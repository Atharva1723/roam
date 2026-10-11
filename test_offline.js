/**
 * Roam - offline-mode verification.
 *
 * Proves the app keeps working with no internet. It points the LLM at the local
 * Ollama endpoint and stubs the global fetch so every EXTERNAL host (Open-Meteo
 * weather, cloud speech) fails, while localhost is allowed through. It then checks:
 *   1. The server starts and serves with no cloud LLM key.
 *   2. Trail search works from the local dataset.
 *   3. Hike planning works and weather degrades to an honest "unavailable" state.
 *   4. Memory and journal persist locally.
 *   5. The outdoor agent answers a chat turn.
 *
 * Run with: node test_offline.js   (requires `npm run build`, and a local model
 * pulled via Ollama, e.g. `ollama pull gemma2:2b`, for the live chat check.)
 * If no local model is present, chat checks are skipped with a clear notice.
 */

const { spawn } = require("child_process");
const path = require("path");

const PORT = 3941;
const BASE = `http://localhost:${PORT}`;
const OLLAMA = "http://localhost:11434";

// External hosts that must FAIL to simulate being offline.
const EXTERNAL = ["open-meteo.com", "api.elevenlabs.io", "api.groq.com", "serpapi.com"];

let passed = 0;
let failed = 0;
let skipped = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}
function skip(name, why) { skipped++; console.log(`  SKIP  ${name} — ${why}`); }

async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if ((await fetch(`${BASE}/health`)).ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function j(method, url, body) {
  const res = await fetch(BASE + url, {
    method, headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function localModelReady() {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return false;
    const data = await r.json();
    return Array.isArray(data.models) && data.models.length > 0;
  } catch {
    return false;
  }
}

async function main() {
  const env = {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: "test",
    // Force the local path and strip every cloud credential.
    LLM_BASE_URL: `${OLLAMA}/v1`,
    LLM_MODEL: process.env.LLM_MODEL || "gemma2:2b",
    LLM_API_KEY: "",
    GROQ_API_KEY: "",
    ELEVENLABS_API_KEY: "",
    SERPAPI_API_KEY: "",
    SENTRY_DSN: "",
    // Simulate a real network outage: the preloaded stub fails all external hosts.
    NODE_OPTIONS: `--require ${path.resolve(__dirname, "test", "_offline_stub.js")}`,
  };
  const server = spawn("node", [path.resolve(__dirname, "dist", "server.js")], { env, stdio: "ignore" });

  try {
    if (!(await waitForServer())) throw new Error("server did not start");

    check("server starts with no cloud LLM key", true);

    // Trail search is local — must work with zero internet.
    const search = await j("GET", "/api/trails/search?limit=5");
    check("trail search works offline (local dataset)", search.json?.data?.trails?.length >= 1);

    // Planning uses local trail data; weather should degrade honestly, not fabricate.
    const plan = await j("POST", "/api/agent", { message: "Plan a hike for this morning" });
    const p = plan.json?.data?.data?.plan;
    check("hike planning works offline", p?.checklist?.length >= 5);
    check("weather degrades to honest unavailable state", p?.weather?.available === false);

    // Memory and journal are local files.
    const saved = await j("POST", "/api/memory", { kind: "preference", text: "offline test pref" });
    check("memory persists offline", saved.status === 200 && !!saved.json?.data?.id);
    await j("POST", "/api/journal", { text: "offline test note" });
    const journal = await j("GET", "/api/journal");
    check("journal works offline", (journal.json?.data?.entries || []).some((e) => e.text.includes("offline test note")));
    await j("DELETE", "/api/memory");
    await j("DELETE", "/api/journal");

    // Device simulator is local.
    const dev = await j("GET", "/api/device");
    check("IoT simulator works offline", dev.json?.data?.status?.simulated === true);

    // Chat: only meaningful if a local model is pulled.
    const hasModel = await localModelReady();
    if (hasModel) {
      const chat = await j("POST", "/api/agent", { message: "What bird is singing in the oaks?" });
      check("local-model chat answers offline", typeof chat.json?.data?.spokenText === "string" && chat.json.data.spokenText.length > 0);
    } else {
      skip("local-model chat answers offline", "no Ollama model pulled yet (run: ollama pull gemma2:2b)");
    }
  } catch (err) {
    failed++;
    console.error("Offline test crashed:", err);
  } finally {
    server.kill();
  }

  console.log(`\n${failed === 0 ? "All offline checks passed" : "SOME OFFLINE CHECKS FAILED"} — ${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
