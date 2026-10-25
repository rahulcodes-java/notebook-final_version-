const path = require("path");
const { processNotes } = require("./services/nuExtractService");

async function run() {
  console.log("=== Testing NuExtract In-Memory Service ===");
  const testText = "Data Structures: Arrays store contiguous elements in memory. Linked lists store nodes with pointers.";
  
  try {
    const result = await processNotes(testText, null);
    console.log("NuExtract Output:\n", result);
    if (result && result.length > 0) {
      console.log("\n[TEST PASSED] NuExtract is working and successfully returning structured extraction!");
    } else {
      console.log("\n[TEST FAILED] NuExtract returned empty response.");
    }
  } catch (err) {
    console.error("Test execution failed:", err);
  }
  process.exit(0);
}

run();
