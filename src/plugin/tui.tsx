import { createElement, insert, setProp } from "@opentui/solid";
import type { PluginOptions } from "@opencode-ai/plugin";
import type { TuiPluginApi, TuiPluginMeta } from "@opencode-ai/plugin/tui";
import { Plugin as V2Plugin } from "@opencode/plugin/tui";
import { getConfigurableAgentIds, listAvailableModels, loadJcePluginSettings, saveJcePluginSettings } from "./lib/settings.js";
import { createContextBudgetLineSignal, renderContextBudgetLine } from "./lib/token-savings-sidebar.js";

export function buildJceModelOptions() {
  const settings = loadJcePluginSettings();
  const models = listAvailableModels();
  return [
    ...getConfigurableAgentIds().map((agent) => ({
      title: agent,
      value: `agent:${agent}`,
      description: typeof settings.agents[agent] === "string" && models.includes(settings.agents[agent]!)
        ? settings.agents[agent]!
        : "active OpenCode model",
      category: "Agents",
      disabled: true,
    })),
    ...(models.length ? models.map((model) => ({
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
    }]),
  ];
}

async function selectAgent(context: V2Plugin.Context): Promise<void> {
  const settings = loadJcePluginSettings();
  const models = listAvailableModels();
  const agent = await context.ui.dialog.select({
    title: "JCE Agent Model",
    placeholder: "Select agent",
    options: getConfigurableAgentIds().map((id) => ({
      title: id,
      value: id,
      description: typeof settings.agents[id] === "string" && models.includes(settings.agents[id]!)
        ? settings.agents[id]!
        : "active OpenCode model",
      category: "Agents",
    })),
  });
  if (!agent) return;

  const model = await context.ui.dialog.select({
    title: `JCE Agent Model: ${agent}`,
    placeholder: "Select model override",
    current: settings.agents[agent] ?? "default",
    options: [
      { title: "active OpenCode model", value: "default", description: `Clear ${agent} override`, category: "Default" },
      ...models.map((id) => ({ title: id, value: id, description: `Set ${agent} to ${id}`, category: "Available models" })),
    ],
  });
  if (!model) return;
  settings.agents[agent] = model === "default" ? null : model;
  await saveJcePluginSettings(settings);
  context.ui.toast.show({ message: model === "default" ? `${agent} now uses active OpenCode model.` : `${agent} now uses ${model}.`, variant: "success" });
}

async function showModels(context: V2Plugin.Context): Promise<void> {
  await context.ui.dialog.select({
    title: "JCE Agent Models",
    placeholder: "Search models. Use /jce-agent-model <agent> <provider/model|default> to set.",
    options: buildJceModelOptions(),
  });
}

function buildLegacyAgentModelOptions(api: TuiPluginApi, agent: string) {
  const models = listAvailableModels();
  return [
    {
      title: "active OpenCode model",
      value: "default",
      description: `Clear ${agent} override`,
      category: "Default",
      onSelect: () => void setLegacyAgentModel(api, agent, null),
    },
    ...(models.length ? models.map((model) => ({
      title: model,
      value: model,
      description: `Set ${agent} to ${model}`,
      category: "Available models",
      onSelect: () => void setLegacyAgentModel(api, agent, model),
    })) : [{
      title: "none found",
      value: "none",
      description: "Add models to OpenCode provider config first.",
      category: "Available models",
      disabled: true,
    }]),
  ];
}

function showLegacyAgentModelDialog(api: TuiPluginApi, agent: string): void {
  api.ui.dialog.replace(() => api.ui.DialogSelect({
    title: `JCE Agent Model: ${agent}`,
    placeholder: "Select model override",
    options: buildLegacyAgentModelOptions(api, agent),
  }));
}

function buildLegacyAgentOptions(api: TuiPluginApi) {
  const settings = loadJcePluginSettings();
  const models = listAvailableModels();
  return getConfigurableAgentIds().map((agent) => ({
    title: agent,
    value: agent,
    description: typeof settings.agents[agent] === "string" && models.includes(settings.agents[agent]!)
      ? settings.agents[agent]!
      : "active OpenCode model",
    category: "Agents",
    onSelect: () => showLegacyAgentModelDialog(api, agent),
  }));
}

async function setLegacyAgentModel(api: TuiPluginApi, agent: string, model: string | null): Promise<void> {
  const settings = loadJcePluginSettings();
  settings.agents[agent] = model;
  await saveJcePluginSettings(settings);
  api.ui.toast({ message: model ? `${agent} now uses ${model}.` : `${agent} now uses active OpenCode model.` });
}

function createLegacyTokenSavingsBox(api: TuiPluginApi): any {
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

/** OpenCode V1 TUI entrypoint. */
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
          api.ui.dialog.replace(() => api.ui.DialogSelect({
            title: "JCE Agent Model",
            placeholder: "Select agent",
            options: buildLegacyAgentOptions(api),
          }));
        },
      },
    ],
  });

  api.slots.register({
    order: 600,
    slots: {
      sidebar_content: () => createLegacyTokenSavingsBox(api),
    },
  });
}

const v2Plugin = V2Plugin.define({
  id: "opencode-jce-token-savings",
  setup(context) {
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "jce.models",
          title: "JCE Models",
          group: "JCE",
          palette: true,
          slash: { name: "jce-models" },
          run: () => showModels(context),
        },
        {
          id: "jce.agent-model",
          title: "JCE Agent Model",
          group: "JCE",
          palette: true,
          slash: { name: "jce-agent-model" },
          run: () => selectAgent(context),
        },
      ],
    }));

    return context.ui.slot({
      append: "sidebar.content",
      render: () => <text fg={context.theme.text.muted}>Token Savings\n{renderContextBudgetLine(context)}</text>,
    });
  },
});

export default {
  ...v2Plugin,
  tui,
};
