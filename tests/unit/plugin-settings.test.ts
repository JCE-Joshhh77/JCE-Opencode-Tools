import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getConfigDir } from "../../src/lib/config.ts";
import { loadAgents } from "../../src/lib/agents.ts";
import {
  AGENT_IDS,
  getJcePluginSettingsPath,
  getConfigurableAgentIds,
  loadJcePluginSettings,
  saveJcePluginSettings,
  listAvailableModels,
  isModelAvailable,
} from "../../src/plugin/lib/settings.ts";

const originalXdg = process.env.XDG_CONFIG_HOME;
const originalPath = process.env.PATH;
const originalWindowsPath = process.env.Path;
const originalOpenCodeCommand = process.env.OPENCODE_JCE_OPENCODE_COMMAND;

function tempConfigDir(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `opencode-jce-${name}-`));
  const configDir = join(root, "opencode");
  mkdirSync(configDir, { recursive: true });
  process.env.XDG_CONFIG_HOME = root;
  writeFileSync(join(configDir, "opencode.json"), JSON.stringify({}), "utf-8");
  return configDir;
}

afterEach(() => {
  if (process.env.XDG_CONFIG_HOME?.includes("opencode-jce-")) {
    rmSync(process.env.XDG_CONFIG_HOME, { recursive: true, force: true });
  }
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdg;
  process.env.PATH = originalPath;
  if (originalWindowsPath === undefined) delete process.env.Path;
  else process.env.Path = originalWindowsPath;
  if (originalOpenCodeCommand === undefined) delete process.env.OPENCODE_JCE_OPENCODE_COMMAND;
  else process.env.OPENCODE_JCE_OPENCODE_COMMAND = originalOpenCodeCommand;
});

describe("plugin settings", () => {
  test("loads empty settings when jce-plugin.json does not exist", () => {
    const configDir = tempConfigDir("missing-settings");
    expect(getConfigDir()).toBe(configDir);
    expect(loadJcePluginSettings()).toEqual({ agents: {} });
  });

  test("saves nullable per-agent model settings", async () => {
    const configDir = tempConfigDir("save-settings");
    await saveJcePluginSettings({ agents: { "jce-worker": null, frontend: "enowxlabs/gpt-5.5", backend: "openai/gpt-5.5-fast" } });
    const saved = JSON.parse(readFileSync(join(configDir, "jce-plugin.json"), "utf-8"));
    expect(saved.agents["jce-worker"]).toBeNull();
    expect(saved.agents.frontend).toBe("enowxlabs/gpt-5.5");
    expect(saved.agents.backend).toBe("openai/gpt-5.5-fast");
  });

  test("loads configurable agent IDs from native JCE plugin agents only", () => {
    const configDir = tempConfigDir("agent-ids");
    writeFileSync(join(configDir, "agents.json"), JSON.stringify({ agents: [{ id: "backend" }, { id: "oracle" }, { id: "bad id" }] }), "utf-8");
    const ids = getConfigurableAgentIds(configDir);
    expect(ids).toContain("oracle");
    expect(ids).toContain("jce-worker");
    expect(ids).not.toContain("backend");
    expect(ids).not.toContain("bad id");
  });

  test("applies per-agent model settings to agents.json agents", async () => {
    const configDir = tempConfigDir("agents-model");
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify({ provider: { openai: { models: { "gpt-5.5-fast": {} } } } }), "utf-8");
    writeFileSync(join(configDir, "agents.json"), JSON.stringify({ agents: [{ id: "debugger", name: "Debugger", role: "Debug", systemPrompt: "debug", preferredProfile: "quality", maxTokens: 1000, tools: ["read"] }] }), "utf-8");
    writeFileSync(join(configDir, "jce-plugin.json"), JSON.stringify({ agents: { debugger: "openai/gpt-5.5-fast" } }), "utf-8");
    expect((await loadAgents())[0]?.model).toBe("openai/gpt-5.5-fast");
  });

  test("lists provider/model strings from opencode.json", () => {
    const configDir = tempConfigDir("models");
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify({
      provider: {
        enowxlabs: { models: { "gpt-5.5": {}, "gpt-5.4": {} } },
        openrouter: { models: { "anthropic/claude-sonnet": {} } },
      },
    }), "utf-8");
    expect(listAvailableModels()).toEqual([
      "enowxlabs/gpt-5.5",
      "enowxlabs/gpt-5.4",
      "openrouter/anthropic/claude-sonnet",
    ]);
  });

  test("lists models from OpenCode CLI when provider registry has built-in models", () => {
    const configDir = tempConfigDir("opencode-models");
    const binDir = join(configDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const bunPath = process.execPath;
    writeFileSync(join(binDir, "opencode"), `#!${bunPath}\nconsole.log("opencode/minimax-m2.5-free")\nconsole.log("anthropic/claude-opus-4-6")\nconsole.log("openai/gpt-5.5-fast")\n`, { mode: 0o755 });
    writeFileSync(join(binDir, "opencode.cmd"), `@echo opencode/minimax-m2.5-free\r\n@echo anthropic/claude-opus-4-6\r\n@echo openai/gpt-5.5-fast\r\n`, "utf-8");
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify({
      provider: { enowxlabs: { models: { "gpt-5.5": {} } } },
    }), "utf-8");
    process.env.PATH = `${binDir}${process.platform === "win32" ? ";" : ":"}${originalPath ?? ""}`;
    process.env.Path = process.env.PATH;
    process.env.OPENCODE_JCE_OPENCODE_COMMAND = join(binDir, process.platform === "win32" ? "opencode.cmd" : "opencode");

    expect(listAvailableModels()).toEqual([
      "opencode/minimax-m2.5-free",
      "anthropic/claude-opus-4-6",
      "openai/gpt-5.5-fast",
      "enowxlabs/gpt-5.5",
    ]);
    expect(isModelAvailable("openai/gpt-5.5-fast")).toBe(true);
  });

  test("caches OpenCode CLI model discovery briefly", () => {
    const configDir = tempConfigDir("opencode-model-cache");
    const binDir = join(configDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const bunPath = process.execPath;
    const counterPath = join(configDir, "counter.txt");
    const script = `#!/usr/bin/env sh\nprintf '1' >> ${JSON.stringify(counterPath)}\nprintf 'openai/gpt-5.5-fast\\n'\n`;
    writeFileSync(join(binDir, "opencode"), script, { mode: 0o755 });
    const opencodeCmdPath = join(binDir, "opencode.cmd");
    writeFileSync(opencodeCmdPath, `@echo off\r\n>>"${counterPath}" echo 1\r\necho openai/gpt-5.5-fast\r\n`, "utf-8");
    process.env.PATH = `${binDir}${process.platform === "win32" ? ";" : ":"}${originalPath ?? ""}`;
    process.env.Path = process.env.PATH;
    process.env.OPENCODE_JCE_OPENCODE_COMMAND = join(binDir, process.platform === "win32" ? "opencode.cmd" : "opencode");

    if (process.platform === "win32") expect(readFileSync(opencodeCmdPath, "utf-8")).toContain("openai/gpt-5.5-fast");

    expect(listAvailableModels()).toContain("openai/gpt-5.5-fast");
    expect(listAvailableModels()).toContain("openai/gpt-5.5-fast");

    expect(readFileSync(counterPath, "utf-8").trim()).toBe("1");
  });

  test("validates model strings against available OpenCode provider models", () => {
    const configDir = tempConfigDir("validate");
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify({
      provider: { enowxlabs: { models: { "gpt-5.5": {} } } },
    }), "utf-8");
    process.env.OPENCODE_JCE_OPENCODE_COMMAND = join(configDir, "missing-opencode");
    expect(isModelAvailable("enowxlabs/gpt-5.5")).toBe(true);
    expect(isModelAvailable("openai/gpt-4o-mini")).toBe(false);
  });

  test("exports the native JCE agent IDs", () => {
    expect(AGENT_IDS).toEqual(["jce-worker", "oracle", "jce-researcher", "explorer", "frontend", "android"]);
    expect(getJcePluginSettingsPath()).toContain("jce-plugin.json");
  });

});
