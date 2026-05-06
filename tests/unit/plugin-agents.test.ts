import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { buildAgentConfigs } from "../../src/plugin/config.ts";

const originalXdg = process.env.XDG_CONFIG_HOME;

function tempConfigDir(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `opencode-jce-agents-${name}-`));
  const configDir = join(root, "opencode");
  mkdirSync(configDir, { recursive: true });
  process.env.XDG_CONFIG_HOME = root;
  return configDir;
}

function writeProviderConfig(configDir: string): void {
  writeFileSync(join(configDir, "opencode.json"), JSON.stringify({
    provider: { enowxlabs: { models: { "gpt-5.5": {}, "gpt-5.4": {} } } },
  }), "utf-8");
}

afterEach(() => {
  if (process.env.XDG_CONFIG_HOME?.includes("opencode-jce-agents-")) {
    rmSync(process.env.XDG_CONFIG_HOME, { recursive: true, force: true });
  }
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdg;
});

describe("plugin agents", () => {
  test("builds 5 agent configs with correct IDs", () => {
    const agents = buildAgentConfigs();
    const ids = Object.keys(agents);
    expect(ids).toContain("jce-worker");
    expect(ids).toContain("oracle");
    expect(ids).toContain("jce-researcher");
    expect(ids).toContain("explorer");
    expect(ids).toContain("frontend");
    expect(ids).toHaveLength(5);
  });

  test("jce-worker agent has boulder/todo system prompt", () => {
    const agents = buildAgentConfigs();
    expect(agents["jce-worker"].systemPrompt).toContain("todo");
    expect(agents["jce-worker"].systemPrompt).toContain("boulder");
    expect(agents["jce-worker"].systemPrompt).toContain("JCE-Worker");
  });

  test("jce-worker prompt describes planning, delegation review, and verification", () => {
    const agents = buildAgentConfigs();
    expect(agents["jce-worker"].systemPrompt).toContain("planning");
    expect(agents["jce-worker"].systemPrompt).toContain("verification");
    expect(agents["jce-worker"].systemPrompt).toContain("review delegated work");
  });

  test("agents omit model by default so OpenCode uses the active user model", () => {
    const configDir = tempConfigDir("default-active");
    writeProviderConfig(configDir);
    const agents = buildAgentConfigs();
    for (const agent of Object.values(agents)) {
      expect(agent.model).toBeUndefined();
    }
  });

  test("agents apply valid per-agent model preferences", () => {
    const configDir = tempConfigDir("override");
    writeProviderConfig(configDir);
    writeFileSync(join(configDir, "jce-plugin.json"), JSON.stringify({
      agents: { "jce-worker": "enowxlabs/gpt-5.5", frontend: "enowxlabs/gpt-5.4" },
    }), "utf-8");
    const agents = buildAgentConfigs();
    expect(agents["jce-worker"].model).toBe("enowxlabs/gpt-5.5");
    expect(agents.frontend.model).toBe("enowxlabs/gpt-5.4");
    expect(agents.oracle.model).toBeUndefined();
  });

  test("invalid per-agent model preferences are ignored", () => {
    const configDir = tempConfigDir("invalid");
    writeProviderConfig(configDir);
    writeFileSync(join(configDir, "jce-plugin.json"), JSON.stringify({
      agents: { "jce-worker": "openai/gpt-4o-mini" },
    }), "utf-8");
    const agents = buildAgentConfigs();
    expect(agents["jce-worker"].model).toBeUndefined();
  });
});
