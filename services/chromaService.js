const { ChromaClient } = require("chromadb");
const fs = require("fs");
const path = require("path");

const chromaUrl = process.env.CHROMA_URL || "http://localhost:8000";
const client = new ChromaClient({ path: chromaUrl });

// Local database path for fallback
const fallbackDbPath = path.join(__dirname, "..", "chroma_fallback.json");

// Serializing writes to fallback JSON file
let dbLock = Promise.resolve();

async function readFallbackDb() {
  try {
    if (!fs.existsSync(fallbackDbPath)) {
      return { indexedFiles: [], indexedHashes: [], chunks: [] };
    }
    const data = await fs.promises.readFile(fallbackDbPath, "utf8");
    const parsed = JSON.parse(data || "{}");
    if (Array.isArray(parsed)) {
      return { indexedFiles: [], indexedHashes: [], chunks: parsed };
    }
    return {
      indexedFiles: parsed.indexedFiles || [],
      indexedHashes: parsed.indexedHashes || [],
      chunks: parsed.chunks || []
    };
  } catch (error) {
    console.error("[Chroma Fallback DB] Error reading database:", error.message);
    return { indexedFiles: [], indexedHashes: [], chunks: [] };
  }
}

async function writeFallbackDb(data) {
  try {
    await fs.promises.writeFile(fallbackDbPath, JSON.stringify(data, null, 2), "utf8");
  } catch (error) {
    console.error("[Chroma Fallback DB] Error writing database:", error.message);
  }
}

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

let useChromaFallback = false;

const fallbackCollection = {
  add: async function({ ids, embeddings, metadatas, documents, s3Key }) {
    return new Promise((resolve, reject) => {
      dbLock = dbLock.then(async () => {
        try {
          const db = await readFallbackDb();
          const existingIds = new Set(db.chunks.map(item => item.id));
          
          for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            const item = {
              id,
              embedding: embeddings[i],
              metadata: metadatas[i],
              document: documents[i]
            };
            
            if (existingIds.has(id)) {
              const index = db.chunks.findIndex(x => x.id === id);
              if (index !== -1) {
                db.chunks[index] = item;
              }
            } else {
              db.chunks.push(item);
            }
          }
          
          // Track file metadata keys and hashes
          if (s3Key && !db.indexedFiles.includes(s3Key)) {
            db.indexedFiles.push(s3Key);
          }
          const hash = metadatas && metadatas[0] && metadatas[0].hash;
          if (hash && !db.indexedHashes.includes(hash)) {
            db.indexedHashes.push(hash);
          }
          
          await writeFallbackDb(db);
          console.log(`[Chroma Fallback DB] Indexed ${ids.length} chunks locally.`);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  },
  query: async function({ queryEmbeddings, nResults, where, userId }) {
    try {
      const db = await readFallbackDb();
      let filtered = db.chunks;
      
      if (where && typeof where === "object") {
        filtered = db.chunks.filter(item => {
          for (const [key, value] of Object.entries(where)) {
            if (!item.metadata || item.metadata[key] !== value) {
              return false;
            }
          }
          return true;
        });
      }

      if (userId) {
        filtered = filtered.filter(item => {
          const isFilePublic = item.metadata && item.metadata.isPublic !== false;
          const isOwner = item.metadata && item.metadata.uploadedBy === userId;
          return isFilePublic || isOwner;
        });
      }
      
      const queryEmbedding = queryEmbeddings ? queryEmbeddings[0] : null;
      if (!queryEmbedding) {
        return { ids: [[]], embeddings: [[]], metadatas: [[]], documents: [[]], distances: [[]] };
      }
      
      const scored = filtered.map(item => {
        const sim = cosineSimilarity(queryEmbedding, item.embedding);
        return { item, similarity: sim };
      });
      
      scored.sort((a, b) => b.similarity - a.similarity);
      const top = scored.slice(0, nResults).map(x => x.item);
      
      return {
        ids: [top.map(item => item.id)],
        embeddings: [top.map(item => item.embedding)],
        metadatas: [top.map(item => item.metadata)],
        documents: [top.map(item => item.document)],
        distances: [scored.slice(0, nResults).map(x => 1 - x.similarity)]
      };
    } catch (err) {
      console.error("[Chroma Fallback DB] Query failed:", err.message);
      throw err;
    }
  }
};

/**
 * Helper to fetch or initialize the vector collection
 */
async function getCollection() {
  if (useChromaFallback) {
    return fallbackCollection;
  }
  
  try {
    return await client.getOrCreateCollection({
      name: "notebook-files",
    });
  } catch (error) {
    console.warn("ChromaDB is not running or unreachable. Falling back to local JSON vector database. Error:", error.message);
    useChromaFallback = true;
    return fallbackCollection;
  }
}

// ChromaDB rejects null metadata values with HTTP 422, so only emit scalars.
function sanitizeMetadata(meta) {
  const clean = {};
  for (const [key, value] of Object.entries(meta || {})) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      clean[key] = value;
    } else {
      clean[key] = String(value);
    }
  }
  return clean;
}

/**
 * Add an array of chunks and their corresponding embeddings into ChromaDB or fallback
 */
async function addChunksToCollection(hash, filename, uploadedBy, folder, chunks, embeddings, s3Key = null) {
  if (!chunks || chunks.length === 0) return;
  if (!embeddings || embeddings.length !== chunks.length) {
    throw new Error(
      `Embedding count (${embeddings ? embeddings.length : 0}) does not match chunk count (${chunks.length})`
    );
  }

  try {
    const collection = await getCollection();

    // Normalize documents and page numbers (handles both string chunks and { text, page } objects)
    const documents = chunks.map((c) => (typeof c === "object" && c.text ? c.text : c));
    const pages = chunks.map((c) => (typeof c === "object" && c.page !== undefined ? c.page : null));

    // Generate unique ID for each chunk based on hash and index
    const ids = chunks.map((_, index) => `${hash}_${index}`);

    const metadatas = chunks.map((_, index) =>
      sanitizeMetadata({
        hash,
        filename,
        uploadedBy,
        folder,
        chunkIndex: index,
        page: pages[index] !== null && pages[index] !== undefined ? pages[index] : undefined,
      })
    );

    if (collection === fallbackCollection) {
      await collection.add({
        ids,
        embeddings,
        metadatas,
        documents,
        s3Key,
      });
    } else {
      // Upsert keeps re-indexing idempotent: re-running a sync or an upload that
      // was already indexed overwrites instead of failing on a duplicate id.
      if (typeof collection.upsert === "function") {
        await collection.upsert({
          ids,
          embeddings,
          metadatas,
          documents,
        });
      } else {
        await collection.add({
          ids,
          embeddings,
          metadatas,
          documents,
        });
      }
    }

    console.log(`Successfully indexed ${chunks.length} chunks for file: ${filename}`);
  } catch (error) {
    console.error("Failed to add chunks to Collection:", error.message);
    throw error;
  }
}

async function queryCollection(queryEmbedding, limit = 5, filter = {}, userId = null) {
  try {
    const collection = await getCollection();
    
    const queryParams = {
      queryEmbeddings: [queryEmbedding],
      nResults: limit,
    };

    if (collection === fallbackCollection) {
      queryParams.where = filter;
      queryParams.userId = userId;
    } else {
      // Official ChromaDB query
      // If a userId is specified and we are NOT looking up a user-specific scope already
      if (userId && (!filter || !filter.uploadedBy)) {
        // Enforce OR condition: isPublic !== false OR uploadedBy === userId
        queryParams.where = {
          "$or": [
            { "isPublic": { "$ne": false } },
            { "uploadedBy": { "$eq": userId } }
          ]
        };
        // If there were other filters, logically combine them using $and
        if (filter && Object.keys(filter).length > 0) {
          queryParams.where = {
            "$and": [
              filter,
              {
                "$or": [
                  { "isPublic": { "$ne": false } },
                  { "uploadedBy": { "$eq": userId } }
                ]
              }
            ]
          };
        }
      } else if (filter && Object.keys(filter).length > 0) {
        queryParams.where = filter;
      }
    }

    const results = await collection.query(queryParams);
    return results;
  } catch (error) {
    console.error("Collection query failed:", error.message);
    throw error;
  }
}

/**
 * Background sync utility that downloads all existing local PDFs and indexes them into the local fallback database
 */
async function syncExistingFiles() {
  console.log("[Sync Local Fallback] Starting background sync of existing local files...");
  try {
    const s3Service = require("./s3Service");
    const embeddingService = require("./embeddingService");
    const pdfExtractor = require("../utils/pdfExtractor");
    const chunkText = require("../utils/chunkText");
    const crypto = require("crypto");

    // 1. Get all files in local storage
    const s3Files = await s3Service.listAllFiles("");
    if (s3Files.length === 0) {
      console.log("[Sync Local Fallback] No files found in local storage.");
      return;
    }

    // 2. Get currently indexed files in fallback DB
    const db = await readFallbackDb();
    const indexedSet = new Set(db.indexedFiles);

    console.log(`[Sync Local Fallback] Local files: ${s3Files.length}, Already indexed locally: ${indexedSet.size}`);

    for (const file of s3Files) {
      if (indexedSet.has(file.s3Key)) {
        continue;
      }

      console.log(`[Sync Local Fallback] Downloading and indexing new file: ${file.s3Key}...`);
      try {
        const buffer = await s3Service.downloadFile(file.s3Key);
        
        // Compute SHA256 hash of the buffer
        const hash = crypto.createHash("sha256").update(buffer).digest("hex");
        
        // If hash is already indexed, link this s3Key and skip full re-indexing
        if (db.indexedHashes.includes(hash)) {
          db.indexedFiles.push(file.s3Key);
          await writeFallbackDb(db);
          console.log(`[Sync Local Fallback] File hash already indexed. Linked s3Key: ${file.s3Key}`);
          // The vectors for this content already exist, so the file is searchable
          // even though this particular copy never went through a full index pass.
          const dynamoService = require("./dynamoService");
          await dynamoService.updateIndexStatus(hash, "INDEXED");
          continue;
        }

        // Extract page-level text if available
        let chunks = [];
        try {
          const pages = await pdfExtractor.extractPages(buffer);
          if (pages && pages.length > 0) {
            chunks = (chunkText.chunkPages || chunkText)(pages);
          }
        } catch (e) {
          console.warn(`[Sync Local Fallback] Page extraction fallback for ${file.s3Key}:`, e.message);
        }

        if (!chunks || chunks.length === 0) {
          const text = await pdfExtractor.extractText(buffer);
          if (!text || text.trim().length === 0) {
            console.warn(`[Sync Local Fallback] Skip ${file.s3Key}: extracted text is empty.`);
            continue;
          }
          chunks = chunkText(text).map((t) => ({ text: t, page: 1 }));
        }

        const documents = chunks.map((c) => (typeof c === "object" && c.text ? c.text : c));

        // Generate embeddings
        console.log(`[Sync Local Fallback] Generating embeddings for ${chunks.length} chunks...`);
        const embeddings = [];
        for (const doc of documents) {
          const emb = await embeddingService.generateEmbedding(doc);
          embeddings.push(emb);
        }

        // Index into the active store: ChromaDB when reachable, local JSON fallback otherwise
        await addChunksToCollection(
          hash,
          file.filename,
          file.uploadedBy || "unknown",
          file.folder,
          chunks,
          embeddings,
          file.s3Key
        );

        // Keep local bookkeeping current so the same file is not re-processed on every restart,
        // regardless of which store now holds its vectors
        await recordIndexedFile(file.s3Key, hash);

        // Sync is a real indexing path too, so reflect it in the status the UI reads.
        const dynamoService = require("./dynamoService");
        await dynamoService.updateIndexStatus(hash, "INDEXED");

        console.log(`[Sync Local Fallback] Successfully indexed: ${file.filename}`);
      } catch (err) {
        console.error(`[Sync Local Fallback] Failed to index file ${file.s3Key}:`, err.message);
      }
    }
    console.log("[Sync Local Fallback] Background sync completed.");
  } catch (error) {
    console.error("[Sync Local Fallback] Sync process failed:", error.message);
  }
}

/**
 * Records that a file has been indexed so the startup sync skips it next time.
 * The bookkeeping lives in the local JSON file whether the vectors themselves
 * ended up in ChromaDB or in the fallback store.
 */
async function recordIndexedFile(s3Key, hash) {
  if (!s3Key && !hash) return;
  const db = await readFallbackDb();
  let changed = false;
  if (s3Key && !db.indexedFiles.includes(s3Key)) {
    db.indexedFiles.push(s3Key);
    changed = true;
  }
  if (hash && !db.indexedHashes.includes(hash)) {
    db.indexedHashes.push(hash);
    changed = true;
  }
  if (changed) await writeFallbackDb(db);
}

module.exports = {
  client,
  getCollection,
  addChunksToCollection,
  queryCollection,
  syncExistingFiles,
  recordIndexedFile,
};
