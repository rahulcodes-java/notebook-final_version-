const embeddingService = require("./embeddingService");
const chromaService = require("./chromaService");
const geminiService = require("./geminiService");

/**
 * Orchestrates the RAG process: embeddings -> Chroma query -> configurable similarity filtering
 * -> retrieval relevance validation -> strict 3-level grounded answer generation -> source & page attribution
 * @param {string} question - Question asked by user
 * @param {string} userId - Current user's ID
 * @param {string} scope - Search scope ("all" or "mine")
 * @returns {Promise<Object>} - Output matching RAG format (answer, sources)
 */
async function getRAGAnswer(question, userId, scope = "all") {
  if (!question) {
    throw new Error("Question is required for search");
  }

  // Configurable similarity threshold and top-K from environment
  const SIMILARITY_THRESHOLD = parseFloat(process.env.RAG_SIMILARITY_THRESHOLD) || 0.45;
  const TOP_K = parseInt(process.env.RAG_TOP_K, 10) || 10;

  // 1. Generate query embedding vector
  const embedding = await embeddingService.generateEmbedding(question);

  // 2. Build metadata filter for the vector search scope
  const filter = {};
  if (scope === "mine") {
    filter.uploadedBy = userId;
  }

  // 3. Search top candidate chunks in ChromaDB / local fallback store
  const results = await chromaService.queryCollection(embedding, TOP_K, filter, userId);

  const rawChunks = (results.documents && results.documents[0]) || [];
  const metadatas = (results.metadatas && results.metadatas[0]) || [];
  const distances = (results.distances && results.distances[0]) || [];

  // Pair chunks with their metadata and calculate cosine similarity score
  const candidateChunks = rawChunks.map((text, idx) => {
    const meta = metadatas[idx] || {};
    const distance = (distances && distances[idx] !== undefined) ? distances[idx] : 1.0;
    // Cosine distance = 1 - similarity => similarity = 1 - distance
    const similarity = Math.max(0, Math.min(1, 1 - distance));
    return {
      text,
      metadata: meta,
      distance,
      similarity,
      index: idx,
    };
  });

  // Step 4: Configurable vector similarity pre-filter
  const viableCandidates = candidateChunks.filter((c) => c.similarity >= SIMILARITY_THRESHOLD);

  if (viableCandidates.length === 0) {
    console.log(`[RAG Service] No chunks met the similarity threshold (>= ${SIMILARITY_THRESHOLD}).`);
    return {
      answer: geminiService.NOT_ENOUGH_INFO_PHRASE,
      sources: [],
    };
  }

  // Step 5: Check contextual relevance and entity coverage of viable chunks to the question
  const viableTexts = viableCandidates.map((c) => c.text);
  const relevantIndices = await geminiService.checkChunksRelevance(question, viableTexts, viableCandidates);
  const relevantChunks = relevantIndices.map((idx) => viableCandidates[idx]).filter(Boolean);

  console.log(`[RAG Service] Out of ${viableCandidates.length} viable candidate chunks, ${relevantChunks.length} were determined to be contextually relevant.`);

  // If no chunks are relevant or if the question asks about subjects absent from the document, return refusal immediately
  if (relevantChunks.length === 0) {
    return {
      answer: geminiService.NOT_ENOUGH_INFO_PHRASE,
      sources: [],
    };
  }

  // Step 6: Sort relevant chunks by similarity and select top 4 most focused chunks to prevent context dilution
  relevantChunks.sort((a, b) => b.similarity - a.similarity);
  const selectedChunks = relevantChunks.slice(0, 4);

  // Generate answer using the contextually relevant chunks
  const answer = await geminiService.generateAnswer(
    question,
    selectedChunks.map((c) => c.text),
    selectedChunks.map((c) => c.metadata)
  );

  // Step 7: Check if the generated answer is a Level 3 refusal
  const lowerAnswer = answer.toLowerCase();
  const notesUnrelatedPhrases = [
    "does not contain sufficient information",
    "do not contain sufficient information",
    "does not contain information",
    "stored notes are not related",
    "notes are not related",
    "not related to the stored notes",
    "not related to the question",
    "no example or question is present in the stored notes",
  ];
  const isAnswerUnrelated = notesUnrelatedPhrases.some((phrase) => lowerAnswer.includes(phrase));

  if (isAnswerUnrelated) {
    return {
      answer,
      sources: [],
    };
  }

  // Step 8: Deduplicate and gather source list ONLY from relevant chunk metadata, including page numbers
  const sourcesMap = new Map();
  relevantChunks.forEach((item) => {
    const meta = item.metadata;
    if (meta && meta.filename) {
      const key = `${meta.filename}::${meta.uploadedBy}`;
      if (!sourcesMap.has(key)) {
        sourcesMap.set(key, {
          filename: meta.filename,
          uploadedBy: meta.uploadedBy,
          pages: [],
        });
      }
      if (meta.page !== undefined && meta.page !== null) {
        const src = sourcesMap.get(key);
        if (!src.pages.includes(meta.page)) {
          src.pages.push(meta.page);
        }
      }
    }
  });

  const sources = Array.from(sourcesMap.values()).map((s) => {
    s.pages.sort((a, b) => a - b);
    return s;
  });

  return {
    answer,
    sources,
  };
}

module.exports = {
  getRAGAnswer,
};
