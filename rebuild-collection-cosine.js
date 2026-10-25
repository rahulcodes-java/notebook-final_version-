// One-time rebuild: convert the ChromaDB collection from the default L2 space to
// cosine space so that `1 - distance` is a true cosine similarity (which is what
// services/ragService.js and the JSON fallback store both assume).
//
// The stored vectors are reused as-is -- changing the HNSW distance metric does
// not require re-embedding anything.
//
// Usage: node rebuild-collection-cosine.js
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const { ChromaClient } = require("chromadb");

const COLLECTION = process.env.CHROMA_COLLECTION || "notebook-files";
const BACKUP = path.join(__dirname, `chroma-backup-${Date.now()}.json`);
const BATCH = 100;

function asArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "object" && v.data) return Array.from(v.data);
  return Array.from(v);
}

async function main() {
  const client = new ChromaClient({ path: process.env.CHROMA_URL || "http://localhost:8000" });

  const restoreFrom = process.argv[2];
  let records = null;

  if (restoreFrom && fs.existsSync(restoreFrom)) {
    records = JSON.parse(fs.readFileSync(restoreFrom, "utf8"));
    console.log(`Restoring ${records.length} vectors from backup ${restoreFrom}.`);
  } else {
    // Read everything out of the current collection.
    let source;
    try {
      source = await client.getCollection({ name: COLLECTION });
    } catch (err) {
      console.log(`Collection "${COLLECTION}" does not exist; nothing to rebuild.`);
      return;
    }

    const existing = await source.get({
      limit: 100000,
      include: ["embeddings", "documents", "metadatas"],
    });
    const ids = existing.ids || [];
    console.log(`Read ${ids.length} vectors from "${COLLECTION}".`);
    if (ids.length === 0) {
      console.log("Empty collection; nothing to do.");
      return;
    }

    records = ids.map((id, i) => ({
      id,
      embedding: asArray((existing.embeddings || [])[i]),
      document: (existing.documents || [])[i],
      metadata: (existing.metadatas || [])[i],
    }));

    // Back up before touching anything.
    fs.writeFileSync(BACKUP, JSON.stringify(records));
    console.log(`Backup written to ${BACKUP}`);
  }

  for (const r of records) {
    if (!Array.isArray(r.embedding) || r.embedding.length === 0) {
      throw new Error(`Record ${r.id} has no embedding; aborting.`);
    }
  }

  // Recreate the collection with cosine distance. hnsw:space is the only HNSW
  // key Chroma 1.x accepts in collection metadata.
  try {
    await client.deleteCollection({ name: COLLECTION });
    console.log(`Deleted existing "${COLLECTION}".`);
  } catch (err) {
    console.log(`No existing collection to delete (${err.message}).`);
  }

  const target = await client.getOrCreateCollection({
    name: COLLECTION,
    metadata: { "hnsw:space": "cosine" },
  });

  for (let i = 0; i < records.length; i += BATCH) {
    const slice = records.slice(i, i + BATCH);
    const payload = {
      ids: slice.map((r) => r.id),
      embeddings: slice.map((r) => r.embedding),
      documents: slice.map((r) => r.document),
      metadatas: slice.map((r) => r.metadata),
    };
    if (typeof target.upsert === "function") {
      await target.upsert(payload);
    } else {
      await target.add(payload);
    }
    console.log(`  upserted ${Math.min(i + BATCH, records.length)}/${records.length}`);
  }

  // 4. Verify the metric by comparing distance against a true cosine similarity.
  const count = await target.count();
  console.log(`\nRebuilt "${COLLECTION}" with ${count} vectors (hnsw:space=cosine).`);

  const sample = await target.get({ limit: 1, include: ["embeddings"] });
  const v = asArray((sample.embeddings || [])[0]);
  if (v.length) {
    const qres = await target.query({ queryEmbeddings: [v], nResults: 1, include: ["distances"] });
    const d = (qres.distances && qres.distances[0] && qres.distances[0][0]) || null;
    console.log(
      `Self-query distance = ${d} (cosine self-distance should be ~0). ` +
        (d !== null && Math.abs(d) < 1e-3 ? "METRIC VERIFIED" : "UNEXPECTED -- check config")
    );
  }

  console.log("\nDone. Restart the app so it re-reads the collection handle.");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("Rebuild failed:", err);
    process.exit(1);
  }
);
