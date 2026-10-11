/**
 * Roam - Shared domain types for outdoor intelligence.
 * Kept in one place so tools, the agent, and the API agree on shapes.
 */

export type Difficulty = "easy" | "moderate" | "hard";

export interface TrailCoordinates {
  lat: number;
  lng: number;
  areaName: string;
}

/**
 * A trail record. `verified` and `source` are always present so the UI can label
 * sample data honestly and never present it as live, confirmed information.
 */
export interface Trail {
  id: string;
  name: string;
  region: string;
  location: TrailCoordinates;
  distance_km: number;
  elevation_gain_m: number;
  estimated_duration_min: number;
  difficulty: Difficulty;
  /** 0 (busy) to 1 (very quiet). Only meaningful when backed by real traffic data. */
  quietScore: number;
  terrain: string;
  accessibility: string;
  water_available: boolean;
  water_notes: string;
  conditions: string;
  highlights: string[];
  source: string;
  lastUpdated: string;
  verified: boolean;
}

export interface TrailSearchFilters {
  /** Free-text match on name, region, area, terrain, and highlights. */
  query?: string;
  location?: string;
  maxDistanceKm?: number;
  maxDurationMin?: number;
  maxElevationGainM?: number;
  difficulty?: Difficulty | Difficulty[];
  accessibleOnly?: boolean;
  /** Bias results toward higher quietScore. */
  preferQuiet?: boolean;
}

export interface TrailSearchResult {
  trails: Trail[];
  /** True when the configured provider returned data; false when the dataset is empty/missing. */
  providerAvailable: boolean;
  providerName: string;
  /** How many records matched before the limit was applied. */
  totalMatches: number;
}
