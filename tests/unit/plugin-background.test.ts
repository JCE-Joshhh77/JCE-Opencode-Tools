import { describe, expect, test } from "bun:test";
import { BackgroundManager } from "../../src/plugin/background/manager.ts";
import { extractPromptText, spawnBackgroundTask } from "../../src/plugin/background/spawner.ts";

describe("background manager reliability metadata", () => {
  test("initializes retry, stale, activity, and trace metadata", () => {
    const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T00:00:00.000Z" } as any);
    const task = manager.createTask({
      description: "Check plugin",
      prompt: "p",
      agent: "explorer",
      parentSessionId: "s",
      parentMessageId: "m",
    });

    expect(task.retryCount).toBe(0);
    expect(task.maxRetries).toBe(1);
    expect(task.stale).toBe(false);
    expect(task.lastActivityAt).toBe("2026-05-06T00:00:00.000Z");
    expect(manager.getTraceEvents().map((event) => event.type)).toContain("task.created");
  });

  test("marks old pending tasks stale", () => {
    const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T01:00:00.000Z" } as any);
    const task = manager.createTask({
      description: "Check plugin",
      prompt: "p",
      agent: "explorer",
      parentSessionId: "s",
      parentMessageId: "m",
    });
    task.lastActivityAt = "2026-05-06T00:00:00.000Z";

    const stale = manager.markStaleTasks(30 * 60 * 1000);

    expect(stale.map((item) => item.id)).toContain(task.id);
    expect(manager.getTask(task.id)!.stale).toBe(true);
    expect(manager.getTraceEvents().map((event) => event.type)).toContain("task.stale_detected");
  });

  test("records retryable failures until retry limit is exhausted", () => {
    const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T00:00:00.000Z" } as any);
    const task = manager.createTask({
      description: "Check plugin",
      prompt: "p",
      agent: "explorer",
      parentSessionId: "s",
      parentMessageId: "m",
    });

    const first = manager.recordRetryableFailure(task.id, "Network timeout");
    expect(first).toBe(true);
    expect(task.retryCount).toBe(0);
    expect(task.reviewStatus).toBe("retryable_failure");

    task.retryCount = task.maxRetries;
    const second = manager.recordRetryableFailure(task.id, "Network timeout again");

    expect(second).toBe(false);
    expect(manager.getTask(task.id)!.retryCount).toBe(1);
    expect(manager.getTask(task.id)!.reviewStatus).toBe("blocked");
    expect(manager.getTask(task.id)!.failureReason).toContain("Network timeout again");
  });

  test("creates bounded memory snapshots", () => {
    const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T00:00:00.000Z" } as any);
    const task = manager.createTask({
      description: "Check plugin",
      prompt: "p",
      agent: "explorer",
      parentSessionId: "s",
      parentMessageId: "m",
    });
    manager.completeTask(task.id, "## Summary\nDone\n\n## Files\n- none\n\n## Verification\n- not run\n\n## Risks\n- none");

    const memory = manager.toExecutionMemory("2026-05-06T00:01:00.000Z");

    expect(memory.completedSummaries.length).toBe(1);
    expect(memory.traceEvents.length).toBeGreaterThan(0);
    expect(memory.workflowRuns).toEqual([]);
  });

  test("spawner stores text returned from child chat", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T00:00:00.000Z" } as any);
    const delegatedOutput = "## Summary\nDone\n\n## Files\n- none\n\n## Verification\n- not run\n\n## Risks\n- none";
    const client = {
      session: {
        create: async () => ({ id: "child-session" }),
        chat: async () => delegatedOutput,
      },
    } as any;

    const taskId = await spawnBackgroundTask(manager, client, {
      description: "Check plugin",
      prompt: "p",
      agent: "explorer",
      parentSessionId: "s",
      parentMessageId: "m",
    });
    await Promise.resolve();

    expect(manager.getTask(taskId)?.result).toContain(delegatedOutput);
    expect(manager.getTask(taskId)?.result).not.toBe("Task completed");
  });

  test("extractPromptText reads text from prompt response parts", () => {
    expect(extractPromptText({ parts: [{ type: "text", text: "## Summary\nDone" }] })).toBe("## Summary\nDone");
  });

  test("spawner prefers prompt API and stores extracted parts text", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T00:00:00.000Z" } as any);
    const calls: string[] = [];
    const requests: unknown[] = [];
    const client = {
      session: {
        create: async () => ({ id: "child-session" }),
        prompt: async (request: unknown) => {
          calls.push("prompt");
          requests.push(request);
          return { parts: [{ type: "text", text: "## Summary\nDone" }] };
        },
        chat: async () => {
          calls.push("chat");
          return "wrong";
        },
      },
    } as any;

    const taskId = await spawnBackgroundTask(manager, client, {
      description: "Check plugin",
      prompt: "p",
      agent: "explorer",
      parentSessionId: "s",
      parentMessageId: "m",
    });
    await Promise.resolve();

    expect(calls).toEqual(["prompt"]);
    expect(requests).toEqual([
      {
        path: { id: "child-session" },
        body: { agent: "explorer", parts: [{ type: "text", text: "p" }] },
      },
    ]);
    expect(requests[0]).not.toHaveProperty("params");
    expect((requests[0] as any).body).not.toHaveProperty("prompt");
    expect((requests[0] as any).body).not.toHaveProperty("content");
    expect(manager.getTask(taskId)?.result).toBe("## Summary\nDone");
  });

  test("spawner records context budget telemetry for delegated prompts", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T00:00:00.000Z" } as any);
    const requests: any[] = [];
    const repeated = "same low value context line repeated";
    const client = {
      session: {
        create: async () => ({ id: "child-session" }),
        prompt: async (request: unknown) => {
          requests.push(request);
          return { parts: [{ type: "text", text: "## Summary\nDone" }] };
        },
      },
    } as any;

    const taskId = await spawnBackgroundTask(manager, client, {
      description: "Check plugin",
      prompt: [repeated, repeated, repeated].join("\n"),
      agent: "explorer",
      parentSessionId: "s",
      parentMessageId: "m",
    });
    await Promise.resolve();

    const task = manager.getTask(taskId)!;
    expect(task.contextBudget?.changed).toBe(true);
    expect(task.contextBudget?.estimatedSavingsPercent).toBeGreaterThan(0);
    expect(task.contextBudget?.estimatedTokensSaved).toBeGreaterThan(0);
    expect(task.contextBudget?.originalChars).toBeGreaterThan(task.contextBudget?.compressedChars ?? 0);
    expect(manager.toExecutionMemory().contextBudgetSummary?.tasks).toBe(1);
    expect(manager.toExecutionMemory().contextBudgetSummary?.estimatedTokensSaved).toBe(task.contextBudget?.estimatedTokensSaved);
    expect(manager.toExecutionMemory().contextBudgetSummary?.byTool?.dispatch?.tasks).toBe(1);
    expect(requests[0].body.parts[0].text.match(/same low value context line repeated/g)).toHaveLength(1);
  });

  test("spawner uses promptAsync fallback with prompt parts request shape", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T00:00:00.000Z" } as any);
    const requests: unknown[] = [];
    const client = {
      session: {
        create: async () => ({ id: "child-session" }),
        promptAsync: async (request: unknown) => {
          requests.push(request);
        },
      },
    } as any;

    const taskId = await spawnBackgroundTask(manager, client, {
      description: "Check plugin",
      prompt: "p",
      agent: "explorer",
      parentSessionId: "s",
      parentMessageId: "m",
    });
    await Promise.resolve();

    expect(requests).toEqual([
      {
        path: { id: "child-session" },
        body: { agent: "explorer", parts: [{ type: "text", text: "p" }] },
      },
    ]);
    expect(requests[0]).not.toHaveProperty("params");
    expect((requests[0] as any).body).not.toHaveProperty("prompt");
    expect((requests[0] as any).body).not.toHaveProperty("content");
    expect(manager.getTask(taskId)?.status).toBe("completed");
    expect(manager.getTask(taskId)?.result).toBe("Task completed");
  });

  test("spawner fails task when no supported prompt method exists", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T00:00:00.000Z" } as any);
    const client = { session: { create: async () => ({ id: "child-session" }) } } as any;

    const taskId = await spawnBackgroundTask(manager, client, {
      description: "Check plugin",
      prompt: "p",
      agent: "explorer",
      parentSessionId: "s",
      parentMessageId: "m",
    });
    await Promise.resolve();

    expect(manager.getTask(taskId)?.status).toBe("error");
    expect(manager.getTask(taskId)?.error).toContain("No supported session prompt method");
  });
});
