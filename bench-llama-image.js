// Measures where time goes for ONE image-based NuExtract request by capturing
// llama-server's own timing logs.
// Usage: node bench-llama-image.js [path-to-pdf]
const { spawn, execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const BIN_DIR = path.join(__dirname, "llama-cpp-bin");
const EXE = path.join(BIN_DIR, "llama-server.exe");
const MODEL = "D:\\Codes\\nuextract\\NuExtract3-Q4_K_M.gguf";
const MMPROJ = "D:\\Codes\\nuextract\\mmproj-NuExtract3-BF16.gguf";
const PORT = 8085;
const PDF = process.argv[2] || "D:\\Codes\\qa-test-upload.pdf";

function getImageB64(pdfPath) {
  return new Promise((resolve, reject) => {
    execFile(
      "python",
      [path.join(__dirname, "utils", "pdf_to_base64.py"), pdfPath],
      { maxBuffer: 1024 * 1024 * 200 },
      (err, stdout) => {
        if (err) return reject(err);
        try {
          const json = JSON.parse(stdout.substring(stdout.indexOf("{")));
          resolve(json.images[0]);
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

async function main() {
  const b64 = await getImageB64(PDF);
  console.log(`image base64 length: ${b64.length} (${(b64.length * 0.75 / 1024).toFixed(0)} KB)`);

  const args = [
    "-m", MODEL, "--port", String(PORT), "-c", "16384", "-np", "1",
    "--device", "Vulkan1", "--mmproj", MMPROJ,
    ...(process.env.BENCH_EXTRA ? process.env.BENCH_EXTRA.trim().split(/\s+/) : []),
  ];
  console.log("spawning:", args.join(" "));
  const t0 = Date.now();
  const child = spawn(EXE, args, { cwd: BIN_DIR, stdio: ["ignore", "pipe", "pipe"] });

  let log = "";
  const cap = (d) => {
    const s = String(d);
    log += s;
    for (const line of s.split(/\r?\n/)) {
      if (/timings|prompt eval|encode|error|bad allocation|offload|load_model|using|device/i.test(line))
        console.log("  | " + line);
    }
  };
  child.stdout.on("data", cap);
  child.stderr.on("data", cap);
  child.on("exit", (c) => console.log("server exited", c));

  // wait healthy
  for (let i = 0; i < 180; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.ok) break;
    } catch (e) { /* not up */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`healthy after ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  const prompt =
    `You are a note extraction AI. Extract structured notes.\n\nText:\nSample text about containers.\n\n` +
    `Template:\n${JSON.stringify({ Extracted_Notes: "", Diagrams_and_Graphs_Descriptions: "" }, null, 2)}`;

  const c0 = Date.now();
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "nuextract3",
      messages: [{ role: "user", content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
      ] }],
      stream: false,
      temperature: 0.2,
    }),
  });
  const ms = Date.now() - c0;
  const j = await res.json();
  const u = j.usage || {};
  const content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";

  console.log(`\n=== RESULT ===`);
  console.log(`total ${ms} ms | prompt ${u.prompt_tokens} tok | completion ${u.completion_tokens} tok`);
  console.log(`gen speed: ${(u.completion_tokens / (ms / 1000)).toFixed(1)} tok/s (includes prompt eval)`);
  console.log(`output ${content.length} chars`);

  // Isolate: text-only request for comparison.
  const t2 = Date.now();
  const res2 = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "nuextract3",
      messages: [{ role: "user", content: prompt }],
      stream: false, temperature: 0.2,
    }),
  });
  const ms2 = Date.now() - t2;
  const j2 = await res2.json();
  const u2 = j2.usage || {};
  console.log(`\n=== TEXT-ONLY CONTROL ===`);
  console.log(`total ${ms2} ms | prompt ${u2.prompt_tokens} tok | completion ${u2.completion_tokens} tok`);

  child.kill();
  setTimeout(() => process.exit(0), 800);
}

main().catch((e) => {
  console.error("bench failed:", e);
  process.exit(1);
});
