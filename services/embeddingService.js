const path = require("path");

let extractor = null;

async function getLocalExtractor() {
  if (!extractor) {
    const { pipeline } = await import("@huggingface/transformers");
    // Xenova/all-MiniLM-L6-v2 is standard and runs locally using ONNX runtime
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return extractor;
}

/**
 * Generate embedding vector using Ollama (nomic-embed-text) or local HuggingFace (all-MiniLM-L6-v2) fallback
 * @param {string} text - The input text content to embed
 * @returns {Promise<number[]>} - The vector representation of the text
 */
async function generateEmbedding(text) {
  if (!text || typeof text !== "string") {
    throw new Error("Text content must be a non-empty string to generate embeddings");
  }

  // 1. Attempt using local Ollama model (nomic-embed-text)
  try {
    const response = await fetch("http://localhost:11434/api/embed", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "nomic-embed-text",
        input: text,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data && data.embeddings && data.embeddings[0]) {
        console.log(`[Embedding Service] Successfully generated embedding of length ${data.embeddings[0].length} using Ollama (nomic-embed-text)`);
        return data.embeddings[0];
      }
    }
    throw new Error(`Ollama responded with status: ${response.status}`);
  } catch (ollamaError) {
    // 2. Cascade fallback to local ONNX Transformers (all-MiniLM-L6-v2)
    console.warn(`[Embedding Service] Ollama not available or failed (${ollamaError.message}). Falling back to local all-MiniLM-L6-v2 model...`);
    try {
      const localExtractor = await getLocalExtractor();
      const output = await localExtractor(text, {
        pooling: "mean",
        normalize: true,
      });
      const embedding = Array.from(output.data);
      console.log(`[Embedding Service] Successfully generated local embedding of length ${embedding.length} using sentence-transformers (all-MiniLM-L6-v2)`);
      return embedding;
    } catch (localError) {
      console.error("[Embedding Service] Local embedding generation failed:", localError.message);
      throw new Error(`Failed to generate real semantic embeddings: ${localError.message}`);
    }
  }
}

module.exports = {
  generateEmbedding,
};
