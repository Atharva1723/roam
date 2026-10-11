/**
 * Roam - Outdoor companion agent.
 *
 * A lightweight intent router that decides what the user wants and dispatches to the
 * right tools, then phrases a short spoken answer. It reuses the existing naturalist
 * for nature/field-guide questions, and adds the outdoor workflows from the Roam brief:
 * find a trail, plan a hike, save/recall preferences, start a session, log observations,
 * and control the (simulated) device.
 *
 * The LLM is used only to phrase the final answer from real tool output. All facts
 * (trail stats, weather, plans) come from tools, never from the model. If the model is
 * unavailable, a deterministic spoken summary is returned and labelled as a fallback.
 */

import { trailProvider } from "../tools/trailProvider.js";
import { getWeather } from "../tools/weatherTool.js";
import { planHike, estimateDurationMin } from "../tools/plannerTool.js";
import { createMemoryStore, MemoryStore, MemoryKind } from "../memory/memoryStore.js";
import { SessionManager } from "../tools/sessionTool.js";
import { Journal } from "../tools/journalTool.js";
import { device as simDevice, ALLOWED_COMMANDS } from "../device/device.js";
import { naturalistAgent } from "./naturalist.js";
import { gemmaService } from "../../services/gemma.js";
import { traceAgentSpan } from "../../observability/sentry.js";
import type { Trail } from "../../types/trail.js";

export type Intent =
  | "find_trail"
  | "trail_details"
  | "plan_hike"
  | "weather"
  | "save_memory"
  | "recall_memory"
  | "forget_memory"
  | "start_session"
  | "end_session"
  | "log_observation"
  | "device_status"
  | "device_command"
  | "nature"
  | "smalltalk";

export interface AgentRequest {
  message: string;
  /** When the client shares them. Used to fetch weather for a place. */
  location?: { lat: number; lng: number; label?: string };
  llm?: { baseUrl?: string; apiKey?: string; model?: string };
  elevenLabsApiKey?: string;
}

export interface AgentResponse {
  intent: Intent;
  /** Short spoken answer, ready for text-to-speech. */
  spokenText: string;
  /** Structured payload the UI can render (cards, lists), when relevant. */
  data?: Record<string, unknown>;
  /** Whether the LLM produced the phrasing or a deterministic fallback did. */
  usedFallback: boolean;
  model: string;
}

const DEFAULT_LOCATION = { lat: 38.5534, lng: -78.3959, label: "Shenandoah area" };

/** Keyword intent classifier. Deliberately simple and transparent. */
export function classifyIntent(message: string): Intent {
  const m = message.toLowerCase();
  const has = (...words: string[]) => words.some((w) => m.includes(w));

  if (has("remember", "save this trail", "note that i", "keep in mind", "my preference")) {
    return "save_memory";
  }
  if (has("what do i prefer", "do you remember", "my saved", "what are my", "recall", "my preferences", "my favorite")) return "recall_memory";
  if (has("forget", "delete my", "clear my memory")) return "forget_memory";

  if (has("start my", "start a hike", "begin my", "start the session", "start session", "heading out", "start a walk", "go for a walk", "start a nature walk")) return "start_session";
  if (has("end my", "end the session", "finish my hike", "end session", "i'm back", "im back", "done hiking", "end the hike")) return "end_session";

  if (has("note that i saw", "i saw a", "i noticed", "log this", "add to my journal", "journal")) return "log_observation";

  if (has("device", "button", "led", "hardware", "esp32", "arduino")) {
    if (has("status", "connected", "is it")) return "device_status";
    if (has("listen", "talk", "speak", "press", "toggle", "session")) return "device_command";
    return "device_status";
  }

  if (has("weather", "rain", "forecast", "temperature outside", "how hot", "how cold", "sunny")) return "weather";
  if (has("plan", "itinerary", "what should i pack", "checklist", "how long will", "prepare for")) return "plan_hike";
  if (has("details", "tell me about", "how hard is", "how difficult", "about the ", "conditions on")) return "trail_details";
  if (has("find", "trail", "hike", "walk", "route", "nearby", "somewhere green", "get outside")) return "find_trail";
  if (has("hi", "hello", "hey", "what can you do", "who are you")) return "smalltalk";

  return "nature";
}


function parseFilters(message: string): {
  maxDistanceKm?: number;
  difficulty?: Trail["difficulty"];
  preferQuiet?: boolean;
  accessibleOnly?: boolean;
  maxDurationMin?: number;
} {
  const m = message.toLowerCase();
  const filters: ReturnType<typeof parseFilters> = {};

  const kmMatch = m.match(/(\d+(?:\.\d+)?)\s*(km|kilomet|kilometre|kilometer|mile|mi\b)/);
  if (kmMatch) {
    let km = parseFloat(kmMatch[1]);
    if (kmMatch[2].startsWith("mi")) km *= 1.609;
    filters.maxDistanceKm = Math.round(km * 10) / 10;
  }
  const hourMatch = m.match(/(\d+)\s*(hour|hr)/);
  if (hourMatch) filters.maxDurationMin = parseInt(hourMatch[1], 10) * 60;
  const minMatch = m.match(/(\d+)\s*min/);
  if (minMatch && !hourMatch) filters.maxDurationMin = parseInt(minMatch[1], 10);

  if (m.includes("easy") || m.includes("gentle") || m.includes("flat")) filters.difficulty = "easy";
  else if (m.includes("hard") || m.includes("strenuous") || m.includes("challenging")) filters.difficulty = "hard";
  else if (m.includes("moderate")) filters.difficulty = "moderate";

  if (m.includes("quiet") || m.includes("not too crowded") || m.includes("uncrowded")) filters.preferQuiet = true;
  if (m.includes("accessible") || m.includes("wheelchair") || m.includes("boardwalk")) filters.accessibleOnly = true;

  return filters;
}

function trailCard(t: Trail): Record<string, unknown> {
  return {
    id: t.id,
    name: t.name,
    region: t.region,
    distance_km: t.distance_km,
    elevation_gain_m: t.elevation_gain_m,
    estimated_duration_min: t.estimated_duration_min,
    difficulty: t.difficulty,
    quietScore: t.quietScore,
    terrain: t.terrain,
    accessibility: t.accessibility,
    water_available: t.water_available,
    conditions: t.conditions,
    source: t.source,
    verified: t.verified,
  };
}


export class OutdoorAgent {
  private memory: MemoryStore = createMemoryStore();
  private sessions = new SessionManager();
  private journal = new Journal();
  private device = simDevice;

  /** Phrase a final answer with the LLM; fall back to a deterministic summary if it is unavailable. */
  private async phrase(facts: string, userMessage: string, req: AgentRequest, fallback: string): Promise<{ text: string; usedFallback: boolean; model: string }> {
    const llm = await gemmaService.generateReply(
      {
        system:
          "You are Roam, a calm, warm outdoor companion. The hiker hears you through earbuds. " +
          "Using ONLY the FACTS below, answer the user in at most 3 short spoken sentences. " +
          "Do not add facts that are not in FACTS. If a needed fact is missing, say so plainly. " +
          "Spoken safety first for injury or being lost: tell them to contact emergency services and stay put.",
        facts,
        userMessage,
      },
      req.llm,
    );
    if (llm.usedFallback || !llm.text) {
      return { text: fallback, usedFallback: true, model: llm.provider };
    }
    return { text: llm.text, usedFallback: false, model: llm.provider };
  }

  private pickTrailFor(req: AgentRequest): Trail | undefined {
    // Prefer the most recently saved trail, else a gentle default from a search.
    const saved = this.memory.list("saved_trail")[0];
    if (saved && typeof saved.data?.trailId === "string") {
      const t = trailProvider.getById(saved.data.trailId as string);
      if (t) return t;
    }
    const filters = parseFilters(req.message);
    const res = trailProvider.search({ ...filters, preferQuiet: filters.preferQuiet ?? true }, 1);
    return res.trails[0];
  }

  async handle(req: AgentRequest): Promise<AgentResponse> {
    return traceAgentSpan("outdoorAgent.handle", "ai.agent.reasoning", async () => {
      const message = (req.message || "").trim() || "what should I do today?";
      const intent = classifyIntent(message);
      const loc = req.location ?? DEFAULT_LOCATION;

      switch (intent) {
        case "find_trail":
          return this.findTrails(message, req);
        case "trail_details":
          return this.trailDetails(message, req);
        case "plan_hike":
          return this.plan(message, req, loc);
        case "weather":
          return this.weather(loc, req);
        case "save_memory":
          return this.saveMemory(message);
        case "recall_memory":
          return this.recallMemory(message);
        case "forget_memory":
          return this.forgetMemory();
        case "start_session":
          return this.startSession(message);
        case "end_session":
          return this.endSession();
        case "log_observation":
          return this.logObservation(message);
        case "device_status":
          return this.deviceStatus();
        case "device_command":
          return this.deviceCommand(message);
        case "smalltalk":
          return {
            intent,
            spokenText:
              "I'm Roam, your outdoor companion. I can find a trail, check the weather, plan a hike with a checklist, remember your preferences, and keep you company on the walk. What sounds good?",
            usedFallback: true,
            model: "deterministic",
          };
        case "nature":
        default:
          return this.nature(message, req);
      }
    });
  }

  private async findTrails(message: string, req: AgentRequest): Promise<AgentResponse> {
    const filters = parseFilters(message);
    const res = trailProvider.search({ ...filters, query: message }, 5);
    if (!res.providerAvailable || res.trails.length === 0) {
      return {
        intent: "find_trail",
        spokenText: "I couldn't find a trail that matches that. Try widening the distance or difficulty, or name a place to search near.",
        data: { providerAvailable: false, providerName: res.providerName, trails: [] },
        usedFallback: true,
        model: "deterministic",
      };
    }
    const top = res.trails[0];
    const facts = res.trails
      .map((t) => `- ${t.name} (${t.difficulty}, ${t.distance_km} km, ~${t.estimated_duration_min} min, ${t.elevation_gain_m} m up) in ${t.location.areaName}`)
      .join("\n");
    const phrased = await this.phrase(facts, message, req, "");
    return {
      intent: "find_trail",
      spokenText: phrased.text || `${top.name} looks like a good match: ${top.difficulty}, ${top.distance_km} km, about ${top.estimated_duration_min} minutes.`,
      data: { providerName: res.providerName, totalMatches: res.totalMatches, trails: res.trails.map(trailCard) },
      usedFallback: phrased.usedFallback,
      model: phrased.model,
    };
  }

  private async trailDetails(message: string, req: AgentRequest): Promise<AgentResponse> {
    let trail = trailProvider.getById(message);
    if (!trail) {
      const res = trailProvider.search({ query: message }, 1);
      trail = res.trails[0];
    }
    if (!trail) {
      return {
        intent: "trail_details",
        spokenText: "I don't have that trail in my dataset, so I can't tell you its conditions. I'd rather say that than guess.",
        data: { found: false },
        usedFallback: true,
        model: "deterministic",
      };
    }
    const facts =
      `${trail.name}: ${trail.difficulty}, ${trail.distance_km} km, ${trail.elevation_gain_m} m up, ~${trail.estimated_duration_min} min. ` +
      `Terrain: ${trail.terrain} Access: ${trail.accessibility} Water: ${trail.water_notes} Conditions: ${trail.conditions}`;
    const phrased = await this.phrase(facts, message, req, "");
    return {
      intent: "trail_details",
      spokenText: phrased.text || facts,
      data: { found: true, trail: trailCard(trail) },
      usedFallback: phrased.usedFallback,
      model: phrased.model,
    };
  }

  private async plan(message: string, req: AgentRequest, loc: { lat: number; lng: number; label?: string }): Promise<AgentResponse> {
    void loc;
    const trail = this.pickTrailFor(req);
    if (!trail) {
      return {
        intent: "plan_hike",
        spokenText: "I need a trail to plan around. Tell me a place or how far you want to go, and I'll find one first.",
        data: { planned: false },
        usedFallback: true,
        model: "deterministic",
      };
    }
    const weather = await getWeather({ lat: trail.location.lat, lng: trail.location.lng, locationLabel: trail.location.areaName, forecastHours: 6 });
    const prefs = this.memory.list("preference").map((p) => p.text);
    const plan = planHike({ trail, weather, preferences: prefs });
    const facts =
      `Plan for ${trail.name}: start ~${plan.estimatedStart}, finish ~${plan.estimatedFinish}, about ${plan.estimatedDurationMin} min. ` +
      `Water: ${plan.waterAdvice} Clothing: ${plan.clothingAdvice} ` +
      `Weather: ${weather.available ? weather.summary : "unavailable"}.`;
    const phrased = await this.phrase(facts, message, req, "");
    return {
      intent: "plan_hike",
      spokenText: phrased.text || `Here's a plan for ${trail.name}: about ${plan.estimatedDurationMin} minutes, starting around ${plan.estimatedStart}.`,
      data: { planned: true, plan },
      usedFallback: phrased.usedFallback,
      model: phrased.model,
    };
  }

  private async weather(loc: { lat: number; lng: number; label?: string }, req: AgentRequest): Promise<AgentResponse> {
    const w = await getWeather({ lat: loc.lat, lng: loc.lng, locationLabel: loc.label, forecastHours: 4 });
    if (!w.available) {
      return {
        intent: "weather",
        spokenText: `I can't get live weather right now. ${w.unavailableReason || "It's unavailable."} Please check a forecast app before you head out.`,
        data: { available: false, reason: w.unavailableReason, source: w.provider },
        usedFallback: true,
        model: "deterministic",
      };
    }
    const phrased = await this.phrase(w.summary, "weather", req, "");
    return {
      intent: "weather",
      spokenText: phrased.text || `Right now: ${w.summary}`,
      data: { available: true, weather: w },
      usedFallback: phrased.usedFallback,
      model: phrased.model,
    };
  }

  private saveMemory(message: string): AgentResponse {
    const text = message.replace(/^.*?\bremember\b\s*(that\s+)?/i, "").trim() || message;
    const kind: MemoryKind = /trail|route/i.test(text) ? "saved_trail" : "preference";
    const trailMatch = kind === "saved_trail" ? trailProvider.search({ query: text }, 1).trails[0] : undefined;
    const record = this.memory.save(kind, text, trailMatch ? { trailId: trailMatch.id } : undefined);
    return {
      intent: "save_memory",
      spokenText: `Got it, I'll remember that: "${text}".`,
      data: { saved: record, backing: this.memory.backing },
      usedFallback: true,
      model: "deterministic",
    };
  }

  private recallMemory(message: string): AgentResponse {
    const hits = this.memory.recall(message);
    if (hits.length === 0) {
      return {
        intent: "recall_memory",
        spokenText: "I don't have anything saved about that yet. Tell me and I'll remember it.",
        data: { records: [] },
        usedFallback: true,
        model: "deterministic",
      };
    }
    const list = hits.map((h) => h.text).join("; ");
    return {
      intent: "recall_memory",
      spokenText: `Here's what I've remembered: ${list}.`,
      data: { records: hits },
      usedFallback: true,
      model: "deterministic",
    };
  }

  private forgetMemory(): AgentResponse {
    const n = this.memory.clear();
    return {
      intent: "forget_memory",
      spokenText: n > 0 ? `Done. I've cleared all ${n} saved ${n === 1 ? "item" : "items"}.` : "There was nothing saved to clear.",
      data: { cleared: n },
      usedFallback: true,
      model: "deterministic",
    };
  }

  private startSession(message: string): AgentResponse {
    const type = /walk/i.test(message) ? "walk" : /bird|nature/i.test(message) ? "nature" : "hike";
    const session = this.sessions.start(type);
    return {
      intent: "start_session",
      spokenText: `You're out. I've started a ${type} session. Ask me anything as you go.`,
      data: { session },
      usedFallback: true,
      model: "deterministic",
    };
  }

  private endSession(): AgentResponse {
    const session = this.sessions.end();
    if (!session) {
      return { intent: "end_session", spokenText: "There's no active session to end.", data: {}, usedFallback: true, model: "deterministic" };
    }
    const mins = Math.max(1, Math.round(session.elapsedMs / 60000));
    const dist = session.distanceKm != null ? ` about ${session.distanceKm} km` : "";
    return {
      intent: "end_session",
      spokenText: `Nice work. That was a ${mins}-minute ${session.type}${dist}. Go touch some grass.`,
      data: { session },
      usedFallback: true,
      model: "deterministic",
    };
  }

  private logObservation(message: string): AgentResponse {
    const text = message.replace(/^.*?\b(that|this|:)\s*/i, "").trim() || message;
    const entry = this.journal.add({ text, sessionId: this.sessions.status?.sessionId });
    return {
      intent: "log_observation",
      spokenText: "Noted in your journal.",
      data: { entry },
      usedFallback: true,
      model: "deterministic",
    };
  }

  private deviceStatus(): AgentResponse {
    const status = this.device.getStatus();
    return {
      intent: "device_status",
      spokenText: status.simulated
        ? "No physical device is connected. I'm running the built-in simulator, so any button or LED is simulated."
        : `Device ${status.deviceId} is connected and ${status.indicator}.`,
      data: { status, allowedCommands: ALLOWED_COMMANDS },
      usedFallback: true,
      model: "deterministic",
    };
  }

  private deviceCommand(message: string): AgentResponse {
    const m = message.toLowerCase();
    let cmd: (typeof ALLOWED_COMMANDS)[number] | null = null;
    if (m.includes("listen")) cmd = "start_listening";
    else if (m.includes("stop")) cmd = "stop_listening";
    else if (m.includes("session") || m.includes("start")) cmd = "start_session";
    else if (m.includes("end")) cmd = "end_session";
    else if (m.includes("speak") || m.includes("say")) cmd = "speak";

    if (!cmd) {
      return {
        intent: "device_command",
        spokenText: "I can start or stop listening, start or end a session, or make the device speak. Which would you like?",
        data: { allowedCommands: ALLOWED_COMMANDS },
        usedFallback: true,
        model: "deterministic",
      };
    }
    const result = this.device.command(cmd, { text: message });
    return {
      intent: "device_command",
      spokenText: result.ok ? `${result.message} (simulated device)` : result.message,
      data: { result },
      usedFallback: true,
      model: "deterministic",
    };
  }

  private async nature(message: string, req: AgentRequest): Promise<AgentResponse> {
    const obs = await naturalistAgent.processTrailEvent({
      userQuery: message,
      telemetry: { elevation_m: 1350, incline_pct: 14.2, temp_c: 16.5, humidity_pct: 60, day_of_year: 280 },
      llm: req.llm,
      elevenLabsApiKey: req.elevenLabsApiKey,
    });
    return {
      intent: "nature",
      spokenText: obs.spokenText,
      data: {
        fieldGuideHits: obs.fieldGuideHits,
        tabpfnMetrics: obs.tabpfnMetrics,
        parkAlert: obs.parkAlert,
        voiceAudio: obs.voiceAudio,
      },
      usedFallback: obs.usedFallback,
      model: obs.model,
    };
  }
}

export const outdoorAgent = new OutdoorAgent();
