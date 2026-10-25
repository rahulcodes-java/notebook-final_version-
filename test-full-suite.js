// End-to-end verification of the whole app: auth, Groq, RAG chat, Chroma, NuExtract.
// Usage: node test-full-suite.js
require("dotenv").config();

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";

const results = [];
let token = null;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
}

async function call(method, path, { body, auth = true, form } = {}) {
  const headers = {};
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  let data = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = text;
  }
  return { status: res.status, data, raw: text };
}

async function step(name, fn) {
  try {
    const detail = await fn();
    record(name, true, detail || "");
  } catch (err) {
    record(name, false, err.message);
  }
}

function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function waitFor(
  fn,
  { timeoutMs = 180000, intervalMs = 4000, label = "condition" } = {}
) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last.ok) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label} (last: ${JSON.stringify(last)})`);
}

async function main() {
  console.log("=== FULL SUITE against " + BASE + " ===\n");

  // --- health -------------------------------------------------------------
  await step("GET /api-status", async () => {
    const r = await call("GET", "/api-status", { auth: false });
    expect(r.status === 200, `status ${r.status}`);
    expect(r.data.status === "running", JSON.stringify(r.data));
    return `200 ${r.data.status}`;
  });

  // --- auth ---------------------------------------------------------------
  const user = `qa_${Date.now().toString(36)}`;
  await step("POST /register", async () => {
    const r = await call("POST", "/register", {
      body: { userId: user, password: "pass1234" },
      auth: false,
    });
    expect(r.status === 200 || r.status === 201, `status ${r.status}: ${r.raw.slice(0, 200)}`);
    return `created ${user}`;
  });

  await step("POST /login", async () => {
    const r = await call("POST", "/login", {
      body: { userId: user, password: "pass1234" },
      auth: false,
    });
    expect(r.status === 200, `status ${r.status}: ${r.raw.slice(0, 200)}`);
    token = r.data.token || r.data.accessToken || r.data.jwt;
    expect(!!token, "no token in response");
    return `token ${String(token).length} chars`;
  });

  await step("GET /files (auth)", async () => {
    const r = await call("GET", "/files");
    expect(r.status === 200, `status ${r.status}: ${r.raw.slice(0, 200)}`);
    return "authorized";
  });

  // --- Groq raw -----------------------------------------------------------
  await step("GET /test-gemini (Groq raw)", async () => {
    const r = await call("GET", "/test-gemini?prompt=" + encodeURIComponent("Say GROQ_OK"));
    expect(r.status === 200, `status ${r.status}: ${r.raw.slice(0, 300)}`);
    const s = r.raw.toLowerCase();
    expect(s.includes("groq_ok") || s.includes("groq ok"), `unexpected body: ${r.raw.slice(0, 300)}`);
    return r.raw.slice(0, 160);
  });

  // --- Chroma search ------------------------------------------------------
  await step("POST /debug-search (Chroma)", async () => {
    const r = await call("POST", "/debug-search", { body: { question: "What is Docker?" } });
    expect(r.status === 200, `status ${r.status}: ${r.raw.slice(0, 300)}`);
    const chunks =
      (r.data && (r.data.retrievedChunks || r.data.chunks || r.data.results)) || [];
    expect(Array.isArray(chunks) && chunks.length > 0, `no chunks: ${r.raw.slice(0, 300)}`);
    return `${chunks.length} chunks`;
  });

  // --- RAG chat -----------------------------------------------------------
  await step("POST /chat (RAG answer via Groq)", async () => {
    const r = await call("POST", "/chat", {
      body: { question: "What is Docker?", scope: "all" },
    });
    expect(r.status === 200, `status ${r.status}: ${r.raw.slice(0, 400)}`);
    const answer = r.data.answer || r.data.response || (typeof r.data === "string" ? r.data : "");
    expect(typeof answer === "string" && answer.trim().length > 0, "empty answer");
    expect(
      !/does not contain sufficient information/i.test(answer),
      "model returned NOT_ENOUGH_INFO fallback"
    );
    return `"${answer.trim().slice(0, 140)}..."`;
  });

  // --- folders / files ----------------------------------------------------
  await step("GET /folders", async () => {
    const r = await call("GET", "/folders");
    expect(r.status === 200, `status ${r.status}`);
    const n = Array.isArray(r.data) ? r.data.length : Object.keys(r.data || {}).length;
    return `${n} entries`;
  });

  await step("GET /files", async () => {
    const r = await call("GET", "/files");
    expect(r.status === 200, `status ${r.status}: ${r.raw.slice(0, 200)}`);
    const files = Array.isArray(r.data) ? r.data : r.data.files || [];
    return `${files.length} files`;
  });

  // --- upload + inline indexing (NuExtract) -------------------------------
  const SAMPLE_PDF = process.env.TEST_PDF;
  if (SAMPLE_PDF) {
    let uploadHash = null;
    let uploadedName = null;

    await step("POST /upload (PDF -> NuExtract -> Chroma)", async () => {
      const fs = require("fs");
      const path = require("path");
      const buf = fs.readFileSync(SAMPLE_PDF);
      const boundary = "----qa" + Date.now();
      const name = path.basename(SAMPLE_PDF);
      const head = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="folder"\r\n\r\ndefault\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="isPublic"\r\n\r\ntrue\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="pdf"; filename="${name}"\r\n` +
          `Content-Type: application/pdf\r\n\r\n`
      );
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      const body = Buffer.concat([head, buf, tail]);

      const res = await fetch(BASE + "/upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });
      const data = await res.json();
      expect(
        res.status === 200 || res.status === 201,
        `status ${res.status}: ${JSON.stringify(data).slice(0, 300)}`
      );
      expect(data.success !== false, `rejected: ${JSON.stringify(data).slice(0, 300)}`);
      uploadHash =
        data.hash || (data.data && data.data.hash) || (data.file && data.file.hash);
      uploadedName = name;
      return JSON.stringify(data).slice(0, 200);
    });

    if (uploadHash) {
      await step("inline indexing reached INDEXED", async () => {
        const s = await waitFor(
          async () => {
            const r = await call("GET", `/files`);
            const files = Array.isArray(r.data) ? r.data : (r.data && r.data.files) || [];
            const f = files.find((x) => x.hash === uploadHash);
            if (!f) return { ok: false, note: "file not in /files yet" };
            const status = f.indexStatus;
            if (status === "FAILED")
              throw new Error(`indexStatus FAILED: ${JSON.stringify(f)}`);
            return { ok: status === "INDEXED", note: `status=${status}` };
          },
          { timeoutMs: 900000, intervalMs: 5000, label: "INDEXED status" }
        );
        return s.note;
      });

      await step("uploaded PDF answerable via /chat", async () => {
        const r = await call("POST", "/chat", {
          body: {
            question: "What is a random forest and how is it used in bioinformatics?",
            scope: "mine",
          },
        });
        expect(r.status === 200, `status ${r.status}: ${r.raw.slice(0, 400)}`);
        const answer = r.data.answer || r.data.response || "";
        expect(answer.trim().length > 0, "empty answer");
        expect(
          !/does not contain sufficient information/i.test(answer),
          `answer was the NOT_ENOUGH_INFO refusal: ${answer.slice(0, 200)}`
        );
        return `"${answer.trim().slice(0, 140)}"`;
      });
    }
  } else {
    console.log("SKIP  upload test (set TEST_PDF=<path> to enable)\n");
  }

  // --- Chroma collection counts ------------------------------------------
  await step("ChromaDB collection queryable", async () => {
    const { ChromaClient } = require("chromadb");
    const client = new ChromaClient({ path: process.env.CHROMA_URL || "http://localhost:8000" });
    const col = await client.getOrCreateCollection({ name: "notebook-files" });
    const count = await col.count();
    expect(count > 0, "collection empty");
    return `${count} vectors`;
  });

  // --- NuExtract direct ---------------------------------------------------
  if (process.env.SKIP_NUEXTRACT !== "1") {
    await step("NuExtract service (text + PDF images)", async () => {
      const svc = require("./services/nuExtractService");
      const fs = require("fs");
      const pdf = SAMPLE_PDF
        ? fs.readFileSync(SAMPLE_PDF)
        : fs.existsSync("./uploads/public/default/1792954768944-Random_Forest_in_Bioinformatics.pdf")
          ? fs.readFileSync("./uploads/public/default/1792954768944-Random_Forest_in_Bioinformatics.pdf")
          : null;
      const input =
        "Docker packages applications with dependencies. Images are blueprints; containers are running instances.";
      const t0 = Date.now();
      const out = await svc.processNotes(input, pdf);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      expect(typeof out === "string" && out.length > 0, "empty output");
      // The service falls back to returning the input verbatim when NuExtract fails,
      // so a verbatim echo means extraction did not actually run.
      expect(out !== input, "returned the input verbatim - extraction fell back");
      expect(out.length > input.length, `output too short (${out.length} chars)`);
      const structured = /Extracted_Notes|Diagrams_and_Graphs/i.test(out);
      return `${secs}s, ${out.length} chars, structuredTemplate=${structured}`;
    });
  }

  // --- summary ------------------------------------------------------------
  const failed = results.filter((r) => !r.ok);
  console.log("\n=== SUMMARY ===");
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    failed.forEach((f) => console.log(`  FAIL: ${f.name} -- ${f.detail}`));
    process.exitCode = 1;
  } else {
    console.log("ALL TESTS PASSED");
  }
  process.exit(process.exitCode || 0);
}

main().catch((err) => {
  console.error("Suite crashed:", err);
  process.exit(2);
});
