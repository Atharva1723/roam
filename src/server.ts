/**
 * Roam - Express server and API gateway.
 * Serves the web UI and the trail API.
 *
 * Privacy and state: the server holds no per-user state. Keys sent by the browser apply to
 * that request only. They are never written to process.env, and neither keys nor query text
 * are logged.
 */

import express from "express";
import cors from "cors";
import path from "path";
import dotenv from "dotenv";
import { initSentry } from "./observability/sentry.js";
import { naturalistAgent, TrailObservationRequest } from "./mastra/agents/naturalist.js";
import { outdoorAgent } from "./mastra/agents/outdoor.js";
import { trailProvider } from "./mastra/tools/trailProvider.js";
import { getWeather } from "./mastra/tools/weatherTool.js";
import { createMemoryStore, MemoryKind } from "./mastra/memory/memoryStore.js";
import { Journal } from "./mastra/tools/journalTool.js";
import { device as simDevice, ALLOWED_COMMANDS } from "./mastra/device/device.js";
import { executeDurableTrailSync, TrailCheckpoint } from "./workflows/trailSyncWorkflow.js";
import type { LLMConfig } from "./services/gemma.js";
import type { Difficulty } from "./types/trail.js";

// Server-scoped singletons for user-controlled data. Local JSON files by default.
const memory = createMemoryStore();
const journal = new Journal();

dotenv.config();
initSentry();

const PORT = process.env.PORT || 3000;
const ASSISTANT_NAME = process.env.ASSISTANT_NAME || "roam";
// Comma-separated list from the environment, otherwise the defaults below. The UI stretches each
// letter when matching, so spellings like "roaam"/"rooom" are covered without listing them here.
const DEFAULT_WAKE_WORDS = ["roam", "rome", "rom"];
const WAKE_WORDS = (
  process.env.WAKE_WORDS ? process.env.WAKE_WORDS.split(",") : DEFAULT_WAKE_WORDS
)
  .map((w) => w.trim().toLowerCase())
  .filter(Boolean)
  .filter((w, i, all) => all.indexOf(w) === i);

const MAX_QUERY_CHARS = 500;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

const DEFAULT_TELEMETRY = {
  elevation_m: 1350,
  incline_pct: 14.2,
  temp_c: 17.5,
  humidity_pct: 62,
  day_of_year: 279,
  pace_min_km: 11.5,
  distance_km: 3.2,
};

function clean(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function bounded(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function sanitizeTelemetry(t: any) {
  const d = DEFAULT_TELEMETRY;
  return {
    elevation_m: bounded(t?.elevation_m, 0, 9000, d.elevation_m),
    incline_pct: bounded(t?.incline_pct, 0, 60, d.incline_pct),
    temp_c: bounded(t?.temp_c, -40, 50, d.temp_c),
    humidity_pct: bounded(t?.humidity_pct, 0, 100, d.humidity_pct),
    day_of_year: Math.round(bounded(t?.day_of_year, 1, 366, d.day_of_year)),
    pace_min_km: bounded(t?.pace_min_km, 1, 60, d.pace_min_km),
    distance_km: bounded(t?.distance_km, 0, 500, d.distance_km),
  };
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.static(path.resolve(process.cwd(), "public")));

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    app: "Roam",
    assistantName: ASSISTANT_NAME,
    theme: "Touch Grass",
    capabilities: {
      trailSearch: true,
      weather: true,
      planning: true,
      memory: true,
      journal: true,
      iotSimulator: true,
    },
  });
});

// Non-secret runtime facts the UI needs (wake words, which server-side services are configured).
app.get("/api/config", (_req, res) => {
  res.json({
    assistantName: ASSISTANT_NAME,
    wakeWords: WAKE_WORDS,
    server: {
      defaultLlmEndpoint: process.env.LLM_BASE_URL || process.env.GEMMA_API_BASE || "http://localhost:11434/v1",
      serverTranscription: Boolean(process.env.GROQ_API_KEY),
      serverTts: Boolean(process.env.ELEVENLABS_API_KEY),
    },
    offline: {
      // Offline works for text chat with a local model, trail search, planning, memory, journal.
      // Weather and live park advisories need the internet.
      localTrailData: true,
      weatherRequiresNetwork: true,
    },
  });
});

// ---------- Shared request helpers ----------

function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeLocation(v: any): { lat: number; lng: number; label?: string } | undefined {
  const lat = num(v?.lat);
  const lng = num(v?.lng);
  if (lat == null || lng == null) return undefined;
  return { lat, lng, label: typeof v?.label === "string" ? v.label : undefined };
}

function parseDifficulty(v: unknown): Difficulty | Difficulty[] | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  const parts = v.split(",").map((d) => d.trim().toLowerCase());
  const valid = parts.filter((d): d is Difficulty => ["easy", "moderate", "hard"].includes(d));
  if (valid.length === 0) return undefined;
  return valid.length === 1 ? valid[0] : valid;
}

function parseMemoryKind(v: unknown): MemoryKind | undefined {
  if (typeof v !== "string") return undefined;
  const valid: MemoryKind[] = ["preference", "saved_trail", "saved_plan", "observation"];
  return valid.includes(v as MemoryKind) ? (v as MemoryKind) : undefined;
}

// ---------- Outdoor companion agent ----------

app.post("/api/agent", async (req, res) => {
  const started = Date.now();
  try {
    const message = typeof req.body?.message === "string" ? req.body.message.slice(0, 1000) : "";
    if (!message.trim()) {
      return res.status(400).json({ success: false, error: "A message is required.", code: "EMPTY_MESSAGE" });
    }
    const llm: LLMConfig = {
      baseUrl: clean(req.body?.llmBaseUrl),
      apiKey: clean(req.body?.llmApiKey),
      model: clean(req.body?.llmModel),
    };
    const response = await outdoorAgent.handle({
      message,
      location: normalizeLocation(req.body?.location),
      llm,
      elevenLabsApiKey: clean(req.body?.elevenLabsApiKey),
    });
    res.json({ success: true, data: { ...response, latencyMs: Date.now() - started } });
  } catch (err: any) {
    console.error("[agent] failed:", err?.message);
    res.status(500).json({ success: false, error: "Roam couldn't handle that. Please try again.", code: "AGENT_ERROR" });
  }
});

// ---------- Trail search & details ----------

app.get("/api/trails/search", (req, res) => {
  try {
    const result = trailProvider.search(
      {
        query: typeof req.query.q === "string" ? req.query.q : undefined,
        location: typeof req.query.location === "string" ? req.query.location : undefined,
        maxDistanceKm: num(req.query.maxDistanceKm),
        maxDurationMin: num(req.query.maxDurationMin),
        maxElevationGainM: num(req.query.maxElevationGainM),
        difficulty: parseDifficulty(req.query.difficulty),
        accessibleOnly: req.query.accessible === "true",
        preferQuiet: req.query.quiet === "true",
      },
      Math.min(20, Math.max(1, num(req.query.limit) ?? 10)),
    );
    res.json({
      success: true,
      data: {
        providerName: result.providerName,
        providerAvailable: result.providerAvailable,
        totalMatches: result.totalMatches,
        trails: result.trails,
      },
    });
  } catch (err: any) {
    console.error("[trails/search] failed:", err?.message);
    res.status(500).json({ success: false, error: "Trail search failed.", code: "TRAIL_SEARCH_ERROR" });
  }
});

app.get("/api/trails/:id", (req, res) => {
  const trail = trailProvider.getById(req.params.id);
  if (!trail) {
    return res.status(404).json({ success: false, error: "Trail not found in the dataset.", code: "NOT_FOUND" });
  }
  res.json({ success: true, data: trail });
});

// ---------- Weather ----------

app.get("/api/weather", async (req, res) => {
  try {
    const lat = num(req.query.lat);
    const lng = num(req.query.lng);
    if (lat == null || lng == null) {
      return res.status(400).json({ success: false, error: "lat and lng are required.", code: "MISSING_COORDS" });
    }
    const result = await getWeather({
      lat,
      lng,
      locationLabel: typeof req.query.label === "string" ? req.query.label : undefined,
      forecastHours: Math.min(24, Math.max(0, num(req.query.hours) ?? 0)),
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    console.error("[weather] failed:", err?.message);
    res.status(500).json({ success: false, error: "Weather lookup failed.", code: "WEATHER_ERROR" });
  }
});

// ---------- Memory (user-controlled) ----------

app.get("/api/memory", (req, res) => {
  res.json({ success: true, data: { backing: memory.backing, records: memory.list(parseMemoryKind(req.query.kind)) } });
});

app.post("/api/memory", (req, res) => {
  try {
    const kind = parseMemoryKind(req.body?.kind) ?? "preference";
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) return res.status(400).json({ success: false, error: "text is required.", code: "EMPTY_TEXT" });
    const record = memory.save(kind, text, req.body?.data && typeof req.body.data === "object" ? req.body.data : undefined);
    res.json({ success: true, data: record });
  } catch (err: any) {
    console.error("[memory/save] failed:", err?.message);
    res.status(500).json({ success: false, error: "Could not save.", code: "MEMORY_SAVE_ERROR" });
  }
});

app.delete("/api/memory/:id", (req, res) => {
  if (!memory.remove(req.params.id)) {
    return res.status(404).json({ success: false, error: "Record not found.", code: "NOT_FOUND" });
  }
  res.json({ success: true, data: { deleted: req.params.id } });
});

app.delete("/api/memory", (_req, res) => {
  res.json({ success: true, data: { cleared: memory.clear() } });
});

// ---------- Journal ----------

app.get("/api/journal", (_req, res) => {
  res.json({ success: true, data: { entries: journal.list() } });
});

app.post("/api/journal", (req, res) => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) return res.status(400).json({ success: false, error: "text is required.", code: "EMPTY_TEXT" });
    const entry = journal.add({
      text,
      locationLabel: clean(req.body?.locationLabel),
      mediaRef: clean(req.body?.mediaRef),
      sessionId: clean(req.body?.sessionId),
    });
    res.json({ success: true, data: entry });
  } catch (err: any) {
    console.error("[journal/save] failed:", err?.message);
    res.status(500).json({ success: false, error: "Could not save entry.", code: "JOURNAL_SAVE_ERROR" });
  }
});

app.delete("/api/journal", (_req, res) => {
  res.json({ success: true, data: { cleared: journal.clear() } });
});

// ---------- IoT device (simulated) ----------

app.get("/api/device", (_req, res) => {
  res.json({ success: true, data: { status: simDevice.getStatus(), allowedCommands: ALLOWED_COMMANDS } });
});

app.post("/api/device/command", (req, res) => {
  const cmd = typeof req.body?.command === "string" ? req.body.command : "";
  if (!(ALLOWED_COMMANDS as readonly string[]).includes(cmd)) {
    return res.status(400).json({
      success: false,
      error: `Unknown command "${cmd}". Allowed: ${ALLOWED_COMMANDS.join(", ")}.`,
      code: "COMMAND_NOT_ALLOWED",
    });
  }
  const result = simDevice.command(cmd, req.body?.args && typeof req.body.args === "object" ? req.body.args : {});
  res.json({ success: result.ok, data: result });
});

app.post("/api/trail/observe", async (req, res) => {
  const started = Date.now();
  try {
    const body = req.body ?? {};
    const llm: LLMConfig = {
      baseUrl: clean(body.llmBaseUrl),
      apiKey: clean(body.llmApiKey) ?? clean(body.groqApiKey),
      model: clean(body.llmModel),
    };

    const request: TrailObservationRequest = {
      userQuery: (typeof body.userQuery === "string" ? body.userQuery : "").slice(0, MAX_QUERY_CHARS),
      telemetry: sanitizeTelemetry(body.telemetry),
      llm,
      elevenLabsApiKey: clean(body.elevenLabsApiKey),
    };

    const observation = await naturalistAgent.processTrailEvent(request);
    res.json({ success: true, data: { ...observation, latencyMs: Date.now() - started } });
  } catch (err: any) {
    console.error("[observe] failed:", err?.message);
    res.status(500).json({ success: false, error: "The naturalist couldn't answer that. Please try again." });
  }
});

// Whisper fallback for browsers without Web Speech. Works only with a Groq key.
app.post("/api/trail/transcribe", async (req, res) => {
  try {
    const audioBase64 = typeof req.body?.audioBase64 === "string" ? req.body.audioBase64 : "";
    const apiKey = clean(req.body?.groqApiKey) || process.env.GROQ_API_KEY || "";

    if (!audioBase64) return res.status(400).json({ success: false, error: "No audio received." });

    const base64Data = audioBase64.replace(/^data:audio\/[\w.+-]+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    if (buffer.byteLength > MAX_AUDIO_BYTES) {
      return res.status(413).json({ success: false, error: "Recording is too long. Keep questions short." });
    }

    if (!apiKey) {
      return res.status(503).json({
        success: false,
        error: "Server transcription needs a Groq key in settings. Chrome and Edge can also transcribe in the browser.",
      });
    }

    const form = new FormData();
    form.append("file", new Blob([buffer], { type: "audio/webm" }), "audio.webm");
    form.append("model", "whisper-large-v3-turbo");

    const groqRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });

    if (!groqRes.ok) {
      return res.status(502).json({ success: false, error: `Transcription provider returned ${groqRes.status}.` });
    }

    const groqData: any = await groqRes.json();
    const text = String(groqData.text ?? "").trim();
    if (!text) {
      return res.json({ success: false, error: "Didn't catch any speech. Try again a little closer to the mic." });
    }
    res.json({ success: true, text, source: "Whisper large-v3-turbo (via Groq)" });
  } catch (err: any) {
    console.error("[transcribe] failed:", err?.message);
    res.status(500).json({ success: false, error: "Transcription failed. Please type your question." });
  }
});

app.post("/api/trail/sync", async (req, res) => {
  try {
    const incoming: TrailCheckpoint[] | undefined = Array.isArray(req.body?.checkpoints) ? req.body.checkpoints : undefined;
    const checkpoints: TrailCheckpoint[] = incoming ?? [
      {
        checkpointId: "cp-1",
        timestamp: new Date().toISOString(),
        elevation_m: 1350,
        coordinates: { lat: 38.52, lng: -78.43 },
        observationNotes: "Sugar Maple peak color reached",
      },
    ];
    const result = await executeDurableTrailSync(checkpoints);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || "Sync failed" });
  }
});

app.use("/api", (_req, res) => {
  res.status(404).json({ success: false, error: "Unknown endpoint", code: "UNKNOWN_ENDPOINT" });
});

app.listen(PORT, () => {
  console.log(`🌲 ${ASSISTANT_NAME} (Roam) live at http://localhost:${PORT}`);
  console.log(`🎧 Wake words: ${WAKE_WORDS.join(", ")}`);
});
