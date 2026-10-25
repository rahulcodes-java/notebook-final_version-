// One-time migration: copy indexed chunks from chroma_fallback.json into ChromaDB.
// Safe to re-run: chunks already present in ChromaDB (matched by id) are skipped.
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const { ChromaClient } = require("chromadb");
const embeddingService = require("./services/embeddingService");

const COLLECTION_NAME = "notebook-files";
const FALLBACK_PATH = path.join(__dirname, "chroma_fallback.json");
const BATCH_SIZE = 50;

// Chroma only accepts scalar metadata values (string | number | boolean)
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

async function main() {
  const chromaUrl = process.env.CHROMA_URL || "http://localhost:8000";
  console.log(`[Migrate] Connecting to ChromaDB at ${chromaUrl} ...`);

  const client = new ChromaClient({ path: chromaUrl });
  await client.heartbeat();

  if (!fs.existsSync(FALLBACK_PATH)) {
    console.log("[Migrate] No chroma_fallback.json found — nothing to migrate.");
    return;
  }

  const fallback = JSON.parse(fs.readFileSync(FALLBACK_PATH, "utf8"));
  const chunks = Array.isArray(fallback) ? fallback : fallback.chunks || [];
  console.log(`[Migrate] Found ${chunks.length} chunks in local fallback DB.`);
  if (chunks.length === 0) return;

  const collection = await client.getOrCreateCollection({ name: COLLECTION_NAME });

  // Collect ids already stored in ChromaDB so a re-run doesn't duplicate them
  const existingIds = new Set();
  const alreadyCount = await collection.count();
  if (alreadyCount > 0) {
    let offset = 0;
    while (offset < alreadyCount) {
      const page = await collection.get({ limit: 1000, offset, include: [] });
      (page.ids || []).forEach((id) => existingIds.add(id));
      if (!page.ids || page.ids.length === 0) break;
      offset += page.ids.length;
    }
  }
  console.log(`[Migrate] ChromaDB already holds ${existingIds.size} chunks.`);

  const pending = chunks.filter((c) => c && c.id && !existingIds.has(c.id) && Array.isArray(c.embedding));
  console.log(`[Migrate] ${pending.length} chunks to copy...`);
  if (pending.length === 0) {
    console.log("[Migrate] Nothing left to migrate — ChromaDB is already up to date.");
    return;
  }

  // ChromaDB requires every vector in a collection to share one dimension.
  // Probe the project's own embedding service to learn the dimension used at query time.
  const probe = await embeddingService.generateEmbedding("dimension probe");
  const targetDim = probe.length;
  console.log(`[Migrate] Query embeddings are ${targetDim}-dimensional — normalizing vectors to match.`);

  const mismatched = pending.filter((c) => c.embedding.length !== targetDim);
  if (mismatched.length > 0) {
    console.log(`[Migrate] Re-embedding ${mismatched.length} chunks that were produced by a different model...`);
    for (const c of mismatched) {
      const text = typeof c.document === "string" ? c.document.trim() : "";
      c.embedding = text ? await embeddingService.generateEmbedding(text) : null;
    }
  }

  const ready = pending.filter((c) => Array.isArray(c.embedding) && c.embedding.length === targetDim);
  const skipped = pending.length - ready.length;
  if (skipped > 0) console.warn(`[Migrate] Skipping ${skipped} chunks with no usable text.`);
  if (ready.length === 0) {
    console.log("[Migrate] Nothing usable to migrate.");
    return;
  }

  let migrated = 0;
  for (let i = 0; i < ready.length; i += BATCH_SIZE) {
    const batch = ready.slice(i, i + BATCH_SIZE);
    await collection.add({
      ids: batch.map((c) => c.id),
      embeddings: batch.map((c) => c.embedding),
      metadatas: batch.map((c) => sanitizeMetadata(c.metadata)),
      documents: batch.map((c) => c.document),
    });
    migrated += batch.length;
    console.log(`[Migrate]   ... ${migrated}/${ready.length}`);
  }

  const total = await collection.count();
  console.log(`\n✅ Migration complete. Collection '${COLLECTION_NAME}' now holds ${total} chunks.`);
}

main().catch((err) => {
  console.error("\n❌ Migration failed:");
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
