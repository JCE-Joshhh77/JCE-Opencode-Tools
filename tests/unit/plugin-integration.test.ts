import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createEmptyExecutionMemory, loadExecutionMemory, saveExecutionMemory } from "../../src/plugin/lib/execution-memory.ts";
import { saveSessionPolicyProfile } from "../../src/plugin/lib/policy-profile.ts";
import { addWorkflowStep, attachStepEvidence, createWorkflowRun, updateWorkflowStepStatus } from "../../src/plugin/lib/workflow.ts";

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

    expect(collect).toContain("Recovery: retry scheduled");
    expect(promptCalls).toHaveLength(2);
    expect(promptCalls[1]).toMatchObject({
      path: { id: "child-2" },
      body: { agent: "explorer", parts: [{ type: "text" }] },
    });
  });

  test("dispatch persists task route with parallel agent hint", async () => {
    const root = tempRoot();
    const memory = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = createWorkflowRun({ id: "wf-route", goal: "Coordinate background work" });
    saveExecutionMemory(root, memory, "2026-05-06T00:01:00.000Z");
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
    const persisted = loadExecutionMemory(root).memory;

    expect(persisted.activeWorkflow?.route).toMatchObject({
      intent: "parallel_work",
      skills: ["dispatching-parallel-agents"],
      agentHint: "explorer",
      source: "task",
    });
  });

  test("dispatch output after hook preserves task route source for same intent", async () => {
    const root = tempRoot();
    const memory = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = createWorkflowRun({ id: "wf-route", goal: "Coordinate background work" });
    saveExecutionMemory(root, memory, "2026-05-06T00:01:00.000Z");
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
    const persisted = loadExecutionMemory(root).memory;

    expect(persisted.activeWorkflow?.route).toMatchObject({
      intent: "parallel_work",
      skills: ["dispatching-parallel-agents"],
      agentHint: "explorer",
      source: "task",
    });
  });

  test("dispatch policy warns on balanced agent mismatch", async () => {
    const root = tempRoot();
    const memory = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = createWorkflowRun({ id: "wf-policy", goal: "Coordinate parallel work" });
    saveExecutionMemory(root, memory, "2026-05-06T00:01:00.000Z");
    const client = { session: { create: async () => ({ id: "child-1" }), prompt: async () => ({ parts: [{ type: "text", text: "## Summary\nDone\n\n## Files\n- none\n\n## Verification\n- not run\n\n## Risks\n- none" }] }) } } as any;

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, client, directory: root });
    const context = { sessionID: "s", messageID: "m", agent: "jce-worker", directory: root, worktree: root, abort: new AbortController().signal, metadata: () => {}, ask: () => {} } as any;

    const result = await hooks.tool!.dispatch.execute({ description: "Run independent research tasks in parallel", prompt: "Use independent checks concurrently", agent: "jce-researcher" } as any, context);

    expect(String(result)).toContain("EXECUTION POLICY: warning");
    expect(String(result)).toContain("Dispatch agent jce-researcher does not match route hint explorer.");
  });

  test("dispatch policy blocks strict agent mismatch", async () => {
    const root = tempRoot();
    saveSessionPolicyProfile(root, "strict");
    const memory = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = createWorkflowRun({ id: "wf-policy", goal: "Coordinate parallel work" });
    saveExecutionMemory(root, memory, "2026-05-06T00:01:00.000Z");
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

    const result = await hooks.tool!.dispatch.execute({ description: "Run independent research tasks in parallel", prompt: "Use independent checks concurrently", agent: "jce-researcher" } as any, context);
    const status = await hooks.tool!.bg_status.execute({} as any, context);

    expect(String(result)).toContain("EXECUTION POLICY: blocked");
    expect(String(result)).not.toContain("Background task launched");
    expect(createCalls).toBe(0);
    expect(promptCalls).toBe(0);
    expect(status).toBe("No background tasks.");
  });

  test("config hook injects 5 agents", async () => {
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server(mockInput);

    const config: any = { agent: {} };
    await hooks.config!(config);
    expect(Object.keys(config.agent)).toHaveLength(5);
    expect(config.agent["jce-worker"]).toBeDefined();
    expect(config.agent.oracle).toBeDefined();
    expect(config.agent["jce-researcher"]).toBeDefined();
    expect(config.agent.explorer).toBeDefined();
    expect(config.agent.frontend).toBeDefined();
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
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server(mockInput);

    const config: any = {};
    await hooks.config!(config);
    expect(Object.keys(config.agent)).toHaveLength(5);
  });

  test("tool.execute.after appends warning for excessive comments", async () => {
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server(mockInput);

    const input = { tool: "Write", sessionID: "s", callID: "c", args: { filePath: "test.ts" } };
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

    const input = { tool: "Write", sessionID: "s", callID: "c", args: { filePath: "test.ts" } };
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

    const input = { tool: "Task", sessionID: "s", callID: "c", args: {} };
    const output = {
      title: "Task",
      output: "Implemented the change and it is complete.",
      metadata: {},
    };
    await hooks["tool.execute.after"]!(input, output);
    expect(output.output).toContain("verification");
  });

  test("tool.execute.after appends final review gate warning for blocked active workflow completion", async () => {
    const root = tempRoot();
    const memory = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
    let run = createWorkflowRun({ id: "wf-final", goal: "Ship final gate", acceptanceCriteria: ["tests pass"] });
    run = addWorkflowStep(run, { id: "step-1", title: "Implement", taskType: "code", expectedOutput: "code", verification: ["bun test"] });
    memory.activeWorkflow = updateWorkflowStepStatus(run, "step-1", "completed");
    saveExecutionMemory(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const input = { tool: "Task", sessionID: "s", callID: "c", args: {} };
    const output = { title: "Task", output: "Implemented and complete.", metadata: {} };

    await hooks["tool.execute.after"]!(input, output);

    expect(output.output).toContain("FINAL REVIEW GATE");
    expect(output.output).toMatch(/passing relevant command evidence|Completion certificate is not valid/);
  });

  test("tool.execute.after uses session policy profile for final review gate", async () => {
    const root = tempRoot();
    saveSessionPolicyProfile(root, "strict");
    const memory = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
    let run = createWorkflowRun({ id: "wf-final", goal: "Research", acceptanceCriteria: ["source reviewed"] });
    run = addWorkflowStep(run, { id: "step-1", title: "Research", taskType: "research", expectedOutput: "notes", verification: ["manual source review"] });
    run = attachStepEvidence(run, "step-1", { kind: "manual", summary: "manual review", passed: true });
    memory.activeWorkflow = updateWorkflowStepStatus(run, "step-1", "completed");
    saveExecutionMemory(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const output = { title: "Task", output: "Finished and complete. Verification: manual review passed.", metadata: {} };

    await hooks["tool.execute.after"]!({ tool: "Task", sessionID: "s", callID: "c", args: {} }, output);

    expect(output.output).toContain("FINAL REVIEW GATE");
    expect(output.output).toContain("requires source, file, or review evidence for research");
  });

  test("tool.execute.after does not append final review gate warning for verified active workflow completion", async () => {
    const root = tempRoot();
    const memory = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
    let run = createWorkflowRun({ id: "wf-final", goal: "Ship final gate", acceptanceCriteria: ["tests pass"] });
    run = addWorkflowStep(run, { id: "step-1", title: "Implement", taskType: "code", expectedOutput: "code", verification: ["bun test"] });
    run = attachStepEvidence(run, "step-1", { kind: "command", command: "bun test", summary: "bun test: pass", passed: true });
    memory.activeWorkflow = updateWorkflowStepStatus(run, "step-1", "completed");
    saveExecutionMemory(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const input = { tool: "Task", sessionID: "s", callID: "c", args: {} };
    const output = { title: "Task", output: "Implemented and complete. Verification: bun test passed.", metadata: {} };

    await hooks["tool.execute.after"]!(input, output);

    expect(output.output).not.toContain("FINAL REVIEW GATE");
  });

  test("tool.execute.after persists completion claim route on active workflow", async () => {
    const root = tempRoot();
    const memory = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = createWorkflowRun({ id: "wf-route", goal: "Complete routed workflow", acceptanceCriteria: ["tests pass"] });
    saveExecutionMemory(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const output = { title: "Task", output: "Implemented and complete.", metadata: {} };

    await hooks["tool.execute.after"]!({ tool: "Task", sessionID: "s", callID: "c", args: {} }, output);
    const persisted = loadExecutionMemory(root).memory;

    expect(persisted.activeWorkflow?.route).toMatchObject({
      intent: "completion_claim",
      skills: ["verification-before-completion"],
      source: "completion",
    });
    expect(output.output).toContain("FINAL REVIEW GATE");
  });

  test("tool.execute.after does not overwrite specific route with general text", async () => {
    const root = tempRoot();
    const memory = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = {
      ...createWorkflowRun({ id: "wf-route", goal: "Fix routed workflow" }),
      route: {
        intent: "bugfix",
        skills: ["systematic-debugging", "test-driven-development"],
        reason: "Detected bug or failing test intent.",
        source: "message",
      },
    };
    saveExecutionMemory(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const output = { title: "Task", output: "Here is a neutral progress update.", metadata: {} };

    await hooks["tool.execute.after"]!({ tool: "Task", sessionID: "s", callID: "c", args: {} }, output);
    const persisted = loadExecutionMemory(root).memory;

    expect(persisted.activeWorkflow?.route?.intent).toBe("bugfix");
  });

  test("tool.execute.after policy blocks generic route overwrite", async () => {
    const root = tempRoot();
    const memory = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = {
      ...createWorkflowRun({ id: "wf-policy", goal: "Preserve route" }),
      route: {
        intent: "bugfix",
        skills: ["systematic-debugging", "test-driven-development"],
        reason: "Detected bug or failing test intent.",
        source: "message",
      },
    };
    saveExecutionMemory(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const output = { title: "Task", output: "Here is a neutral progress update.", metadata: {} };

    await hooks["tool.execute.after"]!({ tool: "Task", sessionID: "s", callID: "c", args: {} }, output);
    const persisted = loadExecutionMemory(root).memory;

    expect(persisted.activeWorkflow?.route?.intent).toBe("bugfix");
    expect(output.output).not.toContain("EXECUTION POLICY: blocked");
  });

  test("completion claim policy appends execution policy block when evidence is missing", async () => {
    const root = tempRoot();
    const memory = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
    let run = createWorkflowRun({ id: "wf-policy", goal: "Complete safely", acceptanceCriteria: ["tests pass"] });
    run = addWorkflowStep(run, { id: "step-1", title: "Implement", taskType: "code", expectedOutput: "code", verification: ["bun test"] });
    memory.activeWorkflow = updateWorkflowStepStatus(run, "step-1", "completed");
    saveExecutionMemory(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const output = { title: "Task", output: "Implemented and complete.", metadata: {} };

    await hooks["tool.execute.after"]!({ tool: "Task", sessionID: "s", callID: "c", args: {} }, output);

    expect(output.output).toContain("EXECUTION POLICY: blocked");
    expect(output.output).toContain("Completion claim route requires fresh verification evidence before reporting done.");
    expect(output.output).toContain("FINAL REVIEW GATE");
  });

  test("completion claim output includes task-type verification policy block", async () => {
    const root = tempRoot();
    const memory = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
    let run = createWorkflowRun({ id: "wf-policy", goal: "Complete docs update", acceptanceCriteria: ["docs updated"] });
    run = addWorkflowStep(run, { id: "step-docs", title: "Update docs", taskType: "docs", expectedOutput: "docs", verification: ["review docs"] });
    run = attachStepEvidence(run, "step-docs", { kind: "command", command: "bun test", summary: "bun test: pass", passed: true });
    run = updateWorkflowStepStatus(run, "step-docs", "completed");
    memory.activeWorkflow = run;
    saveExecutionMemory(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const output = { title: "Task", output: "Documentation update complete.", metadata: {} };

    await hooks["tool.execute.after"]!({ tool: "Task", sessionID: "s", callID: "c", args: {} }, output);

    expect(output.output).toContain("EXECUTION POLICY: blocked");
    expect(output.output).toContain("completion.task_type_verification.required");
    expect(output.output).toContain("Step step-docs requires file or review evidence for docs changes.");
    expect(output.output).toContain("FINAL REVIEW GATE");
  });

  test("completion claim does not overwrite review route without accepted review evidence", async () => {
    const root = tempRoot();
    const memory = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = {
      ...createWorkflowRun({ id: "wf-policy", goal: "Complete reviewed work", acceptanceCriteria: ["review accepted"] }),
      route: {
        intent: "review",
        skills: ["requesting-code-review"],
        reason: "Review route requires accepted review evidence before completion.",
        source: "message",
      },
    };
    saveExecutionMemory(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const output = { title: "Task", output: "Implemented and complete.", metadata: {} };

    await hooks["tool.execute.after"]!({ tool: "Task", sessionID: "s", callID: "c", args: {} }, output);
    const persisted = loadExecutionMemory(root).memory;

    expect(output.output).toContain("EXECUTION POLICY: blocked");
    expect(output.output).toContain("Review route requires accepted review evidence before completion.");
    expect(output.output).toContain("FINAL REVIEW GATE");
    expect(persisted.activeWorkflow?.route?.intent).toBe("review");
  });

  test("tool.execute.after blocks completion when delegated work lacks accepted review", async () => {
    const root = tempRoot();
    const memory = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
    let run = createWorkflowRun({ id: "wf-final", goal: "Ship final gate", acceptanceCriteria: ["tests pass"] });
    run = addWorkflowStep(run, { id: "step-1", title: "Implement", taskType: "code", expectedOutput: "code", verification: ["bun test"] });
    run = attachStepEvidence(run, "step-1", { kind: "command", command: "bun test", summary: "bun test: pass", passed: true });
    memory.activeWorkflow = updateWorkflowStepStatus(run, "step-1", "completed");
    memory.completedSummaries = [{ id: "bg-1", description: "Delegated review", reviewStatus: "pending_review", result: "delegated output" }];
    saveExecutionMemory(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    const output = { title: "Task", output: "Implemented and complete. Verification: bun test passed.", metadata: {} };

    await hooks["tool.execute.after"]!({ tool: "Task", sessionID: "s", callID: "c", args: {} }, output);

    expect(output.output).toContain("FINAL REVIEW GATE");
    expect(output.output).toContain("Delegated review has not been accepted yet.");
  });

  test("bg_collect persists delegated review before final review gate runs", async () => {
    const root = tempRoot();
    const memory = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
    let run = createWorkflowRun({ id: "wf-final", goal: "Ship final gate", acceptanceCriteria: ["tests pass"] });
    run = addWorkflowStep(run, { id: "step-1", title: "Implement", taskType: "code", expectedOutput: "code", verification: ["bun test"] });
    run = attachStepEvidence(run, "step-1", { kind: "command", command: "bun test", summary: "bun test: pass", passed: true });
    memory.activeWorkflow = updateWorkflowStepStatus(run, "step-1", "completed");
    saveExecutionMemory(root, memory, "2026-05-06T00:01:00.000Z");
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

    await hooks["tool.execute.after"]!({ tool: "Task", sessionID: "s", callID: "c", args: {} }, output);
    const persisted = loadExecutionMemory(root).memory;

    expect(persisted.completedSummaries).toContainEqual(expect.objectContaining({ id: taskId, reviewStatus: "accepted" }));
    expect(output.output).not.toContain("Delegated work has not been accepted by review");
  });

  test("event hook runs JCE-Worker monitor without throwing", async () => {
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: process.cwd() });

    await expect(hooks.event!({ event: { type: "session.idle" } } as any)).resolves.toBeUndefined();
  });

  test("event hook preserves loaded workflow runtime fields when saving memory", async () => {
    const root = tempRoot();
    const memory = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
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
    saveExecutionMemory(root, memory, "2026-05-06T00:01:00.000Z");

    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server({ ...mockInput, directory: root });
    await hooks.event!({ event: { type: "session.idle" } } as any);
    const loaded = loadExecutionMemory(root, "2026-05-06T00:02:00.000Z");

    expect(loaded.memory.activeWorkflow?.id).toBe("wf-active");
    expect(loaded.memory.workflowRuns.map((run) => run.id)).toEqual(["wf-completed"]);
  });
});
