# Deploying Roam

Roam is a single Node service: it serves the web UI and the API from one
process. This guide covers a public demo on **Render's free tier** and the fully
**offline** local path.

## What runs where

| Piece            | Local (offline)                     | Render free tier                                   |
| :--------------- | :---------------------------------- | :------------------------------------------------- |
| LLM              | Ollama + a local model (`gemma2:2b`) | A hosted open-weight endpoint (e.g. Groq). **Ollama cannot run on the free tier.** |
| Trail data       | `data/trails.json` (local)          | Same local dataset                                 |
| Weather          | Offline → honest "unavailable"      | Live via Open-Meteo (no key needed)                |
| TabPFN / alerts  | Local Python, or labeled fallbacks  | Labeled local heuristics/simulations (no Python)   |
| Memory / journal | Local JSON files                    | Ephemeral — cleared on each deploy/restart         |

**Honest note:** the hosted demo is *not* offline. It uses a hosted open-weight model
so judges can try it without installing anything. The same code runs **fully offline**
locally (see below), and the app never silently falls back from a local model to a
cloud one — if the configured model is unreachable it says so.

---

## Option A — Deploy to Render (public demo, ~3 minutes)

Render deploys from a Git repository, so the project must be pushed to GitHub first.

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Roam v1.2.0 — outdoor companion"
git branch -M main
git remote add origin https://github.com/<you>/roam.git
git push -u origin main
```

`.env`, `node_modules/`, `dist/`, and runtime data are git-ignored — nothing secret
is committed.

### 2. Create the service on Render

1. Go to <https://dashboard.render.com> → **New +** → **Blueprint**.
2. Connect the repo. Render reads `render.yaml` and pre-fills everything.
   (Or **New + → Web Service**, connect the repo, and use the values from
   `render.yaml`: Build `npm install && npm run build`, Start `node dist/server.js`,
   Health check `/health`.)
3. Set the one secret in the dashboard (Environment → **LLM_API_KEY**):
   - Free option: create a key at <https://console.groq.com> and paste it. The
     default model `llama-3.1-8b-instant` is served on Groq's free tier.
   - **No key?** Leave it blank. The app still deploys and works — chat uses the
     built-in deterministic fallback, and trails/planning/memory/journal all work.
4. Click **Create / Deploy**. Wait for the build, then open the `onrender.com` URL.

The `/health` endpoint returns `{"status":"ok", ...}` so Render's health check passes.

### 3. Optional hosted services (all have offline fallbacks)

Set any of these in the Render dashboard to enable a feature; leave them unset to
deploy with zero secrets:

| Variable            | Enables                                        |
| :------------------ | :--------------------------------------------- |
| `LLM_API_KEY`       | Live chat via the hosted open-weight model     |
| `ELEVENLABS_API_KEY`| Natural voice (otherwise the browser speaks)   |
| `SERPAPI_API_KEY`   | Live park advisories (otherwise simulated)     |
| `GROQ_API_KEY`      | Server-side speech-to-text (needs internet)    |
| `SENTRY_DSN`        | Error/trace reporting                          |

> **Free-tier caveat:** a Render free web service sleeps after ~15 minutes of
> inactivity, so the first request after a pause takes a few seconds to wake. That's
> expected on the free plan.

---

## Option B — Run fully offline (local, no internet)

This is the path the project is built around: the model, data, and tools all run on
your machine.

### 1. Install and start the local model

```bash
# Install Ollama from https://ollama.com, then:
ollama pull gemma2:2b      # fast on a laptop CPU (~1.6 GB)
# or, for better answers (needs more RAM): ollama pull gemma2:9b
```

### 2. Configure and run

```bash
cp .env.example .env        # already points at local Ollama; keys stay blank
npm install
npm start                   # tsx runs src/server.ts directly
```

Open <http://localhost:3000>. The header shows **🟢 online** / **📴 offline**, and the
model badge shows which model answered.

### 3. Prove it works with the network off

Disconnect from the internet (or turn off Wi‑Fi), then:

```bash
npm run test:offline
```

This boots the server with every external host blocked and checks that the local
model answers chat, trail search and planning work, weather degrades honestly, and
memory/journal persist — all with no internet.

### What still needs the internet (offline)

- **Live weather** (Open-Meteo) — returns an honest "unavailable" message offline.
- **Hands-free voice input** ("Hey roam") — browser speech recognition is
  cloud-based. Voice *output* (roam speaking) uses local OS voices and works offline.
- **Server-side Whisper transcription** (Groq) — needs a connection.

Everything else — chat with the local model, trail search, hike planning, memory,
journal, and the IoT simulator — is fully offline.
