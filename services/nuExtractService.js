const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const { spawn, execFile } = require("child_process");

let serverProcess = null;
let spawnFailed = false;

const SERVER_PORT = Number(process.env.NUEXTRACT_PORT || 8081);

// 16384 matches the known-working configuration from the reference project.
// The previous 8192 value truncated longer extractions.
const SERVER_CTX = Number(process.env.NUEXTRACT_CTX || 16384);

// One llama-server request per image batch. 1 keeps the reference behaviour.
const IMAGE_BATCH_SIZE = Math.max(1, Number(process.env.NUEXTRACT_IMAGE_BATCH || 1));

// Per-request timeout so a stuck generation cannot hang an upload forever.
const REQUEST_TIMEOUT_MS = Number(process.env.NUEXTRACT_TIMEOUT_MS || 300000);

const SERVER_BIN_DIR = path.join(__dirname, "..", "llama-cpp-bin");
const SERVER_EXE = path.join(SERVER_BIN_DIR, "llama-server.exe");
const MODEL_PATH = "D:\\Codes\\nuextract\\NuExtract3-Q4_K_M.gguf";
const MMPROJ_PATH = "D:\\Codes\\nuextract\\mmproj-NuExtract3-BF16.gguf";

// Cached result of device discovery: ["--device", "<id>"] or [] for CPU-only.
let deviceArgsCache = null;

async function probeHealth() {
  try {
    const res = await fetch(`http://127.0.0.1:${SERVER_PORT}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

/**
 * Picks the fastest available llama.cpp device.
 * Prefers a discrete NVIDIA GPU, then any other GPU, then plain CPU.
 * Without --device the build auto-offloads too, but discovering the device makes
 * the choice explicit and reproducible across machines.
 */
function resolveDeviceArgs() {
  if (deviceArgsCache) return Promise.resolve(deviceArgsCache);

  return new Promise((resolve) => {
    const done = (args) => {
      deviceArgsCache = args;
      resolve(args);
    };

    if (!require("fs").existsSync(SERVER_EXE)) return done([]);

    execFile(SERVER_EXE, ["--list-devices"], { timeout: 20000 }, (err, stdout) => {
      if (err) {
        console.warn(`[NuExtract Service] Device listing failed (${err.message}); using defaults.`);
        return done([]);
      }
      const devices = [];
      for (const raw of String(stdout).split(/\r?\n/)) {
        const m = raw.trim().match(/^(Vulkan\d+|CUDA\d+|Metal):\s*(.+)$/);
        if (m) devices.push({ id: m[1], name: m[2] });
      }
      const chosen =
        devices.find((d) => /nvidia|geforce|rtx/i.test(d.name)) ||
        devices.find((d) => !/radeon\s*740m|intel|uhd/i.test(d.name)) ||
        devices[0];
      if (chosen) {
        console.log(`[NuExtract Service] Using GPU device ${chosen.id} (${chosen.name})`);
        // --mmproj-device must be set explicitly. Relying on its documented default
        // ("follows --device") leaves the image projector on the CPU, which makes
        // prompt evaluation ~50x slower for image requests.
        return done(["--device", chosen.id, "--mmproj-device", chosen.id]);
      }
      console.log("[NuExtract Service] No GPU device found; using default device policy.");
      return done([]);
    });
  });
}

function spawnServer(deviceArgs) {
  const serverArgs = [
    "-m", MODEL_PATH,
    "--port", String(SERVER_PORT),
    "-c", String(SERVER_CTX),
    "-np", "1",
    ...deviceArgs,
  ];
  if (require("fs").existsSync(MMPROJ_PATH)) {
    serverArgs.push("--mmproj", MMPROJ_PATH);
  }

  console.log(`[NuExtract Service] Starting llama-server on port ${SERVER_PORT}...`);
  const child = spawn(SERVER_EXE, serverArgs, {
    cwd: SERVER_BIN_DIR,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // The server is chatty. If these pipes were left unread their 64 KB buffers
  // would fill up and eventually block it mid-generation, so drain them and
  // forward only the lines that are useful for diagnosing performance/problems.
  const forward = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (!line.trim()) continue;
      if (/error|bad allocation|failed|timings|prompt eval time|kv cache/i.test(line)) {
        console.log(`[llama-server] ${line}`);
      }
    }
  };
  child.stdout.on("data", forward);
  child.stderr.on("data", forward);

  child.on("exit", (code, signal) => {
    console.warn(`[NuExtract Service] llama-server exited (code=${code}, signal=${signal}).`);
    if (serverProcess === child) serverProcess = null;
  });
  child.on("error", (err) => {
    console.error(`[NuExtract Service] Failed to spawn llama-server: ${err.message}`);
    spawnFailed = true;
    if (serverProcess === child) serverProcess = null;
  });

  serverProcess = child;
  spawnFailed = false;
  return child;
}

/**
 * Ensures the llama-server is running. Reuses an already-running instance so a
 * restarted app does not fight over port 8081.
 */
async function ensureServerRunning() {
  if (serverProcess) return true;

  if (await probeHealth()) {
    console.log(`[NuExtract Service] Reusing llama-server already listening on port ${SERVER_PORT}.`);
    return true;
  }

  const deviceArgs = await resolveDeviceArgs();
  spawnServer(deviceArgs);

  const healthy = await waitForHealth(180000);

  // If the chosen device was rejected, retry once with the default device policy.
  if (!healthy && deviceArgs.length > 0 && !spawnFailed) {
    console.warn("[NuExtract Service] Server did not become healthy with the selected device; retrying with defaults.");
    try { serverProcess && serverProcess.kill(); } catch (e) { /* ignore */ }
    serverProcess = null;
    spawnServer([]);
    return waitForHealth(180000);
  }

  if (!healthy) {
    console.error("[NuExtract Service] llama-server failed to start; calls will fall back to raw text.");
  }
  return healthy;
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (spawnFailed) return false;
    if (await probeHealth()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function extractBase64ImagesFromPDF(buffer) {
  const tempPdfPath = path.join(os.tmpdir(), `temp_${Date.now()}.pdf`);
  await fs.writeFile(tempPdfPath, buffer);

  return new Promise((resolve, reject) => {
    const pythonScript = path.join(__dirname, "..", "utils", "pdf_to_base64.py");
    execFile("python", [pythonScript, tempPdfPath], { maxBuffer: 1024 * 1024 * 100 }, async (error, stdout, stderr) => {
      await fs.unlink(tempPdfPath).catch(() => {});
      if (error) {
        return reject(error);
      }
      try {
        const jsonStr = stdout.substring(stdout.indexOf("{"));
        const result = JSON.parse(jsonStr);
        if (result.success) {
          resolve(result.images);
        } else {
          reject(new Error(result.error));
        }
      } catch (err) {
        reject(new Error("Failed to parse Python script output: " + err.message));
      }
    });
  });
}

/**
 * Process text and PDF buffer through NuExtract3 via local llama-server.
 * Returns the enhanced text, or the original text if extraction is unavailable.
 */
async function processNotes(text, buffer) {
  try {
    const started = Date.now();
    await ensureServerRunning();

    console.log("[NuExtract Service] Extracting images from PDF...");
    let images = [];
    if (buffer) {
      images = await extractBase64ImagesFromPDF(buffer);
      console.log(`[NuExtract Service] Extracted ${images.length} images from PDF.`);
    }

    const instructions = `You are a note extraction AI. Process the provided text and document images to extract structured notes. Accurately describe any diagrams, graphs, and important data points shown in the images.`;
    const jsonTemplate = {
      Extracted_Notes: "",
      Diagrams_and_Graphs_Descriptions: "",
    };

    const promptText = `${instructions}\n\nText:\n${text}\n\nTemplate:\n${JSON.stringify(jsonTemplate, null, 2)}`;

    const imageBatches = [];
    for (let i = 0; i < images.length; i += IMAGE_BATCH_SIZE) {
      imageBatches.push(images.slice(i, i + IMAGE_BATCH_SIZE));
    }
    if (imageBatches.length === 0) imageBatches.push([]);

    const results = [];
    for (let batchIndex = 0; batchIndex < imageBatches.length; batchIndex++) {
      const content = [{ type: "text", text: promptText }];
      for (const b64 of imageBatches[batchIndex]) {
        content.push({
          type: "image_url",
          image_url: { url: `data:image/png;base64,${b64}` },
        });
      }

      console.log(`[NuExtract Service] Processing image batch ${batchIndex + 1}/${imageBatches.length}...`);
      const response = await fetch(`http://127.0.0.1:${SERVER_PORT}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "nuextract3",
          messages: [{ role: "user", content }],
          stream: false,
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`API returned status ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();
      const result =
        data.choices && data.choices[0] && data.choices[0].message
          ? data.choices[0].message.content
          : "";
      if (result) results.push(result);
    }

    const enhanced = results.join("\n\n");
    console.log(
      `[NuExtract Service] Finished processing notes in ${((Date.now() - started) / 1000).toFixed(1)}s ` +
        `(${enhanced.length} chars).`
    );
    if (!enhanced) {
      console.warn("[NuExtract Service] Model returned no text; falling back to the input text.");
      return text;
    }
    return enhanced;
  } catch (err) {
    console.error("[NuExtract Service] Error processing with NuExtract:", err.message || err);
    console.error("[NuExtract Service] Falling back to the un-enriched input text.");
    return text;
  }
}

// Do not leave an orphaned llama-server holding several GB of RAM behind us.
process.on("exit", () => {
  if (serverProcess) {
    try { serverProcess.kill(); } catch (err) { /* ignore */ }
  }
});

module.exports = {
  processNotes,
  ensureServerRunning,
};
