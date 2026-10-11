/**
 * Roam - TabPFN prediction bridge.
 *
 * Resolution order:
 *   1. TABPFN_SERVICE_URL set  -> HTTP call to the persistent FastAPI service (model loaded once).
 *   2. Otherwise               -> spawn services/tabpfn_service.py (refits each call; fine for demos).
 *   3. Both unavailable        -> heuristic fallback, clearly labelled as such in `source`.
 */

import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);

export interface TabPFNInput {
  elevation_m: number;
  incline_pct: number;
  temp_c: number;
  humidity_pct?: number;
  day_of_year?: number;
  pace_min_km?: number;
}

export interface TabPFNResult {
  source: string;
  engine?: "tabpfn" | "sklearn" | "heuristic";
  training_data?: string;
  foliage_stage: string;
  confidence: number;
  fatigue_risk: string;
  recommended_hydration_ml_hr: number;
  wildlife_sighting_chance: number;
  elevation_m: number;
  incline_pct: number;
  temp_c: number;
}

function normalise(input: TabPFNInput) {
  return {
    elevation_m: input.elevation_m,
    incline_pct: input.incline_pct,
    temp_c: input.temp_c,
    humidity_pct: input.humidity_pct ?? 60.0,
    day_of_year: input.day_of_year ?? 278,
    pace_min_km: input.pace_min_km ?? 12.0,
  };
}

function heuristicFallback(input: TabPFNInput): TabPFNResult {
  return {
    source: "Heuristic fallback (TabPFN service unavailable)",
    engine: "heuristic",
    foliage_stage: input.elevation_m > 1200 ? "Peak Color" : "Turning",
    confidence: 0.5,
    fatigue_risk: input.incline_pct > 15 ? "High" : "Moderate",
    recommended_hydration_ml_hr: 650,
    wildlife_sighting_chance: 0.4,
    elevation_m: input.elevation_m,
    incline_pct: input.incline_pct,
    temp_c: input.temp_c,
  };
}

async function viaHttp(input: TabPFNInput, baseUrl: string): Promise<TabPFNResult> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(normalise(input)),
    signal: AbortSignal.timeout(4_000),
  });
  if (!res.ok) throw new Error(`TabPFN service returned HTTP ${res.status}`);
  return (await res.json()) as TabPFNResult;
}

async function viaCli(input: TabPFNInput): Promise<TabPFNResult> {
  const scriptPath = path.resolve(process.cwd(), "services", "tabpfn_service.py");
  const python = process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");
  const n = normalise(input);
  const cmd = `"${python}" "${scriptPath}" --elevation ${n.elevation_m} --incline ${n.incline_pct} --temp ${n.temp_c} --humidity ${n.humidity_pct} --day ${n.day_of_year} --pace ${n.pace_min_km}`;
  const { stdout } = await execAsync(cmd, { timeout: 20_000 });
  return JSON.parse(stdout.trim()) as TabPFNResult;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const predictionCache = new Map<string, { at: number; value: TabPFNResult }>();

export async function runTabPFNPrediction(input: TabPFNInput): Promise<TabPFNResult> {
  // Round so near-identical readings share a cache entry; waypoints repeat often.
  const n = normalise(input);
  const key = [n.elevation_m, n.incline_pct, n.temp_c, n.humidity_pct, n.day_of_year, n.pace_min_km]
    .map((v) => Math.round(v * 2) / 2)
    .join("|");
  const hit = predictionCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const value = await predict(input);
  predictionCache.set(key, { at: Date.now(), value });
  return value;
}

async function predict(input: TabPFNInput): Promise<TabPFNResult> {
  const serviceUrl = process.env.TABPFN_SERVICE_URL;

  if (serviceUrl) {
    try {
      return await viaHttp(input, serviceUrl);
    } catch (err: any) {
      console.warn(`[TabPFN] service unreachable (${err?.message}); trying local script.`);
    }
  }

  try {
    return await viaCli(input);
  } catch (err: any) {
    console.error(`[TabPFN] local script failed (${err?.message}); using heuristic fallback.`);
    return heuristicFallback(input);
  }
}
