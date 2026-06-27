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

    const memory = manager.toRuntimeState("2026-05-06T00:01:00.000Z");

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
    expect(manager.toRuntimeState().contextBudgetSummary?.tasks).toBe(1);
    expect(manager.toRuntimeState().contextBudgetSummary?.estimatedTokensSaved).toBe(task.contextBudget?.estimatedTokensSaved);
    expect(manager.toRuntimeState().contextBudgetSummary?.byTool?.dispatch?.tasks).toBe(1);
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

  test("spawner fails task when session.create stalls past timeout (slow OpenCode load)", async () => {
    // Force a tiny session-create timeout so the test runs fast.
    const previous = process.env.OPENCODE_JCE_BG_SESSION_CREATE_TIMEOUT_MS;
    process.env.OPENCODE_JCE_BG_SESSION_CREATE_TIMEOUT_MS = "50";
    // Settle deferred slowly so tests don't leak pending promises.
    let releaseCreate: ((value: { id: string }) => void) | undefined;
    const createDeferred = new Promise<{ id: string }>((resolve) => { releaseCreate = resolve; });
    try {
      const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T00:00:00.000Z" } as any);
      const client = {
        session: {
          // Returns a promise we resolve only after assertions — simulates a
          // session.create that did not resolve before the timeout fired.
          create: () => createDeferred,
          prompt: async () => "should not reach",
        },
      } as any;

      const taskId = await spawnBackgroundTask(manager, client, {
        description: "Check plugin",
        prompt: "p",
        agent: "explorer",
        parentSessionId: "s",
        parentMessageId: "m",
      });
      // Wait long enough for the timeout to fire and the catch handler to run.
      await new Promise((resolve) => setTimeout(resolve, 120));

      const task = manager.getTask(taskId);
      expect(task?.status).toBe("error");
      expect(task?.error).toContain("timed out");
    } finally {
      // Release the pending deferred so the test runner can shut down cleanly.
      releaseCreate?.({ id: "late-session" });
      if (previous === undefined) delete process.env.OPENCODE_JCE_BG_SESSION_CREATE_TIMEOUT_MS;
      else process.env.OPENCODE_JCE_BG_SESSION_CREATE_TIMEOUT_MS = previous;
    }
  });

  test("spawner fails task when session.prompt stalls past timeout (orphaned delegated session)", async () => {
    const previous = process.env.OPENCODE_JCE_BG_PROMPT_TIMEOUT_MS;
    process.env.OPENCODE_JCE_BG_PROMPT_TIMEOUT_MS = "50";
    let releasePrompt: ((value: unknown) => void) | undefined;
    const promptDeferred = new Promise<unknown>((resolve) => { releasePrompt = resolve; });
    try {
      const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T00:00:00.000Z" } as any);
      const client = {
        session: {
          create: async () => ({ id: "child-session" }),
          // Prompt resolves only after we release it — simulates a stalled
          // provider/model call that exceeds the per-prompt timeout.
          prompt: () => promptDeferred,
        },
      } as any;

      const taskId = await spawnBackgroundTask(manager, client, {
        description: "Check plugin",
        prompt: "p",
        agent: "explorer",
        parentSessionId: "s",
        parentMessageId: "m",
      });
      await new Promise((resolve) => setTimeout(resolve, 120));

      const task = manager.getTask(taskId);
      expect(task?.status).toBe("error");
      expect(task?.error).toContain("timed out");
      // The task must have been marked running before timing out, not stuck pending.
      expect(task?.failureReason).toContain("timed out");
    } finally {
      releasePrompt?.("late-result");
      if (previous === undefined) delete process.env.OPENCODE_JCE_BG_PROMPT_TIMEOUT_MS;
      else process.env.OPENCODE_JCE_BG_PROMPT_TIMEOUT_MS = previous;
    }
  });

  test("manager.completeTask ignores late completion for already-error tasks (#6 race fix)", () => {
    // Regression guard: when withTimeout fails a stalled session.prompt and
    // failTask sets status="error", the inner SDK promise may eventually
    // resolve and run the .then(completeTask) chain. Without the error-status
    // guard, completeTask would overwrite the failed task back to "completed"
    // and corrupt the recovery flow. The guard must drop the late completion
    // silently and leave the task in its terminal "error" state.
    const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T00:00:00.000Z" } as any);
    const task = manager.createTask({
      description: "Check plugin",
      prompt: "p",
      agent: "explorer",
      parentSessionId: "s",
      parentMessageId: "m",
    });

    manager.failTask(task.id, "Session prompt timed out after 50ms");
    expect(manager.getTask(task.id)?.status).toBe("error");
    expect(manager.getTask(task.id)?.error).toContain("timed out");

    // Simulate the late-arrival completion from the stalled SDK promise.
    manager.completeTask(task.id, "late successful result");

    const after = manager.getTask(task.id);
    expect(after?.status).toBe("error");
    expect(after?.error).toContain("timed out");
    expect(after?.result).toBeUndefined();
    // Trace should record the ignored late completion for diagnostic visibility.
    expect(manager.getTraceEvents().map((e) => e.message).some((m) => m.includes("Ignored late completion"))).toBe(true);
  });

  test("manager.completeTask ignores late completion for already-completed tasks (idempotent)", () => {
    const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T00:00:00.000Z" } as any);
    const task = manager.createTask({
      description: "Check plugin",
      prompt: "p",
      agent: "explorer",
      parentSessionId: "s",
      parentMessageId: "m",
    });

    manager.completeTask(task.id, "first result");
    expect(manager.getTask(task.id)?.result).toBe("first result");

    manager.completeTask(task.id, "second result");
    expect(manager.getTask(task.id)?.result).toBe("first result");
  });
});
