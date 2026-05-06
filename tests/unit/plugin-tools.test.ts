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
    expect(task.prompt).toContain("## Goal");
    expect(task.prompt).toContain("## Scope");
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
});
