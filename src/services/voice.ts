/**
 * Roam - Spoken audio.
 * Uses ElevenLabs when a key is available (per request or ELEVENLABS_API_KEY).
 * Otherwise returns "browser-synthesized", and the frontend speaks with the Web Speech API.
 */

export interface VoiceGenerationResult {
  audioBase64?: string;
  format: "audio/mpeg" | "browser-synthesized";
  voiceName: string;
  text: string;
  durationEstimateSec: number;
}

export class VoiceService {
  private get defaultVoiceId(): string {
    return process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
  }

  async synthesizeSpeech(text: string, apiKeyOverride?: string): Promise<VoiceGenerationResult> {
    const wordCount = text.split(/\s+/).length;
    const durationEstimateSec = Math.max(1.5, Math.round(wordCount / 2.5));
    const apiKey = apiKeyOverride || process.env.ELEVENLABS_API_KEY || "";

    const browserFallback = (voiceName: string): VoiceGenerationResult => ({
      format: "browser-synthesized",
      voiceName,
      text,
      durationEstimateSec,
    });

    if (!apiKey) return browserFallback("Browser speech (no ElevenLabs key)");

    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.defaultVoiceId}`, {
        method: "POST",
        headers: {
          Accept: "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2_5",
          voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        console.warn(`[ElevenLabs] HTTP ${response.status}; using browser speech.`);
        return browserFallback("Browser speech (ElevenLabs unavailable)");
      }

      const base64Audio = Buffer.from(await response.arrayBuffer()).toString("base64");
      return {
        audioBase64: `data:audio/mpeg;base64,${base64Audio}`,
        format: "audio/mpeg",
        voiceName: "ElevenLabs Turbo v2.5",
        text,
        durationEstimateSec,
      };
    } catch (err) {
      console.error("[ElevenLabs] synthesis failed; using browser speech.", (err as Error)?.message);
      return browserFallback("Browser speech (fallback)");
    }
  }
}

export const voiceService = new VoiceService();
