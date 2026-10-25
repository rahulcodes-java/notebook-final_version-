const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const { spawn, execFile } = require("child_process");

let serverProcess = null;
const SERVER_PORT = 8081;

/**
 * Ensures the llama-server is running.
 */
async function ensureServerRunning() {
  if (serverProcess) return true;

  const serverExe = path.join(__dirname, "..", "llama-cpp-bin", "llama-server.exe");
  const modelPath = "D:\\Codes\\nuextract\\NuExtract3-Q4_K_M.gguf";
  
  console.log(`[NuExtract Service] Starting llama-server on port ${SERVER_PORT}...`);
  serverProcess = spawn(serverExe, ["-m", modelPath, "--port", SERVER_PORT.toString(), "-c", "4096"]);
  
  serverProcess.on("exit", () => {
    serverProcess = null;
  });
  
  // Wait for server to be responsive
  return new Promise((resolve) => {
    let attempts = 0;
    const check = async () => {
      attempts++;
      try {
        const res = await fetch(`http://127.0.0.1:${SERVER_PORT}/health`);
        if (res.ok) return resolve(true);
      } catch (err) {
        // ignore
      }
      if (attempts > 30) {
        console.log("[NuExtract Service] Server taking a long time to start or failed.");
        resolve(true); // just proceed and let fetch fail if it's still down
      } else {
        setTimeout(check, 2000);
      }
    };
    check();
  });
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
        const jsonStr = stdout.substring(stdout.indexOf('{'));
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
 */
async function processNotes(text, buffer) {
  try {
    await ensureServerRunning();
    
    console.log("[NuExtract Service] Extracting images from PDF...");
    let images = [];
    if (buffer) {
      images = await extractBase64ImagesFromPDF(buffer);
      console.log(`[NuExtract Service] Extracted ${images.length} images from PDF.`);
    }

    const instructions = `You are a note extraction AI. Process the provided text and document images to extract structured notes. Accurately describe any diagrams, graphs, and important data points shown in the images.`;
    const jsonTemplate = {
      "Extracted_Notes": "",
      "Diagrams_and_Graphs_Descriptions": ""
    };

    const promptText = `${instructions}\n\nText:\n${text}\n\nTemplate:\n${JSON.stringify(jsonTemplate, null, 2)}`;
    
    const content = [
      { type: "text", text: promptText }
    ];
    
    for (const b64 of images) {
       content.push({
         type: "image_url",
         image_url: { url: `data:image/png;base64,${b64}` }
       });
    }

    console.log("[NuExtract Service] Passing text and images to local NuExtract3 model...");
    
    const response = await fetch(`http://127.0.0.1:${SERVER_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "nuextract3",
        messages: [{ role: "user", content: content }],
        stream: false,
        temperature: 0.2
      })
    });

    if (!response.ok) {
      throw new Error(`API returned status ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    console.log("[NuExtract Service] Finished processing notes.");
    return data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : text;
  } catch (err) {
    console.error("[NuExtract Service] Error processing with NuExtract:", err);
    return text;
  }
}

module.exports = {
  processNotes
};
