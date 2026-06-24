import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createEmptyRuntimeState, loadRuntimeState, saveRuntimeState } from "../../src/plugin/lib/runtime-state.ts";
import { saveSessionPolicyProfile } from "../../src/plugin/lib/policy-profile.ts";
import { addWorkflowStep, attachStepEvidence, createWorkflowRun, updateWorkflowStepStatus } from "../../src/plugin/lib/workflow.ts";
import { getMemoryPath, loadMemoryV2 } from "../../src/plugin/lib/orchestration/execution-memory-v2.ts";


const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "opencode-jce-plugin-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const mockInput = {
  client: {} as any,
  project: {} as any,
  directory: "/tmp",
  worktree: "/tmp",
  serverUrl: new URL("http://localhost:3000"),
  $: {} as any,
  experimental_workspace: { register: () => {} },
} as any;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

describe("plugin integration", () => {
  test("plugin server returns hooks with tools and event handler", async () => {
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server(mockInput);

    expect(hooks.tool).toBeDefined();
    expect(hooks.tool!.dispatch).toBeDefined();
    expect(hooks.tool!.bg_status).toBeDefined();
    expect(hooks.tool!.bg_collect).toBeDefined();
    expect(hooks.event).toBeDefined();
    expect(hooks.config).toBeDefined();
    expect(hooks["tool.execute.after"]).toBeDefined();
    expect(hooks["command.execute.before"]).toBeDefined();
  });

  test("slash command configures per-agent model from OpenCode command hook", async () => {
    const root = tempRoot();
    const configRoot = tempRoot();
    const configDir = join(configRoot, "opencode");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify({ provider: { openai: { models: { "gpt-5.5-fast": {} } } } }), "utf-8");
    writeFileSync(join(configDir, "agents.json"), JSON.stringify({ agents: [{ id: "debugger", name: "Debugger", role: "Debug", systemPrompt: "debug", preferredProfile: "quality", maxTokens: 1000, tools: ["read"] }] }), "utf-8");
    const oldXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = configRoot;
    try {
      const mod = await import("../../src/plugin/index.ts");
      const hooks = await mod.default.server({ ...mockInput, directory: root, worktree: root });
      const output = { parts: [] as any[] };
      await hooks["command.execute.before"]!({ command: "jce-agent-model", arguments: "oracle openai/gpt-5.5-fast", sessionID: "s" }, output as any);
      expect(output.parts[0].text).toContain("oracle now uses openai/gpt-5.5-fast");
      const saved = JSON.parse(readFileSync(join(configDir, "jce-plugin.json"), "utf-8"));
      expect(saved.agents.oracle).toBe("openai/gpt-5.5-fast");
    } finally {
      if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = oldXdg;
    }
  });

  test("slash command ignores agents.json-only agents", async () => {
    const root = tempRoot();
    const configRoot = tempRoot();
    const configDir = join(configRoot, "opencode");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify({ provider: { openai: { models: { "gpt-5.5-fast": {} } } } }), "utf-8");
    writeFileSync(join(configDir, "agents.json"), JSON.stringify({ agents: [{ id: "debugger", name: "Debugger", role: "Debug", systemPrompt: "debug", preferredProfile: "quality", maxTokens: 1000, tools: ["read", "bash"] }] }), "utf-8");
    const oldXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = configRoot;
    try {
      const mod = await import("../../src/plugin/index.ts");
      const hooks = await mod.default.server({ ...mockInput, directory: root, worktree: root });
      const output = { parts: [] as any[] };
      await hooks["command.execute.before"]!({ command: "jce-agent-model", arguments: "debugger openai/gpt-5.5-fast", sessionID: "s" }, output as any);
      expect(output.parts[0].text).toContain("Unknown agent: debugger");
      expect(output.parts[0].text).toContain("jce-worker");
    } finally {
      if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = oldXdg;
    }
  });

  test("slash command updates native agent config without plugin restart", async () => {
    const root = tempRoot();
    const configRoot = tempRoot();
    const configDir = join(configRoot, "opencode");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify({ provider: { openai: { models: { "gpt-5.5-fast": {} } } } }), "utf-8");
    const oldXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = configRoot;
    try {
      const mod = await import("../../src/plugin/index.ts");
      const hooks = await mod.default.server({ ...mockInput, directory: root, worktree: root });
      const output = { parts: [] as any[] };
      await hooks["command.execute.before"]!({ command: "jce-agent-model", arguments: "oracle openai/gpt-5.5-fast", sessionID: "s" }, output as any);
      const config = { agent: {} as Record<string, any> };
      await hooks.config!(config as any);
      expect(config.agent.oracle.model).toBe("openai/gpt-5.5-fast");

      await hooks["command.execute.before"]!({ command: "jce-agent-model", arguments: "oracle default", sessionID: "s" }, output as any);
      const resetConfig = { agent: {} as Record<string, any> };
      await hooks.config!(resetConfig as any);
      expect(resetConfig.agent.oracle.model).toBeUndefined();
    } finally {
      if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = oldXdg;
    }
  });

  test("tool.execute.after skips direct context-budget compression for read output", async () => {
    const root = tempRoot();
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root, worktree: root });
    const repeated = "same verbose low value output line for token savings";
    const original = [repeated, repeated, repeated, "final important line"].join("\n");
    const output = {
      title: "Read",
      output: original,
      metadata: {},
    };

    // Runtime passes lowercase tool names; the hook normalizes internally.
    await hooks["tool.execute.after"]!({ tool: "read", sessionID: "s", callID: "c", args: {} }, output);

    const persisted = loadRuntimeState(root).runtime;
    expect(output.output).toBe(original);
    expect(persisted.contextBudgetSummary).toBeUndefined();
    expect(persisted.traceEvents.some((event) => event.message === "Context budget applied to read output")).toBe(false);
  });

  test("plugin runtime persistence writes orchestration memory v2", async () => {
    const root = tempRoot();
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root, worktree: root });

    await hooks["chat.message"]!({} as any, {
      message: "Fix broken tests, update config, verify the workflow, and audit every related file across the project.",
      parts: [{ type: "text", text: "Fix broken tests, update config, verify the workflow, and audit every related file across the project." }],
    } as any);
    await hooks.event!({ event: { type: "session.idle" } } as any);

    expect(existsSync(getMemoryPath(root))).toBe(true);
  });

  test("plugin creates project context template on first chat message when missing", async () => {
    const root = tempRoot();
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root, worktree: root });
    const contextPath = join(root, ".opencode-context.md");

    expect(existsSync(contextPath)).toBe(false);

    await hooks["chat.message"]!({} as any, {
      message: "fix this simple bug",
      parts: [{ type: "text", text: "fix this simple bug" }],
    } as any);

    expect(existsSync(contextPath)).toBe(true);
    expect(readFileSync(contextPath, "utf-8")).toContain("Auto-maintained by AI");
  });

  test("plugin injects no-task compaction guard and disables autocontinue after greeting", async () => {
    const root = tempRoot();
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root, worktree: root });

    await hooks["chat.message"]!({} as any, {
      message: "halow",
      parts: [{ type: "text", text: "halow" }],
    } as any);

    const systemOutput = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]!({} as any, systemOutput as any);
    expect(systemOutput.system.join("\n")).toContain("JCE Post-Compaction No-Task Guard");

    const autocontinueOutput = { enabled: true, autocontinue: true, continue: true } as any;
    await (hooks as any)["experimental.compaction.autocontinue"]?.({ summary: "Goal\n- Awaiting user's task or question\nProgress\nDone\n- (none)\nIn Progress\n- (none)\nRelevant Files\n- (none)" }, autocontinueOutput);

    expect(autocontinueOutput.enabled).toBe(false);
    expect(autocontinueOutput.autocontinue).toBe(false);
    expect(autocontinueOutput.continue).toBe(false);
    expect(autocontinueOutput.reason).toContain("no-task compaction guard");
  });

  test("plugin bg_collect launches recovery retry through registered client", async () => {
    const promptCalls: unknown[] = [];
    const client = {
      session: {
        create: async () => ({ id: `child-${promptCalls.length + 1}` }),
        prompt: async (request: unknown) => {
          promptCalls.push(request);
          if (promptCalls.length === 1) return { parts: [{ type: "text", text: "initial output" }] };
          return { parts: [{ type: "text", text: "## Summary\nRetried\n\n## Files\n- none\n\n## Verification\n- not run\n\n## Risks\n- none" }] };
        },
      },
    } as any;
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, client });
    const context = {
      sessionID: "s",
      messageID: "m",
      agent: "jce-worker",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: () => {
        throw new Error("not implemented");
      },
    } as any;

    const launch = await hooks.tool!.dispatch.execute({ description: "Inspect runtime", prompt: "Inspect the runtime", agent: "explorer" } as any, context);
    await Promise.resolve();
    const taskId = String(launch).match(/Background task launched: (\S+)/)?.[1];
    expect(taskId).toBeDefined();

    const collect = await hooks.tool!.bg_collect.execute({ taskId } as any, context);
    await Promise.resolve();

    expect(collect).toMatch(/Recovery: retry (scheduled|already scheduled)/);
    expect(promptCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("dispatch persists task route with parallel agent hint", async () => {
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = createWorkflowRun({ id: "wf-route", goal: "Coordinate background work" });
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");
    const client = {
      session: {
        create: async () => ({ id: "child-1" }),
        prompt: async () => ({ parts: [{ type: "text", text: "## Summary\nResearched\n\n## Files\n- none\n\n## Verification\n- not run\n\n## Risks\n- none" }] }),
      },
    } as any;

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, client, directory: root });
    const context = { sessionID: "s", messageID: "m", agent: "jce-worker", directory: root, worktree: root, abort: new AbortController().signal, metadata: () => {}, ask: () => {} } as any;

    await hooks.tool!.dispatch.execute({ description: "Run independent research tasks in parallel", prompt: "Use independent checks concurrently", agent: "explorer" } as any, context);
    const persisted = loadRuntimeState(root).runtime;

    // New intent router classifies this as "research" (keyword: "research")
    expect(persisted.activeWorkflow?.route).toMatchObject({
      intent: "research",
      source: "task",
    });
    expect(persisted.activeWorkflow?.route?.skills.length).toBeGreaterThan(0);
  });

  test("dispatch output after hook preserves task route source for same intent", async () => {
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = createWorkflowRun({ id: "wf-route", goal: "Coordinate background work" });
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");
    const client = {
      session: {
        create: async () => ({ id: "child-1" }),
        prompt: async () => ({ parts: [{ type: "text", text: "## Summary\nResearched\n\n## Files\n- none\n\n## Verification\n- not run\n\n## Risks\n- none" }] }),
      },
    } as any;

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, client, directory: root });
    const context = { sessionID: "s", messageID: "m", agent: "jce-worker", directory: root, worktree: root, abort: new AbortController().signal, metadata: () => {}, ask: () => {} } as any;

    const dispatchOutput = await hooks.tool!.dispatch.execute({ description: "Run independent research tasks in parallel", prompt: "Use independent checks concurrently", agent: "explorer" } as any, context);
    await hooks["tool.execute.after"]!({ tool: "dispatch", sessionID: "s", callID: "c", args: {} }, { title: "dispatch", output: String(dispatchOutput), metadata: {} });
    const persisted = loadRuntimeState(root).runtime;

    // Route persists with task source after dispatch + after-hook
    expect(persisted.activeWorkflow?.route).toMatchObject({
      intent: "research",
      source: "task",
    });
  });

  test("dispatch policy warns on balanced agent mismatch", async () => {
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = createWorkflowRun({ id: "wf-policy", goal: "Coordinate parallel work" });
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");
    const client = { session: { create: async () => ({ id: "child-1" }), prompt: async () => ({ parts: [{ type: "text", text: "## Summary\nDone\n\n## Files\n- none\n\n## Verification\n- not run\n\n## Risks\n- none" }] }) } } as any;

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, client, directory: root });
    const context = { sessionID: "s", messageID: "m", agent: "jce-worker", directory: root, worktree: root, abort: new AbortController().signal, metadata: () => {}, ask: () => {} } as any;

    // Use a prompt that routes to explorer hint, but dispatch to jce-researcher (mismatch)
    const result = await hooks.tool!.dispatch.execute({ description: "Find where the auth module is defined in the codebase", prompt: "Explore the codebase structure to find auth", agent: "jce-researcher" } as any, context);

    expect(String(result)).toContain("EXECUTION POLICY: warning");
    expect(String(result)).toContain("Dispatch agent jce-researcher does not match route hint explorer.");
  });

  test("dispatch policy blocks strict agent mismatch", async () => {
    const root = tempRoot();
    saveSessionPolicyProfile(root, "strict");
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = createWorkflowRun({ id: "wf-policy", goal: "Coordinate parallel work" });
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");
    let createCalls = 0;
    let promptCalls = 0;
    const client = {
      session: {
        create: async () => {
          createCalls += 1;
          return { id: "child-1" };
        },
        prompt: async () => {
          promptCalls += 1;
          return { parts: [{ type: "text", text: "should not launch" }] };
        },
      },
    } as any;

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, client, directory: root });
    const context = { sessionID: "s", messageID: "m", agent: "jce-worker", directory: root, worktree: root, abort: new AbortController().signal, metadata: () => {}, ask: () => {} } as any;

    // Use a prompt that routes to explorer hint, but dispatch to jce-researcher (mismatch)
    const result = await hooks.tool!.dispatch.execute({ description: "Find where the auth module is defined in the codebase", prompt: "Explore the codebase structure to find auth", agent: "jce-researcher" } as any, context);
    const status = await hooks.tool!.bg_status.execute({} as any, context);

    expect(String(result)).toContain("EXECUTION POLICY: blocked");
    expect(String(result)).not.toContain("Background task launched");
    expect(createCalls).toBe(0);
    expect(promptCalls).toBe(0);
    expect(status).toBe("No background tasks.");
  });

  test("config hook injects 6 agents", async () => {
    const configRoot = tempRoot();
    const configDir = join(configRoot, "opencode");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "opencode.json"), "{}", "utf-8");
    const oldXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = configRoot;
    try {
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server(mockInput);

    const config: any = { agent: {} };
    await hooks.config!(config);
    expect(Object.keys(config.agent)).toHaveLength(6);
    expect(config.agent["jce-worker"]).toBeDefined();
    expect(config.agent.oracle).toBeDefined();
    expect(config.agent["jce-researcher"]).toBeDefined();
    expect(config.agent.explorer).toBeDefined();
    expect(config.agent.frontend).toBeDefined();
    expect(config.agent.android).toBeDefined();
    } finally {
      if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = oldXdg;
    }
  });

  test("config hook does not inject agents.json legacy agents", async () => {
    const configRoot = tempRoot();
    const configDir = join(configRoot, "opencode");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "opencode.json"), "{}", "utf-8");
    writeFileSync(join(configDir, "agents.json"), JSON.stringify({ agents: [
      { id: "debugger", name: "Debugger", role: "Debug", systemPrompt: "debug", preferredProfile: "quality", maxTokens: 1000, tools: ["read", "bash"] },
      { id: "tester", name: "Tester", role: "Test", systemPrompt: "test", preferredProfile: "quality", maxTokens: 1000, tools: ["read"] },
    ] }), "utf-8");
    const oldXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = configRoot;
    try {
      const mod = await import("../../src/plugin/index.ts");
      const hooks = await mod.default.server({ ...mockInput, directory: tempRoot(), worktree: tempRoot() });
      const config: any = { agent: {} };
      await hooks.config!(config);
      expect(Object.keys(config.agent)).toEqual(["jce-worker", "oracle", "jce-researcher", "explorer", "frontend", "android"]);
      expect(config.agent.debugger).toBeUndefined();
      expect(config.agent.tester).toBeUndefined();
    } finally {
      if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = oldXdg;
    }
  });

  test("plugin exposes android_logcat tool", async () => {
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server(mockInput);
    expect(hooks.tool!.android_logcat).toBeDefined();
  });

  test("config hook does not overwrite existing agents", async () => {
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server(mockInput);

    const existingAgent = { model: "custom-model", systemPrompt: "custom" };
    const config: any = { agent: { "jce-worker": existingAgent } };
    await hooks.config!(config);
    expect(config.agent["jce-worker"]).toBe(existingAgent);
    expect(config.agent.oracle).toBeDefined();
  });

  test("config hook creates agent object if missing", async () => {
    const configRoot = tempRoot();
    const configDir = join(configRoot, "opencode");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "opencode.json"), "{}", "utf-8");
    const oldXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = configRoot;
    try {
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server(mockInput);

    const config: any = {};
    await hooks.config!(config);
    expect(Object.keys(config.agent)).toHaveLength(6);
    } finally {
      if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = oldXdg;
    }
  });

  test("tool.execute.after appends warning for excessive comments", async () => {
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server(mockInput);

    const input = { tool: "write", sessionID: "s", callID: "c", args: { filePath: "test.ts" } };
    // 10 lines, 5 are comments = 50% ratio > 40% threshold
    const output = {
      title: "Write",
      output: "// comment\n// comment\n// comment\n// comment\n// comment\nconst a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconst e = 5;",
      metadata: {},
    };
    await hooks["tool.execute.after"]!(input, output);
    expect(output.output).toContain("COMMENT CHECK");
  });

  test("tool.execute.after does not warn for normal code", async () => {
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server(mockInput);

    const input = { tool: "write", sessionID: "s", callID: "c", args: { filePath: "test.ts" } };
    const output = {
      title: "Write",
      output: "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconst e = 5;\n// one comment",
      metadata: {},
    };
    await hooks["tool.execute.after"]!(input, output);
    expect(output.output).not.toContain("COMMENT CHECK");
  });

  test("plugin server appends verification warning for suspicious completion output", async () => {
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server(mockInput);

    const input = { tool: "task", sessionID: "s", callID: "c", args: {} };
    const output = {
      title: "Task",
      output: "Implemented the change and it is complete.",
      metadata: {},
    };
    await hooks["tool.execute.after"]!(input, output);
    expect(output.output).toContain("verification");
  });

  test("bg_collect appends research quality warning for incomplete jce-researcher output", async () => {
    const client = {
      session: {
        create: async () => ({ id: "child-1" }),
        prompt: async () => ({ parts: [{ type: "text", text: "## Summary\nDone\n\n## Files\n- none\n\n## Verification\n- not run\n\n## Risks\n- none\n\n# Short Answer\nUse docs, but sources omitted." }] }),
      },
    } as any;
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, client });
    const context = { sessionID: "s", messageID: "m", agent: "jce-worker", directory: "/tmp", worktree: "/tmp", abort: new AbortController().signal, metadata: () => {}, ask: () => {} } as any;

    const launch = await hooks.tool!.dispatch.execute({ description: "Research API", prompt: "Research API", agent: "jce-researcher" } as any, context);
    await Promise.resolve();
    const taskId = String(launch).match(/Background task launched: (\S+)/)?.[1];
    const collect = await hooks.tool!.bg_collect.execute({ taskId } as any, context);

    expect(collect).toContain("RESEARCH QUALITY WARNING");
    expect(collect).toContain("Section: Research Scope");
  });

  test("bg_collect does not append research quality warning for non-researcher output", async () => {
    const client = {
      session: {
        create: async () => ({ id: "child-1" }),
        prompt: async () => ({ parts: [{ type: "text", text: "## Summary\nDone\n\n## Files\n- none\n\n## Verification\n- not run\n\n## Risks\n- none\n\n# Short Answer\nUse docs, but sources omitted." }] }),
      },
    } as any;
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, client });
    const context = { sessionID: "s", messageID: "m", agent: "jce-worker", directory: "/tmp", worktree: "/tmp", abort: new AbortController().signal, metadata: () => {}, ask: () => {} } as any;

    const launch = await hooks.tool!.dispatch.execute({ description: "Explore API", prompt: "Explore API", agent: "explorer" } as any, context);
    await Promise.resolve();
    const taskId = String(launch).match(/Background task launched: (\S+)/)?.[1];
    const collect = await hooks.tool!.bg_collect.execute({ taskId } as any, context);

    expect(collect).not.toContain("RESEARCH QUALITY WARNING");
  });

  test("tool.execute.after appends final review gate warning for blocked active workflow completion", async () => {
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    let run = createWorkflowRun({ id: "wf-final", goal: "Ship final gate", acceptanceCriteria: ["tests pass"] });
    run = addWorkflowStep(run, { id: "step-1", title: "Implement", taskType: "code", expectedOutput: "code", verification: ["bun test"] });
    memory.activeWorkflow = updateWorkflowStepStatus(run, "step-1", "completed");
    memory.activeTasks = [{ id: "bg-live" }];
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const input = { tool: "task", sessionID: "s", callID: "c", args: {} };
    const output = { title: "Task", output: "Implemented and complete.", metadata: {} };

    await hooks["tool.execute.after"]!(input, output);

    expect(output.output).toContain("FINAL REVIEW GATE");
    expect(output.output).toMatch(/passing relevant command evidence|Completion certificate is not valid/);
  });

  test("tool.execute.after ignores stale persisted workflow gates until current session activates them", async () => {
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    let run = createWorkflowRun({ id: "wf-stale", goal: "Old blocked workflow", acceptanceCriteria: ["tests pass"] });
    run = addWorkflowStep(run, { id: "step-1", title: "Implement", taskType: "code", expectedOutput: "code", verification: ["bun test"] });
    memory.activeWorkflow = updateWorkflowStepStatus(run, "step-1", "completed");
    memory.blockers = [{ id: "bg-old", failureReason: "Failed to create child session" }];
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const output = { title: "Task", output: "Here is a neutral progress update.", metadata: {} };

    await hooks["tool.execute.after"]!({ tool: "task", sessionID: "fresh-session", callID: "c", args: {} }, output);

    expect(output.output).not.toContain("EXECUTION POLICY: blocked");
    expect(output.output).not.toContain("FINAL REVIEW GATE");
  });

  test("tool.execute.after blocks confirmation stop when TodoWrite has pending items", async () => {
    const root = tempRoot();
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root, worktree: root });

    const todoOutput = { title: "TodoWrite", output: JSON.stringify([{ content: "Run verification", status: "pending" }]), metadata: {} };
    await hooks["tool.execute.after"]!({ tool: "todowrite", sessionID: "s", callID: "todo", args: {} }, todoOutput);

    const finalOutput = { title: "Task", output: "Sisanya tinggal dikonfirmasi dulu ya.", metadata: {} };
    await hooks["tool.execute.after"]!({ tool: "task", sessionID: "s", callID: "final", args: {} }, finalOutput);

    expect(finalOutput.output).toContain("BOULDER CONTINUATION");
    expect(finalOutput.output).toContain("Run verification");
  });

  test("tool.execute.after appends autonomy guard when user requested continue-until-done mode", async () => {
    const root = tempRoot();
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root, worktree: root });

    await hooks["chat.message"]!({} as any, { message: "kerjakan sampai selesai dan jangan berhenti sebelum selesai", parts: [{ type: "text", text: "kerjakan sampai selesai dan jangan berhenti sebelum selesai" }] } as any);

    const finalOutput = { title: "Task", output: "Sisanya tinggal dikonfirmasi dulu ya.", metadata: {} };
    await hooks["tool.execute.after"]!({ tool: "task", sessionID: "s", callID: "final", args: {} }, finalOutput);

    expect(finalOutput.output).toContain("AUTONOMY GUARD:");
    expect(finalOutput.output).toContain("continue-until-done mode");
  });

  test("tool.execute.after final gate blocks review route completion without accepted review", async () => {
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = {
      ...createWorkflowRun({ id: "wf-review-block", goal: "Complete reviewed work", acceptanceCriteria: ["review accepted"] }),
      route: {
        intent: "review",
        skills: ["codebase-intelligence"],
        reason: "Review route requires accepted review evidence before completion.",
        source: "message",
      },
    };
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const output = { title: "Task", output: "Implemented and complete.", metadata: {} };

    await hooks["tool.execute.after"]!({ tool: "task", sessionID: "s", callID: "c", args: {} }, output);

    expect(output.output).toContain("FINAL REVIEW GATE");
    expect(output.output).toContain("Review route requires accepted review evidence");
  });

  test("tool.execute.after uses session policy profile for final review gate", async () => {
    const root = tempRoot();
    saveSessionPolicyProfile(root, "strict");
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    let run = createWorkflowRun({ id: "wf-final", goal: "Research", acceptanceCriteria: ["source reviewed"] });
    run = addWorkflowStep(run, { id: "step-1", title: "Research", taskType: "research", expectedOutput: "notes", verification: ["manual source review"] });
    run = attachStepEvidence(run, "step-1", { kind: "manual", summary: "manual review", passed: true });
    memory.activeWorkflow = updateWorkflowStepStatus(run, "step-1", "completed");
    memory.activeTasks = [{ id: "bg-live" }];
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const output = { title: "Task", output: "Finished and complete. Verification: manual review passed.", metadata: {} };

    await hooks["tool.execute.after"]!({ tool: "task", sessionID: "s", callID: "c", args: {} }, output);

    expect(output.output).toContain("FINAL REVIEW GATE");
    expect(output.output).toContain("requires source, file, or review evidence for research");
  });

  test("tool.execute.after does not append final review gate warning for verified active workflow completion", async () => {
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    let run = createWorkflowRun({ id: "wf-final", goal: "Ship final gate", acceptanceCriteria: ["tests pass"] });
    run = addWorkflowStep(run, { id: "step-1", title: "Implement", taskType: "code", expectedOutput: "code", verification: ["bun test"] });
    run = attachStepEvidence(run, "step-1", { kind: "command", command: "bun test", summary: "bun test: pass", passed: true });
    memory.activeWorkflow = updateWorkflowStepStatus(run, "step-1", "completed");
    memory.activeTasks = [{ id: "bg-live" }];
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const input = { tool: "task", sessionID: "s", callID: "c", args: {} };
    const output = { title: "Task", output: "Implemented and complete. Verification: bun test passed.", metadata: {} };

    await hooks["tool.execute.after"]!(input, output);

    expect(output.output).not.toContain("FINAL REVIEW GATE");
  });

  test("tool.execute.after does NOT inject gates onto lowercase read/bash output (L1 regression)", async () => {
    // Regression for L1: runtime passes lowercase tool names. A blocked active
    // workflow that WOULD inject gates onto inspected tools must never leak
    // those gates onto read/grep/glob/ls/bash output. The previous code
    // compared against capitalized "Read"/"Bash" so lowercase names slipped
    // through and gates spammed every file read.
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    let run = createWorkflowRun({ id: "wf-l1", goal: "Blocked workflow", acceptanceCriteria: ["tests pass"] });
    run = addWorkflowStep(run, { id: "step-1", title: "Implement", taskType: "code", expectedOutput: "code", verification: ["bun test"] });
    memory.activeWorkflow = updateWorkflowStepStatus(run, "step-1", "completed");
    memory.activeTasks = [{ id: "bg-live" }];
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const completionText = "Implemented and complete.";

    for (const tool of ["read", "bash", "grep", "glob", "ls", "dispatch", "bg_collect", "bg_status"]) {
      const output = { title: tool, output: completionText, metadata: {} };
      await hooks["tool.execute.after"]!({ tool, sessionID: "s", callID: "c", args: {} }, output);
      expect(output.output).not.toContain("FINAL REVIEW GATE");
      expect(output.output).not.toContain("VERIFICATION CHECK");
      expect(output.output).not.toContain("CLOSED-LOOP ORCHESTRATION");
      expect(output.output).not.toContain("EXECUTION POLICY: blocked");
    }

    // Positive control: the SAME blocked state on an INSPECTED tool (lowercase
    // "task") MUST still inject the gate. This proves the exclusion above is
    // tool-specific, not a blanket suppression that would silently disable all
    // gating (which would also "pass" the negative assertions and hide breakage).
    const inspected = { title: "task", output: completionText, metadata: {} };
    await hooks["tool.execute.after"]!({ tool: "task", sessionID: "s", callID: "c", args: {} }, inspected);
    expect(inspected.output).toContain("FINAL REVIEW GATE");
  });

  test("chat.message does not auto-activate orchestration for question-only prompts", async () => {
    const root = tempRoot();
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root, worktree: root });

    await hooks["chat.message"]!({} as any, {
      message: "Bisakah Anda menjelaskan arsitektur plugin ini?",
      parts: [{ type: "text", text: "Bisakah Anda menjelaskan arsitektur plugin ini?" }],
    } as any);
    await hooks.event!({ event: { type: "session.idle" } } as any);

    const persisted = loadRuntimeState(root).runtime;
    const orchestration = loadMemoryV2(root).memory;
    expect(persisted.activeTasks).toHaveLength(0);
    expect(persisted.activeWorkflow).toBeUndefined();
    expect(orchestration.graph).toBeUndefined();
  });

  test("chat.message can still auto-activate orchestration for imperative complex requests", async () => {
    const root = tempRoot();
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root, worktree: root });

    await hooks["chat.message"]!({} as any, {
      message: "Fix broken tests, update config, verify the workflow, and audit every related file across the project.",
      parts: [{ type: "text", text: "Fix broken tests, update config, verify the workflow, and audit every related file across the project." }],
    } as any);
    await hooks.event!({ event: { type: "session.idle" } } as any);

    expect(existsSync(getMemoryPath(root))).toBe(true);
    const orchestration = loadMemoryV2(root).memory;
    expect(orchestration.graph).toBeDefined();
  });

  test("tool.execute.after persists completion claim route on active workflow", async () => {
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = createWorkflowRun({ id: "wf-route", goal: "Complete routed workflow", acceptanceCriteria: ["tests pass"] });
    memory.activeTasks = [{ id: "bg-live" }];
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const output = { title: "Task", output: "Implemented and complete.", metadata: {} };

    await hooks["tool.execute.after"]!({ tool: "task", sessionID: "s", callID: "c", args: {} }, output);
    const persisted = loadRuntimeState(root).runtime;

    // New router classifies "complete" as general (no strong signal) — route is applied
    expect(persisted.activeWorkflow?.route).toBeDefined();
    expect(persisted.activeWorkflow?.route?.source).toBe("completion");
    expect(output.output).toContain("FINAL REVIEW GATE");
  });

  test("tool.execute.after does not overwrite specific route with general text", async () => {
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = {
      ...createWorkflowRun({ id: "wf-route", goal: "Fix routed workflow" }),
      route: {
        intent: "bugfix",
        skills: ["systematic-debugging", "test-driven-development"],
        reason: "Detected bug or failing test intent.",
        source: "message",
      },
    };
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const output = { title: "Task", output: "Here is a neutral progress update.", metadata: {} };

    await hooks["tool.execute.after"]!({ tool: "task", sessionID: "s", callID: "c", args: {} }, output);
    const persisted = loadRuntimeState(root).runtime;

    expect(persisted.activeWorkflow?.route?.intent).toBe("bugfix");
  });

  test("tool.execute.after policy blocks generic route overwrite", async () => {
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = {
      ...createWorkflowRun({ id: "wf-policy", goal: "Preserve route" }),
      route: {
        intent: "bugfix",
        skills: ["systematic-debugging", "test-driven-development"],
        reason: "Detected bug or failing test intent.",
        source: "message",
      },
    };
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const output = { title: "Task", output: "Here is a neutral progress update.", metadata: {} };

    await hooks["tool.execute.after"]!({ tool: "task", sessionID: "s", callID: "c", args: {} }, output);
    const persisted = loadRuntimeState(root).runtime;

    expect(persisted.activeWorkflow?.route?.intent).toBe("bugfix");
    expect(output.output).not.toContain("EXECUTION POLICY: blocked");
  });

  test("completion claim policy appends execution policy block when evidence is missing", async () => {
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    let run = createWorkflowRun({ id: "wf-policy", goal: "Complete safely", acceptanceCriteria: ["tests pass"] });
    run = addWorkflowStep(run, { id: "step-1", title: "Implement", taskType: "code", expectedOutput: "code", verification: ["bun test"] });
    memory.activeWorkflow = updateWorkflowStepStatus(run, "step-1", "completed");
    memory.activeTasks = [{ id: "bg-live" }];
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const output = { title: "Task", output: "Implemented and complete.", metadata: {} };

    await hooks["tool.execute.after"]!({ tool: "task", sessionID: "s", callID: "c", args: {} }, output);

    expect(output.output).toContain("EXECUTION POLICY: blocked");
    expect(output.output).toContain("task_type_verification.required");
    expect(output.output).toContain("FINAL REVIEW GATE");
  });

  test("completion claim output includes task-type verification policy block", async () => {
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    let run = createWorkflowRun({ id: "wf-policy", goal: "Complete docs update", acceptanceCriteria: ["docs updated"] });
    run = addWorkflowStep(run, { id: "step-docs", title: "Update docs", taskType: "docs", expectedOutput: "docs", verification: ["review docs"] });
    run = attachStepEvidence(run, "step-docs", { kind: "command", command: "bun test", summary: "bun test: pass", passed: true });
    run = updateWorkflowStepStatus(run, "step-docs", "completed");
    memory.activeWorkflow = run;
    memory.activeTasks = [{ id: "bg-live" }];
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const output = { title: "Task", output: "Documentation update complete.", metadata: {} };

    await hooks["tool.execute.after"]!({ tool: "task", sessionID: "s", callID: "c", args: {} }, output);

    expect(output.output).toContain("EXECUTION POLICY: blocked");
    expect(output.output).toContain("completion.task_type_verification.required");
    expect(output.output).toContain("Step step-docs requires file or review evidence for docs changes.");
    expect(output.output).toContain("FINAL REVIEW GATE");
  });

  test("completion claim preserves review route and blocks without accepted review evidence", async () => {
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = {
      ...createWorkflowRun({ id: "wf-policy", goal: "Complete reviewed work", acceptanceCriteria: ["review accepted"] }),
      route: {
        intent: "review",
        skills: ["codebase-intelligence", "verification-discipline", "requesting-code-review"],
        reason: "Review route requires accepted review evidence before completion.",
        source: "message",
      },
    };
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const output = { title: "Task", output: "Implemented and complete.", metadata: {} };

    await hooks["tool.execute.after"]!({ tool: "task", sessionID: "s", callID: "c", args: {} }, output);
    const persisted = loadRuntimeState(root).runtime;

    expect(output.output).toContain("EXECUTION POLICY: blocked");
    expect(output.output).toContain("FINAL REVIEW GATE");
    expect(output.output).toContain("Review route requires accepted review evidence");
    expect(persisted.activeWorkflow?.route?.intent).toBe("review");
  });

  test("tool.execute.after blocks completion when delegated work lacks accepted review", async () => {
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    let run = createWorkflowRun({ id: "wf-final", goal: "Ship final gate", acceptanceCriteria: ["tests pass"] });
    run = addWorkflowStep(run, { id: "step-1", title: "Implement", taskType: "code", expectedOutput: "code", verification: ["bun test"] });
    run = attachStepEvidence(run, "step-1", { kind: "command", command: "bun test", summary: "bun test: pass", passed: true });
    memory.activeWorkflow = updateWorkflowStepStatus(run, "step-1", "completed");
    memory.completedSummaries = [{ id: "bg-1", description: "Delegated review", reviewStatus: "pending_review", result: "delegated output" }];
    memory.activeTasks = [{ id: "bg-live" }];
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const output = { title: "Task", output: "Implemented and complete. Verification: bun test passed.", metadata: {} };

    await hooks["tool.execute.after"]!({ tool: "task", sessionID: "s", callID: "c", args: {} }, output);

    expect(output.output).toContain("FINAL REVIEW GATE");
    expect(output.output).toContain("Delegated review has not been accepted yet.");
  });

  test("bg_collect persists delegated review before final review gate runs", async () => {
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    let run = createWorkflowRun({ id: "wf-final", goal: "Ship final gate", acceptanceCriteria: ["tests pass"] });
    run = addWorkflowStep(run, { id: "step-1", title: "Implement", taskType: "code", expectedOutput: "code", verification: ["bun test"] });
    run = attachStepEvidence(run, "step-1", { kind: "command", command: "bun test", summary: "bun test: pass", passed: true });
    memory.activeWorkflow = updateWorkflowStepStatus(run, "step-1", "completed");
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");
    const promptCalls: unknown[] = [];
    const client = {
      session: {
        create: async () => ({ id: `child-${promptCalls.length + 1}` }),
        prompt: async (request: unknown) => {
          promptCalls.push(request);
          return { parts: [{ type: "text", text: "## Summary\nReviewed\n\n## Files\n- none\n\n## Verification\n- bun test passed\n\n## Risks\n- none" }] };
        },
      },
    } as any;

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, client, directory: root });
    const context = { sessionID: "s", messageID: "m", agent: "jce-worker", directory: root, worktree: root, abort: new AbortController().signal, metadata: () => {}, ask: () => {} } as any;
    const launch = await hooks.tool!.dispatch.execute({ description: "Review implementation", prompt: "Review implementation", agent: "explorer" } as any, context);
    await Promise.resolve();
    const taskId = String(launch).match(/Background task launched: (\S+)/)?.[1];
    await hooks.tool!.bg_collect.execute({ taskId } as any, context);
    const output = { title: "Task", output: "Implemented and complete. Verification: bun test passed.", metadata: {} };

    await hooks["tool.execute.after"]!({ tool: "task", sessionID: "s", callID: "c", args: {} }, output);
    const persisted = loadRuntimeState(root).runtime;

    expect(persisted.completedSummaries).toContainEqual(expect.objectContaining({ id: taskId, reviewStatus: "accepted" }));
    expect(output.output).not.toContain("Delegated work has not been accepted by review");
  });

  test("tool.execute.after translates Chinese string output with prompt request and parts response", async () => {
    const promptRequests: unknown[] = [];
    const client = {
      session: {
        create: async () => ({ id: "translation-session" }),
        prompt: async (request: unknown) => {
          promptRequests.push(request);
          return { parts: [{ type: "text", text: "Please fix this error." }] };
        },
      },
    } as any;

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, client });
    const output = { output: "请修复这个错误" } as any;

    await hooks["tool.execute.after"]!({ tool: "task", args: {} } as any, output);

    expect(promptRequests).toHaveLength(1);
    expect(promptRequests[0]).toMatchObject({
      path: { id: "translation-session" },
      body: { agent: "jce-worker", parts: [{ type: "text" }] },
    });
    const request = promptRequests[0] as any;
    expect(request.body.parts[0].text).toContain("请修复这个错误");
    expect(request.body.parts[0].text.match(/<<<CHINESE_OUTPUT_TO_TRANSLATE>>>/g)).toHaveLength(2);
    expect(output.output).toContain("Please fix this error.");
    expect(output.output).toContain("Chinese text was automatically translated to English.");
    expect(output.output).not.toContain("请修复这个错误");
  });

  test("tool.execute.after translates Chinese string output with chat fallback request shape", async () => {
    const chatRequests: unknown[] = [];
    const client = {
      session: {
        create: async () => ({ id: "translation-session" }),
        chat: async (request: unknown) => {
          chatRequests.push(request);
          return { content: "Please fix this error." };
        },
      },
    } as any;

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, client });
    const output = { output: "请修复这个错误" } as any;

    await hooks["tool.execute.after"]!({ tool: "task", args: {} } as any, output);

    expect(chatRequests).toHaveLength(1);
    expect(chatRequests[0]).toMatchObject({
      params: { id: "translation-session" },
      body: { agent: "jce-worker" },
    });
    const request = chatRequests[0] as any;
    expect(request.body.content).toContain("请修复这个错误");
    expect(request.body.content.match(/<<<CHINESE_OUTPUT_TO_TRANSLATE>>>/g)).toHaveLength(2);
    expect(output.output).toContain("Please fix this error.");
    expect(output.output).toContain("Chinese text was automatically translated to English.");
  });

  test("tool.execute.after preserves Chinese output with warning when session prompt method is unsupported", async () => {
    const client = {
      session: {
        create: async () => ({ id: "translation-session" }),
      },
    } as any;

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, client });
    const output = { output: "请修复这个错误" } as any;

    await hooks["tool.execute.after"]!({ tool: "task", args: {} } as any, output);

    expect(output.output).toContain("请修复这个错误");
    expect(output.output).toContain("Chinese text was detected, but automatic translation failed. Original output preserved.");
  });

  test("tool.execute.after preserves Chinese output with warning when translator unavailable", async () => {
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, client: {} as any });
    const output = { output: "请修复这个错误" } as any;

    await hooks["tool.execute.after"]!({ tool: "task", args: {} } as any, output);

    expect(output.output).toContain("请修复这个错误");
    expect(output.output).toContain("Chinese text was detected, but automatic translation failed. Original output preserved.");
  });

  test("tool.execute.after translates Chinese blocked completion output after final review gate text", async () => {
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    let run = createWorkflowRun({ id: "wf-chinese-final", goal: "Ship final gate", acceptanceCriteria: ["tests pass"] });
    run = addWorkflowStep(run, { id: "step-1", title: "Implement", taskType: "code", expectedOutput: "code", verification: ["bun test"] });
    memory.activeWorkflow = updateWorkflowStepStatus(run, "step-1", "completed");
    memory.activeTasks = [{ id: "bg-live" }];
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");
    const promptMessages: string[] = [];
    const client = {
      session: {
        create: async () => ({ id: "translation-session" }),
        prompt: async (request: unknown) => {
          const message = isRecord(request) && isRecord(request.body) && Array.isArray(request.body.parts) ? (request.body.parts[0] as any)?.text ?? "" : "";
          promptMessages.push(message);
          if (message.includes("已完成这个修复") && message.includes("<<<CHINESE_OUTPUT_TO_TRANSLATE>>>")) {
            if (!message.includes("FINAL REVIEW GATE")) return { text: "unexpected translation request" };
            return { text: "This fix is complete. Verification: bun test passed.\n\nFINAL REVIEW GATE: Completion is blocked.\n- Completion claim route requires fresh verification evidence before reporting done." };
          }
          return { text: "No translation requested." };
        },
      },
    } as any;

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, client, directory: root });
    const output = { output: "已完成这个修复。Implemented and complete. Verification: bun test passed." } as any;

    await hooks["tool.execute.after"]!({ tool: "task", sessionID: "s", callID: "c", args: {} }, output);

    expect(promptMessages).toHaveLength(1);
    expect(output.output).toContain("This fix is complete. Verification: bun test passed.");
    expect(output.output).toContain("FINAL REVIEW GATE");
    expect(output.output).toContain("Chinese text was automatically translated to English.");
    expect(output.output).not.toContain("已完成这个修复");
  });

  test("tool.execute.after does not translate Chinese Write or Edit output", async () => {
    const client = {
      session: {
        create: async () => ({ id: "translation-session" }),
        chat: async () => ({ text: "Please fix this error." }),
      },
    } as any;
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, client });

    for (const tool of ["write", "edit"] as const) {
      const output = { output: "请修复这个错误" } as any;
      await hooks["tool.execute.after"]!({ tool, args: {} } as any, output);
      expect(output.output).toBe("请修复这个错误");
    }
  });

  test("tool.execute.after does not translate unsafe technical or user-derived tool output", async () => {
    const client = {
      session: {
        create: async () => ({ id: "translation-session" }),
        chat: async () => ({ text: "Please fix this error." }),
      },
    } as any;
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, client });

    for (const tool of ["bash", "read", "grep", "glob", "dispatch"] as const) {
      const output = { output: "请修复这个错误" } as any;
      await hooks["tool.execute.after"]!({ tool, args: {} } as any, output);
      expect(output.output).toBe("请修复这个错误");
    }
  });

  test("event hook runs JCE-Worker monitor without throwing", async () => {
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: process.cwd() });

    await expect(hooks.event!({ event: { type: "session.idle" } } as any)).resolves.toBeUndefined();
  });

  test("event hook preserves loaded workflow runtime fields when saving memory", async () => {
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = {
      id: "wf-active",
      goal: "Active workflow",
      status: "planning",
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z",
      steps: [],
      acceptanceCriteria: [],
      evidence: [],
      retryPolicy: { maxRetries: 1 },
      completionGate: { status: "pending", reasons: [] },
    };
    memory.workflowRuns = [{
      id: "wf-completed",
      goal: "Completed workflow",
      status: "completed",
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z",
      steps: [],
      acceptanceCriteria: [],
      evidence: [],
      retryPolicy: { maxRetries: 1 },
      completionGate: { status: "passed", reasons: [] },
    }];
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    await hooks.event!({ event: { type: "session.idle" } } as any);
    const loaded = loadRuntimeState(root, "2026-05-06T00:02:00.000Z");

    expect(loaded.runtime.activeWorkflow?.id).toBe("wf-active");
    expect(loaded.runtime.workflowRuns.map((run) => run.id)).toEqual(["wf-completed"]);
  });

  test("experimental.text.complete flags unverified completion claim in final text (#3)", async () => {
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = createWorkflowRun({ id: "wf-tc", goal: "Ship feature", acceptanceCriteria: ["tests pass"] });
    memory.activeTasks = [{ id: "bg-live" }];
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const out = { text: "The fix is complete." };
    await hooks["experimental.text.complete"]!({ sessionID: "s", messageID: "m", partID: "p" } as any, out);
    expect(out.text).toContain("FINAL REVIEW GATE");
    expect(out.text).toContain("Workflow requires at least one verification evidence item before completion.");
  });

  test("experimental.text.complete appends final review gate for blocked completion claim", async () => {
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    let run = createWorkflowRun({ id: "wf-tc-blocked", goal: "Ship feature", acceptanceCriteria: ["tests pass"] });
    run = addWorkflowStep(run, { id: "step-1", title: "Implement", taskType: "code", expectedOutput: "code", verification: ["bun test"] });
    memory.activeWorkflow = updateWorkflowStepStatus(run, "step-1", "completed");
    memory.activeTasks = [{ id: "bg-live" }];
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const out = { text: "The fix is complete." };
    await hooks["experimental.text.complete"]!({ sessionID: "s", messageID: "m", partID: "p" } as any, out);
    expect(out.text).toContain("FINAL REVIEW GATE");
    expect(out.text).toMatch(/passing relevant command evidence|Completion claim route requires fresh verification evidence/);
  });

  test("experimental.text.complete does NOT flag verified claims or questions (#3)", async () => {
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = createWorkflowRun({ id: "wf-tc2", goal: "Ship feature", acceptanceCriteria: ["tests pass"] });
    memory.activeTasks = [{ id: "bg-live" }];
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });

    const verified = { text: "The fix is complete. Verification: bun test passed." };
    await hooks["experimental.text.complete"]!({ sessionID: "s", messageID: "m", partID: "p" } as any, verified);
    expect(verified.text).not.toContain("VERIFICATION CHECK");

    const question = { text: "Is the implementation complete?" };
    await hooks["experimental.text.complete"]!({ sessionID: "s", messageID: "m", partID: "p2" } as any, question);
    expect(question.text).not.toContain("VERIFICATION CHECK");
  });

  test("experimental.text.complete stays silent when no active workflow (#3)", async () => {
    const root = tempRoot();
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const out = { text: "The fix is complete." };
    await hooks["experimental.text.complete"]!({ sessionID: "s", messageID: "m", partID: "p" } as any, out);
    expect(out.text).not.toContain("VERIFICATION CHECK");
  });

  test("chat.message persists continue-until-done mode in runtime state", async () => {
    const root = tempRoot();
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root, worktree: root });

    await hooks["chat.message"]!({} as any, { message: "continue until done", parts: [{ type: "text", text: "continue until done" }] } as any);

    const loaded = loadRuntimeState(root, "2026-05-06T00:02:00.000Z");
    expect(loaded.runtime.autonomousExecutionSession?.continueUntilDone).toBe(true);
    expect(loaded.runtime.autonomousExecutionSession?.reason).toContain("continue until done");
  });

  test("auto-planning records planner explain trace event", async () => {
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.activeTasks = [{ id: "bg-live" }];
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root, worktree: root });

    await hooks["chat.message"]!({} as any, {
      message: "Implement across app:\n1. login flow\n2. settings page\n3. admin audit log\nThen verify all integration points.",
      parts: [{ type: "text", text: "Implement across app:\n1. login flow\n2. settings page\n3. admin audit log\nThen verify all integration points." }],
    } as any);

    const loaded = loadRuntimeState(root, "2026-05-06T00:02:00.000Z");
    const plannerTrace = loaded.runtime.traceEvents.find((event) => event.type === "planner.explain");
    expect(plannerTrace).toBeDefined();
    expect(plannerTrace?.message).toMatch(/Planner fan-out created|Planner kept linear plan/);
  });

  test("system.transform re-injects restored project memory on a new top-level session", async () => {
    const root = tempRoot();
    // Seed durable restorable memory (needs a high-value signal like wisdom).
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.changedFiles = ["src/app.ts", "src/server.ts"];
    memory.wisdom = [{ id: "w1", learning: "use bun test", source: "task", createdAt: "2026-05-06T00:00:00.000Z" }];
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root, worktree: root });

    // First top-level session: memory injects from the process-init snapshot.
    const out1 = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]!({ sessionID: "s1" } as any, out1 as any);
    expect(out1.system.join("\n")).toContain("Restored Project Memory");

    // Same session again: must NOT re-inject (once-per-session latch holds).
    const out1b = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]!({ sessionID: "s1" } as any, out1b as any);
    expect(out1b.system.join("\n")).not.toContain("Restored Project Memory");

    // New top-level session: rehydrates from disk and re-injects memory.
    const out2 = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]!({ sessionID: "s2" } as any, out2 as any);
    expect(out2.system.join("\n")).toContain("Restored Project Memory");
  });

  test("child sub-agent session.created does not reset parent memory injection", async () => {
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.changedFiles = ["src/app.ts"];
    memory.wisdom = [{ id: "w1", learning: "use bun test", source: "task", createdAt: "2026-05-06T00:00:00.000Z" }];
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root, worktree: root });

    // Establish the parent top-level session and consume its injection.
    const out1 = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]!({ sessionID: "parent" } as any, out1 as any);
    expect(out1.system.join("\n")).toContain("Restored Project Memory");

    // A sub-agent child session is created (carries parentID) — must be ignored.
    await hooks.event!({ event: { type: "session.created", properties: { info: { id: "child", parentID: "parent" } } } } as any);

    // Parent session keeps its latch: no spurious re-injection on the same id.
    const out2 = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]!({ sessionID: "parent" } as any, out2 as any);
    expect(out2.system.join("\n")).not.toContain("Restored Project Memory");
  });

  test("session.created event re-arms project memory injection for a new top-level session", async () => {
    const root = tempRoot();
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.changedFiles = ["src/app.ts"];
    memory.wisdom = [{ id: "w1", learning: "use bun test", source: "task", createdAt: "2026-05-06T00:00:00.000Z" }];
    saveRuntimeState(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root, worktree: root });

    // First session consumes the injection.
    const out1 = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]!({ sessionID: "s1" } as any, out1 as any);
    expect(out1.system.join("\n")).toContain("Restored Project Memory");

    // A genuine new top-level session is created via the event hook.
    await hooks.event!({ event: { type: "session.created", properties: { info: { id: "s2" } } } } as any);

    // The next system.transform for that new session re-injects memory.
    const out2 = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]!({ sessionID: "s2" } as any, out2 as any);
    expect(out2.system.join("\n")).toContain("Restored Project Memory");
  });
});
