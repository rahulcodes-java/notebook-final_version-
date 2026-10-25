const ragService = require("../services/ragService");
const embeddingService = require("../services/embeddingService");
const chromaService = require("../services/chromaService");
const chatHistoryService = require("../services/chatHistoryService");

/**
 * Handle POST /chat requests with session and history persistence
 */
async function chat(req, res) {
  try {
    const { question, scope, sessionId } = req.body;
    const userId = req.user.userId;

    if (!question || typeof question !== "string") {
      return res.status(400).json({
        success: false,
        error: "question is required and must be a string",
      });
    }

    // Default scope is "all" if not specified or invalid
    const targetScope = scope === "mine" ? "mine" : "all";

    // 1. Record the user message in the session history (or create new session)
    const { session: currentSession, message: userMsg } = await chatHistoryService.addMessageToSession(
      userId,
      sessionId,
      "user",
      question
    );

    // 2. Execute RAG pipeline
    const result = await ragService.getRAGAnswer(question, userId, targetScope);

    // 3. Record the AI answer and sources in the session history
    await chatHistoryService.addMessageToSession(
      userId,
      currentSession.id,
      "ai",
      result.answer,
      result.sources
    );

    return res.json({
      ...result,
      sessionId: currentSession.id,
      sessionTitle: currentSession.title,
    });
  } catch (error) {
    console.error("Chat controller error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to process chat query due to server error",
    });
  }
}

/**
 * Handle GET /chat/sessions - Get all sessions for the authenticated user
 */
async function getSessions(req, res) {
  try {
    const userId = req.user.userId;
    const sessions = await chatHistoryService.getSessions(userId);
    return res.json({
      success: true,
      sessions,
    });
  } catch (error) {
    console.error("Get sessions error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to retrieve chat sessions",
    });
  }
}

/**
 * Handle GET /chat/history/:sessionId - Get full messages for a specific session
 */
async function getSessionHistory(req, res) {
  try {
    const userId = req.user.userId;
    const { sessionId } = req.params;

    const session = await chatHistoryService.getSession(userId, sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: "Chat session not found",
      });
    }

    return res.json({
      success: true,
      session,
    });
  } catch (error) {
    console.error("Get session history error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to retrieve session history",
    });
  }
}

/**
 * Handle POST /chat/sessions - Create a new empty chat session
 */
async function createSession(req, res) {
  try {
    const userId = req.user.userId;
    const { title } = req.body || {};

    const session = await chatHistoryService.createSession(userId, title || "New Conversation");
    return res.json({
      success: true,
      session,
    });
  } catch (error) {
    console.error("Create session error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to create new chat session",
    });
  }
}

/**
 * Handle DELETE /chat/history/:sessionId - Delete a specific chat session
 */
async function deleteSession(req, res) {
  try {
    const userId = req.user.userId;
    const { sessionId } = req.params;

    const deleted = await chatHistoryService.deleteSession(userId, sessionId);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: "Chat session not found or already deleted",
      });
    }

    return res.json({
      success: true,
      message: "Chat session deleted successfully",
    });
  } catch (error) {
    console.error("Delete session error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to delete chat session",
    });
  }
}

/**
 * Handle DELETE /chat/history - Clear all chat sessions for the authenticated user
 */
async function clearHistory(req, res) {
  try {
    const userId = req.user.userId;
    const count = await chatHistoryService.clearUserHistory(userId);

    return res.json({
      success: true,
      message: `Cleared ${count} chat session(s)`,
      count,
    });
  } catch (error) {
    console.error("Clear history error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to clear chat history",
    });
  }
}

/**
 * Handle POST /debug-search requests
 */
async function debugSearch(req, res) {
  try {
    const { question } = req.body;

    if (!question || typeof question !== "string") {
      return res.status(400).json({
        success: false,
        error: "question is required and must be a string",
      });
    }

    const userId = req.user.userId;

    console.log(`[Debug Search] Generating embedding for question: "${question}"...`);
    const embedding = await embeddingService.generateEmbedding(question);

    console.log(`[Debug Search] Querying database for top 5 matches...`);
    const results = await chromaService.queryCollection(embedding, 5, {}, userId);

    const chunks = (results.documents && results.documents[0]) || [];
    const distances = (results.distances && results.distances[0]) || [];

    const retrievedChunks = chunks.map((text, index) => {
      const distance = distances[index] !== undefined ? distances[index] : 0;
      // Cosine distance = 1 - similarity. So similarity = 1 - distance.
      const similarityScore = Math.max(0, Math.min(1, 1 - distance));
      return {
        score: parseFloat(similarityScore.toFixed(4)),
        text: text,
      };
    });

    console.log(`[Debug Search] Found ${retrievedChunks.length} chunks. Returning scores.`);
    return res.json({
      retrievedChunks,
    });
  } catch (error) {
    console.error("Debug search error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to query vector store",
    });
  }
}

module.exports = {
  chat,
  getSessions,
  getSessionHistory,
  createSession,
  deleteSession,
  clearHistory,
  debugSearch,
};
