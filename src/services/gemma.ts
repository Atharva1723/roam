/**
 * Roam - Naturalist LLM client (OpenAI-compatible protocol).
 *
 * Works with any open-weight model served behind an OpenAI-style /chat/completions endpoint:
 *   - Ollama (fully local, no internet needed):  http://localhost:11434/v1   model: gemma2:9b
 *   - llama.cpp server / LM Studio (local):      http://localhost:8080/v1    model: whatever is loaded
 *   - Groq / OpenRouter (hosted open weights):   data leaves the device
 *
 * Config precedence per request: request body > environment variables > built-in default.
 * Keys supplied by the browser are used for that one request and are never stored or logged.
 */

export interface LLMConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export interface ResolvedLLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  isLocal: boolean;
}

export function resolveLLMConfig(override: LLMConfig = {}): ResolvedLLMConfig {
  const baseUrl = (
    override.baseUrl ||
    process.env.LLM_BASE_URL ||
    process.env.GEMMA_API_BASE ||
    "http://localhost:11434/v1"
  ).replace(/\/+$/, "");
  const apiKey = override.apiKey || process.env.LLM_API_KEY || process.env.GROQ_API_KEY || "";
  const model = override.model || process.env.LLM_MODEL || process.env.GEMMA_MODEL || "gemma2:9b";
  const isLocal = /localhost|127\.0\.0\.1|\[::1\]/.test(baseUrl);
  return { baseUrl, apiKey, model, isLocal };
}

export interface GemmaPromptOptions {
  userQuery: string;
  elevation_m: number;
  incline_pct: number;
  temp_c: number;
  foliage_stage: string;
  fatigue_risk: string;
  hydration_ml_hr: number;
  fieldNotes?: string[];
  parkAdvisory?: string;
}

export interface GemmaResult {
  text: string;
  provider: string;
  usedFallback: boolean;
}

const ASSISTANT_NAME = process.env.ASSISTANT_NAME || "roam";

export function buildSystemPrompt(o: GemmaPromptOptions): string {
  const notes = o.fieldNotes && o.fieldNotes.length > 0
    ? o.fieldNotes.map((n) => `- ${n}`).join("\n")
    : "- (no field guide match for this question)";

  return `You are ${ASSISTANT_NAME}, an experienced outdoor naturalist walking beside a hiker. The hiker hears you through earbuds, so speak naturally and briefly.

CURRENT TELEMETRY:
- Elevation: ${o.elevation_m} m
- Incline grade: ${o.incline_pct}%
- Temperature: ${o.temp_c} °C
- Foliage stage (TabPFN): ${o.foliage_stage}
- Fatigue risk (TabPFN): ${o.fatigue_risk}
- Suggested hydration (TabPFN): ${o.hydration_ml_hr} mL/hr
- Park advisory: ${o.parkAdvisory || "none"}

FIELD GUIDE NOTES (treat these as ground truth when relevant):
${notes}

RULES:
1. Answer the hiker's question directly and accurately, like a knowledgeable friend.
2. Use at most 3 short sentences.
3. Add one sensory detail (sound, bark, color, scent) when it helps.
4. Mention hydration or pacing only when the telemetry makes it relevant.
5. Never say a wild plant, mushroom, or berry is safe to eat based on a description. Say it must be confirmed in person by an expert, and never eat anything identified from a chat.
6. If the hiker mentions an injury, a medical emergency, or being lost, first tell them to contact emergency services (or the local emergency number) and to stay where they are.
7. If you are not sure what a bird or plant is, say so and suggest how to narrow it down. Do not guess with confidence.`;
}

export class GemmaService {
  async generateNaturalistInsight(opts: GemmaPromptOptions, override: LLMConfig = {}): Promise<GemmaResult> {
    const cfg = resolveLLMConfig(override);
    const userMessage =
      opts.userQuery.trim().length > 0
        ? opts.userQuery.trim()
        : "I just arrived at this waypoint on the trail. What should I notice around me?";

    console.log(`[LLM] model=${cfg.model} endpoint=${cfg.isLocal ? "local" : "remote"} key=${cfg.apiKey ? "provided" : "none"}`);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;

      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: "system", content: buildSystemPrompt(opts) },
            { role: "user", content: userMessage },
          ],
          temperature: 0.6,
          max_tokens: 120,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        // Status only: response bodies can echo user content, so they are not logged.
        console.warn(`[LLM] HTTP ${res.status} from ${cfg.baseUrl}`);
      } else {
        const data: any = await res.json();
        const content: string | undefined = data.choices?.[0]?.message?.content?.trim();
        if (content) {
          return {
            text: content,
            provider: `${cfg.model} (${cfg.isLocal ? "local" : "remote"})`,
            usedFallback: false,
          };
        }
        console.warn("[LLM] 200 response without message content");
      }
    } catch (err: any) {
      const reason = err?.name === "TimeoutError" ? "timed out" : err?.message || String(err);
      console.warn(`[LLM] request failed: ${reason}`);
    }

    return {
      text: this.offlineAnswer(userMessage, opts),
      provider: "Offline naturalist (no LLM reachable)",
      usedFallback: true,
    };
  }

  /**
   * Phrase a short spoken answer strictly from provided FACTS. Used by the outdoor agent,
   * which supplies real tool output as `facts`. Never adds facts beyond them. Falls back
   * to a deterministic phrase (the `fallback` argument) when no model is reachable.
   */
  async generateReply(
    opts: { system: string; facts: string; userMessage: string },
    override: LLMConfig = {},
  ): Promise<{ text: string; provider: string; usedFallback: boolean }> {
    const cfg = resolveLLMConfig(override);
    const userMessage = `FACTS:\n${opts.facts}\n\nUSER: ${opts.userMessage}`;

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;

      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: userMessage },
          ],
          temperature: 0.5,
          max_tokens: 160,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        console.warn(`[LLM] HTTP ${res.status} from ${cfg.baseUrl}`);
      } else {
        const data: any = await res.json();
        const content: string | undefined = data.choices?.[0]?.message?.content?.trim();
        if (content) {
          return { text: content, provider: `${cfg.model} (${cfg.isLocal ? "local" : "remote"})`, usedFallback: false };
        }
        console.warn("[LLM] 200 response without message content");
      }
    } catch (err: any) {
      const reason = err?.name === "TimeoutError" ? "timed out" : err?.message || String(err);
      console.warn(`[LLM] request failed: ${reason}`);
    }

    return { text: "", provider: "Offline (no LLM reachable)", usedFallback: true };
  }

  /** Deterministic answers used only when no LLM endpoint responds. Phrased as possibilities, not certainties. */
  private offlineAnswer(query: string, opts: GemmaPromptOptions): string {
    const q = query.toLowerCase();

    if (q.includes("bird") || q.includes("sing") || q.includes("call") || q.includes("whistle")) {
      return `Listen closely to the canopy rhythm. At ${opts.elevation_m} meters, that whistling cadence could be a Black-capped Chickadee or a Tufted Titmouse. I can't judge the call from here, so look up at the mid-branch level and watch for movement.`;
    }
    if (q.includes("mushroom") || q.includes("fungi") || q.includes("forag") || q.includes("edible")) {
      return `Look near decomposing logs and mossy patches. Never eat a wild mushroom based on a description or a chat. Confirm it in person with an experienced local forager or mycological society, and check gill attachment and spore print first.`;
    }
    if (q.includes("foliage") || q.includes("leaf") || q.includes("tree") || q.includes("maple") || q.includes("oak")) {
      return `The foliage model reads ${opts.foliage_stage} at this elevation. Sugar Maples glow scarlet when backlit, and Red Oaks show deep bronze. Notice how the crowns catch the low autumn light as the grade climbs to ${opts.incline_pct}%.`;
    }
    if (q.includes("water") || q.includes("drink") || q.includes("fatigue") || q.includes("tired") || q.includes("rest")) {
      return `With a ${opts.incline_pct}% grade and ${opts.temp_c}°C air, the fatigue model rates your risk as ${opts.fatigue_risk}. Drink about ${opts.hydration_ml_hr} milliliters per hour and take a short rest if your breathing gets ragged.`;
    }

    return `At ${opts.elevation_m} meters, look around at the woodland understory. The models read ${opts.foliage_stage} with ${opts.fatigue_risk.toLowerCase()} fatigue risk. Take in the crisp ${opts.temp_c}°C air, keep a steady pace, and let the sounds of the trail guide you.`;
  }
}

export const gemmaService = new GemmaService();
