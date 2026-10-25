const fs = require("fs");

async function test() {
  const { getLlama, LlamaChatSession } = await import("node-llama-cpp");
  const llama = await getLlama();
  const modelPath = "D:\\Codes\\nuextract\\NuExtract3-Q4_K_M.gguf";
  console.log("Loading model...");
  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext();
  const session = new LlamaChatSession({
    contextSequence: context.getSequence()
  });

  console.log("Model loaded successfully. Testing image prompt...");
  // Dummy base64 1x1 pixel png
  const dummyBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  
  const prompt = `<|input|>
### Template:
{
  "Extracted_Notes": "",
  "Diagrams_and_Graphs_Descriptions": ""
}
### Text:
[image]
<|predict|>`;

  try {
    const res = await session.prompt(prompt, {
      maxTokens: 100,
      onTextChunk: (text) => process.stdout.write(text),
      // In node-llama-cpp v3, you can pass an array of images or similar?
      // Wait, let's see what works. Let's just try text first to ensure it's generating something.
    });
    console.log("\nResponse:", res);
  } catch (e) {
    console.error("Error during prompt:", e);
  }
}

test().catch(console.error);
