# 🌿 Roam

### A screen-free, voice-first trail naturalist. Say "Hey roam" and ask.

> **Hacktoberfest 2026 · Theme: Touch Grass**
> _The screen should be the shortest part of the experience._

Roam is a hands-free field companion for earbuds. Start a hike, put the phone in your pocket, and ask questions out loud: _"Hey roam, what bird is that?"_ or _"Hey roam, how much water should I drink on this grade?"_ An open-weight language model answers in a few spoken sentences, grounded in a tabular model's predictions for your elevation, grade, and temperature, plus a local field guide.

**roam** is the assistant's name. It's short, it's a small bird, and it's easy to say. You can change it (see [Configuration](#configuration)).

---

## What makes it open

| Piece               | Open component                                                                                       | Why it matters on a trail                                                                                               |
| :------------------ | :--------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| Language model      | Any open-weight model via an OpenAI-compatible API. Default: **Gemma 2 9B through Ollama**           | Runs on a laptop or phone-adjacent device with **no internet**. Trail coordinates and questions never leave the device. |
| Tabular predictions | **Prior Labs TabPFN** (optional, in-context model); scikit-learn fallback                            | Predicts foliage stage, fatigue risk, and hydration from telemetry without per-dataset training.                        |
| Speech in           | Browser Web Speech API (Chrome/Edge); Whisper large-v3 (open weights) as an optional server fallback | Hands-free wake word without a screen.                                                                                  |
| Field knowledge     | Local, editable field guide                                                                          | Swap in your own region's species, safety notes, and seasonal timing.                                                   |
| Code                | MIT licensed, no proprietary runtime                                                                 | Fork it, change the persona, the model, or the agent's behaviour.                                                       |

For the full write-up on why open innovation matters for this build, see [Why open matters](#why-open-matters).

---

## Quick start

**Requirements:** Node.js 20+, and optionally [Ollama](https://ollama.com) for a fully offline model.

```bash
# 1. Install
npm install

# 2. Fully local model (optional but recommended — works with no internet)
ollama pull gemma2:2b        # fast on a laptop CPU (~1.6 GB)

# 3. Configure (every variable is optional; see .env.example)
cp .env.example .env

# 4. Run
npm start
```

Open **http://localhost:3000** in Chrome or Edge. The header shows 🟢 online / 📴 offline and which model answered.

### Required: many free providers through FreeLLMAPI

For better answers than a local model, with automatic failover across free providers, run **[FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi)** next to Roam. It exposes one OpenAI-compatible `/v1` endpoint over many providers.

**1. Start FreeLLMAPI** (from its [repository](https://github.com/tashfeenahmed/freellmapi)):

```bash
git clone https://github.com/tashfeenahmed/freellmapi.git
cd freellmapi
npm install 
npm run dev
```

**2. Add your keys.** Open `http://localhost:3001`. If it asks you to create an account, do that first. On the **Keys** page, add at least one free provider key. Then copy the **unified key** (it starts with `freellmapi-`) from the Keys page header.

**3. Point Roam at it.** Add these lines to Roam's `.env`:

```bash
LLM_BASE_URL=http://localhost:3001/v1
LLM_MODEL=auto
LLM_API_KEY=freellmapi-your-unified-key
LLM_GATEWAY=true
```

Restart Roam with `npm start`. The header badge should read `auto (via gateway)`.

> **Privacy and terms:** with a gateway, your questions and telemetry are sent to third-party providers, so this mode is not on-device. FreeLLMAPI's own README says it is for personal experimentation, not production, and each provider's terms apply. Don't use it for the public Render demo. Use an official endpoint with its own key for that. Roam still answers offline if the gateway is unreachable, and it says so.

### Run it fully offline

With a local model pulled, disconnect from the internet and roam still works: chat, trail
search, hike planning, memory, and the journal all run on your device. Live weather and
hands-free voice input need a connection — roam says so honestly instead of guessing.
Prove it with the network off:

```bash
npm run test:offline
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full offline guide and how to deploy a public demo to Render.

### Optional: persistent TabPFN service

By default the server runs `services/tabpfn_service.py` for each request, which refits the model every time. For smoother demos, run the persistent service and point the server at it:

```bash
pip install -r services/requirements-tabpfn.txt   # optional: real TabPFN (large download)
uvicorn tabpfn_api:app --app-dir services --port 8001
# in .env:  TABPFN_SERVICE_URL=http://localhost:8001
```

Without TabPFN installed, the service uses a scikit-learn ensemble and reports that in the UI.

---

## Using it on a hike

1. Plug in earbuds.
2. Tap **START TRAIL HIKE**.
3. Tap **Hands-free: "Hey roam"** so it turns green and says _Listening_.
4. Lock the phone and put it away.
5. Say **"Hey roam"**, pause, and ask. For example:
   - _"Hey roam, what's that whistling?"_
   - _"Hey roam, are the maples peaking?"_
   - _"Hey roam, how steep is this and when should I drink?"_

roam answers out loud and pauses listening while it speaks, so it doesn't hear itself.

**Safety:** roam will never tell you a wild mushroom, plant, or berry is safe to eat based on a description. It will also tell you to contact emergency services first if you mention an injury or being lost. Treat it as a field companion, not a substitute for expert identification or emergency help.

Full details of the wake-word behaviour and its limits: [docs/WAKE_WORD.md](docs/WAKE_WORD.md).

---

## Plan an outing (the outdoor companion)

Beyond the trail naturalist, roam can help you plan before you go. In the **"Ask roam to plan your outing"** section, type or say what you want and roam routes it to the right tool:

- _\"Find me an easy hike under 5 km\"_ → real trail search (filtered, with stats and source labels)
- _\"What should I pack, and what's the weather?\"_ → a hike plan with a checklist, water and clothing advice, grounded in live weather when online
- _\"Remember that I prefer quiet trails under 5 km\"_ → saved to memory (you can view, delete, or clear it)
- _\"What do I prefer?\"_ → recalls your saved preferences
- _\"Start my hike\"_ / _\"I'm back, end my hike\"_ → an outdoor session with a summary
- _\"Note that I saw a pileated woodpecker\"_ → adds to your nature journal
- _\"Is the device connected?\"_ → reports the IoT device status (a clearly-labeled simulator unless real hardware is attached)

The **Trails / Memory / Journal / Device** tabs below let you browse, save, and manage this data directly. Everything is honest: trail records are labeled **sample data**, weather is either live (Open-Meteo) or clearly unavailable, and the device is a **simulation** unless real hardware is connected.

**What works offline:** text chat with a local Ollama model, trail search over the local dataset, hike planning, memory, and the journal. **What needs the internet:** live weather and live park advisories.

---

## Documentation

| Document                                     | What it covers                                                                                        |
| :------------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data flow, components, failure modes, security model, and roadmap                      |
| [docs/WAKE_WORD.md](docs/WAKE_WORD.md)       | How hands-free listening works, its browser support, privacy trade-offs, and the offline upgrade path |
| [docs/API.md](docs/API.md)                   | HTTP endpoints, request and response shapes, and error codes                                          |
| [test_wake.js](test_wake.js)                 | Wake word regression checks: name matching, the question window, submission (`npm run test:wake`)      |
| [test_outdoor.js](test_outdoor.js)           | Outdoor API smoke test: trail search, weather, memory, journal, device, and agent intents (`npm run test:outdoor`) |
| [CHANGELOG.md](CHANGELOG.md)                 | What changed in v1.1 and why                                                                          |

---

## Configuration

Set these in `.env`. Anything left blank falls back to a working default.

| Variable              | Default                         | Purpose                                                                   |
| :-------------------- | :------------------------------ | :------------------------------------------------------------------------ |
| `ASSISTANT_NAME`      | `roam`                          | Name shown in the UI and used in the model's persona                      |
| `WAKE_WORDS`          | `roam,rome,rom`                 | Comma-separated words that trigger listening. Use short, distinct names   |
| `LLM_BASE_URL`        | `http://localhost:11434/v1`     | Any OpenAI-compatible endpoint                                            |
| `LLM_MODEL`           | `gemma2:9b`                     | Model name at that endpoint                                               |
| `LLM_API_KEY`         | (empty)                         | Only for hosted endpoints such as Groq or OpenRouter                      |
| `LLM_GATEWAY`         | `false`                         | Set `true` for a gateway such as FreeLLMAPI. Answers are labelled "via gateway", never "local" |
| `TABPFN_SERVICE_URL`  | (empty)                         | URL of the persistent TabPFN service. Empty means run the CLI             |
| `PYTHON_BIN`          | `python3` (`python` on Windows) | Interpreter for the TabPFN CLI                                            |
| `ELEVENLABS_API_KEY`  | (empty)                         | Natural voice. Without it, the browser's built-in speech is used          |
| `ELEVENLABS_VOICE_ID` | built-in                        | Voice to use with ElevenLabs                                              |
| `SENTRY_DSN`          | (empty)                         | Enables Sentry tracing. Without it, tracing stays local                   |
| `SERPAPI_API_KEY`     | (empty)                         | Live park advisories. Without it, a simulated advisory is used            |
| `GROQ_API_KEY`        | (empty)                         | Server-side Whisper transcription for browsers without speech recognition |

Keys entered in the browser's settings panel are stored only in that browser's `localStorage` and are sent to the server for each request. They are not written to disk on the server.

---

## Deploying

`render.yaml` deploys the Node server to Render. **Ollama will not run on Render's free tier**, so for a hosted demo use a hosted open-weight endpoint: set `LLM_BASE_URL` (for example `https://api.groq.com/openai/v1`), `LLM_MODEL`, and `LLM_API_KEY` in the Render dashboard. A fully offline deployment means running the server on the same machine as Ollama.

---

## Honest status

Some parts of this project are complete, some are partial, and some are not built yet. This table reflects the code as shipped.

| Component                | Status                               | Notes                                                                                                                             |
| :----------------------- | :----------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------- |
| Open-weight LLM client   | ✅ Working                           | Any OpenAI-compatible endpoint. Tested against a stub endpoint and the offline fallback.                                          |
| Offline fallback answers | ✅ Working                           | Used when no model responds. Phrased as possibilities, not certainties.                                                           |
| Hands-free "Hey roam"    | ✅ Implemented, ⚠️ browser-dependent | Web Speech API in Chrome and Edge. Not offline. See [docs/WAKE_WORD.md](docs/WAKE_WORD.md).                                       |
| Push-to-talk mic         | ✅ Working                           | Browser speech first, server Whisper fallback when a Groq key is set.                                                             |
| Trail search & details   | ✅ Working (sample data)             | Local `data/trails.json` behind a provider interface. Real filtering; **sample records, not live**. Labeled as such everywhere.     |
| Live weather             | ✅ Working when online               | Open-Meteo (free, no key). Honest "unavailable" state offline.                                                                   |
| Hike planner & checklist | ✅ Working                           | Deterministic plan + checklist from real trail/weather output. Estimates labeled as estimates.                                    |
| Memory (preferences)     | ✅ Working                           | Local JSON store behind an interface. User can save, recall, delete, and clear. No raw audio stored.                              |
| Nature journal           | ✅ Working                           | Observations the user chooses to save. Local JSON store.                                                                          |
| Outdoor session mode     | ✅ Working (in-memory)              | Explicit start/end, safe duplicate handling, summary from recorded data. Session state is per-process, not persisted.            |
| IoT device               | ✅ Simulator only                     | Same interface a real ESP32/Arduino adapter would use. Clearly labeled simulated. No physical hardware claimed.                    |
| TabPFN predictions       | ⚠️ Partial                           | Real TabPFN code path when `tabpfn` is installed. **Training data is synthetic**, so predictions reproduce the generator's rules. |
| Field guide retrieval    | ✅ Working                           | Keyword-scored over a small seed database. Extend it for your region.                                                             |
| Park advisories          | ⚠️ Partial                           | Live via SerpApi when a key is set. Otherwise simulated.                                                                          |
| ElevenLabs voice         | ✅ Working when keyed                | Browser speech fallback otherwise.                                                                                                |
| Sentry tracing           | ✅ Working when keyed                | Traces appear only when `SENTRY_DSN` is set.                                                                                      |
| Mastra agent framework   | ❌ Not used                          | The agent pipeline is hand-written. The dependency was removed rather than claimed.                                               |
| Temporal durable sync    | ❌ Stub                              | Returns success without persisting anything. Labelled `local-stub` in responses.                                                  |

---

## Why open matters

**Zero signal in the backcountry.** Cloud APIs fail the moment the phone loses signal. A local Gemma 2 model served by Ollama keeps working in a ravine with no bars.

**Your location stays yours.** Foragers protect their spots, and hikers may not want their route or fitness data on a stranger's server. With a local model, coordinates and questions never leave the device.

**No metered bill for public land.** Trail volunteers, park nonprofits, and outdoor clubs can run this indefinitely at no per-query cost.

**You can change the brain.** Because the model sits behind a standard API, a club can swap models, add its own field guide, change the persona, or tune the safety rules without waiting for a vendor.

**Where open did better than closed in this build:** the same code runs on a laptop with no network, and the same code also points at a hosted open-weight model when a laptop isn't enough. Closed APIs offer neither.

---

## License

MIT. Built for Hacktoberfest 2026.

<img width="1000" height="420" alt="roam_cover_devto" src="https://github.com/user-attachments/assets/1c44fdda-2fd8-45d6-a53f-466d86baff50" />

