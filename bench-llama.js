// Benchmark llama-server configurations for NuExtract3.
// Usage: node bench-llama.js [--port 8082] [--extra "-ngl auto -c 16384"]
const { spawn } = require("child_process");
const path = require("path");

const BIN_DIR = path.join(__dirname, "llama-cpp-bin");
const EXE = path.join(BIN_DIR, "llama-server.exe");
const MODEL = "D:\\Codes\\nuextract\\NuExtract3-Q4_K_M.gguf";
const MMPROJ = "D:\\Codes\\nuextract\\mmproj-NuExtract3-BF16.gguf";

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { port: 8082, extra: "", label: "default" };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port") out.port = args[++i];
    else if (args[i] === "--extra") out.extra = args[++i];
    else if (args[i] === "--label") out.label = args[++i];
  }
  return out;
}

const { port, extra, label } = parseArgs();

const serverArgs = ["-m", MODEL, "--port", String(port), "-np", "1"];
if (extra.trim()) serverArgs.push(...extra.trim().split(/\s+/));
if (require("fs").existsSync(MMPROJ)) serverArgs.push("--mmproj", MMPROJ);

console.log(`\n=== BENCH [${label}] port=${port} extra="${extra}" ===`);
console.log(`args: ${serverArgs.join(" ")}`);

const t0 = Date.now();
const child = spawn(EXE, serverArgs, { cwd: BIN_DIR, stdio: ["ignore", "pipe", "pipe"] });

let stderrBuf = "";
child.stdout.on("data", (d) => process.stdout.write("[out] " + d));
child.stderr.on("data", (d) => {
  stderrBuf += d.toString();
  process.stdout.write("[err] " + d);
});
child.on("exit", (code) => {
  console.log(`\n[bench] llama-server exited code=${code}`);
  process.exit(code === 0 ? 0 : 1);
});

async function waitHealthy(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) return true;
    } catch (e) {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  const ok = await waitHealthy(180000);
  if (!ok) {
    console.log("[bench] FAIL: server never became healthy");
    child.kill();
    process.exit(2);
  }
  const loadMs = Date.now() - t0;
  console.log(`[bench] healthy after ${(loadMs / 1000).toFixed(1)}s`);

  const text =
    "Docker containers package applications together with their dependencies. " +
    "An image is a blueprint; a container is a running instance. " +
    "Volumes keep data persistent beyond the container lifecycle. " +
    "Docker Hub is the registry for sharing images.";
  const prompt =
    `You are a note extraction AI. Extract structured notes.\n\nText:\n${text}\n\n` +
    `Template:\n${JSON.stringify({ Extracted_Notes: "", Diagrams_and_Graphs_Descriptions: "" }, null, 2)}`;

  const c0 = Date.now();
  const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "nuextract3",
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      stream: false,
      temperature: 0.2,
    }),
  });
  const ms = Date.now() - c0;
  const j = await r.json();

  if (!r.ok) {
    console.log(`[bench] HTTP ${r.status}: ${JSON.stringify(j).slice(0, 400)}`);
    child.kill();
    process.exit(3);
  }

  const content = j.choices?.[0]?.[ "message"]?.content ?? "";
  const u = j.usage || {};
  const tps = u.completion_tokens ? (u.completion_tokens / (ms / 1000)).toFixed(2) : "?";

  console.log(`\n--- RESULT [${label}] ---`);
  console.log(`  HTTP ${r.status} | ${ms} ms | ${u.completion_tokens} out tok | ${tps} tok/s`);
  console.log(`  prompt ${u.prompt_tokens} tok`);
  console.log(`  valid JSON: ${(() => { try { JSON.parse(content); return "YES"; } catch { return "NO"; } })()}`);
  console.log(`  output: ${content.slice(0, 300)}`);

  child.kill();
  setTimeout(() => process.exit(0), 500);
}

main().catch((e) => {
  console.error("[bench] error:", e.message);
  child.kill();
  process.exit(4);
});
