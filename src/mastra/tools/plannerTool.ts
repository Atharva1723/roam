/**
 * Roam - Hike planner and checklist generator.
 *
 * Deterministic logic. The planner uses real trail records and real weather output;
 * it never invents trail statistics. Estimates are labelled as estimates, and missing
 * data (no weather, unknown trail) is stated plainly rather than filled in.
 */

import type { Difficulty, Trail } from "../../types/trail.js";
import type { WeatherResult } from "./weatherTool.js";

export interface ChecklistItem {
  text: string;
  category: "gear" | "clothing" | "food_water" | "safety" | "navigation";
}

export interface HikePlan {
  trailId: string;
  trailName: string;
  trailSource: string;
  /** Best-effort. An estimate, not a guarantee. */
  estimatedStart: string;
  estimatedFinish: string;
  estimatedDurationMin: number;
  distance_km: number;
  elevation_gain_m: number;
  difficulty: Difficulty;
  itinerary: string[];
  checklist: ChecklistItem[];
  waterAdvice: string;
  clothingAdvice: string;
  safetyReminders: string[];
  caveats: string[];
  weather: { available: boolean; summary: string; source: string } | null;
  /** Why this trail was chosen, given the stated preferences. */
  rationale: string;
}

export interface PlanInput {
  trail: Trail;
  /** Local Date/time the hike starts. Defaults to now + 30 min. */
  startTime?: Date;
  weather?: WeatherResult | null;
  /** Extra context the user gave, e.g. "bringing a dog", "want it quiet". */
  preferences?: string[];
}

function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** A conservative walking-time estimate: Naismith's rule (12 min/km + 10 min per 100 m climb). */
export function estimateDurationMin(distanceKm: number, elevationGainM: number): number {
  return Math.round(distanceKm * 12 + (elevationGainM / 100) * 10);
}

function clothingFor(weather: WeatherResult | null | undefined): string {
  if (!weather || !weather.available || !weather.current) {
    return "Check the forecast before you leave; dress in a layer you can shed as you warm up.";
  }
  const c = weather.current;
  const bits: string[] = [];
  if (c.temp_c < 5) bits.push("insulating layer and gloves");
  else if (c.temp_c < 14) bits.push("a light fleece or long sleeves");
  else bits.push("breathable layers");
  if (c.precipitation_mm > 0 || c.weather_code >= 51) bits.push("a waterproof shell");
  if (c.wind_kmh > 30) bits.push("a windbreaker");
  return `Around ${Math.round(c.temp_c)}°C: bring ${bits.join(" and ")}.`;
}

function waterFor(trail: Trail, weather: WeatherResult | null | undefined, durationMin: number): string {
  const hours = durationMin / 60;
  const heatBoost = weather?.available && weather.current && weather.current.temp_c >= 22 ? 0.5 : 0;
  const litres = Math.max(0.5, Math.round((0.5 + 0.4 * hours + heatBoost) * 2) / 2);
  return trail.water_available
    ? `The trail has water (${trail.water_notes.toLowerCase()}), but carry about ${litres} L and treat any stream water.`
    : `No dependable water on this trail. Carry about ${litres} L.`;
}


export function planHike(input: PlanInput): HikePlan {
  const { trail } = input;
  const start = input.startTime ? new Date(input.startTime) : addMinutes(new Date(), 30);
  const weather = input.weather ?? null;

  // Prefer the trail's own duration estimate; fall back to Naismith if absent.
  const duration = trail.estimated_duration_min || estimateDurationMin(trail.distance_km, trail.elevation_gain_m);
  const finish = addMinutes(start, duration);

  const caveats: string[] = [
    "Times are estimates from distance and elevation, not guarantees. Your pace and breaks will change them.",
    `Trail data is from ${trail.source} and marked verified=${trail.verified}; confirm current conditions with the local land manager before you go.`,
  ];

  const safety: string[] = [
    "Tell someone your route and when you expect to be back.",
    "Stay on marked trail and watch footing on rock and roots.",
  ];
  if (!trail.water_available) safety.push("Carry all the water you need; there is none on route.");
  if (trail.difficulty === "hard") safety.push("This is a strenuous route. Turn back if you are behind schedule or the weather shifts.");
  if (weather?.available && weather.current && weather.current.weather_code >= 95) {
    safety.push("Thunderstorms are in the forecast. Avoid exposed high ground and return if you hear thunder.");
    caveats.push("Severe weather was in the forecast at planning time; re-check right before you leave.");
  }
  if (!weather || !weather.available) {
    safety.push("Weather was unavailable at planning time. Check it yourself before leaving.");
  }

  const checklist: ChecklistItem[] = [
    { text: `${Math.max(0.5, Math.round((duration / 60) * 0.6 * 2) / 2)} L of water (adjust for heat)`, category: "food_water" },
    { text: "A snack with salt and something sweet", category: "food_water" },
    { text: "Sturdy shoes with grip", category: "gear" },
    { text: "Small first-aid basics and any personal medication", category: "safety" },
    { text: "Phone, charged, plus a power bank", category: "gear" },
    { text: "Sun protection: hat, sunglasses, sunscreen", category: "clothing" },
    { text: "A map or downloaded offline route", category: "navigation" },
    { text: "A whistle (three blasts is the distress signal)", category: "safety" },
  ];
  if (trail.difficulty !== "easy") {
    checklist.push({ text: "Trekking poles for the climbs", category: "gear" });
  }
  if (weather?.available && weather.current && weather.current.temp_c < 6) {
    checklist.push({ text: "An extra warm layer and a hat", category: "clothing" });
  }

  const itinerary = [
    `Arrive and park by ${fmtTime(addMinutes(start, -10))}.`,
    `Start walking around ${fmtTime(start)}.`,
    `First ${Math.round(duration * 0.4)} min: steady pace, easing into the ${trail.elevation_gain_m} m of climbing.`,
    `Midpoint (~${fmtTime(addMinutes(start, Math.round(duration * 0.5)))}): take a break and drink.`,
    `Turn for home by ~${fmtTime(addMinutes(finish, -15))} to finish near ${fmtTime(finish)}.`,
  ];

  const prefNote = input.preferences?.length ? ` Taking into account: ${input.preferences.join(", ")}.` : "";
  const rationale =
    `${trail.name} is ${trail.difficulty} (${trail.distance_km} km, ${trail.elevation_gain_m} m up), ` +
    `estimated about ${duration} min.${prefNote}`;

  return {
    trailId: trail.id,
    trailName: trail.name,
    trailSource: trail.source,
    estimatedStart: fmtTime(start),
    estimatedFinish: fmtTime(finish),
    estimatedDurationMin: duration,
    distance_km: trail.distance_km,
    elevation_gain_m: trail.elevation_gain_m,
    difficulty: trail.difficulty,
    itinerary,
    checklist,
    waterAdvice: waterFor(trail, weather, duration),
    clothingAdvice: clothingFor(weather),
    safetyReminders: safety,
    caveats,
    weather: weather
      ? { available: weather.available, summary: weather.available ? weather.summary : weather.unavailableReason || "unavailable", source: weather.provider }
      : null,
    rationale,
  };
}
