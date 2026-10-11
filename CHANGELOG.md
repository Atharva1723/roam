# Changelog

## 1.2.1: Offline mode, live demo, and deployment

- **Verified fully-offline operation.** Pulled a local `gemma2:2b` model through Ollama and
  confirmed end to end that chat, trail search, hike planning, memory, and the journal all
  run with no internet. Live weather and hands-free voice input degrade honestly when
  offline instead of fabricating data.
- **Offline test suite** (`test_offline.js`, `npm run test:offline`). Boots the server with a
  preloaded fetch stub that fails every external host (weather, cloud speech, search) while
  allowing localhost, then asserts the local model answers chat, planning works, weather
  returns an honest unavailable state, and memory/journal persist. 8 checks.
- **Offline indicator in the UI.** A header badge (🟢 online / 📴 offline) and a banner that
  explains exactly what still works without a connection. A model badge shows which model
  answered and whether it was the offline fallback.
- **Scripted demo** (`demo.js`, `npm run demo`) that walks the full path — find a trail,
  plan it, save a preference, recall it, start a session, check the device — and prints
  roam's spoken answers for a live walkthrough.
- **Fixed a deployment bug.** `render.yaml` started the app with `tsx` (a devDependency),
  which is absent under Render's `NODE_ENV=production`. It now builds with `npm run build`
  and runs compiled JS with plain `node dist/server.js`, and sets a `/health` check. Python
  is no longer installed on the host; TabPFN and park advisories use their labeled local
  fallbacks there.
- **Deployment guide** (`docs/DEPLOYMENT.md`) with exact Render steps, an honest
  local-vs-hosted comparison, and the note that Ollama can't run on the free tier so the
  hosted demo uses a hosted open-weight model while the same code runs fully offline locally.
- `.env.example` cleaned up: the default model is `gemma2:2b` and a malformed multi-line
  `WAKE_WORDS` value was fixed. Added a `.env` for local use (git-ignored).

## 1.2.0: Outdoor companion — trails, planning, memory, journal, and IoT

Turns Roam from a single-question trail naturalist into the fuller outdoor
companion from the Roam brief: find a real trail, plan the outing, save what matters,
and go outside. Everything added is honest — sample data is labeled, weather is live or
clearly unavailable, and the device is a simulation.

- **Outdoor agent with intent routing** (`src/mastra/agents/outdoor.ts`). A transparent
  keyword classifier routes a message to the right tool, then the LLM phrases a short
  spoken answer strictly from tool output. Facts come from tools, never the model. When
  no model is reachable, a deterministic summary is returned and labelled a fallback.
  Nature questions still reuse the existing field-naturalist pipeline.
- **Trail search and details** (`src/mastra/tools/trailProvider.ts`, `data/trails.json`).
  A local sample dataset behind a provider interface, so a real trail API can replace it.
  Real filtering by distance, duration, elevation, difficulty, accessibility, and quiet
  preference. Every record carries `source` and `verified: false`. A query that matches
  nothing returns an empty list — trail statistics are never invented.
- **Live weather** (`src/mastra/tools/weatherTool.ts`). Open-Meteo, free and keyless, so
  this is a real data path. Offline it returns `available: false` with an honest reason
  instead of fabricated conditions.
- **Hike planner and checklist** (`src/mastra/tools/plannerTool.ts`). Deterministic plan
  and checklist from real trail + weather output. Times use Naismith's rule and are
  labelled estimates; water, clothing, and safety guidance adapt to the data on hand.
- **User-controlled memory** (`src/mastra/memory/memoryStore.ts`). Preferences, saved
  trails, and plans in a local JSON file behind an interface (file or in-memory). Save,
  recall, delete, and clear. No raw audio or transcripts are stored.
- **Outdoor sessions** (`src/mastra/tools/sessionTool.ts`) and **nature journal**
  (`src/mastra/tools/journalTool.ts`). Explicit start/end with safe duplicate handling
  and a summary from recorded data; distance only from real reported waypoints. Journal
  entries never fabricate a location.
- **IoT device abstraction** (`src/mastra/device/device.ts`). A simulator with the same
  interface a real ESP32/Arduino adapter would use. Commands are restricted to an
  allowlist; anything else is rejected. Always labeled simulated in the UI.
- **Typed API** for all of the above (`POST /api/agent`, `/api/trails`, `/api/weather`,
  `/api/memory`, `/api/journal`, `/api/device`) with machine-readable error codes and
  server-side validation. `GET /health` and `GET /api/config` now advertise capabilities
  and offline behaviour.
- **Web UI**: an "Ask roam to plan your outing" composer with quick actions and a spoken
  answer, plus Trails / Memory / Journal / Device tabs for managing saved data.
- **Tests**: `npm run test:outdoor` builds and runs an end-to-end smoke test (31 checks)
  covering trail search, honest empty/unavailable states, memory CRUD, device-command
  rejection, and agent intent routing. `npm test` now runs both the wake-word and outdoor
  suites. `data/memory.json` and `data/journal.json` are git-ignored runtime state.

## 1.1.3: Wake word list and question capture fixed

- **The server only ever advertised one wake word.** `WAKE_WORDS` was built with a comma operator, so `(process.env.WAKE_WORDS || "roam", "rom", ...)` evaluated to the single string `"rom"`. The list sent to the browser was therefore `["rom"]`, the `WAKE_WORDS` environment variable was ignored, and `Hey roam` / `rome` failed to match. The list is now built properly: `roam, rome, rom` by default, with `WAKE_WORDS=wren,roam` (comma-separated) overriding it.
- **Stretched names match without a hand-written variant list.** Each letter may repeat (`roaam`, `roooam`, `roaaammm`, `rooom`), replacing the 20-odd hard-coded spellings on both the server and in the UI.
- **A question no longer has to repeat the wake word.** Saying the name once opens a 15 second question window (was 6 seconds), and everything said inside it is taken as the question. Previously, a pause after the name expired the window, so the only questions that got through were the ones that contained `roam`/`rome` again.
- **Mid-sentence pauses no longer truncate questions.** Submission now waits for the recogniser's final result instead of firing after 1.0 s of interim silence, with a 4 second fallback when a browser never finalises. Hesitation words (`um`, `uh`, `hm`) are never submitted and do not close the window.
- **Recognition failures now self-heal.** If `rec.start()` throws (typically because push-to-talk still held the microphone), the listener retried never - it stayed silent until the next state change, which read as "the wake word stopped working". It now retries after 700 ms, and the push-to-talk recogniser is stopped when the mic button finishes so the two no longer fight over the microphone.
- **`audio-capture` errors are surfaced** (no microphone found) instead of being logged as a generic error.
- **Regression checks:** `npm run test:wake` runs the state machine in `public/app.js` under fake timers and asserts name matching, the question window, and submission behaviour (34 checks).

## 1.1.2: Wake word fixes and faster answers

- **Speaking flag can no longer get stuck.** A watchdog resumes listening after the expected speech duration, even if the browser never reports that speech ended. This was the most likely cause of the wake word going silent.
- **Live feedback.** The status line shows what the browser heard ("Heard: ..."), and recognition errors (for example, microphone blocked) appear in the log. This makes it possible to see whether the name is being recognized.
- **Wake word variants:** added "rin" and "ray ren"-style mishearings; the default list is now roam, wrenn, wran, rin, ren.
- **Start-of-hike greeting is local.** It no longer asks the model for a narration. The odd "acorn-strewn switchbacks" line came from a simulated park advisory that was being passed to the model as fact.
- **Simulated advisories are never sent to the model.** The fallback is labelled "Simulated" and excluded from the prompt.
- **Faster:** end-of-question pause cut from 1.8 s to 1.0 s; park advisory cached 10 minutes; TabPFN predictions cached 10 minutes; model reply capped at 120 tokens with a 15-second timeout.
- For faster answers on a laptop, set `LLM_MODEL=gemma2:2b` (after `ollama pull gemma2:2b`). The persistent TabPFN service (`npm run tabpfn:serve`) removes the per-question Python startup.

## 1.1.1: Wake word listens by default

- Hands-free listening starts on page load instead of requiring a button click. The toggle now pauses and resumes it, and the choice is remembered.
- If the browser needs a user gesture or mic permission first, roam stays armed and starts on the next tap or key press.
- Documented the platform limit: listening stops when the page is backgrounded or the screen locks.

## 1.1.0: Hands-free "Hey roam", architecture fixes

### Added

- **Hands-free wake word.** Say the assistant's name, then ask. Implemented as an explicit state machine with a 1.8 s pause rule, a 6 s idle timeout, and pausing while the assistant speaks. See `docs/WAKE_WORD.md`.
- **Configurable name and wake words.** `ASSISTANT_NAME` and `WAKE_WORDS` on the server, exposed to the UI through `GET /api/config`.
- **Open-weight by default.** The LLM client defaults to a local Ollama endpoint with `gemma2:9b`, and works with any OpenAI-compatible server.
- **Persistent TabPFN service** (`services/tabpfn_api.py`), so the model loads once instead of per request. Opt in with `TABPFN_SERVICE_URL`.
- **Honest engine reporting.** The TabPFN output names the engine that ran (TabPFN, scikit-learn, or heuristic) and states that the training data is synthetic.
- **Safety rules in the model prompt:** no edibility confirmations from descriptions; emergency guidance first for injury or being lost.
- **Field notes and park advisories now reach the model.** In v1.0 the advisory was fetched and discarded.
- **Documentation:** `README.md` (rewritten), `docs/ARCHITECTURE.md`, `docs/WAKE_WORD.md`, `docs/API.md`.
- **Additional field guide entries:** Eastern Bluebird, Pileated Woodpecker, and Wild Leek (with a toxic look-alike warning).
- `typecheck` and `test:api` scripts, `.gitignore`, `services/requirements-tabpfn.txt` (kept separate so the default deploy stays light).

### Fixed

- **`package.json` was invalid JSON** (stray text after the closing brace), so `npm install` would fail.
- **API keys were written to `process.env`** on every request, so one user's key became the default for others and concurrent requests could interfere. Keys are now per-request only.
- **Fake transcription.** With no key, `/api/trail/transcribe` returned a hard-coded question ("What bird is that singing in the oaks?") that was then answered as if the user had asked it. It now returns an honest error.
- **Settings mismatch.** The Whisper fallback read a localStorage key that the settings panel never wrote, so it could never use the saved key.
- **`.env.example` variables did not match the code.** `GEMMA_API_BASE` and `GEMMA_MODEL` were ignored; the code read `LLM_*` only. Both are now honoured.
- **Field guide matched whole phrases.** Natural questions returned generic results. Lookup is now keyword-scored.
- **Fabricated UI values removed.** The log showed a hard-coded "240 ms" and a random trace ID. It now shows measured latency and the model that answered.
- **Missing Python fallback.** `python` is not on Linux hosts by default; the CLI now uses `python3` unless `PYTHON_BIN` is set.
- **TabPFN CLI timeouts.** The script call had no timeout and could hang the request.
- **Key name mismatch in the UI**: the Whisper fallback and settings panel now read the same stored key.

### Changed

- **Dropped the unused `@mastra/core` dependency.** The pipeline was never built on it. Re-add it when migrating.
- **Temporal sync is labelled a stub** (`engine: "local-stub"`) in responses and in the UI. The earlier README described it as durable.
- **Pipeline steps run concurrently** (TabPFN, field guide, park advisory).
- **Settings and UI copy** now describe the fully offline path accurately. The earlier footer said "fully offline" while the default path called a cloud API.
- **Badges** list only what is wired in.
- **Offline fallback answers** are phrased as possibilities ("could be"), not identifications.
- **Persona** renamed to roam (configurable).
- `fastapi` and `uvicorn` are now used only by the optional Python TabPFN service.

### Known gaps

See `docs/ARCHITECTURE.md` §8. Notably: Mastra is not yet used, Temporal is a stub, the TabPFN training data is synthetic, and there is no automated test suite.

## 1.0.0

- Initial hackathon build: Express server, browser UI, Gemma-style LLM call, TabPFN script, ElevenLabs and Sentry hooks, Temporal-style sync stub.
