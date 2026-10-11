// Exercises the wake-word state machine straight out of public/app.js with fake timers.
// Run with: npm run test:wake
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "public", "app.js");
const src = fs.readFileSync(APP, "utf8");

const start = src.indexOf("  // One pattern per wake word");
const end = src.indexOf("  btnWake.addEventListener");
if (start < 0 || end < 0) throw new Error("could not locate the wake block in public/app.js");
const code = src.slice(start, end);

// --- fake timers -------------------------------------------------------------
let timers = [];
let nextId = 1;
const realSet = global.setTimeout;
const realClear = global.clearTimeout;
global.setTimeout = (fn, ms) => {
  const t = { id: nextId++, fn, ms };
  timers.push(t);
  return t.id;
};
global.clearTimeout = (h) => {
  timers = timers.filter((t) => t.id !== h);
};
function advance(ms) {
  const due = timers.filter((t) => t.ms <= ms);
  timers = timers.filter((t) => t.ms > ms);
  due.forEach((t) => t.fn());
}

// --- harness -----------------------------------------------------------------
function makeHarness(wakeWords) {
  const wake = { state: "idle", buffer: "", silenceTimer: null };
  const wakeStatus = { textContent: "" };
  const inputQuery = { value: "" };
  const submitted = [];
  const factory = new Function(
    "wakeWords",
    "wakeStatus",
    "inputQuery",
    "submitCustomQuery",
    "assistantName",
    "wake",
    `${code}
     return { handleWakeResult, findWakeWord, isFiller, COMMAND_WINDOW_MS, PARTIAL_SILENCE_MS };`,
  );
  const api = factory(
    wakeWords,
    wakeStatus,
    inputQuery,
    // app.js's submitCustomQuery() reads the question out of the input box
    () => submitted.push(inputQuery.value),
    "roam",
    wake,
  );
  return {
    ...api,
    wake,
    wakeStatus,
    inputQuery,
    submitted,
    // one recognition result, exactly as startRecognition() would deliver it
    say(text, isFinal) {
      api.handleWakeResult(text.toLowerCase(), isFinal);
    },
  };
}

// --- assertions --------------------------------------------------------------
let failures = 0;
function check(label, cond, extra = "") {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${extra ? ` -- ${extra}` : ""}`);
  }
}
function section(name) {
  console.log(`\n${name}`);
}

const DEFAULTS = ["roam", "rome", "rom"];

section("Wake word matching (elongation + prefixes + boundaries)");
{
  const h = makeHarness(DEFAULTS);
  const hits = (t) => !!h.findWakeWord(t);
  check("matches 'hey roam'", hits("hey roam"));
  check("matches bare 'roam'", hits("roam"));
  check("matches 'rome'", hits("rome"));
  check("matches 'rom'", hits("rom"));
  check("matches elongated 'hey roaaammm'", hits("hey roaaammm"));
  check("matches elongated 'rooom'", hits("rooom"));
  check("matches 'okay, Roam'", hits("okay, roam"));
  check("matches name first with comma", hits("roam, what's the weather"));
  check("does NOT match 'when'", !hits("when"));
  check("does NOT match 'wrenches'", !hits("wrenches"));
  check("does NOT match 'roaming'", !hits("roaming"));
  check("does NOT match 'romantic'", !hits("romantic"));
}

section("Question after the name does NOT need the wake word");
{
  const h = makeHarness(DEFAULTS);
  h.say("hey roam", false);
  h.say("hey roam", true); // name finalised on its own
  check("window opened", h.wake.state === "command");
  advance(h.COMMAND_WINDOW_MS - 1000); // 14 s pass with no speech
  h.say("how long is the ridge trail", false);
  h.say("how long is the ridge trail", true); // separate utterance, no wake word
  check("question submitted", h.submitted.length === 1, `got ${JSON.stringify(h.submitted)}`);
  check("full question captured", h.submitted[0] === "how long is the ridge trail");
  check("back to idle", h.wake.state === "idle");
}

section("Question in the same sentence as the name");
{
  const h = makeHarness(DEFAULTS);
  h.say("hey rome how far to the summit", false);
  h.say("hey rome how far to the summit", true);
  check("submitted", h.submitted.length === 1);
  check("wake word stripped from question", h.submitted[0] === "how far to the summit");
}

section("Mid-sentence pause does not cut the question in half");
{
  const h = makeHarness(DEFAULTS);
  h.say("hey roam what's the", false); // interim only, no final yet
  advance(1000); // user pauses > 1 s (the old code submitted here)
  check("nothing submitted on interim pause", h.submitted.length === 0);
  h.say("hey roam what's the weather tomorrow", true); // final arrives
  check(
    "whole question submitted",
    h.submitted.length === 1 && h.submitted[0] === "what's the weather tomorrow",
  );
}

section("Interim that never finalises still submits (fallback)");
{
  const h = makeHarness(DEFAULTS);
  h.say("hey roam what's the weather", false);
  advance(h.PARTIAL_SILENCE_MS + 1);
  check("fallback submitted", h.submitted.length === 1 && h.submitted[0] === "what's the weather");
}

section("Name alone keeps the window open; window expires eventually");
{
  const h = makeHarness(DEFAULTS);
  h.say("hey roam", true);
  check("window open", h.wake.state === "command");
  advance(h.COMMAND_WINDOW_MS + 1);
  check("expired back to idle", h.wake.state === "idle");
  check("no phantom submission", h.submitted.length === 0);
}

section("Repeating the name does not wipe or submit a captured question");
{
  const h = makeHarness(DEFAULTS);
  h.say("hey roam", true);
  h.say("is the shelter", false); // partial capture
  h.say("hey roam", true); // browser emits a name-only final
  check("not submitted yet", h.submitted.length === 0, JSON.stringify(h.submitted));
  check("partial still held", h.wake.buffer === "is the shelter");
  h.say("is the shelter open", true); // final of the actual question
  check("submitted", h.submitted.length === 1, JSON.stringify(h.submitted));
  check("question intact", h.submitted[0] === "is the shelter open");
}

section("Hesitation words neither submit nor close the window");
{
  const h = makeHarness(DEFAULTS);
  h.say("hey roam", true);
  h.say("um", true);
  check("not submitted", h.submitted.length === 0);
  check("still in command window", h.wake.state === "command");
  advance(5000);
  check("window still open after 5 s", h.wake.state === "command");
  h.say("is there water at the next creek", true);
  check("real question still accepted", h.submitted.length === 1);
}

section("Wake word late in the sentence keeps the whole utterance");
{
  const h = makeHarness(DEFAULTS);
  h.say("hey roam", true);
  h.say("what's the weather like roam", true); // name repeated at the end
  check("submitted", h.submitted.length === 1, JSON.stringify(h.submitted));
}

global.setTimeout = realSet;
global.clearTimeout = realClear;

console.log(failures ? `\n${failures} FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
