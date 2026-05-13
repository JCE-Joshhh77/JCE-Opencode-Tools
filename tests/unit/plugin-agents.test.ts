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
    const prompt = agents["jce-worker"].systemPrompt;
    const lower = prompt.toLowerCase();
    expect(lower).toContain("todo");
    expect(lower).toContain("boulder");
    expect(prompt).toContain("JCE-Worker");
  });

  test("jce-worker prompt describes planning, delegation review, and verification", () => {
    const agents = buildAgentConfigs();
    expect(agents["jce-worker"].systemPrompt).toContain("Planning Rules");
    expect(agents["jce-worker"].systemPrompt).toContain("Verification Evidence");
    expect(agents["jce-worker"].systemPrompt).toContain("verify delegated work");
  });

  test("jce-worker prompt defines v3 full hybrid execution contract", () => {
    const agents = buildAgentConfigs();
    const prompt = agents["jce-worker"].systemPrompt;

    expect(prompt).toContain("Principal Engineer");
    expect(prompt).toContain("Acceptance Criteria");
    expect(prompt).toContain("Root Cause");
    expect(prompt).toContain("Delegation Contract");
    expect(prompt).toContain("jce_workflow");
    expect(prompt).toContain("safe_commit_plan");
    expect(prompt).toContain("release_ready");
    expect(prompt).toContain("advisory");
    expect(prompt).toContain("read-only");
    expect(prompt).toContain("permission to commit or push");
    expect(prompt).toContain("Verification Evidence");
    expect(prompt).toContain("Release Safety");
    expect(prompt).toContain("Anti-Patterns");
    expect(prompt).toContain("Final Response Contract");
    expect(prompt).toContain("What was found, or what changed if edits were made.");
    expect(prompt).toContain("Continue within the user-approved scope.");
    expect(prompt).toContain("Stop when blocked, unsafe, or explicitly instructed.");
  });

  test("jce-worker prompt defines coding brain upgrades without superpowers dependency", () => {
    const agents = buildAgentConfigs();
    const prompt = agents["jce-worker"].systemPrompt;

    expect(prompt).toContain("Coding Brain v3.1");
    expect(prompt).toContain("Bugfix Protocol");
    expect(prompt).toContain("reproduce the symptom");
    expect(prompt).toContain("Feature Protocol");
    expect(prompt).toContain("Verification Brain v3.2");
    expect(prompt).toContain("Project Learning v3.3");
    expect(prompt).toContain("Safe Edit Engine v3.4");
    expect(prompt).toContain("Autonomous Debug Loop v3.5");
    expect(prompt).toContain("After three failed focused fixes");
    expect(prompt).toContain("Do not require Superpowers");
  });

  test("jce-worker prompt defines intelligence pack protocols", () => {
    const agents = buildAgentConfigs();
    const prompt = agents["jce-worker"].systemPrompt;

    expect(prompt).toContain("Intelligence Pack v1");
    expect(prompt).toContain("Meta-Cognition Gate");
    expect(prompt).toContain("Codebase Intelligence");
    expect(prompt).toContain("Verification Discipline");
    expect(prompt).toContain("Release Engineering");
    expect(prompt).toContain("Delegation Quality");
  });

  test("jce-researcher prompt defines deep research modes", () => {
    const agents = buildAgentConfigs();
    const prompt = agents["jce-researcher"].systemPrompt;

    expect(prompt).toContain("docs-library");
    expect(prompt).toContain("codebase");
    expect(prompt).toContain("web-github");
    expect(prompt).toContain("comparative");
    expect(prompt).toContain("troubleshooting");
    expect(prompt).toContain("mixed");
  });

  test("jce-researcher prompt requires structured research output", () => {
    const agents = buildAgentConfigs();
    const prompt = agents["jce-researcher"].systemPrompt;

    expect(prompt).toContain("Research Scope");
    expect(prompt).toContain("Short Answer");
    expect(prompt).toContain("Findings");
    expect(prompt).toContain("Evidence");
    expect(prompt).toContain("Code / Commands");
    expect(prompt).toContain("Risks & Unknowns");
    expect(prompt).toContain("Recommended Next Step");
  });

  test("jce-researcher prompt prioritizes sources and forbids invented claims", () => {
    const agents = buildAgentConfigs();
    const prompt = agents["jce-researcher"].systemPrompt;

    expect(prompt).toContain("official documentation");
    expect(prompt).toContain("official source code");
    expect(prompt).toContain("changelog");
    expect(prompt).toContain("Never invent");
    expect(prompt).toContain("evidence is weak");
  });

  test("jce-researcher prompt enforces professional query planning and evidence ledger", () => {
    const agents = buildAgentConfigs();
    const prompt = agents["jce-researcher"].systemPrompt;

    expect(prompt).toContain("Query Planning");
    expect(prompt).toContain("Break the request into answerable sub-questions");
    expect(prompt).toContain("Evidence Ledger");
    expect(prompt).toContain("Claim");
    expect(prompt).toContain("Source");
    expect(prompt).toContain("Confidence");
    expect(prompt).toContain("not verified");
  });

  test("jce-researcher prompt requires version awareness and conflict handling", () => {
    const agents = buildAgentConfigs();
    const prompt = agents["jce-researcher"].systemPrompt;

    expect(prompt).toContain("Version Awareness");
    expect(prompt).toContain("library, framework, runtime, CLI, or API version");
    expect(prompt).toContain("Conflict Handling");
    expect(prompt).toContain("When sources disagree");
    expect(prompt).toContain("do not flatten the conflict");
  });

  test("jce-researcher prompt defines source confidence levels", () => {
    const agents = buildAgentConfigs();
    const prompt = agents["jce-researcher"].systemPrompt;

    expect(prompt).toContain("authoritative");
    expect(prompt).toContain("primary");
    expect(prompt).toContain("secondary");
    expect(prompt).toContain("weak");
  });

  test("jce-researcher prompt defines a research strategy matrix", () => {
    const agents = buildAgentConfigs();
    const prompt = agents["jce-researcher"].systemPrompt;

    expect(prompt).toContain("Research Strategy Matrix");
    expect(prompt).toContain("API docs");
    expect(prompt).toContain("Migration");
    expect(prompt).toContain("Security");
    expect(prompt).toContain("Performance");
  });

  test("jce-researcher prompt defines evidence budget and source traps", () => {
    const agents = buildAgentConfigs();
    const prompt = agents["jce-researcher"].systemPrompt;

    expect(prompt).toContain("Evidence Budget");
    expect(prompt).toContain("High confidence requires");
    expect(prompt).toContain("Source Trap Rules");
    expect(prompt).toContain("outdated docs");
    expect(prompt).toContain("version mismatch");
    expect(prompt).toContain("SEO content");
  });

  test("jce-researcher prompt adds decision quality and red team pass", () => {
    const agents = buildAgentConfigs();
    const prompt = agents["jce-researcher"].systemPrompt;

    expect(prompt).toContain("Decision Quality");
    expect(prompt).toContain("Implementation Readiness");
    expect(prompt).toContain("Red Team Pass");
    expect(prompt).toContain("What claim is most likely to be wrong?");
  });

  test("jce-worker requires evidence and sources from research delegation", () => {
    const agents = buildAgentConfigs();
    const prompt = agents["jce-worker"].systemPrompt;

    expect(prompt).toContain("Research delegations must return");
    expect(prompt).toContain("Evidence");
    expect(prompt).toContain("Sources");
    expect(prompt).toContain("Missing evidence means not verified");
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
