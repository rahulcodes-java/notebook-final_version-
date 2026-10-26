const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "..", "local-db.json");

// Initialize database file if it doesn't exist
if (!fsSync.existsSync(DB_FILE)) {
  fsSync.writeFileSync(DB_FILE, JSON.stringify({ users: {}, files: {} }, null, 2));
}

async function readDB() {
  try {
    const data = await fs.readFile(DB_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    return { users: {}, files: {} };
  }
}

async function writeDB(data) {
  await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2));
}

/**
 * Fetch a user by userId
 * @param {string} userId
 * @returns {Promise<Object|null>} - User item or null
 */
async function getUser(userId) {
  const db = await readDB();
  return db.users[userId] || null;
}

/**
 * Create a new user
 * @param {string} userId
 * @param {string} passwordHash
 * @returns {Promise<Object>} - The created user object
 */
async function createUser(userId, passwordHash) {
  const db = await readDB();
  const item = {
    userId,
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  db.users[userId] = item;
  await writeDB(db);
  return item;
}

/**
 * Fetch a file by its SHA256 hash
 * @param {string} hash
 * @returns {Promise<Object|null>} - File item or null
 */
async function getFileByHash(hash) {
  const db = await readDB();
  return db.files[hash] || null;
}

/**
 * Asynchronously runs indexing inline
 */
async function triggerInlineIndexing(s3Key, hash) {
  console.log(`[Inline Indexing] Start background indexing for Key: ${s3Key}`);
  try {
    const s3Service = require("./s3Service");
    const embeddingService = require("./embeddingService");
    const chromaService = require("./chromaService");
    const pdfExtractor = require("../utils/pdfExtractor");
    const chunkText = require("../utils/chunkText");

    await updateIndexStatus(hash, "PROCESSING");
    
    const buffer = await s3Service.downloadFile(s3Key);
    
    const rawText = await pdfExtractor.extractText(buffer);
    const hasText = !!rawText && rawText.trim().length > 0;

    // A scanned / image-only PDF has no text layer. That is precisely the case
    // NuExtract (the vision model) exists for, so hand it the page images rather
    // than failing the upload outright.
    const SOURCE_INSTRUCTION =
      "This document has no text layer. Read the page images and transcribe their text, " +
      "describing any diagrams, charts and tables you see.";
    const sourceText = hasText ? rawText : SOURCE_INSTRUCTION;

    if (hasText) {
      console.log(`[Inline Indexing] Extracted ${rawText.trim().length} characters of text.`);
    } else {
      console.warn(
        `[Inline Indexing] ${s3Key} has no text layer; relying on NuExtract to read the page images.`
      );
    }

    // Pass both text and PDF buffer to NuExtract to generate structured notes with image context
    const nuExtractService = require("./nuExtractService");
    const enhancedNotes = await nuExtractService.processNotes(sourceText, buffer);

    if (!enhancedNotes || !enhancedNotes.trim()) {
      throw new Error("Indexing produced no text");
    }
    // processNotes returns its input verbatim when NuExtract fails. For a text-less
    // PDF that would mean indexing our own instruction string instead of the document.
    if (!hasText && (enhancedNotes === sourceText || enhancedNotes.trim().length <= 100)) {
      throw new Error(
        "PDF has no text layer and NuExtract could not read the page images"
      );
    }
    console.log(`[Inline Indexing] Using ${enhancedNotes.length} characters of NuExtract output.`);

    const chunks = chunkText(enhancedNotes);
    if (chunks.length === 0) {
      throw new Error("No text chunks created for indexing");
    }

    const embeddings = [];
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await embeddingService.generateEmbedding(chunks[i]);
      embeddings.push(embedding);
    }

    const fileMetadata = await getFileByHash(hash);
    const filename = fileMetadata ? fileMetadata.filename : "unknown.pdf";
    const uploadedBy = fileMetadata ? fileMetadata.uploadedBy : "unknown";
    const folder = fileMetadata ? fileMetadata.folder : (s3Key.split("/")[1] || "default");

    await chromaService.addChunksToCollection(hash, filename, uploadedBy, folder, chunks, embeddings, s3Key);

    // Record it so the startup sync does not re-process this upload.
    await chromaService.recordIndexedFile(s3Key, hash);

    await updateIndexStatus(hash, "INDEXED");
    console.log(`[Inline Indexing] Completed indexing for hash: ${hash}`);
  } catch (error) {
    console.error(`[Inline Indexing Error] Failed for ${s3Key}:`, error.message);
    try {
      await updateIndexStatus(hash, "FAILED");
    } catch (dbErr) {
      console.error("[Inline Indexing Error] Failed to update status to FAILED in DB:", dbErr.message);
    }
  }
}

/**
 * Save notebook file metadata
 * @param {Object} item - Metadata item
 * @returns {Promise<Object>} - The saved item
 */
async function saveFileMetadata(item) {
  const db = await readDB();
  const itemWithStatus = {
    indexStatus: "PENDING",
    ...item,
  };
  db.files[item.hash] = itemWithStatus;
  await writeDB(db);

  // Trigger inline indexing in the background asynchronously
  setImmediate(() => {
    triggerInlineIndexing(item.s3Key, item.hash);
  });

  return itemWithStatus;
}

/**
 * Retrieve all metadata entries
 * @returns {Promise<Object[]>} - Array of metadata objects
 */
async function getAllFiles() {
  const db = await readDB();
  return Object.values(db.files);
}

async function updateIndexStatus(hash, status) {
  const db = await readDB();
  if (db.files[hash]) {
    db.files[hash].indexStatus = status;
    db.files[hash].hash = hash; // Ensure hash partition key is present
    await writeDB(db);
    return db.files[hash];
  }
  return null;
}

module.exports = {
  getUser,
  createUser,
  getFileByHash,
  saveFileMetadata,
  getAllFiles,
  updateIndexStatus,
};
