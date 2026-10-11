/**
 * Roam - Park safety and conditions lookup.
 * Live via SerpApi when SERPAPI_API_KEY is set. Otherwise returns a clearly labelled simulated
 * result that is NOT passed to the language model as a real advisory.
 * Results are cached for 10 minutes so each question doesn't pay for a network round trip.
 */

export interface ParkAlert {
  parkName: string;
  weatherCondition: string;
  sunsetTime: string;
  activeAdvisory: string;
  source: string;
  simulated: boolean;
}

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: ParkAlert }>();

export async function getLiveParkAlerts(parkName: string = "Shenandoah Ridge / Bear Mountain"): Promise<ParkAlert> {
  const cached = cache.get(parkName);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const serpApiKey = process.env.SERPAPI_API_KEY;
  if (serpApiKey) {
    try {
      const url = `https://serpapi.com/search.json?q=${encodeURIComponent(parkName + " trail conditions weather sunset")}&api_key=${serpApiKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4_000) });
      const data: any = await res.json();
      const snippet: string | undefined = data.organic_results?.[0]?.snippet;
      if (snippet) {
        const value: ParkAlert = {
          parkName,
          weatherCondition: "See advisory",
          sunsetTime: "Unknown",
          activeAdvisory: snippet,
          source: "SerpApi search result",
          simulated: false,
        };
        cache.set(parkName, { at: Date.now(), value });
        return value;
      }
    } catch (err: any) {
      console.warn(`[SerpApi] lookup failed (${err?.message}); no live advisory.`);
    }
  }

  // No live data: say so explicitly. The naturalist does not pass this to the model as fact.
  const value: ParkAlert = {
    parkName,
    weatherCondition: "Unknown (no live data)",
    sunsetTime: "Unknown",
    activeAdvisory: "No live park advisory available.",
    source: "Simulated: set SERPAPI_API_KEY for live advisories",
    simulated: true,
  };
  cache.set(parkName, { at: Date.now(), value });
  return value;
}
