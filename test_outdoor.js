/**
 * Roam - end-to-end smoke test for the Roam outdoor companion API.
 * Starts the built server on a test port and asserts real behavior: real trail
 * records, honest empty/unavailable states, memory CRUD, device command rejection,
 * and agent intent routing. Run with: npm run test:outdoor (builds first).
 */
const { spawn } = require("child_process");
const path = require("path");

const PORT = 3939;
const BASE = `http://localhost:${PORT}`;
let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
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
async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if ((await fetch(`${BASE}/health`)).ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  const server = spawn("node", [path.resolve(__dirname, "dist", "server.js")], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: "test" }, stdio: "ignore",
  });
  try {
    if (!(await waitForServer())) throw new Error("server did not start");

    const health = await j("GET", "/health");
    check("health advertises capabilities", health.status === 200 && health.json?.capabilities?.trailSearch === true);

    const search = await j("GET", "/api/trails/search?quiet=true&limit=10");
    check("trail search returns records", search.json?.data?.trails?.length >= 3);
    const first = search.json?.data?.trails?.[0];
    check("trail records labelled sample", first?.source?.includes("SAMPLE") && first?.verified === false);
    check("trail records have stats", typeof first?.distance_km === "number" && typeof first?.elevation_gain_m === "number");

    const easy = await j("GET", "/api/trails/search?difficulty=easy");
    check("difficulty filter works", (easy.json?.data?.trails || []).every((t) => t.difficulty === "easy"));

    const none = await j("GET", "/api/trails/search?q=zzzznotarealtrail");
    check("no-match search is empty, not fake", Array.isArray(none.json?.data?.trails) && none.json.data.trails.length === 0);

    const detail = await j("GET", `/api/trails/${first.id}`);
    check("trail details found", detail.status === 200 && detail.json?.data?.id === first.id);
    const missing = await j("GET", "/api/trails/does-not-exist");
    check("unknown trail is 404", missing.status === 404 && missing.json?.success === false);

    const weather = await j("GET", "/api/weather?lat=38.55&lng=-78.39&hours=3&label=Test");
    check("weather has a provider", typeof weather.json?.data?.provider === "string");
    if (weather.json?.data?.available) {
      check("weather available has temp", typeof weather.json.data.current.temp_c === "number");
    } else {
      check("weather unavailable is honest", typeof weather.json.data.unavailableReason === "string" && weather.json.data.current === undefined);
    }
    const badWeather = await j("GET", "/api/weather");
    check("weather without coords is 400", badWeather.status === 400 && badWeather.json?.code === "MISSING_COORDS");
    const saved = await j("POST", "/api/memory", { kind: "preference", text: "I prefer quiet trails under 5 km" });
    check("memory save returns a record", saved.status === 200 && saved.json?.data?.id);
    const list1 = await j("GET", "/api/memory");
    check("memory lists the record", (list1.json?.data?.records || []).some((r) => r.text.includes("quiet trails")));
    const del = await j("DELETE", `/api/memory/${saved.json.data.id}`);
    check("memory delete works", del.status === 200 && del.json?.data?.deleted === saved.json.data.id);
    await j("POST", "/api/memory", { kind: "preference", text: "temp for clear" });
    const cleared = await j("DELETE", "/api/memory");
    check("memory clear works", cleared.json?.data?.cleared >= 1);
    const emptyText = await j("POST", "/api/memory", { kind: "preference", text: "" });
    check("memory rejects empty text", emptyText.status === 400);

    const entry = await j("POST", "/api/journal", { text: "Saw a pileated woodpecker" });
    check("journal add returns entry", entry.status === 200 && entry.json?.data?.id);
    const jlist = await j("GET", "/api/journal");
    check("journal lists entry", (jlist.json?.data?.entries || []).some((e) => e.text.includes("pileated")));
    await j("DELETE", "/api/journal");

    const dev = await j("GET", "/api/device");
    check("device status is simulated", dev.json?.data?.status?.simulated === true);
    const cmd = await j("POST", "/api/device/command", { command: "start_listening" });
    check("device accepts allowlisted command", cmd.status === 200 && cmd.json?.data?.ok === true);
    const badCmd = await j("POST", "/api/device/command", { command: "rm -rf /" });
    check("device rejects unknown command", badCmd.status === 400 && badCmd.json?.code === "COMMAND_NOT_ALLOWED");

    const agentFind = await j("POST", "/api/agent", { message: "Find me an easy hike under 5 km" });
    check("agent find_trail intent", agentFind.json?.data?.intent === "find_trail" && agentFind.json?.data?.data?.trails?.length >= 1);
    check("agent returns spoken text", typeof agentFind.json?.data?.spokenText === "string" && agentFind.json.data.spokenText.length > 0);

    const agentPlan = await j("POST", "/api/agent", { message: "Plan a hike for this morning" });
    check("agent plan_hike intent", agentPlan.json?.data?.intent === "plan_hike" && agentPlan.json?.data?.data?.plan?.checklist?.length >= 5);

    const agentSave = await j("POST", "/api/agent", { message: "Remember that I prefer quiet trails under 5 km" });
    check("agent save_memory intent", agentSave.json?.data?.intent === "save_memory");
    const agentRecall = await j("POST", "/api/agent", { message: "What do I prefer?" });
    check("agent recall_memory intent", agentRecall.json?.data?.intent === "recall_memory" && agentRecall.json?.data?.spokenText.includes("quiet trails"));

    const agentSession = await j("POST", "/api/agent", { message: "Start my hike" });
    check("agent start_session intent", agentSession.json?.data?.intent === "start_session");
    const agentEnd = await j("POST", "/api/agent", { message: "I'm back, end my hike" });
    check("agent end_session intent", agentEnd.json?.data?.intent === "end_session");

    const agentDevice = await j("POST", "/api/agent", { message: "Is the device connected?" });
    check("agent device_status honest sim", agentDevice.json?.data?.intent === "device_status" && /simulat/i.test(agentDevice.json?.data?.spokenText));

    const agentNature = await j("POST", "/api/agent", { message: "What bird is singing in the oaks?" });
    check("agent nature fallback intent", agentNature.json?.data?.intent === "nature" && typeof agentNature.json?.data?.spokenText === "string");

    const agentEmpty = await j("POST", "/api/agent", { message: "" });
    check("agent rejects empty message", agentEmpty.status === 400 && agentEmpty.json?.code === "EMPTY_MESSAGE");
  } catch (err) {
    failed++;
    console.error("Smoke test crashed:", err);
  } finally {
    server.kill();
  }
  console.log(`\n${failed === 0 ? "All checks passed" : "SOME CHECKS FAILED"} — ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
