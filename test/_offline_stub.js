/**
 * Offline simulation stub. Preloaded into the server process under test via
 * NODE_OPTIONS=--require. It wraps global fetch so requests to EXTERNAL hosts
 * (weather, cloud speech, search) fail like a real network outage, while
 * localhost (the local Ollama model, the server's own API) passes through.
 */
const EXTERNAL = ["open-meteo.com", "api.elevenlabs.io", "api.groq.com", "serpapi.com"];

const realFetch = globalThis.fetch;
globalThis.fetch = function offlineFetch(input, init) {
  let url;
  try {
    url = typeof input === "string" ? input : input?.url ?? String(input);
  } catch {
    url = String(input);
  }
  const isExternal = EXTERNAL.some((host) => url.includes(host));
  const isLocal = url.includes("localhost") || url.includes("127.0.0.1");
  if (isExternal && !isLocal) {
    return Promise.reject(new Error(`offline: blocked request to ${new URL(url).host}`));
  }
  return realFetch(input, init);
};
