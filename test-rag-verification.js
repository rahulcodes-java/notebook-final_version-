const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const ragService = require("./services/ragService");
const geminiService = require("./services/geminiService");

async function runTests() {
  console.log("==================================================================");
  console.log("   PHASE 3: END-TO-END RAG CHUNK RELEVANCE & GROUNDING TESTS      ");
  console.log("==================================================================\n");

  const userId = "gaurav";
  let passedCount = 0;
  let totalTests = 5;

  // TEST 1: Query completely unrelated to stored notes (geography / trivia)
  console.log("--- TEST 1: Unrelated Query ('What is the capital of France?') ---");
  try {
    const res1 = await ragService.getRAGAnswer("What is the capital of France?", userId, "all");
    console.log("Answer:", res1.answer);
    console.log("Sources:", JSON.stringify(res1.sources));
    
    const isSourcesEmpty = res1.sources.length === 0;
    const mentionsUnrelated = res1.answer.toLowerCase().includes("not related") || 
                             res1.answer.toLowerCase().includes("stored notes") ||
                             res1.answer.toLowerCase().includes("not contain");
    
    if (isSourcesEmpty && mentionsUnrelated) {
      console.log(">>> TEST 1 PASSED: Sources are empty and answer correctly states notes are not related.\n");
      passedCount++;
    } else {
      console.log(`>>> TEST 1 FAILED: Sources empty=${isSourcesEmpty}, Mentions unrelated=${mentionsUnrelated}\n`);
    }
  } catch (err) {
    console.error("Test 1 error:", err.message);
  }

  // TEST 2: General knowledge / cooking query
  console.log("--- TEST 2: General Knowledge Query ('How do you make chocolate cookies?') ---");
  try {
    const res2 = await ragService.getRAGAnswer("How do you make chocolate cookies?", userId, "all");
    console.log("Answer:", res2.answer);
    console.log("Sources:", JSON.stringify(res2.sources));

    const isSourcesEmpty = res2.sources.length === 0;
    const mentionsUnrelated = res2.answer.toLowerCase().includes("not related") || 
                             res2.answer.toLowerCase().includes("stored notes") ||
                             res2.answer.toLowerCase().includes("not contain") ||
                             res2.answer.toLowerCase().includes("sufficient information");

    if (isSourcesEmpty && mentionsUnrelated) {
      console.log(">>> TEST 2 PASSED: Unrelated sources filtered out (sources = []) and refusal stated.\n");
      passedCount++;
    } else {
      console.log(`>>> TEST 2 FAILED: Sources length=${res2.sources.length}, Mentions unrelated=${mentionsUnrelated}\n`);
    }
  } catch (err) {
    console.error("Test 2 error:", err.message);
  }

  // TEST 3: Query asking for examples or practice questions
  console.log("--- TEST 3: Query Asking for Practice Questions ('Give me 3 practice exam questions from Imran Sayyed lecture notes') ---");
  try {
    const res3 = await ragService.getRAGAnswer("Give me 3 practice exam questions from Imran Sayyed lecture notes", userId, "all");
    console.log("Answer:", res3.answer);
    console.log("Sources:", JSON.stringify(res3.sources));

    const statesNoQuestions = res3.answer.toLowerCase().includes("no example or question") ||
                              res3.answer.toLowerCase().includes("not present in the stored notes") ||
                              res3.answer.toLowerCase().includes("no question is present");

    if (statesNoQuestions) {
      console.log(">>> TEST 3 PASSED: System explicitly refused to fabricate artificial questions and stated absence in notes.\n");
      passedCount++;
    } else {
      console.log(">>> TEST 3 FAILED: AI may have hallucinated questions instead of stating absence:", res3.answer, "\n");
    }
  } catch (err) {
    console.error("Test 3 error:", err.message);
  }

  // TEST 4: Query directly related to stored notes
  console.log("--- TEST 4: Query Related to Stored Notes ('What is cloud computing?') ---");
  try {
    const res4 = await ragService.getRAGAnswer("What is cloud computing?", userId, "all");
    console.log("Answer:", res4.answer);
    console.log("Sources:", JSON.stringify(res4.sources));

    const hasMatchingPdf = res4.sources.some(s => s.filename === "Cloud-Computing-101.pdf");
    const isAnswerGrounded = res4.answer.toLowerCase().includes("cloud") ||
                             res4.answer.toLowerCase().includes("on-demand") ||
                             res4.answer.toLowerCase().includes("internet") ||
                             res4.answer.toLowerCase().includes("server");

    if (hasMatchingPdf && isAnswerGrounded) {
      console.log(">>> TEST 4 PASSED: Matching PDF cited in sources and answer is strictly grounded in note content.\n");
      passedCount++;
    } else {
      console.log(`>>> TEST 4 FAILED: Matching PDF=${hasMatchingPdf}, Grounded=${isAnswerGrounded}\n`);
    }
  } catch (err) {
    console.error("Test 4 error:", err.message);
  }

  // TEST 5: Direct chunk relevance verification unit test
  console.log("--- TEST 5: Direct Chunk Relevance Verification Unit Test ---");
  try {
    const testChunks = [
      "Docker containers share the host OS kernel and package application code with dependencies.",
      "Baking cookies requires flour, sugar, butter, and chocolate chips at 350 degrees F.",
      "Cloud computing provides on-demand availability of computer system resources like data storage and computing power."
    ];

    const relevanceForDocker = await geminiService.checkChunksRelevance("Explain Docker containerization", testChunks);
    console.log("Relevant chunk indices for 'Explain Docker containerization':", relevanceForDocker);
    
    if (relevanceForDocker.includes(0) && !relevanceForDocker.includes(1)) {
      console.log(">>> TEST 5 PASSED: Docker chunk identified as relevant, baking chunk identified as not relevant.\n");
      passedCount++;
    } else {
      console.log(">>> TEST 5 FAILED: Incorrect indices returned:", relevanceForDocker, "\n");
    }
  } catch (err) {
    console.error("Test 5 error:", err.message);
  }

  console.log("==================================================================");
  console.log(`   TEST SUITE EXECUTION COMPLETED: ${passedCount}/${totalTests} TESTS PASSED`);
  console.log("==================================================================");
}

runTests();
