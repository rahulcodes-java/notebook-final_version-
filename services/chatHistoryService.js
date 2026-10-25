const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_FILE = path.join(__dirname, "..", "local-db.json");

// Ensure database file exists with chatSessions container
if (!fsSync.existsSync(DB_FILE)) {
  fsSync.writeFileSync(DB_FILE, JSON.stringify({ users: {}, files: {}, chatSessions: {} }, null, 2));
}

let dbLock = Promise.resolve();

async function readDB() {
  try {
    const data = await fs.readFile(DB_FILE, "utf8");
    const parsed = JSON.parse(data);
    if (!parsed.chatSessions) {
      parsed.chatSessions = {};
    }
    return parsed;
  } catch (err) {
    return { users: {}, files: {}, chatSessions: {} };
  }
}

async function writeDB(data) {
  await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2));
}

function generateId(prefix = "sess") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

/**
 * Get all chat sessions for a specific user, sorted by updatedAt descending
 * @param {string} userId
 * @returns {Promise<Array>}
 */
async function getSessions(userId) {
  const db = await readDB();
  const userSessions = Object.values(db.chatSessions || {})
    .filter((s) => s.userId === userId)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .map((s) => ({
      id: s.id,
      title: s.title || "New Conversation",
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: Array.isArray(s.messages) ? s.messages.length : 0,
    }));
  return userSessions;
}

/**
 * Get a specific session and its full message history
 * @param {string} userId
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
async function getSession(userId, sessionId) {
  const db = await readDB();
  const session = db.chatSessions && db.chatSessions[sessionId];
  if (!session || session.userId !== userId) {
    return null;
  }
  return session;
}

/**
 * Create a new chat session for a user
 * @param {string} userId
 * @param {string} [title]
 * @returns {Promise<Object>}
 */
async function createSession(userId, title = "New Conversation") {
  return new Promise((resolve, reject) => {
    dbLock = dbLock.then(async () => {
      try {
        const db = await readDB();
        const sessionId = generateId("sess");
        const now = new Date().toISOString();
        const newSession = {
          id: sessionId,
          userId,
          title: title.slice(0, 60),
          createdAt: now,
          updatedAt: now,
          messages: [],
        };

        db.chatSessions[sessionId] = newSession;
        await writeDB(db);
        resolve(newSession);
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Add a message to an existing session or auto-create one
 * @param {string} userId
 * @param {string} [sessionId]
 * @param {"user"|"ai"} role
 * @param {string} content
 * @param {Array} [sources]
 * @returns {Promise<{ session: Object, message: Object }>}
 */
async function addMessageToSession(userId, sessionId, role, content, sources = []) {
  return new Promise((resolve, reject) => {
    dbLock = dbLock.then(async () => {
      try {
        const db = await readDB();
        let targetSession = sessionId ? db.chatSessions[sessionId] : null;

        const now = new Date().toISOString();

        // If session doesn't exist or belongs to another user, create new
        if (!targetSession || targetSession.userId !== userId) {
          const newId = generateId("sess");
          const defaultTitle = role === "user" ? content.slice(0, 45).trim() : "New Conversation";
          targetSession = {
            id: newId,
            userId,
            title: defaultTitle || "New Conversation",
            createdAt: now,
            updatedAt: now,
            messages: [],
          };
          db.chatSessions[newId] = targetSession;
        } else {
          // If title is default and this is first user message, update title
          if (
            role === "user" &&
            (targetSession.title === "New Conversation" || !targetSession.title)
          ) {
            targetSession.title = content.slice(0, 45).trim();
          }
        }

        const message = {
          id: generateId("msg"),
          role,
          content,
          sources: Array.isArray(sources) ? sources : [],
          createdAt: now,
        };

        targetSession.messages.push(message);
        targetSession.updatedAt = now;

        await writeDB(db);
        resolve({ session: targetSession, message });
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Delete a specific chat session for a user
 * @param {string} userId
 * @param {string} sessionId
 * @returns {Promise<boolean>}
 */
async function deleteSession(userId, sessionId) {
  return new Promise((resolve, reject) => {
    dbLock = dbLock.then(async () => {
      try {
        const db = await readDB();
        const session = db.chatSessions && db.chatSessions[sessionId];
        if (!session || session.userId !== userId) {
          return resolve(false);
        }

        delete db.chatSessions[sessionId];
        await writeDB(db);
        resolve(true);
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Delete all chat sessions for a specific user
 * @param {string} userId
 * @returns {Promise<number>} - Count of deleted sessions
 */
async function clearUserHistory(userId) {
  return new Promise((resolve, reject) => {
    dbLock = dbLock.then(async () => {
      try {
        const db = await readDB();
        let count = 0;
        for (const [id, session] of Object.entries(db.chatSessions || {})) {
          if (session.userId === userId) {
            delete db.chatSessions[id];
            count++;
          }
        }
        await writeDB(db);
        resolve(count);
      } catch (err) {
        reject(err);
      }
    });
  });
}

module.exports = {
  getSessions,
  getSession,
  createSession,
  addMessageToSession,
  deleteSession,
  clearUserHistory,
};
