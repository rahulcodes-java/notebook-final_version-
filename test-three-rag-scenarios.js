const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const ragService = require("./services/ragService");

async function runThreeScenarios() {
  console.log("================================================================================");
  console.log("     EVALUATION OF RAG HALLUCINATION FIXES ACROSS 3 USER SCENARIOS               ");
  console.log("================================================================================\n");

  const userId = "gaurav";
  const results = [];

  // ==========================================================================================
  // SCENARIO 1: Direct Retrieval (Directly Answerable from PDF)
  // ==========================================================================================
  console.log(">>> [SCENARIO 1] Direct Retrieval");
  console.log("Question: 'What is a hypervisor, and what are its main responsibilities in virtualization?'");
  try {
    const start1 = Date.now();
    const res1 = await ragService.getRAGAnswer(
      "What is a hypervisor, and what are its main responsibilities in virtualization?",
      userId,
      "all"
    );
    const duration1 = ((Date.now() - start1) / 1000).toFixed(2);
    console.log(`[Completed in ${duration1}s]`);
    console.log("\nGenerated Answer:\n" + res1.answer);
    console.log("\nSources Consulted:", JSON.stringify(res1.sources, null, 2));

    const ans1Lower = res1.answer.toLowerCase();
    const hasHypervisorConcept = ans1Lower.includes("virtual machine") || ans1Lower.includes("vm") || ans1Lower.includes("software layer") || ans1Lower.includes("hardware");
    const hasResponsibilities = ans1Lower.includes("allocat") || ans1Lower.includes("schedul") || ans1Lower.includes("isolat") || ans1Lower.includes("monitor") || ans1Lower.includes("resource");
    const citesDoc = res1.sources.some(s => s.filename.includes("Cloud-Computing-101.pdf"));
    const hasPages = res1.sources.some(s => s.pages && s.pages.length > 0);

    const passed1 = hasHypervisorConcept && citesDoc;
    results.push({
      scenario: "Scenario 1: Direct Retrieval",
      passed: passed1,
      answer: res1.answer,
      sources: res1.sources,
      details: `Concept grounded: ${hasHypervisorConcept}, Responsibilities covered: ${hasResponsibilities}, Cites PDF: ${citesDoc}, Page attribution: ${hasPages}`
    });
    console.log(`\nVerdict: ${passed1 ? "PASSED" : "FAILED"}\n--------------------------------------------------------------------------------\n`);
  } catch (err) {
    console.error("Scenario 1 error:", err);
    results.push({ scenario: "Scenario 1", passed: false, error: err.message });
  }

  // ==========================================================================================
  // SCENARIO 2: Multi-Chunk Synthesis (Indirectly Answerable from PDF)
  // ==========================================================================================
  console.log(">>> [SCENARIO 2] Multi-Chunk Synthesis");
  console.log("Question: 'How can cloud computing help a startup handle sudden increases in website traffic without purchasing additional physical servers?'");
  try {
    const start2 = Date.now();
    const res2 = await ragService.getRAGAnswer(
      "How can cloud computing help a startup handle sudden increases in website traffic without purchasing additional physical servers?",
      userId,
      "all"
    );
    const duration2 = ((Date.now() - start2) / 1000).toFixed(2);
    console.log(`[Completed in ${duration2}s]`);
    console.log("\nGenerated Answer:\n" + res2.answer);
    console.log("\nSources Consulted:", JSON.stringify(res2.sources, null, 2));

    const ans2Lower = res2.answer.toLowerCase();
    const mentionsScaleOrElasticity = ans2Lower.includes("scal") || ans2Lower.includes("elastic") || ans2Lower.includes("on-demand") || ans2Lower.includes("traffic");
    const mentionsCostOrPay = ans2Lower.includes("pay") || ans2Lower.includes("usage") || ans2Lower.includes("cost") || ans2Lower.includes("upfront") || ans2Lower.includes("rent");
    const citesDoc2 = res2.sources.some(s => s.filename.includes("Cloud-Computing-101.pdf"));

    const passed2 = mentionsScaleOrElasticity && citesDoc2;
    results.push({
      scenario: "Scenario 2: Multi-Chunk Synthesis",
      passed: passed2,
      answer: res2.answer,
      sources: res2.sources,
      details: `Scalability/Elasticity covered: ${mentionsScaleOrElasticity}, Pay-per-use/Cost covered: ${mentionsCostOrPay}, Cites PDF: ${citesDoc2}`
    });
    console.log(`\nVerdict: ${passed2 ? "PASSED" : "FAILED"}\n--------------------------------------------------------------------------------\n`);
  } catch (err) {
    console.error("Scenario 2 error:", err);
    results.push({ scenario: "Scenario 2", passed: false, error: err.message });
  }

  // ==========================================================================================
  // SCENARIO 3: Out-of-Context Question (Not Answerable in PDF - Anti-Hallucination)
  // ==========================================================================================
  console.log(">>> [SCENARIO 3] Out-of-Context Question");
  console.log("Question: 'How does Kubernetes manage container orchestration, including automatic pod scaling, service discovery, and load balancing?'");
  try {
    const start3 = Date.now();
    const res3 = await ragService.getRAGAnswer(
      "How does Kubernetes manage container orchestration, including automatic pod scaling, service discovery, and load balancing?",
      userId,
      "all"
    );
    const duration3 = ((Date.now() - start3) / 1000).toFixed(2);
    console.log(`[Completed in ${duration3}s]`);
    console.log("\nGenerated Answer:\n" + res3.answer);
    console.log("\nSources Consulted:", JSON.stringify(res3.sources, null, 2));

    const ans3Lower = res3.answer.toLowerCase();
    const statesNotSufficient = ans3Lower.includes("does not contain sufficient information") ||
                               ans3Lower.includes("not contain sufficient information") ||
                               ans3Lower.includes("stored notes are not related") ||
                               ans3Lower.includes("not contain information");

    // Must NOT contain hallucinated details like "SDP", "SDP2", "3x", "scaling factor of 3x"
    const hasHallucinatedProtocols = ans3Lower.includes("sdp2") || ans3Lower.includes("3x") || ans3Lower.includes("scaling factor is 3x");
    const sourcesEmpty = res3.sources.length === 0;

    const passed3 = statesNotSufficient && !hasHallucinatedProtocols && sourcesEmpty;
    results.push({
      scenario: "Scenario 3: Out-of-Context Anti-Hallucination",
      passed: passed3,
      answer: res3.answer,
      sources: res3.sources,
      details: `Refusal stated: ${statesNotSufficient}, Zero fabricated protocols: ${!hasHallucinatedProtocols}, Sources empty: ${sourcesEmpty}`
    });
    console.log(`\nVerdict: ${passed3 ? "PASSED" : "FAILED"}\n--------------------------------------------------------------------------------\n`);
  } catch (err) {
    console.error("Scenario 3 error:", err);
    results.push({ scenario: "Scenario 3", passed: false, error: err.message });
  }

  console.log("================================================================================");
  console.log("                           SUMMARY OF ALL THREE SCENARIOS                       ");
  console.log("================================================================================");
  results.forEach((r, idx) => {
    console.log(`${idx + 1}. ${r.scenario}: [${r.passed ? "PASSED" : "FAILED"}]`);
    console.log(`   Evaluation: ${r.details || r.error}`);
  });
  console.log("================================================================================");

  const allPassed = results.every(r => r.passed);
  console.log(`Final Status: ${allPassed ? "ALL SCENARIOS PASSED SUCCESSFULLY" : "SOME SCENARIOS FAILED"}`);
  console.log("================================================================================\n");
}

runThreeScenarios();
