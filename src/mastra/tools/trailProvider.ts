/**
 * Roam - Trail data provider.
 *
 * Loads the local sample dataset (data/trails.json) behind a provider interface.
 * A real trail API (AllTrails, NPS, OpenStreetMap-based) can replace the local
 * provider later without touching callers. Every result carries `source` and
 * `verified` so the UI can label sample data and never present it as live truth.
 *
 * The provider never invents records: unknown filters simply reduce the matches,
 * and an empty result is returned as an empty list with providerAvailable=false
 * only when the dataset itself could not be read.
 */

import fs from "fs";
import path from "path";
import type {
  Difficulty,
  Trail,
  TrailSearchFilters,
  TrailSearchResult,
} from "../../types/trail.js";

export interface TrailProvider {
  readonly name: string;
  search(filters: TrailSearchFilters, limit?: number): TrailSearchResult;
  getById(id: string): Trail | undefined;
}

const DIFFICULTY_ORDER: Difficulty[] = ["easy", "moderate", "hard"];

function normalise(s: string): string {
  return s.toLowerCase().trim();
}

function difficultyRank(d: Difficulty): number {
  return DIFFICULTY_ORDER.indexOf(d);
}

/** Highest-difficulty-to-lowest within one "level", so "easy" lists easy first. */
function matchesDifficulty(trail: Trail, want: Difficulty | Difficulty[] | undefined): boolean {
  if (!want) return true;
  const list = Array.isArray(want) ? want : [want];
  if (list.length === 0) return true;
  return list.includes(trail.difficulty);
}

function haystack(trail: Trail): string {
  return normalise(
    [
      trail.name,
      trail.region,
      trail.location.areaName,
      trail.terrain,
      trail.accessibility,
      trail.highlights.join(" "),
    ].join(" "),
  );
}

function scoreTrail(trail: Trail, filters: TrailSearchFilters): number | null {
  // Hard filters first: any that fails returns null (excluded), never fudged.
  if (filters.maxDistanceKm !== undefined && trail.distance_km > filters.maxDistanceKm) return null;
  if (filters.maxDurationMin !== undefined && trail.estimated_duration_min > filters.maxDurationMin) return null;
  if (filters.maxElevationGainM !== undefined && trail.elevation_gain_m > filters.maxElevationGainM) return null;
  if (!matchesDifficulty(trail, filters.difficulty)) return null;
  if (filters.accessibleOnly && !/accessible/i.test(trail.accessibility)) return null;

  let score = 0;

  const terms = [filters.query, filters.location]
    .filter((t): t is string => Boolean(t && t.trim()))
    .flatMap((t) => normalise(t).split(/[^a-z0-9]+/).filter((w) => w.length > 1));

  if (terms.length > 0) {
    const hay = haystack(trail);
    const hits = terms.filter((t) => hay.includes(t)).length;
    // A search was requested but nothing matched: exclude rather than pad results.
    if (hits === 0) return null;
    score += hits;
  }

  // Quieter trails rank higher when the user asked for quiet.
  if (filters.preferQuiet) score += trail.quietScore * 2;

  return score;
}

export class LocalTrailProvider implements TrailProvider {
  readonly name = "Local sample dataset (data/trails.json)";
  private trails: Trail[] = [];
  private loaded = false;

  constructor(private filePath: string = path.resolve(process.cwd(), "data", "trails.json")) {}

  private load(): void {
    if (this.loaded) return;
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      this.trails = Array.isArray(parsed) ? (parsed as Trail[]) : [];
    } catch (err: any) {
      console.warn(`[Trails] could not read dataset (${err?.message}); provider unavailable.`);
      this.trails = [];
    }
    this.loaded = true;
  }

  search(filters: TrailSearchFilters, limit = 5): TrailSearchResult {
    this.load();
    const scored = this.trails
      .map((t) => ({ trail: t, score: scoreTrail(t, filters) }))
      .filter((x): x is { trail: Trail; score: number } => x.score !== null)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return difficultyRank(a.trail.difficulty) - difficultyRank(b.trail.difficulty);
      });

    return {
      trails: scored.slice(0, limit).map((x) => x.trail),
      providerAvailable: this.trails.length > 0,
      providerName: this.name,
      totalMatches: scored.length,
    };
  }

  getById(id: string): Trail | undefined {
    this.load();
    const key = normalise(id);
    return this.trails.find((t) => normalise(t.id) === key || normalise(t.name) === key);
  }
}

export const trailProvider: TrailProvider = new LocalTrailProvider();
