import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Command } from "commander";
import { error, heading, info, success } from "../lib/ui.js";
import { EXIT_ERROR, EXIT_SUCCESS } from "../types.js";

const AGENTS = ["jce-worker", "oracle", "jce-researcher", "explorer", "frontend", "android"];

const NATIVE_MODELS = [
  { model: "claude-opus-4-8", displayName: "Claude Opus 4.8", provider: "anthropic" },
  { model: "claude-opus-4-8-fast", displayName: "Claude Opus 4.8 Fast", provider: "anthropic" },
  { model: "claude-opus-4-7", displayName: "Claude Opus 4.7", provider: "anthropic" },
  { model: "claude-opus-4-7-fast", displayName: "Claude Opus 4.7 Fast", provider: "anthropic" },
  { model: "claude-opus-4-6", displayName: "Claude Opus 4.6", provider: "anthropic" },
  { model: "claude-opus-4-6-fast", displayName: "Claude Opus 4.6 Fast", provider: "anthropic" },
  { model: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", provider: "anthropic" },
  { model: "claude-opus-4-5-20251101", displayName: "Claude Opus 4.5", provider: "anthropic" },
  { model: "claude-sonnet-4-5-20250929", displayName: "Claude Sonnet 4.5", provider: "anthropic" },
  { model: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5", provider: "anthropic" },
  { model: "gpt-5.5", displayName: "GPT-5.5", provider: "openai" },
  { model: "gpt-5.5-fast", displayName: "GPT-5.5 Fast", provider: "openai" },
  { model: "gpt-5.5-pro", displayName: "GPT-5.5 Pro", provider: "openai" },
  { model: "gpt-5.4", displayName: "GPT-5.4", provider: "openai" },
  { model: "gpt-5.4-fast", displayName: "GPT-5.4 Fast", provider: "openai" },
  { model: "gpt-5.4-mini", displayName: "GPT-5.4 Mini", provider: "openai" },
  { model: "gpt-5.3-codex", displayName: "GPT-5.3-Codex", provider: "openai" },
  { model: "gpt-5.3-codex-fast", displayName: "GPT-5.3-Codex Fast", provider: "openai" },
  { model: "gpt-5.2", displayName: "GPT-5.2", provider: "openai" },
  { model: "gemini-3.1-pro-preview", displayName: "Gemini 3.1 Pro", provider: "google" },
  { model: "gemini-3.5-flash", displayName: "Gemini 3.5 Flash", provider: "google" },
  { model: "gemini-3-flash-preview", displayName: "Gemini 3 Flash", provider: "google" },
  { model: "glm-5.2", displayName: "GLM-5.2", provider: "droid-core" },
  { model: "glm-5.1", displayName: "GLM-5.1", provider: "droid-core" },
  { model: "nemotron-3-ultra", displayName: "Nemotron 3 Ultra", provider: "droid-core" },
  { model: "kimi-k2.7-code", displayName: "Kimi K2.7 Code", provider: "droid-core" },
  { model: "kimi-k2.6", displayName: "Kimi K2.6", provider: "droid-core" },
  { model: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro", provider: "droid-core" },
  { model: "minimax-m3", displayName: "MiniMax M3", provider: "droid-core" },
  { model: "minimax-m2.7", displayName: "MiniMax M2.7", provider: "droid-core" },
  { model: "minimax-m2.5", displayName: "MiniMax M2.5", provider: "droid-core" },
];

function factoryHome(): string {
  return process.env.FACTORY_HOME || join(homedir(), ".factory");
}

function droidPath(agent: string): string {
  return join(factoryHome(), "droids", `${agent}.md`);
}

function readJson(file: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function customModels(): Array<{ model: string; displayName?: string; provider?: string }> {
  const settings = readJson(join(factoryHome(), "settings.json"));
  const items = Array.isArray(settings.customModels) ? settings.customModels : [];
  return items.filter((item): item is { model: string; displayName?: string; provider?: string } => Boolean(item && typeof item === "object" && typeof (item as { model?: unknown }).model === "string"));
}

function readModel(agent: string): string {
  const file = droidPath(agent);
  if (!existsSync(file)) return "missing";
  const match = readFileSync(file, "utf8").match(/^model:\s*(\S+)\s*$/m);
  return match ? match[1] : "inherit";
}

function normalizeModel(input: string): string {
  if (input === "default" || input === "inherit") return "inherit";
  if (input.startsWith("custom:")) return input;
  const custom = customModels().find((item) => item.model === input || item.displayName === input);
  return custom ? `custom:${custom.model}` : input;
}

function setModel(agent: string, input: string): string {
  if (!AGENTS.includes(agent)) throw new Error(`Unknown JCE droid: ${agent}. Valid: ${AGENTS.join(", ")}`);
  const file = droidPath(agent);
  if (!existsSync(file)) throw new Error(`Droid file not found: ${file}. Run opencode-jce update first.`);
  const model = normalizeModel(input);
  const text = readFileSync(file, "utf8");
  const next = /^model:\s*\S+\s*$/m.test(text)
    ? text.replace(/^model:\s*\S+\s*$/m, `model: ${model}`)
    : text.replace(/^---\s*$/m, `---\nmodel: ${model}`);
  writeFileSync(file, next, "utf8");
  return model;
}

function labelModel(item: { model: string; displayName?: string; provider?: string }): string {
  const name = item.displayName && item.displayName !== item.model ? `${item.displayName} / ${item.model}` : item.model;
  return `${name}${item.provider ? ` [${item.provider}]` : ""}`;
}

const modelsCommand = new Command("models")
  .description("List Droid models usable by JCE droids")
  .action(() => {
    heading("JCE Droid Models");
    console.log();
    info("Current agents:");
    for (const agent of AGENTS) console.log(`  ${agent.padEnd(16)} ${readModel(agent)}`);
    console.log();
    info("Available models:");
    console.log("  default [inherit current Droid session model]");
    for (const item of NATIVE_MODELS) console.log(`  ${labelModel(item)}`);
    for (const item of customModels()) console.log(`  ${labelModel({ ...item, provider: item.provider || "custom" })}`);
    console.log();
    info("Set with: opencode-jce droid agent <agent> <model|default>");
    process.exit(EXIT_SUCCESS);
  });

const agentCommand = new Command("agent")
  .description("Set one JCE Droid agent model")
  .argument("<agent>", `JCE droid: ${AGENTS.join(", ")}`)
  .argument("<model>", "Droid model id, custom model id, or default")
  .action((agent: string, model: string) => {
    try {
      const applied = setModel(agent, model);
      success(`${agent} model set to ${applied}.`);
      process.exit(EXIT_SUCCESS);
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(EXIT_ERROR);
    }
  });

export const droidCommand = new Command("droid")
  .description("Manage Factory Droid JCE droid models")
  .addCommand(modelsCommand)
  .addCommand(agentCommand);
