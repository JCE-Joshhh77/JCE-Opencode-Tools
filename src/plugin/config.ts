import { buildJceWorkerAgent } from "./agents/jce-worker.js";
import { buildOracleAgent } from "./agents/oracle.js";
import { buildJceResearcherAgent } from "./agents/jce-researcher.js";
import { buildExplorerAgent } from "./agents/explorer.js";
import { buildFrontendAgent } from "./agents/frontend.js";
import { applyJcePluginSettings } from "./lib/settings.js";

export interface PluginAgentConfig {
  model?: string;
  systemPrompt: string;
}

export function buildAgentConfigs(): Record<string, PluginAgentConfig> {
  return applyJcePluginSettings({
    "jce-worker": buildJceWorkerAgent(),
    oracle: buildOracleAgent(),
    "jce-researcher": buildJceResearcherAgent(),
    explorer: buildExplorerAgent(),
    frontend: buildFrontendAgent(),
  });
}
