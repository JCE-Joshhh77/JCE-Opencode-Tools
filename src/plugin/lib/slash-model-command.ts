import { getConfigurableAgentIds, isModelAvailable, listAvailableModels, loadJcePluginSettings, saveJcePluginSettings } from "./settings.js";

export type LiveAgentModels = Record<string, { model?: string }>;

export async function syncLiveAgentModel(client: unknown, projectRoot: string, agent: string, model: string | null, liveAgents?: LiveAgentModels): Promise<boolean> {
  const api = client as { config?: { get?: (options?: unknown) => Promise<{ data?: any; error?: unknown }>; update?: (options?: unknown) => Promise<{ data?: any; error?: unknown }> } };
  if (!api.config?.get || !api.config?.update) return false;
  const current = await api.config.get({ query: { directory: projectRoot } });
  if (current.error || !current.data || typeof current.data !== "object") return false;
  const config = current.data;
  if (!config.agent || typeof config.agent !== "object") config.agent = {};
  let entry = config.agent[agent];
  if (!entry || typeof entry !== "object") {
    entry = liveAgents?.[agent];
    if (!entry) return false;
    config.agent[agent] = entry;
  }
  if (model) entry.model = model;
  else delete entry.model;
  const updated = await api.config.update({ query: { directory: projectRoot }, body: config });
  return !updated.error;
}

export async function handleJceModelCommand(command: string, args: string, projectRoot: string, client?: unknown, liveAgents?: LiveAgentModels): Promise<string | undefined> {
  if (command === "jce-models") {
    const settings = loadJcePluginSettings();
    const models = listAvailableModels();
    const lines = ["JCE Agent Models", "", "Agents:"];
    for (const agent of getConfigurableAgentIds()) {
      const value = settings.agents[agent];
      lines.push(`- ${agent}: ${typeof value === "string" && models.includes(value) ? value : "active OpenCode model"}`);
    }
    lines.push("", "Available models:", ...(models.length ? models.map((model) => `- ${model}`) : ["- none found"]));
    lines.push("", "Set: /jce-agent-model <agent> <provider/model|default>");
    return lines.join("\n");
  }

  if (command !== "jce-agent-model") return undefined;
  const [agent, model, ...extra] = args.trim().split(/\s+/).filter(Boolean);
  if (!agent || !model || extra.length > 0) return "Usage: /jce-agent-model <agent> <provider/model|default>";
  const agents = getConfigurableAgentIds();
  if (!agents.includes(agent)) return `Unknown agent: ${agent}\nKnown agents: ${agents.join(", ")}`;
  const settings = loadJcePluginSettings();
  if (model === "default") {
    settings.agents[agent] = null;
    if (liveAgents?.[agent]) delete liveAgents[agent].model;
    await saveJcePluginSettings(settings);
    await syncLiveAgentModel(client, projectRoot, agent, null, liveAgents);
    return `${agent} now uses active OpenCode model.`;
  }
  if (!isModelAvailable(model)) return `Model not found: ${model}\nRun /jce-models to list available models.`;
  settings.agents[agent] = model;
  if (liveAgents?.[agent]) liveAgents[agent].model = model;
  await saveJcePluginSettings(settings);
  await syncLiveAgentModel(client, projectRoot, agent, model, liveAgents);
  return `${agent} now uses ${model}.`;
}
