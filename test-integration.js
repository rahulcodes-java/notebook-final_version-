const fs = require("fs");
const path = require("path");
const { processNotes } = require("./services/nuExtractService");

async function test() {
  const pdfPath = path.join(__dirname, "uploads", "public", "default", "1788889634534-Cloud-Computing-101.pdf");
  console.log("Reading PDF from:", pdfPath);
  const buffer = fs.readFileSync(pdfPath);
  
  // Provide some dummy text to simulate pdfExtractor output
  const dummyText = "Cloud Computing 101 Notes. This document has charts.";
  
  try {
    const result = await processNotes(dummyText, buffer);
    console.log("----- RESULT -----");
    console.log(result);
  } catch (e) {
    console.error("Test failed:", e);
  }
}

test();
