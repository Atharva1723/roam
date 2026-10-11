/**
 * Roam - scripted demo.
 *
 * Runs the full outdoor-companion path against a running server and prints roam's
 * spoken answers, so you can follow along during a live demo:
 *   find a trail -> plan it -> save a preference -> recall it -> start a session.
 *
 * Usage:
 *   npm start                 # in one terminal (or a deployed URL)
 *   DEMO_BASE=http://localhost:3000 node demo.js
 */

const BASE = (process.env.DEMO_BASE || "http://localhost:3000").replace(/\/+$/, "");

const STEPS = [
  { say: "Find me an easy hike for this morning", note: "real trail search" },
  { say: "What should I pack, and what's the weather?", note: "plan + checklist + live weather" },
  { say: "Remember that I prefer quiet trails under 5 km", note: "save a preference" },
  { say: "What do I prefer?", note: "recall the preference" },
  { say: "Start my hike", note: "begin an outdoor session" },
  { say: "Is the device connected?", note: "honest IoT simulator status" },
];

function hr(title) {
  console.log("\n" + "=".repeat(64));
  console.log(title);
  console.log("=".repeat(64));
}

async function ask(message) {
  const res = await fetch(`${BASE}/api/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || "request failed");
  return json.data;
}

function summarize(d) {
  const lines = [];
  lines.push(`intent:  ${d.intent}`);
  lines.push(`roam:    "${d.spokenText}"`);
  lines.push(`model:   ${d.model}${d.usedFallback ? " (offline fallback)" : ""}`);
  const data = d.data || {};
  if (Array.isArray(data.trails) && data.trails.length) {
    lines.push("trails:");
    data.trails.slice(0, 3).forEach((t) =>
      lines.push(`  - ${t.name} [${t.difficulty}] ${t.distance_km}km ~${t.estimated_duration_min}min  (${t.source})`),
    );
  }
  if (data.plan) {
    lines.push(`plan:    ${data.plan.trailName} · ${data.plan.estimatedStart}→${data.plan.estimatedFinish} · ~${data.plan.estimatedDurationMin}min`);
    lines.push(`weather: ${data.plan.weather?.available ? data.plan.weather.summary : "unavailable (offline)"}`);
    lines.push(`checklist (${data.plan.checklist.length} items): ${data.plan.checklist.slice(0, 3).map((c) => c.text).join("; ")}…`);
  }
  if (data.saved) lines.push(`saved:   ${data.saved.kind} → "${data.saved.text}"`);
  if (data.records) lines.push(`memory:  ${data.records.map((r) => r.text).join(" | ") || "(empty)"}`);
  if (data.session) lines.push(`session: ${data.session.sessionId} (${data.session.state})`);
  if (data.status) lines.push(`device:  simulated=${data.status.simulated} indicator=${data.status.indicator}`);
  return lines.join("\n");
}

async function main() {
  hr(`Roam demo — talking to ${BASE}`);
  try {
    const health = await (await fetch(`${BASE}/health`)).json();
    console.log(`server: ${health.app} · capabilities: ${Object.keys(health.capabilities || {}).join(", ")}`);
  } catch {
    console.error(`Could not reach ${BASE}. Start the server (npm start) or set DEMO_BASE.`);
    process.exit(1);
  }

  for (const step of STEPS) {
    hr(`You: "${step.say}"   (${step.note})`);
    try {
      const d = await ask(step.say);
      console.log(summarize(d));
    } catch (err) {
      console.error(`  error: ${err.message}`);
    }
  }

  hr("Demo complete — go touch some grass 🌲");
  console.log("Clean up demo memory: curl -X DELETE " + BASE + "/api/memory");
}

main();
