const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const chatHistoryService = require("./services/chatHistoryService");

async function runChatHistoryTests() {
  console.log("==================================================================");
  console.log("   PHASE 4: PER-USER CHAT HISTORY & SESSIONS VERIFICATION         ");
  console.log("==================================================================\n");

  const testUser = "test_user_" + Date.now();
  let passedCount = 0;
  let totalTests = 5;

  // TEST 1: Create a new session
  console.log("--- TEST 1: Create New Chat Session ---");
  try {
    const session1 = await chatHistoryService.createSession(testUser, "Cloud Computing Q&A");
    console.log("Created session:", session1.id, "Title:", session1.title);
    if (session1 && session1.id && session1.userId === testUser && session1.title === "Cloud Computing Q&A") {
      console.log(">>> TEST 1 PASSED: Session successfully created with ID and title.\n");
      passedCount++;
    } else {
      console.log(">>> TEST 1 FAILED: Unexpected session object:", session1, "\n");
    }

    // TEST 2: Add user and AI messages with sources
    console.log("--- TEST 2: Add User Query & Grounded AI Response to Session ---");
    const userMsgRes = await chatHistoryService.addMessageToSession(
      testUser,
      session1.id,
      "user",
      "What is cloud computing?"
    );
    const aiMsgRes = await chatHistoryService.addMessageToSession(
      testUser,
      session1.id,
      "ai",
      "Cloud computing is on-demand delivery of IT resources over the internet.",
      [{ filename: "Cloud-Computing-101.pdf", uploadedBy: "gaurav" }]
    );

    const fetchedSession = await chatHistoryService.getSession(testUser, session1.id);
    console.log("Message count in session:", fetchedSession.messages.length);
    const hasUserMsg = fetchedSession.messages.some(m => m.role === "user" && m.content === "What is cloud computing?");
    const hasAiMsg = fetchedSession.messages.some(m => m.role === "ai" && m.sources && m.sources.length === 1);

    if (hasUserMsg && hasAiMsg && fetchedSession.messages.length === 2) {
      console.log(">>> TEST 2 PASSED: User message, AI grounded response, and PDF source citations persisted.\n");
      passedCount++;
    } else {
      console.log(">>> TEST 2 FAILED: Messages not properly stored in session.\n");
    }

    // TEST 3: Auto-create session on first message when sessionId is omitted
    console.log("--- TEST 3: Auto-create Session on First Query ---");
    const autoRes = await chatHistoryService.addMessageToSession(
      testUser,
      null,
      "user",
      "Explain microservices architecture in detail"
    );
    console.log("Auto-created session ID:", autoRes.session.id, "Title:", autoRes.session.title);
    if (autoRes.session && autoRes.session.id && autoRes.session.title.includes("Explain microservices")) {
      console.log(">>> TEST 3 PASSED: Session auto-created with smart title from user question.\n");
      passedCount++;
    } else {
      console.log(">>> TEST 3 FAILED: Auto session creation failed.\n");
    }

    // TEST 4: Fetch user sessions list
    console.log("--- TEST 4: List All Sessions for User ---");
    const sessionsList = await chatHistoryService.getSessions(testUser);
    console.log("Total user sessions retrieved:", sessionsList.length);
    if (sessionsList.length === 2 && sessionsList[0].updatedAt >= sessionsList[1].updatedAt) {
      console.log(">>> TEST 4 PASSED: User sessions listed in descending order of activity.\n");
      passedCount++;
    } else {
      console.log(">>> TEST 4 FAILED: Sessions list mismatch, count:", sessionsList.length, "\n");
    }

    // TEST 5: Delete session and clear user history
    console.log("--- TEST 5: Delete Session and Clear All User History ---");
    const delRes = await chatHistoryService.deleteSession(testUser, session1.id);
    const afterDelList = await chatHistoryService.getSessions(testUser);
    const clearCount = await chatHistoryService.clearUserHistory(testUser);
    const emptyList = await chatHistoryService.getSessions(testUser);

    if (delRes && afterDelList.length === 1 && clearCount === 1 && emptyList.length === 0) {
      console.log(">>> TEST 5 PASSED: Session deletion and complete user history wipe verified.\n");
      passedCount++;
    } else {
      console.log(`>>> TEST 5 FAILED: Delete=${delRes}, afterDel=${afterDelList.length}, clearCount=${clearCount}, emptyList=${emptyList.length}\n`);
    }

  } catch (err) {
    console.error("Test error:", err);
  }

  console.log("==================================================================");
  console.log(`   TEST SUITE EXECUTION COMPLETED: ${passedCount}/${totalTests} TESTS PASSED`);
  console.log("==================================================================");
}

runChatHistoryTests();
