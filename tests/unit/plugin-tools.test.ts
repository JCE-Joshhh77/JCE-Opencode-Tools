import { describe, expect, test } from "bun:test";
import { buildDispatchTool, buildStatusTool, buildCollectTool } from "../../src/plugin/tools/dispatch.ts";
import { BackgroundManager } from "../../src/plugin/background/manager.ts";

describe("plugin tools", () => {
  test("dispatch tool has description and args", () => {
    const manager = new BackgroundManager({ maxConcurrency: 3 });
    const tool = buildDispatchTool(manager, {} as any);
    expect(tool.description).toContain("background");
    expect(tool.args).toBeDefined();
  });

  test("status tool returns formatted task list", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3 });
    manager.createTask({
      description: "Find endpoints",
      prompt: "p",
      agent: "explorer",
      parentSessionId: "s",
      parentMessageId: "m",
    });
    const tool = buildStatusTool(manager);
    const result = await tool.execute({} as any, {
      sessionID: "s",
      messageID: "m",
      agent: "explorer",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: () => { throw new Error("not implemented"); },
    } as any);
    expect(result).toContain("Find endpoints");
    expect(result).toContain("PENDING");
    expect(result).toContain("explorer");
    expect(result).toContain("budget: pending");
  });

  test("status tool includes context budget savings when available", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3 });
    const task = manager.createTask({
      description: "Find endpoints",
      prompt: "p",
      agent: "explorer",
      parentSessionId: "s",
      parentMessageId: "m",
    });
    manager.recordContextBudget(task.id, { originalChars: 100, compressedChars: 70, estimatedTokensSaved: 8, estimatedSavingsPercent: 30, changed: true });
    const tool = buildStatusTool(manager);
    const result = await tool.execute({} as any, {
      sessionID: "s",
      messageID: "m",
      agent: "explorer",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: () => { throw new Error("not implemented"); },
    } as any);

    expect(result).toContain("budget: ~8 token(s) saved");
  });

  test("dispatch tool wraps prompt with delegated result contract", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3 });
    const tool = buildDispatchTool(manager, {
      session: {
        create: async () => ({ id: "child-session" }),
        chat: async () => {},
      },
    } as any);

    await tool.execute(
      { description: "Check plugin", prompt: "Inspect plugin behavior", agent: "explorer" } as any,
      {
        sessionID: "s",
        messageID: "m",
        agent: "jce-worker",
        directory: "/tmp",
        worktree: "/tmp",
        abort: new AbortController().signal,
        metadata: () => {},
        ask: () => { throw new Error("not implemented"); },
      } as any,
    );

    const task = manager.listTasks()[0];
    expect(task.prompt).toContain("## 1. TASK");
    expect(task.prompt).toContain("## 6. CONTEXT");
    expect(task.prompt).toContain("## Output Contract");
    expect(task.prompt).toContain("## Summary");
    expect(task.prompt).toContain("## Verification");
    expect(task.logicalState).toBe("delegating");
  });

  test("status tool includes review state when available", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3 });
    const task = manager.createTask({
      description: "Find endpoints",
      prompt: "p",
      agent: "explorer",
      parentSessionId: "s",
      parentMessageId: "m",
    });
    manager.markReview(task.id, "needs_followup", ["Verification"]);
    const tool = buildStatusTool(manager);
    const result = await tool.execute({} as any, {
      sessionID: "s",
      messageID: "m",
      agent: "explorer",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: () => { throw new Error("not implemented"); },
    } as any);
    expect(result).toContain("needs_followup");
    expect(result).toContain("Verification");
  });

  test("status tool includes stale and retry metadata", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T01:00:00.000Z" } as any);
    const task = manager.createTask({
      description: "Find endpoints",
      prompt: "p",
      agent: "explorer",
      parentSessionId: "s",
      parentMessageId: "m",
    });
    task.lastActivityAt = "2026-05-06T00:00:00.000Z";
    manager.markStaleTasks(30 * 60 * 1000);
    manager.recordRetryableFailure(task.id, "Network timeout");

    const tool = buildStatusTool(manager);
    const result = await tool.execute({} as any, {
      sessionID: "s",
      messageID: "m",
      agent: "explorer",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: () => { throw new Error("not implemented"); },
    } as any);

    expect(result).toContain("stale: true");
    expect(result).toContain("retries: 0/1");
    expect(result).toContain("retry budget available: 1");
    expect(result).not.toContain("recovery retries: 1/1");
    expect(result).toContain("Network timeout");
  });

  test("collect tool classifies blocked delegated output", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3 });
    const task = manager.createTask({
      description: "test",
      prompt: "p",
      agent: "explorer",
      parentSessionId: "s",
      parentMessageId: "m",
    });
    manager.completeTask(task.id, "## Summary\nBlocked\n\n## Files\n- none\n\n## Verification\n- not run\n\n## Risks\n- missing credentials\n\nBlocked: missing credentials");

    const tool = buildCollectTool(manager);
    const result = await tool.execute({ taskId: task.id } as any, {
      sessionID: "s",
      messageID: "m",
      agent: "explorer",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: () => { throw new Error("not implemented"); },
    } as any);

    expect(result).toContain("Review: blocked");
    expect(result).toContain("## Status");
    expect(result).toContain("## Blocker");
  });

  test("collect tool translates Chinese completed output", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3 });
    const task = manager.createTask({
      description: "test",
      prompt: "p",
      agent: "explorer",
      parentSessionId: "s",
      parentMessageId: "m",
    });
    manager.completeTask(task.id, "## Summary\n请修复这个错误\n\n## Files\n- none\n\n## Verification\n- not run\n\n## Risks\n- none");

    const tool = buildCollectTool(manager, undefined, undefined, async (prompt) => {
      expect(prompt).toContain("请修复这个错误");
      return "## Summary\nPlease fix this error.\n\n## Files\n- none\n\n## Verification\n- not run\n\n## Risks\n- none";
    });
    const result = await tool.execute({ taskId: task.id } as any, {
      sessionID: "s",
      messageID: "m",
      agent: "explorer",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: () => { throw new Error("not implemented"); },
    } as any);

    expect(result).toContain("Please fix this error.");
    expect(result).toContain("Chinese text was automatically translated to English.");
    expect(result).not.toContain("<<<CHINESE_OUTPUT_TO_TRANSLATE>>>");
    expect(result).not.toContain("请修复这个错误");
  });

  test("collect tool preserves Chinese output with warning when translation fails", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3 });
    const task = manager.createTask({
      description: "test",
      prompt: "p",
      agent: "explorer",
      parentSessionId: "s",
      parentMessageId: "m",
    });
    manager.completeTask(task.id, "## Summary\n请修复这个错误\n\n## Files\n- none\n\n## Verification\n- not run\n\n## Risks\n- none");

    const tool = buildCollectTool(manager, undefined, undefined, async () => {
      throw new Error("translator unavailable");
    });
    const result = await tool.execute({ taskId: task.id } as any, {
      sessionID: "s",
      messageID: "m",
      agent: "explorer",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: () => { throw new Error("not implemented"); },
    } as any);

    expect(result).toContain("请修复这个错误");
    expect(result).toContain("Chinese text was detected, but automatic translation failed. Original output preserved.");
  });

  test("status tool returns empty message when no tasks", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3 });
    const tool = buildStatusTool(manager);
    const result = await tool.execute({} as any, {
      sessionID: "s",
      messageID: "m",
      agent: "explorer",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: () => { throw new Error("not implemented"); },
    } as any);
    expect(result).toBe("No background tasks.");
  });

  test("collect tool returns result for completed task", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3 });
    const task = manager.createTask({
      description: "test",
      prompt: "p",
      agent: "explorer",
      parentSessionId: "s",
      parentMessageId: "m",
    });
    manager.completeTask(task.id, "Found 5 API endpoints");
    const tool = buildCollectTool(manager);
    const result = await tool.execute({ taskId: task.id } as any, {
      sessionID: "s",
      messageID: "m",
      agent: "explorer",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: () => { throw new Error("not implemented"); },
    } as any);
    expect(result).toContain("Found 5 API endpoints");
    expect(result).toContain("Recovery: retry scheduled");
  });

  test("collect tool reports pending status", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3 });
    const task = manager.createTask({
      description: "test",
      prompt: "p",
      agent: "explorer",
      parentSessionId: "s",
      parentMessageId: "m",
    });
    const tool = buildCollectTool(manager);
    const result = await tool.execute({ taskId: task.id } as any, {
      sessionID: "s",
      messageID: "m",
      agent: "explorer",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: () => { throw new Error("not implemented"); },
    } as any);
    expect(result).toContain("still pending");
  });

  test("collect tool reports error", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3 });
    const task = manager.createTask({
      description: "test",
      prompt: "p",
      agent: "explorer",
      parentSessionId: "s",
      parentMessageId: "m",
    });
    manager.failTask(task.id, "Network timeout");
    const tool = buildCollectTool(manager);
    const result = await tool.execute({ taskId: task.id } as any, {
      sessionID: "s",
      messageID: "m",
      agent: "explorer",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: () => { throw new Error("not implemented"); },
    } as any);
    expect(result).toContain("failed");
    expect(result).toContain("Network timeout");
  });

  test("collect tool records delegation savings on completed task", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3 });
    // Create a task with a substantial prompt (simulating a real delegation envelope)
    const longPrompt = "## 1. TASK\nInvestigate the authentication flow.\n\n## 2. CONTEXT\n" + "Background context line for the sub-agent.\n".repeat(20);
    const task = manager.createTask({
      description: "Investigate auth",
      prompt: longPrompt,
      agent: "oracle",
      parentSessionId: "s",
      parentMessageId: "m",
    });
    // Complete with a well-formed result (accepted review)
    manager.completeTask(task.id, "## Summary\nAuth uses JWT tokens.\n\n## Files\n- src/auth.ts\n\n## Verification\n- Confirmed via code read\n\n## Risks\n- none");

    const tool = buildCollectTool(manager);
    await tool.execute({ taskId: task.id } as any, {
      sessionID: "s",
      messageID: "m",
      agent: "jce-worker",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: () => { throw new Error("not implemented"); },
    } as any);

    // Delegation savings should be recorded: prompt was offloaded to sub-agent context
    const collected = manager.getTask(task.id)!;
    expect(collected.contextBudget).toBeDefined();
    expect(collected.contextBudget!.estimatedTokensSaved).toBeGreaterThan(0);
    expect(collected.contextBudget!.originalChars).toBeGreaterThan(collected.contextBudget!.compressedChars);

    // Execution memory should reflect the savings
    const memory = manager.toExecutionMemory();
    expect(memory.contextBudgetSummary).toBeDefined();
    expect(memory.contextBudgetSummary!.estimatedTokensSaved).toBeGreaterThan(0);
    expect(memory.contextBudgetSummary!.tasks).toBe(1);
    expect(memory.contextBudgetSummary!.byTool?.bg_collect?.tasks).toBe(1);
  });

  test("collect tool records learning for accepted delegated evidence", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T00:00:00.000Z" });
    const task = manager.createTask({ description: "Review release", prompt: "review", agent: "explorer", parentSessionId: "s", parentMessageId: "m" });
    manager.completeTask(task.id, "## Summary\nLooks good.\n\n## Files\n- package.json\n\n## Verification\n- bun test passed\n\n## Risks\n- none");

    const tool = buildCollectTool(manager);
    const result = await tool.execute({ taskId: task.id } as any, {} as any);
    const memory = manager.toExecutionMemory();

    expect(String(result)).toContain("Evidence score: strong");
    expect(memory.wisdom[0].learning).toContain("Accepted explorer delegation");
    expect(memory.taskLearnings[0].trigger).toBe("Review release");
  });

  test("collect tool requests follow-up when delegated verification says not run", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3 });
    const task = manager.createTask({ description: "Review weak evidence", prompt: "review", agent: "explorer", parentSessionId: "s", parentMessageId: "m" });
    manager.completeTask(task.id, "## Summary\nDone.\n\n## Files\n- none\n\n## Verification\n- not run\n\n## Risks\n- none");

    const tool = buildCollectTool(manager);
    const result = await tool.execute({ taskId: task.id } as any, {} as any);

    expect(String(result)).toContain("Recovery:");
    expect(String(result)).toContain("strong Verification evidence");
  });
});
