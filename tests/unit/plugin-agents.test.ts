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
  test("builds 6 agent configs with correct IDs", () => {
    const agents = buildAgentConfigs();
    const ids = Object.keys(agents);
    expect(ids).toContain("jce-worker");
    expect(ids).toContain("oracle");
    expect(ids).toContain("jce-researcher");
    expect(ids).toContain("explorer");
    expect(ids).toContain("frontend");
    expect(ids).toContain("android");
    expect(ids).toHaveLength(6);
  });

  test("android agent defines Android specialist protocols", () => {
    const agents = buildAgentConfigs();
    const prompt = agents.android.systemPrompt;
    expect(prompt).toContain("Android Specialist");
    expect(prompt).toContain("Build Failure Protocol");
    expect(prompt).toContain("Release Protocol");
    expect(prompt).toContain("Verification Requirements");
  });

  test("oracle sub-agent enforces Mandatory Root Cause Gate for bug delegations (#3)", () => {
    const agents = buildAgentConfigs();
    const prompt = agents.oracle.systemPrompt;
    expect(prompt).toContain("Mandatory Root Cause Gate");
    expect(prompt).toContain("Do NOT guess-fix");
    expect(prompt).toContain("Root Cause Evidence");
    expect(prompt).toContain("Output Contract");
    expect(prompt).toContain("## Summary");
    expect(prompt).toContain("## Files");
    expect(prompt).toContain("## Verification");
    expect(prompt).toContain("## Risks");
  });

  test("android sub-agent enforces Mandatory Root Cause Gate for build/runtime issues (#3)", () => {
    const agents = buildAgentConfigs();
    const prompt = agents.android.systemPrompt;
    expect(prompt).toContain("Mandatory Root Cause Gate");
    expect(prompt).toContain("Do NOT guess-fix");
    expect(prompt).toContain("Root Cause Evidence");
    // Android-specific forbidden actions must be listed so delegations don't
    // turn a focused bug fix into a sweeping dependency upgrade or build-style
    // rewrite.
    expect(prompt).toContain("enableJetifier");
    expect(prompt).toContain("disabling R8");
  });

  test("frontend sub-agent enforces Mandatory Root Cause Gate for UI bugs (#3)", () => {
    const agents = buildAgentConfigs();
    const prompt = agents.frontend.systemPrompt;
    expect(prompt).toContain("Mandatory Root Cause Gate");
    expect(prompt).toContain("Do NOT guess-fix");
    expect(prompt).toContain("Root Cause Evidence");
    expect(prompt).toContain("screenshot");
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

  test("jce-worker prompt requires autonomous completion after explicit continue-until-done requests", () => {
    const agents = buildAgentConfigs();
    const prompt = agents["jce-worker"].systemPrompt;

    expect(prompt).toContain("Autonomous Completion Rule");
    expect(prompt).toContain("do not stop after partial slices");
    expect(prompt).toContain("Do not ask “continue?” after making progress");
    expect(prompt).toContain("Only ask the user another question when blocked");
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
    expect(prompt).toContain("Continue within the user-approved scope, including necessary implicit steps required to complete requested outcome.");
    expect(prompt).toContain("Stop when blocked by missing external information, unsafe conditions, irreversible action not already approved, or explicit user instruction.");
  });

  test("jce-worker prompt aligns strong routing claims with runtime-qualified wording", () => {
    const agents = buildAgentConfigs();
    const prompt = agents["jce-worker"].systemPrompt;

    expect(prompt).toContain("Before acting on each user message");
    expect(prompt).toContain("prefer parallel delegation when runtime/tools allow");
    expect(prompt).toContain("if runtime constraints or approval boundaries prevent this");
    expect(prompt).toContain("safest reasonable assumption briefly and continue");
    expect(prompt).not.toContain("Before acting on ANY user message");
    expect(prompt).not.toContain("dispatch ALL units in parallel — never sequentially");
  });

  test("jce-worker prompt avoids unconditional confirmation gates for normal execution", () => {
    const agents = buildAgentConfigs();
    const prompt = agents["jce-worker"].systemPrompt;

    expect(prompt).not.toContain("wait for confirmation |");
    expect(prompt).not.toContain("propose approach → confirm |");
    expect(prompt).toContain("necessary implicit steps required to complete requested outcome");
    expect(prompt).toContain("ask for confirmation only if next action would change code/behavior irreversibly");
  });

  test("jce-worker prompt defines coding brain upgrades without superpowers dependency", () => {
    const agents = buildAgentConfigs();
    const prompt = agents["jce-worker"].systemPrompt;

    expect(prompt).toContain("Coding Brain v3.1");
    expect(prompt).toContain("Bugfix Protocol");
    expect(prompt).toContain("Mandatory Root Cause Gate");
    expect(prompt).toContain("Do NOT guess-fix");
    expect(prompt).toContain("Root Cause Evidence");
    expect(prompt).toContain("exact error excerpt");
    expect(prompt).toContain("Do NOT edit code before reading exact error/log");
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

  test("jce-worker prompt enforces Orchestration Enforcement v4 hard rules", () => {
    const agents = buildAgentConfigs();
    const prompt = agents["jce-worker"].systemPrompt;

    // Top-level section header
    expect(prompt).toContain("Orchestration Enforcement v4 (Hard Rules)");

    // 1. IntentGate Output mandatory format
    expect(prompt).toContain("IntentGate Output");
    expect(prompt).toContain("Intent: <category> | Risk: low|med|high");
    expect(prompt).toContain("Parallelizable: yes|no");

    // 2. Parallel Delegation Audit
    expect(prompt).toContain("Parallel Delegation Audit");
    expect(prompt).toContain("MUST be dispatched in a single batched tool call");
    expect(prompt).toContain("Sequential delegation due to:");

    // 3. Skill Loading Fallback with explicit triggers
    expect(prompt).toContain("Skill Loading Fallback");
    expect(prompt).toContain("orchestration-patterns");
    expect(prompt).toContain("failure-recovery");
    expect(prompt).toContain("release-engineering");
    expect(prompt).toContain("git-guardrails");
    expect(prompt).toContain("incident-response");

    // 4. Failure Recovery Counter — explicit attempt protocol
    expect(prompt).toContain("Failure Recovery Counter");
    expect(prompt).toContain("attempt 1:");
    expect(prompt).toContain("attempt 2:");
    expect(prompt).toContain("attempt 3:");
    expect(prompt).toContain("Never silently exceed 3 failed attempts");

    // 5. Anti-Duplication Enforcement with internal set
    expect(prompt).toContain("Anti-Duplication Enforcement");
    expect(prompt).toContain("already delegated");

    // 6. Wisdom Loop Closure — calls to context tools
    expect(prompt).toContain("Wisdom Loop Closure");
    expect(prompt).toContain("context_update");
    expect(prompt).toContain("context_index_update");
    expect(prompt).toContain("context_checkpoint");

    // 7. Meta-Cognition Gate explicit plan line
    expect(prompt).toContain("Meta-Cognition Gate (visible intent line)");
    expect(prompt).toContain("Task: <X> | Risk: <Y> | AC: <Z> | Evidence: <cmd>");

    // 8. Final Response Contract hard requirement
    expect(prompt).toContain("Final Response Contract (hard-required when work was done)");
    expect(prompt).toContain("Verification Evidence: explicit command(s)");
    expect(prompt).toContain("Not verified because:");
  });

  test("jce-worker prompt owns advanced frontend work as single front door", () => {
    const agents = buildAgentConfigs();
    const prompt = agents["jce-worker"].systemPrompt;

    expect(prompt).toContain("Frontend Product Design Brain v2");
    expect(prompt).toContain("single front door for frontend work");
    expect(prompt).toContain("No extra user command");
    expect(prompt).toContain("ask up to 3 concise questions");
    expect(prompt).toContain("Generic AI Risk Gate");
    expect(prompt).toContain("human-ui-design");
    expect(prompt).toContain("ui-pattern-library");
    expect(prompt).toContain("visual-qa-rubric");
    expect(prompt).toContain("Pattern Choice");
    expect(prompt).toContain("Human UI Review");
    expect(prompt).toContain("Generic AI Risk score");
    expect(prompt).toContain("Visual QA");
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
