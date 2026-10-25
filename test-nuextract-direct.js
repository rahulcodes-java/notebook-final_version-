const fs = require("fs");
const path = require("path");
const nuExtractService = require("./services/nuExtractService");

async function main() {
  console.log("=== Direct NuExtract Test ===\n");

  // Use a PDF that has images/diagrams
  const pdfPath = path.join(__dirname, "uploads", "public", "default", "1788889634534-Cloud-Computing-101.pdf");

  if (!fs.existsSync(pdfPath)) {
    console.log("Test PDF not found, trying another...");
    const altPath = path.join(__dirname, "uploads", "public", "default", "1789013018307-Software Engineering Notes - Unit 2.pdf");
    if (!fs.existsSync(altPath)) {
      console.log("No test PDF found. Exiting.");
      return;
    }
  }

  const testPdf = fs.existsSync(pdfPath) ? pdfPath : path.join(__dirname, "uploads", "public", "default", "1789013018307-Software Engineering Notes - Unit 2.pdf");
  const buffer = fs.readFileSync(testPdf);

  console.log(`Testing with: ${path.basename(testPdf)} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)\n`);

  const sampleText = "Cloud computing is the delivery of computing services over the internet. It includes servers, storage, databases, networking, software, and analytics.";

  console.log("Calling NuExtract service...\n");
  const startTime = Date.now();

  try {
    const result = await nuExtractService.processNotes(sampleText, buffer);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\nCompleted in ${elapsed}s`);
    console.log(`Result length: ${result.length} characters`);
    console.log(`\n--- Result Preview (first 500 chars) ---`);
    console.log(result.substring(0, 500));
    console.log(`\n--- Result Preview (last 300 chars) ---`);
    console.log(result.substring(result.length - 300));

    if (result.length > sampleText.length * 1.5) {
      console.log("\n[PASS] NuExtract enhanced the text (output significantly larger than input)");
    } else if (result === sampleText) {
      console.log("\n[WARN] NuExtract returned raw text unchanged (may have fallen back)");
    } else {
      console.log("\n[PASS] NuExtract returned processed text");
    }
  } catch (err) {
    console.error(`\n[FAIL] NuExtract error: ${err.message}`);
  }
}

main().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
