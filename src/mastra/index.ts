/**
 * Roam - Mastra Instance Configuration
 * Registry for the naturalist agent. Hand-written pipeline; Mastra migration is planned (see docs/ARCHITECTURE.md).
 */

import { naturalistAgent } from "./agents/naturalist.js";

export const mastraConfig = {
  name: "Roam-Outdoor-Agent",
  version: "1.0.0",
  agents: {
    naturalist: naturalistAgent
  }
};

export default mastraConfig;
