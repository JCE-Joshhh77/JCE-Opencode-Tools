import { createElement, insert, setProp } from "@opentui/solid";
import type { PluginOptions } from "@opencode-ai/plugin";
import type { TuiPluginApi, TuiPluginMeta } from "@opencode-ai/plugin/tui";
import { getConfigurableAgentIds, listAvailableModels, loadJcePluginSettings } from "./lib/settings.js";
import { createContextBudgetLineSignal } from "./lib/token-savings-sidebar.js";

export function buildJceModelOptions() {
  const settings = loadJcePluginSettings();
  const models = listAvailableModels();
  const options = getConfigurableAgentIds().map((agent) => {
    const value = settings.agents[agent];
    return {
      title: agent,
      value: `agent:${agent}`,
      description: typeof value === "string" && models.includes(value) ? value : "active OpenCode model",
      category: "Agents",
      disabled: true,
    };
  });

  options.push(...(models.length ? models.map((model) => ({
    title: model,
    value: `model:${model}`,
    description: `Use: /jce-agent-model <agent> ${model}`,
    category: "Available models",
    disabled: false,
  })) : [{
    title: "none found",
    value: "model:none",
    description: "Add models to OpenCode provider config first.",
    category: "Available models",
    disabled: true,
  }]));

  return options;
}

function createTokenSavingsBox(api: TuiPluginApi): any {
  const line = createContextBudgetLineSignal(api);
  const box = createElement("box");
  const title = createElement("text");
  const value = createElement("text");
  const bold = createElement("b");

  setProp(title, "fg", api.theme.current.text);
  setProp(value, "fg", api.theme.current.textMuted);
  insert(bold, "Token Savings");
  insert(title, bold);
  insert(value, line);
  insert(box, [title, value]);

  return box;
}

export async function tui(api: TuiPluginApi, _options: PluginOptions | undefined, _meta: TuiPluginMeta): Promise<void> {
  api.keymap.registerLayer({
    commands: [
      {
        name: "jce.models",
        title: "JCE Models",
        desc: "List JCE agent model overrides",
        category: "JCE",
        namespace: "palette",
        slashName: "jce-models",
        run() {
          api.ui.dialog.replace(() => api.ui.DialogSelect({
            title: "JCE Agent Models",
            placeholder: "Search models. Use /jce-agent-model <agent> <provider/model|default> to set.",
            options: buildJceModelOptions(),
          }));
        },
      },
      {
        name: "jce.agent-model",
        title: "JCE Agent Model",
        desc: "Set JCE agent model override",
        category: "JCE",
        namespace: "palette",
        slashName: "jce-agent-model",
        run() {
          api.ui.toast({ message: "Run /jce-agent-model <agent> <provider/model|default> in the prompt." });
        },
      },
    ],
  });

  api.slots.register({
    order: 600,
    slots: {
      sidebar_content: (_ctx: unknown, _props: { session_id: string }) => {
        return createTokenSavingsBox(api);
      },
    },
  });
}

export default {
  id: "opencode-jce-token-savings",
  tui,
};
