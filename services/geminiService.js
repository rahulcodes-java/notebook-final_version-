const OpenAI = require("openai");

const apiKey = process.env.GROQ_API_KEY;
console.log("Groq key loaded:", !!apiKey);

const NOT_ENOUGH_INFO_PHRASE = "The provided document does not contain sufficient information to answer this question.";

function getClientConfig() {
  const currentKey = process.env.GROQ_API_KEY;
  if (!currentKey || currentKey.trim() === "" || currentKey === "DUMMY_KEY") {
    return {
      client: new OpenAI({
        apiKey: "ollama",
        baseURL: "http://localhost:11434/v1",
      }),
      model: process.env.OLLAMA_MODEL || "deepseek-r1:1.5b",
      isLocal: true,
    };
  }
  return {
    client: new OpenAI({
      apiKey: currentKey,
      baseURL: "https://api.groq.com/openai/v1",
    }),
    model: "llama-3.1-8b-instant",
    isLocal: false,
  };
}

function getClient() {
  return getClientConfig().client;
}

const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but",
  "by", "can", "cannot", "could", "did", "do", "does", "doing", "down", "during", "each",
  "few", "for", "from", "further", "had", "has", "have", "having", "he", "her", "here",
  "hers", "herself", "him", "himself", "his", "how", "i", "if", "in", "into", "is", "it",
  "its", "itself", "just", "me", "more", "most", "my", "myself", "no", "nor", "not", "of",
  "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out",
  "over", "own", "same", "she", "should", "so", "some", "such", "than", "that", "the", "their",
  "theirs", "them", "themselves", "then", "there", "these", "they", "this", "those", "through",
  "to", "too", "under", "until", "up", "very", "was", "we", "were", "what", "when", "where",
  "which", "while", "who", "whom", "why", "with", "would", "you", "your", "yours", "yourself",
  "yourselves", "tell", "give", "explain", "describe", "define", "please", "question", "questions"
]);

/**
 * Extracts non-stopword normalized tokens from a question.
 */
function extractQueryTerms(question) {
  if (!question || typeof question !== "string") return [];
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

/**
 * Extracts named technologies, tools, platforms, or specialized proper nouns from a query.
 */
function extractSpecificSubjects(question) {
  const terms = extractQueryTerms(question);
  const commonTechnicalEntities = [
    "kubernetes", "k8s", "hypervisor", "docker", "openshift", "openstack",
    "ansible", "terraform", "kafka", "redis", "mongodb", "postgresql", "mysql",
    "nginx", "apache", "rabbitmq", "elasticsearch", "consul", "istio", "helm"
  ];
  return terms.filter((t) => commonTechnicalEntities.includes(t));
}

/**
 * Evaluates contextual relevance of a single chunk against a question.
 */
function evaluateChunkRelevance(question, chunkText, similarity = 0) {
  if (!chunkText || typeof chunkText !== "string") {
    return { isRelevant: false, score: 0 };
  }

  const queryTerms = extractQueryTerms(question);
  if (queryTerms.length === 0) {
    return { isRelevant: true, score: 0.5 };
  }

  const chunkLower = chunkText.toLowerCase();

  // Strict check for specific requested entities (e.g. Kubernetes):
  // If the question specifically asks about a distinct named technology,
  // a chunk that does not mention that technology cannot answer questions about it.
  const specificSubjects = extractSpecificSubjects(question);
  if (specificSubjects.length > 0) {
    const hasSubject = specificSubjects.some(
      (sub) => chunkLower.includes(sub) || (sub === "kubernetes" && chunkLower.includes("k8s"))
    );
    if (!hasSubject) {
      return { isRelevant: false, score: 0, reason: "Missing specific requested subject" };
    }
  }

  const matchedTerms = queryTerms.filter((t) => chunkLower.includes(t));
  const termCoverage = matchedTerms.length / queryTerms.length;
  const compositeScore = (similarity * 0.6) + (termCoverage * 0.4);

  // Relevant if has adequate term coverage or strong composite score
  const isRelevant =
    (matchedTerms.length >= 2 && (termCoverage >= 0.25 || compositeScore >= 0.40)) ||
    (matchedTerms.length >= 1 && queryTerms.length <= 2) ||
    termCoverage >= 0.45;

  return {
    isRelevant,
    score: compositeScore,
    matchedTerms,
    termCoverage,
  };
}

/**
 * Fallback heuristic to evaluate contextual chunk relevance based on query keywords and token overlap.
 */
function fallbackRelevanceCheck(question, chunks) {
  if (!chunks || chunks.length === 0) return [];
  const relevantIndices = [];
  chunks.forEach((chunk, index) => {
    const evalRes = evaluateChunkRelevance(question, chunk, 0.5);
    if (evalRes.isRelevant) {
      relevantIndices.push(index);
    }
  });
  return relevantIndices;
}

/**
 * Evaluates whether candidate chunks are contextually related to the user's question.
 * @param {string} question - User's chat question
 * @param {string[]} chunks - Context snippets retrieved from vector store
 * @param {Array<Object>} candidates - Candidate chunk objects with similarity and metadata
 * @returns {Promise<number[]>} - Array of indices of chunks that are actually relevant
 */
async function checkChunksRelevance(question, chunks, candidates = []) {
  if (!question || !chunks || chunks.length === 0) {
    return [];
  }

  // 1. Entity and topic absence pre-check:
  // If the question specifies a dedicated subject (e.g. "Kubernetes") that is completely
  // absent from all candidate chunks, return empty array immediately to avoid false positive retrieval.
  const specificSubjects = extractSpecificSubjects(question);
  if (specificSubjects.length > 0) {
    const allChunksText = chunks.join(" ").toLowerCase();
    const subjectFound = specificSubjects.some(
      (sub) => allChunksText.includes(sub) || (sub === "kubernetes" && allChunksText.includes("k8s"))
    );
    if (!subjectFound) {
      console.log(`[Relevance Check] Specific requested subject(s) [${specificSubjects.join(", ")}] not found in any candidate chunk.`);
      return [];
    }
  }

  // 2. Score candidate chunks
  const relevantIndices = [];
  chunks.forEach((chunk, index) => {
    const cand = candidates[index];
    const sim = cand && cand.similarity !== undefined ? cand.similarity : 0.5;
    const evalRes = evaluateChunkRelevance(question, chunk, sim);
    if (evalRes.isRelevant) {
      relevantIndices.push(index);
    }
  });

  console.log(`[Relevance Check] Out of ${chunks.length} chunks, ${relevantIndices.length} passed contextual relevance validation.`);
  return relevantIndices;
}

/**
 * Post-generation guardrail to verify that the generated answer is faithful to the context
 * and strictly adheres to the Three-Level Question Handling rules.
 */
function verifyAndSanitizeAnswer(answer, question, chunks) {
  if (!answer || typeof answer !== "string") {
    return NOT_ENOUGH_INFO_PHRASE;
  }

  const lowerAnswer = answer.toLowerCase().trim();

  // 1. Normalize refusal phrases to the canonical standard
  const refusalTriggers = [
    "does not contain sufficient information",
    "do not contain sufficient information",
    "does not contain information",
    "stored notes are not related",
    "notes are not related",
    "not related to the stored notes",
    "not related to the question",
    "cannot answer based on the provided",
    "not mentioned in the provided",
  ];

  const hasRefusal = refusalTriggers.some((t) => lowerAnswer.includes(t));
  if (hasRefusal) {
    if (!lowerAnswer.startsWith("the provided document does not contain sufficient information")) {
      return NOT_ENOUGH_INFO_PHRASE;
    }
    return answer;
  }

  // 2. Hallucination interceptor for absent specific subjects:
  // If the user question specifically asked about an entity (e.g. "Kubernetes") completely absent from all chunks,
  // but the LLM generated an ungrounded fabricated answer:
  const specificSubjects = extractSpecificSubjects(question);
  if (specificSubjects.length > 0) {
    const fullChunksText = chunks.join(" ").toLowerCase();
    const subjectInChunks = specificSubjects.some(
      (s) => fullChunksText.includes(s) || (s === "kubernetes" && fullChunksText.includes("k8s"))
    );
    if (!subjectInChunks) {
      console.warn(`[Guardrail] Intercepted hallucinated response for absent subject [${specificSubjects.join(", ")}]. Replacing with Level 3 refusal.`);
      return NOT_ENOUGH_INFO_PHRASE;
    }
  }

  return answer;
}

/**
 * Generates an answer based strictly on the provided context chunks.
 * Enforces Three-Level Question Handling (Direct, Indirect Synthesis, and Not Answerable).
 * @param {string} question - User's chat question
 * @param {string[]} chunks - Context snippets retrieved from document
 * @param {Array<Object>} metadatas - Metadata associated with chunks (including page numbers)
 * @returns {Promise<string>} - The grounded generated response
 */
async function generateAnswer(question, chunks, metadatas = []) {
  if (!question) {
    throw new Error("Question is required for answer generation");
  }

  // If no context chunks are supplied, immediately state the document lacks information
  if (!chunks || chunks.length === 0) {
    return NOT_ENOUGH_INFO_PHRASE;
  }

  const config = getClientConfig();

  try {
    // Format chunks context with optional page number attribution
    const context = chunks
      .map((c, i) => {
        const meta = metadatas && metadatas[i] ? metadatas[i] : {};
        const pageLabel = meta.page ? ` (Page ${meta.page})` : "";
        return `[Notes Excerpt ${i + 1}${pageLabel}]:\n${c}`;
      })
      .join("\n\n");

    const fullNotesText = chunks.join(" ");

    // Check if user specifically requested practice questions or examples
    const isAskingForQuestions = /\b(practice questions?|exam questions?|quiz questions?|test questions?|sample questions?|give (me )?(some )?questions?|3 questions|questions? for practice)\b/i.test(question);
    const isAskingForExamples = /\b(give (me )?(some )?examples?|provide (some )?examples?|practice examples?)\b/i.test(question);

    if (isAskingForQuestions) {
      const hasQuestionsInNotes = /\?|question\s*\d|exercise\s*\d|review question/i.test(fullNotesText);
      if (!hasQuestionsInNotes) {
        return "No example or question is present in the stored notes for this topic.";
      }
    }

    if (isAskingForExamples) {
      const hasExamplesInNotes = /\b(example|examples|e\.g\.|for instance)\b/i.test(fullNotesText);
      if (!hasExamplesInNotes) {
        return "No example or question is present in the stored notes for this topic.";
      }
    }

    const systemInstruction = `You are an expert document-grounded question-answering assistant. Your sole purpose is to answer the user's question based strictly and exclusively on the provided document excerpts.

CRITICAL GROUNDING AND ZERO-HALLUCINATION RULES:
1. Answer strictly using facts and information explicitly present in the provided excerpts.
2. NEVER use prior knowledge, training data, or external information to fill in missing details.
3. NEVER invent, fabricate, or extrapolate technical specifications, protocol names (e.g. NEVER invent protocol names like "SDP" or "SDP2"), algorithms, scaling factors (e.g. NEVER invent "3x scaling factor"), numbers, or statistics.
4. Do NOT claim or imply that a technology, feature, or mechanism is mentioned in the document unless it is explicitly written in the provided excerpts.
5. THREE-LEVEL QUESTION HANDLING:
   - Level 1 (Directly Answerable): If the answer is explicitly stated in the document excerpts, provide a direct, concise, and accurate answer based on the excerpts.
   - Level 2 (Indirectly Answerable / Multi-Chunk Synthesis): If the answer requires combining multiple sections or concepts from the excerpts (e.g., combining elasticity, pay-as-you-go pricing, and service models), synthesize the information carefully. Every factual claim must be directly supported by the text.
   - Level 3 (Not Answerable): If the provided excerpts do not contain sufficient information to answer the question, you MUST return:
     "${NOT_ENOUGH_INFO_PHRASE}"
     You may optionally add a brief, neutral clarification of what related information IS discussed in the document (e.g., "The document discusses virtualization, virtual machines, and cloud compute fundamentals, but does not contain information about Kubernetes container orchestration, pod scaling, service discovery, or load balancing."), without pretending it answers the question.
6. PARTIAL ANSWER HANDLING:
   If only part of a question is answered by the excerpts:
   - Answer the supported parts accurately.
   - Explicitly identify the unsupported parts: "Note: The provided document does not contain information regarding [unsupported aspect]."
   - Never generate unsupported explanations to make the answer appear complete.
7. PRIORITIZE FAITHFULNESS OVER COMPLETENESS:
   It is far better to state that information is absent than to generate an unverified or fabricated explanation.`;

    const userPrompt = `Context Excerpts from Document:
${context}

User Question: ${question}

Instructions:
Answer strictly based on the excerpts above. If the document does not contain sufficient information to answer the question, return:
"${NOT_ENOUGH_INFO_PHRASE}"

Response:`;

    console.log(`[RAG LLM] Submitting completions request (${config.isLocal ? "Local Ollama" : "Groq API"}) with ${chunks.length} context chunks...`);
    const chatCompletion = await config.client.chat.completions.create({
      model: config.model,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.0,
    });

    if (chatCompletion && chatCompletion.choices && chatCompletion.choices[0] && chatCompletion.choices[0].message) {
      console.log("[RAG LLM] Received answer generation response successfully");
      let content = chatCompletion.choices[0].message.content.trim();
      content = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

      // Post-generation verification
      return verifyAndSanitizeAnswer(content, question, chunks);
    } else {
      throw new Error("LLM API returned an empty response.");
    }
  } catch (error) {
    console.error("QA Generation error:", error.message);
    throw error;
  }
}

/**
 * A direct wrapper to test the raw LLM API content generation without context constraints.
 * @param {string} promptText
 * @returns {Promise<string>}
 */
async function generateTestResponse(promptText) {
  const config = getClientConfig();

  try {
    console.log("[LLM API] Submitting raw completions test request...");
    const chatCompletion = await config.client.chat.completions.create({
      model: config.isLocal ? config.model : "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: promptText }],
    });

    if (chatCompletion && chatCompletion.choices && chatCompletion.choices[0] && chatCompletion.choices[0].message) {
      console.log("[LLM API] Received completions test response successfully");
      let content = chatCompletion.choices[0].message.content.trim();
      content = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      return content;
    } else {
      throw new Error("LLM API returned an empty response.");
    }
  } catch (error) {
    console.error("Direct generation error:", error.message);
    throw error;
  }
}

module.exports = {
  generateAnswer,
  generateTestResponse,
  checkChunksRelevance,
  fallbackRelevanceCheck,
  evaluateChunkRelevance,
  verifyAndSanitizeAnswer,
  NOT_ENOUGH_INFO_PHRASE,
};
