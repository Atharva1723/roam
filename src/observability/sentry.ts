/**
 * Roam - Sentry Agent Tracing Integration
 * Instruments AI Agent reasoning, tool latency, token usage, and error monitoring.
 */

import * as Sentry from "@sentry/node";

export function initSentry() {
  const dsn = process.env.SENTRY_DSN || "";
  if (dsn) {
    Sentry.init({
      dsn,
      tracesSampleRate: 1.0,
      environment: process.env.NODE_ENV || "development",
      integrations: [
        // Automatically instruments HTTP and async boundaries
      ],
    });
    console.log("🌲 [Sentry] Agent Tracing initialized with 100% trace sampling.");
  } else {
    console.log("ℹ️ [Sentry] SENTRY_DSN not provided. Tracing running in local telemetry mode.");
  }
}

export function traceAgentSpan<T>(name: string, op: string, fn: () => Promise<T>): Promise<T> {
  return Sentry.startSpan({ name, op }, async (span) => {
    const startTime = Date.now();
    try {
      const result = await fn();
      const durationMs = Date.now() - startTime;
      span?.setAttribute("ai.duration_ms", durationMs);
      span?.setStatus({ code: 1, message: "ok" });
      return result;
    } catch (err: any) {
      span?.setStatus({ code: 2, message: err?.message || "error" });
      Sentry.captureException(err);
      throw err;
    }
  });
}
