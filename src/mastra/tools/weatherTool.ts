/**
 * Roam - Weather provider (Open-Meteo).
 *
 * Open-Meteo is free and needs no API key, so this is a real data path rather than a
 * simulation. When there is no network the tool returns `available: false` and the
 * caller/agent must say weather is unavailable rather than invent conditions.
 *
 * Docs: https://open-meteo.com/en/docs
 */

export interface WeatherPoint {
  /** ISO local time for the reading. */
  time: string;
  temp_c: number;
  apparent_temp_c: number;
  precipitation_mm: number;
  precipitation_probability_pct: number | null;
  wind_kmh: number;
  weather_code: number;
}

export interface WeatherResult {
  available: boolean;
  provider: string;
  locationLabel: string;
  lat: number;
  lng: number;
  /** ISO timestamp of when the provider data was generated. */
  fetchedAt: string;
  current?: WeatherPoint;
  /** Next several hours of forecast, if requested and available. */
  hourly?: WeatherPoint[];
  /** Human-readable headline, e.g. "Light rain likely". Derived, not a forecast body. */
  summary: string;
  /** Honest note when unavailable. */
  unavailableReason?: string;
}

const PROVIDER = "Open-Meteo (free, no key)";
const WMO_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Rain showers",
  82: "Heavy showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
};

export function describeWeatherCode(code: number): string {
  return WMO_CODES[code] ?? `Code ${code}`;
}

export interface WeatherQuery {
  lat: number;
  lng: number;
  locationLabel?: string;
  /** Number of upcoming hours to include in `hourly` (0 = current only). */
  forecastHours?: number;
}

function clampCoord(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function buildSummary(current: WeatherPoint, hourly?: WeatherPoint[]): string {
  const cond = describeWeatherCode(current.weather_code);
  const parts = [`${cond}, ${Math.round(current.temp_c)}°C (feels ${Math.round(current.apparent_temp_c)}°C), wind ${Math.round(current.wind_kmh)} km/h`];
  if (hourly && hourly.length > 0) {
    const rainSoon = hourly.some((h) => (h.precipitation_probability_pct ?? 0) >= 40 || h.precipitation_mm > 0.2);
    if (rainSoon) parts.push("rain possible in the next few hours");
    const temps = hourly.map((h) => h.temp_c);
    parts.push(`range ${Math.round(Math.min(...temps))}–${Math.round(Math.max(...temps))}°C`);
  }
  return parts.join("; ") + ".";
}


export async function getWeather(q: WeatherQuery): Promise<WeatherResult> {
  const lat = clampCoord(q.lat, -90, 90, 0);
  const lng = clampCoord(q.lng, -180, 180, 0);
  const hours = Math.min(24, Math.max(0, Math.round(q.forecastHours ?? 0)));
  const fetchedAt = new Date().toISOString();
  const base: WeatherResult = {
    available: false,
    provider: PROVIDER,
    locationLabel: q.locationLabel || `${lat.toFixed(3)}, ${lng.toFixed(3)}`,
    lat,
    lng,
    fetchedAt,
    summary: "Weather unavailable",
  };

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
    timezone: "auto",
  });
  if (hours > 0) {
    params.set(
      "hourly",
      "temperature_2m,apparent_temperature,precipitation,precipitation_probability,weather_code,wind_speed_10m",
    );
    params.set("forecast_days", "2");
  }

  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) {
      return { ...base, unavailableReason: `Open-Meteo returned HTTP ${res.status}.` };
    }
    const data: any = await res.json();

    const c = data?.current;
    const current: WeatherPoint | undefined = c
      ? {
          time: String(c.time ?? fetchedAt),
          temp_c: Number(c.temperature_2m ?? 0),
          apparent_temp_c: Number(c.apparent_temperature ?? c.temperature_2m ?? 0),
          precipitation_mm: Number(c.precipitation ?? 0),
          precipitation_probability_pct: null,
          wind_kmh: Number(c.wind_speed_10m ?? 0),
          weather_code: Number(c.weather_code ?? 0),
        }
      : undefined;

    let hourly: WeatherPoint[] | undefined;
    if (hours > 0 && data?.hourly?.time) {
      const H = data.hourly;
      const nowIso = current?.time ?? fetchedAt;
      const startIdx = Math.max(0, H.time.findIndex((t: string) => t >= nowIso));
      hourly = H.time.slice(startIdx, startIdx + hours).map((t: string, i: number) => ({
        time: t,
        temp_c: Number(H.temperature_2m?.[startIdx + i] ?? 0),
        apparent_temp_c: Number(H.apparent_temperature?.[startIdx + i] ?? H.temperature_2m?.[startIdx + i] ?? 0),
        precipitation_mm: Number(H.precipitation?.[startIdx + i] ?? 0),
        precipitation_probability_pct:
          H.precipitation_probability?.[startIdx + i] == null
            ? null
            : Number(H.precipitation_probability[startIdx + i]),
        wind_kmh: Number(H.wind_speed_10m?.[startIdx + i] ?? 0),
        weather_code: Number(H.weather_code?.[startIdx + i] ?? 0),
      }));
    }

    if (!current) {
      return { ...base, unavailableReason: "Open-Meteo returned no current conditions." };
    }

    return {
      available: true,
      provider: PROVIDER,
      locationLabel: base.locationLabel,
      lat,
      lng,
      fetchedAt,
      current,
      hourly,
      summary: buildSummary(current, hourly),
    };
  } catch (err: any) {
    const reason = err?.name === "TimeoutError" ? "timed out" : err?.message || String(err);
    return { ...base, unavailableReason: `No network (${reason}). Weather is unavailable offline.` };
  }
}
