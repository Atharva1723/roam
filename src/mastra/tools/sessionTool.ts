/**
 * Roam - Outdoor session state.
 *
 * Tracks a single active session in memory with explicit start/end. Duplicate starts
 * are handled safely (return the existing session), and the summary uses only data
 * actually recorded during the session. No GPS is fabricated: distance comes only from
 * real waypoints the client reports, and is omitted when none exist.
 */

export interface OutdoorSession {
  sessionId: string;
  type: string;
  startedAt: string;
  endedAt: string | null;
  state: "active" | "ended";
  /** Waypoints the client reported, if any. */
  waypointCount: number;
  /** Distance in km computed from reported waypoints, or null when none. */
  distanceKm: number | null;
  elapsedMs: number;
}

interface Waypoint {
  lat: number;
  lng: number;
  at: string;
}

function haversineKm(a: Waypoint, b: Waypoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export class SessionManager {
  private current: (OutdoorSession & { waypoints: Waypoint[] }) | null = null;

  start(type = "hike"): OutdoorSession {
    if (this.current && this.current.state === "active") {
      // Duplicate start: return the live session rather than clobbering it.
      return this.snapshot(this.current);
    }
    this.current = {
      sessionId: `session-${Date.now().toString(36)}`,
      type: String(type).slice(0, 40) || "hike",
      startedAt: new Date().toISOString(),
      endedAt: null,
      state: "active",
      waypointCount: 0,
      distanceKm: null,
      elapsedMs: 0,
      waypoints: [],
    };
    return this.snapshot(this.current);
  }

  addWaypoint(lat: number, lng: number): OutdoorSession | null {
    if (!this.current || this.current.state !== "active") return null;
    const wp: Waypoint = { lat, lng, at: new Date().toISOString() };
    this.current.waypoints.push(wp);
    this.current.waypointCount = this.current.waypoints.length;
    if (this.current.waypoints.length >= 2) {
      let km = 0;
      for (let i = 1; i < this.current.waypoints.length; i++) {
        km += haversineKm(this.current.waypoints[i - 1], this.current.waypoints[i]);
      }
      this.current.distanceKm = Math.round(km * 100) / 100;
    }
    return this.snapshot(this.current);
  }

  end(): OutdoorSession | null {
    if (!this.current) return null;
    if (this.current.state === "ended") return this.snapshot(this.current);
    this.current.endedAt = new Date().toISOString();
    this.current.state = "ended";
    this.current.elapsedMs =
      new Date(this.current.endedAt).getTime() - new Date(this.current.startedAt).getTime();
    return this.snapshot(this.current);
  }

  get status(): OutdoorSession | null {
    if (!this.current) return null;
    const s = this.snapshot(this.current);
    if (this.current.state === "active") {
      s.elapsedMs = Date.now() - new Date(this.current.startedAt).getTime();
    }
    return s;
  }

  private snapshot(s: OutdoorSession & { waypoints: Waypoint[] }): OutdoorSession {
    const { waypoints, ...rest } = s;
    void waypoints;
    return { ...rest };
  }
}
