/**
 * Roam - Field naturalist agent.
 *
 * Pipeline (steps 1-3 run concurrently where independent):
 *   1. TabPFN tabular prediction      (foliage stage, fatigue risk, hydration)
 *   2. Field guide retrieval          (keyword-scored, offline)
 *   3. Park advisory lookup           (SerpApi when configured, otherwise simulated)
 *   4. Open-weight LLM reasoning      (grounded in 1-3, short spoken answer)
 *   5. Spoken audio                   (ElevenLabs when configured, otherwise browser speech)
 *
 * This is a hand-written pipeline. It does not yet run on the Mastra framework.
 */

import { runTabPFNPrediction, TabPFNResult } from "../tools/tabpfnTool.js";
import { searchFieldGuide, FieldGuideEntry } from "../tools/fieldGuideTool.js";
import { getLiveParkAlerts, ParkAlert } from "../tools/parkAlertsTool.js";
import { voiceService, VoiceGenerationResult } from "../../services/voice.js";
import { gemmaService, LLMConfig } from "../../services/gemma.js";
import { traceAgentSpan } from "../../observability/sentry.js";

export interface TrailObservationRequest {
  userQuery?: string;
  telemetry: {
    elevation_m: number;
    incline_pct: number;
    temp_c: number;
    humidity_pct?: number;
    day_of_year?: number;
    pace_min_km?: number;
    distance_km?: number;
  };
  llm?: LLMConfig;
  elevenLabsApiKey?: string;
}

export interface NaturalistResponse {
  spokenText: string;
  voiceAudio: VoiceGenerationResult;
  tabpfnMetrics: TabPFNResult;
  fieldGuideHits: FieldGuideEntry[];
  parkAlert: ParkAlert;
  model: string;
  usedFallback: boolean;
  openInnovationAdvantage: string;
}

function formatFieldNote(e: FieldGuideEntry): string {
  const caution = e.edibleOrCaution ? ` Safety: ${e.edibleOrCaution}` : "";
  return `${e.commonName} (${e.scientificName}): ${e.fieldNote}${caution}`;
}

export class FieldNaturalistAgent {
  async processTrailEvent(req: TrailObservationRequest): Promise<NaturalistResponse> {
    return traceAgentSpan("fieldNaturalistAgent.processTrailEvent", "ai.agent.reasoning", async () => {
      const query = req.userQuery?.trim() || "autumn forest foliage";

      const [tabpfnMetrics, fieldGuideHits, parkAlert] = await Promise.all([
        runTabPFNPrediction(req.telemetry),
        searchFieldGuide(query),
        getLiveParkAlerts(),
      ]);

      const llm = await gemmaService.generateNaturalistInsight(
        {
          userQuery: req.userQuery || "",
          elevation_m: req.telemetry.elevation_m,
          incline_pct: req.telemetry.incline_pct,
          temp_c: req.telemetry.temp_c,
          foliage_stage: tabpfnMetrics.foliage_stage,
          fatigue_risk: tabpfnMetrics.fatigue_risk,
          hydration_ml_hr: tabpfnMetrics.recommended_hydration_ml_hr,
          fieldNotes: fieldGuideHits.map(formatFieldNote),
          parkAdvisory: parkAlert.simulated ? undefined : parkAlert.activeAdvisory,
        },
        req.llm
      );

      const voiceAudio = await voiceService.synthesizeSpeech(llm.text, req.elevenLabsApiKey);

      return {
        spokenText: llm.text,
        voiceAudio,
        tabpfnMetrics,
        fieldGuideHits,
        parkAlert,
        model: llm.provider,
        usedFallback: llm.usedFallback,
        openInnovationAdvantage:
          "Open-weight model behind an OpenAI-compatible endpoint: swap models, run fully on-device with Ollama, and keep trail coordinates off third-party servers.",
      };
    });
  }
}

export const naturalistAgent = new FieldNaturalistAgent();
