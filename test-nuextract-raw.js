// Raw check: hits a running llama-server (NuExtract3) directly on port 8081,
// mirroring the exact request shape used by services/nuExtractService.js
const SERVER = "http://127.0.0.1:8081";

const testText =
  "Docker containers package applications together with their dependencies. " +
  "An image is a blueprint; a container is a running instance. " +
  "Volumes keep data persistent beyond the container lifecycle.";

const jsonTemplate = {
  Extracted_Notes: "",
  Diagrams_and_Graphs_Descriptions: "",
};

const promptText =
  `You are a note extraction AI. Process the provided text to extract structured notes.\n\n` +
  `Text:\n${testText}\n\nTemplate:\n${JSON.stringify(jsonTemplate, null, 2)}`;

async function main() {
  const started = Date.now();

  // 1. health
  const health = await fetch(`${SERVER}/health`);
  console.log(`[1] GET /health -> ${health.status} ${JSON.stringify(await health.json())}`);
  if (!health.ok) throw new Error("llama-server is not healthy");

  // 2. chat completion (exact shape used by nuExtractService)
  const res = await fetch(`${SERVER}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "nuextract3",
      messages: [{ role: "user", content: [{ type: "text", text: promptText }] }],
      stream: false,
      temperature: 0.2,
    }),
  });

  const elapsed = Date.now() - started;
  console.log(`[2] POST /v1/chat/completions -> ${res.status} in ${elapsed}ms`);

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Server returned ${res.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }

  const content =
    data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : "";

  if (!content || !content.trim()) throw new Error("Model returned empty content");

  console.log(`\n[3] Model output (${content.length} chars):`);
  console.log(content);
  console.log("\n✅ NuExtract (llama-server) is WORKING");
  console.log(
    `[stats] tokens: ${JSON.stringify(data.usage || {})} | wall time: ${elapsed}ms`
  );
}

main().catch((err) => {
  console.error("\n❌ NuExtract test FAILED:", err.message);
  process.exit(1);
});
