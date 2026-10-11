# Roam API

Base URL: `http://localhost:3000` (or your Render URL). JSON in and out. No authentication: see [ARCHITECTURE.md §6](ARCHITECTURE.md#6-security-and-privacy-model) before exposing the server publicly.

## `GET /health`

Liveness check.

```json
{
  "status": "ok",
  "app": "Roam",
  "assistantName": "roam",
  "theme": "Touch Grass"
}
```

## `GET /api/config`

Non-secret runtime facts for the UI.

```json
{
  "assistantName": "roam",
  "wakeWords": ["roam", "rome", "rom"],
  "server": {
    "defaultLlmEndpoint": "http://localhost:11434/v1",
    "serverTranscription": false,
    "serverTts": false
  }
}
```

## `POST /api/trail/observe`

Runs the naturalist pipeline for one question or waypoint.

**Request**

| Field                    | Type    | Required | Notes                                                                                |
| :----------------------- | :------ | :------- | :----------------------------------------------------------------------------------- |
| `userQuery`              | string  | no       | Question text. Truncated to 500 characters. Empty means "what should I notice here?" |
| `telemetry.elevation_m`  | number  | no       | 0–9000. Default 1350                                                                 |
| `telemetry.incline_pct`  | number  | no       | 0–60. Default 14.2                                                                   |
| `telemetry.temp_c`       | number  | no       | −40 to 50. Default 17.5                                                              |
| `telemetry.humidity_pct` | number  | no       | 0–100. Default 62                                                                    |
| `telemetry.day_of_year`  | integer | no       | 1–366. Default 279                                                                   |
| `telemetry.pace_min_km`  | number  | no       | 1–60. Default 11.5                                                                   |
| `llmBaseUrl`             | string  | no       | Overrides the server's LLM endpoint for this request                                 |
| `llmApiKey`              | string  | no       | Used for this request only                                                           |
| `llmModel`               | string  | no       | Overrides the model for this request                                                 |
| `elevenLabsApiKey`       | string  | no       | Used for this request only                                                           |

Out-of-range telemetry is clamped, not rejected.

**Response (200)**

```json
{
  "success": true,
  "data": {
    "spokenText": "That whistling could be a Black-capped Chickadee...",
    "voiceAudio": {
      "format": "browser-synthesized",
      "voiceName": "Browser speech (no ElevenLabs key)",
      "text": "...",
      "durationEstimateSec": 4
    },
    "tabpfnMetrics": {
      "source": "scikit-learn ensemble (TabPFN not installed)",
      "engine": "sklearn",
      "training_data": "synthetic (services/generate_data.py)",
      "foliage_stage": "Peak Color",
      "confidence": 0.61,
      "fatigue_risk": "High",
      "recommended_hydration_ml_hr": 790,
      "wildlife_sighting_chance": 0.44,
      "elevation_m": 1450,
      "incline_pct": 15,
      "temp_c": 17
    },
    "fieldGuideHits": [
      { "commonName": "...", "scientificName": "...", "category": "Fauna" }
    ],
    "parkAlert": {
      "parkName": "...",
      "activeAdvisory": "...",
      "source": "..."
    },
    "model": "gemma2:9b (local)",
    "usedFallback": false,
    "openInnovationAdvantage": "...",
    "latencyMs": 1840
  }
}
```

`usedFallback: true` with `model: "Offline naturalist (no LLM reachable)"` means no model answered and a deterministic answer was returned.

**Errors:** `500` with `{ "success": false, "error": "..." }`. The message is deliberately generic; details are logged server-side.

## `POST /api/trail/transcribe`

Server-side speech-to-text. Used by push-to-talk when the browser's own recognition returns nothing.

**Request:** `{ "audioBase64": "data:audio/webm;base64,...", "groqApiKey": "optional" }`

**Responses**

| Status | Body                                                                                | Meaning                         |
| :----- | :---------------------------------------------------------------------------------- | :------------------------------ |
| 200    | `{ "success": true, "text": "...", "source": "Whisper large-v3-turbo (via Groq)" }` | Transcribed                     |
| 200    | `{ "success": false, "error": "Didn't catch any speech..." }`                       | Silence or unintelligible audio |
| 400    | `{ "success": false, "error": "No audio received." }`                               | Missing audio                   |
| 413    | `{ "success": false, "error": "Recording is too long..." }`                         | Over 10 MB                      |
| 502    | `{ "success": false, "error": "Transcription provider returned N." }`               | Upstream failure                |
| 503    | `{ "success": false, "error": "Server transcription needs a Groq key..." }`         | No key configured               |

## `POST /api/trail/sync`

Checkpoint recording. **Currently a stub** (`engine: "local-stub"`). It validates nothing beyond the presence of checkpoints and persists nothing.

**Request:** `{ "checkpoints": [ { "checkpointId", "timestamp", "elevation_m", "coordinates": { "lat", "lng" }, "observationNotes" } ] }`

**Response:** `{ "success": true, "data": { "engine": "local-stub", "workflowId", "status", "checkpointsSynced", "retryAttempts", "durableStorageKey" } }`

## Python: TabPFN service (optional)

`uvicorn tabpfn_api:app --app-dir services --port 8001`

| Method | Path       | Body                                                                                          | Returns                                                              |
| :----- | :--------- | :-------------------------------------------------------------------------------------------- | :------------------------------------------------------------------- |
| GET    | `/health`  | none                                                                                          | `{ "status": "ok", "engine": "tabpfn" \| "sklearn" \| "heuristic" }` |
| POST   | `/predict` | `elevation_m`, `incline_pct`, `temp_c`, optional `humidity_pct`, `day_of_year`, `pace_min_km` | Same shape as `tabpfnMetrics` above                                  |

Input ranges are validated by the service and return HTTP 422 when out of range.

## Outdoor companion (Roam)

All of these return `{ "success": true, "data": ... }` on success, or
`{ "success": false, "error": "...", "code": "..." }` on failure. Error `code` values are
machine-readable; `error` is human-readable. Server-side validation rejects bad input.

### `POST /api/agent`

The conversational outdoor agent. Routes the message to the right tool, then phrases a
short spoken answer (with the configured LLM, or a deterministic fallback when no model is
reachable). Facts always come from tools, never the model.

**Request**

| Field           | Type   | Notes                                                        |
| :-------------- | :----- | :----------------------------------------------------------- |
| `message`       | string | Required. Truncated to 1000 chars.                           |
| `location`      | object | Optional `{ lat, lng, label }` for weather.                  |
| `llmBaseUrl`    | string | Optional per-request LLM endpoint override.                  |
| `llmApiKey`     | string | Optional per-request key. Used once, never stored.           |
| `llmModel`      | string | Optional per-request model.                                 |
| `elevenLabsApiKey` | string | Optional per-request ElevenLabs key.                      |

**Response (200)** `data` contains `intent`, `spokenText`, `usedFallback`, `model`,
optional `data` (tool payload), and `latencyMs`.

Intents: `find_trail`, `trail_details`, `plan_hike`, `weather`, `save_memory`,
`recall_memory`, `forget_memory`, `start_session`, `end_session`, `log_observation`,
`device_status`, `device_command`, `nature`, `smalltalk`.

**Errors:** `400` (`EMPTY_MESSAGE`), `500` (`AGENT_ERROR`).

### `GET /api/trails/search`

| Param              | Type   | Notes                                                        |
| :----------------- | :----- | :----------------------------------------------------------- |
| `q`                | string | Free-text match on name, region, terrain, highlights.        |
| `location`         | string | Place-name match.                                            |
| `maxDistanceKm`    | number | Upper bound on distance.                                     |
| `maxDurationMin`   | number | Upper bound on estimated duration.                           |
| `maxElevationGainM`| number | Upper bound on elevation gain.                               |
| `difficulty`       | string | `easy`, `moderate`, `hard` (comma-separated for multiple).   |
| `accessible`       | `true` | Only trails whose accessibility notes mention "accessible".  |
| `quiet`            | `true` | Bias toward higher quiet score.                              |
| `limit`            | number | 1–20. Default 10.                                            |

Every trail carries `source` (the sample dataset) and `verified: false`. A query that
matches nothing returns an empty `trails` array, never invented records.

### `GET /api/trails/:id`

`404` with `NOT_FOUND` when the id is not in the dataset.

### `GET /api/weather`

| Param   | Type   | Notes                                             |
| :------ | :----- | :------------------------------------------------ |
| `lat`   | number | Required. −90 to 90.                              |
| `lng`   | number | Required. −180 to 180.                            |
| `label` | string | Optional human-readable place name.               |
| `hours` | number | 0–24 hours of forecast to include. Default 0.     |

Live via Open-Meteo (free, no key). When offline, `data.available` is `false` and
`data.unavailableReason` explains why — no fake conditions are returned. `400`
(`MISSING_COORDS`) without coordinates.

### `GET /api/memory` · `POST /api/memory` · `DELETE /api/memory/:id` · `DELETE /api/memory`

User-controlled preferences, saved trails, and saved plans. `GET` returns `{ backing,
records }`. `POST` requires `text` (and accepts `kind` and `data`); `400` (`EMPTY_TEXT`)
without it. `DELETE /:id` is `404` (`NOT_FOUND`) when absent. `DELETE /` clears all and
returns `{ cleared }`. Backed by a local JSON file (`data/memory.json`, git-ignored).

### `GET /api/journal` · `POST /api/journal` · `DELETE /api/journal`

Nature observations. `POST` requires `text` (`400` `EMPTY_TEXT` without it) and accepts
optional `locationLabel`, `mediaRef`, `sessionId`. Never fabricates a location. Backed by
`data/journal.json` (git-ignored).

### `GET /api/device` · `POST /api/device/command`

The IoT device is a **simulator** by default (`status.simulated === true`). Commands are
restricted to an allowlist: `start_listening`, `stop_listening`, `speak`, `set_indicator`,
`start_session`, `end_session`. Any other command returns `400` (`COMMAND_NOT_ALLOWED`).
`GET /api/device` returns `{ status, allowedCommands }`.
