// Verifies that ChromaDB (services/chromaService.js) is reachable and usable
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const { ChromaClient } = require("chromadb");

const TEST_COLLECTION = "connect-test";

async function main() {
  const chromaUrl = process.env.CHROMA_URL || "http://localhost:8000";
  console.log(`[Test] Connecting to ChromaDB at ${chromaUrl} ...`);

  const client = new ChromaClient({ path: chromaUrl });

  const heartbeat = await client.heartbeat();
  console.log(`[Test] Heartbeat OK:`, heartbeat);

  // Clean up any leftover test collection
  try {
    await client.deleteCollection({ name: TEST_COLLECTION });
    console.log(`[Test] Removed leftover '${TEST_COLLECTION}'`);
  } catch (e) {
    // collection didn't exist — fine
  }

  const collection = await client.getOrCreateCollection({ name: TEST_COLLECTION });
  console.log(`[Test] Collection ready: ${collection.name}`);

  await collection.add({
    ids: ["t1", "t2", "t3"],
    embeddings: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    metadatas: [
      { filename: "test-a.pdf", uploadedBy: "user123", isPublic: true },
      { filename: "test-b.pdf", uploadedBy: "user123", isPublic: true },
      { filename: "test-c.pdf", uploadedBy: "other", isPublic: false },
    ],
    documents: ["alpha chunk", "beta chunk", "gamma chunk"],
  });
  console.log("[Test] Add OK (3 records)");

  const count = await collection.count();
  console.log(`[Test] Count: ${count}`);

  const queried = await collection.query({
    queryEmbeddings: [[1, 0, 0]],
    nResults: 2,
  });
  console.log("[Test] Query OK, nearest id:", queried.ids && queried.ids[0] && queried.ids[0][0]);

  // cleanup
  await client.deleteCollection({ name: TEST_COLLECTION });
  console.log("[Test] Cleaned up test collection");

  console.log("\n✅ ChromaDB connection test PASSED");
}

main().catch((err) => {
  console.error("\n❌ ChromaDB connection test FAILED:");
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
