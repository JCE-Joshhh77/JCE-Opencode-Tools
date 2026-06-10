import { describe, expect, test } from "bun:test";
import { BackgroundManager } from "../../src/plugin/background/manager.ts";
import { buildCollectTool } from "../../src/plugin/tools/dispatch.ts";

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

function createTask(manager: BackgroundManager) {
  return manager.createTask({
    description: "Inspect runtime",
    prompt: "Inspect the runtime",
    agent: "explorer",
    parentSessionId: "s",
    parentMessageId: "m",
    maxRetries: 1,
  });
}

describe("dispatch collect recovery loop", () => {
  test("schedules retry task for retryable failed child task", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T00:00:00.000Z" });
    const task = createTask(manager);
    manager.failTask(task.id, "network timeout while fetching package");

    const tool = buildCollectTool(manager);
    const result = await tool.execute({ taskId: task.id } as any, context);

    const retry = manager.listTasks().find((item) => item.retryOfTaskId === task.id);
    expect(result).toContain("Recovery: retry scheduled");
    expect(result).toContain("transient_network");
    expect(retry).toBeDefined();
    expect(retry?.prompt).toContain("## Retry Context");
    expect(retry?.prompt).toContain("network timeout while fetching package");
  });

  test("schedules and launches retry task for retryable failed child task", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T00:00:00.000Z" });
    const task = createTask(manager);
    manager.failTask(task.id, "network timeout while fetching package");
    const promptCalls: unknown[] = [];
    const client = {
      session: {
        create: async () => ({ id: `retry-session-${promptCalls.length + 1}` }),
        prompt: async (input: unknown) => {
          promptCalls.push(input);
          return { parts: [{ type: "text", text: "## Summary\nRetried\n\n## Files\n- none\n\n## Verification\n- not run\n\n## Risks\n- none" }] };
        },
      },
    } as any;

    const tool = buildCollectTool(manager, client);
    const result = await tool.execute({ taskId: task.id } as any, context);
    await Promise.resolve();

    const retries = manager.listTasks().filter((item) => item.retryOfTaskId === task.id);
    expect(result).toContain("Recovery: retry scheduled");
    expect(retries).toHaveLength(1);
    expect(retries[0].status).toBe("completed");
    expect(retries[0].result).toContain("## Summary\nRetried");
    expect(promptCalls).toHaveLength(1);
  });

  test("blocks failed child task when retry budget is exhausted", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T00:00:00.000Z" });
    const task = createTask(manager);
    task.retryCount = 1;
    manager.failTask(task.id, "network timeout while fetching package");

    const tool = buildCollectTool(manager);
    const result = await tool.execute({ taskId: task.id } as any, context);

    expect(result).toContain("Recovery: blocked");
    expect(result).toContain("Retry budget exhausted");
    expect(result).toContain("## Blocker");
    expect(manager.getTask(task.id)?.reviewStatus).toBe("blocked");
    expect(manager.listTasks().filter((item) => item.retryOfTaskId === task.id)).toHaveLength(0);
  });

  test("does not retry missing access failures", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T00:00:00.000Z" });
    const task = createTask(manager);
    manager.failTask(task.id, "401 unauthorized missing credentials");

    const tool = buildCollectTool(manager);
    const result = await tool.execute({ taskId: task.id } as any, context);

    expect(result).toContain("Recovery: blocked");
    expect(result).toContain("missing_access");
    expect(manager.listTasks().filter((item) => item.retryOfTaskId === task.id)).toHaveLength(0);
  });

  test("schedules retry for delegated contract failures", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T00:00:00.000Z" });
    const task = createTask(manager);
    manager.completeTask(task.id, "Only a plain result without required sections");

    const tool = buildCollectTool(manager);
    const result = await tool.execute({ taskId: task.id } as any, context);

    const retry = manager.listTasks().find((item) => item.retryOfTaskId === task.id);
    expect(result).toContain("Recovery: retry scheduled");
    expect(result).toContain("delegated_contract_failure");
    expect(retry?.prompt).toContain("Return the required delegated result contract");
  });

  test("repeated collect points to existing retry task without creating another retry", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T00:00:00.000Z" });
    const task = createTask(manager);
    manager.completeTask(task.id, "Only a plain result without required sections");
    const tool = buildCollectTool(manager);

    await tool.execute({ taskId: task.id } as any, context);
    const firstRetry = manager.listTasks().find((item) => item.retryOfTaskId === task.id);
    const result = await tool.execute({ taskId: task.id } as any, context);
    const retries = manager.listTasks().filter((item) => item.retryOfTaskId === task.id);

    expect(retries).toHaveLength(1);
    expect(result).toContain("Recovery: retry already scheduled");
    expect(result).toContain(firstRetry!.id);
  });

  test("retry prompt for delegated contract failure includes delegated contract once", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T00:00:00.000Z" });
    const task = createTask(manager);
    task.prompt = "# Delegated Task Envelope\r\n\r\n## Goal\r\nInspect runtime\r\n\r\n## Scope\r\nInspect the runtime\r\n\r\n## Output Contract\r\nReturn your final answer in this format:\r\n## Summary\r\n...\r\n\r\n## Files\r\n- path or none\r\n\r\n## Verification\r\n- command/result or not run\r\n\r\n## Risks\r\n- risk or none";
    manager.completeTask(task.id, "Only a plain result without required sections");

    const tool = buildCollectTool(manager);
    await tool.execute({ taskId: task.id } as any, context);

    const retry = manager.listTasks().find((item) => item.retryOfTaskId === task.id);
    expect(retry?.prompt.match(/## Output Contract/g) ?? []).toHaveLength(1);
    expect(retry?.prompt.match(/## Summary/g) ?? []).toHaveLength(1);
  });

  test("retry prompt preserves scope content that mentions output contract heading", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T00:00:00.000Z" });
    const task = createTask(manager);
    task.prompt = [
      "# Delegated Task Envelope",
      "",
      "## Goal",
      "Inspect runtime",
      "",
      "## Scope",
      "Analyze this user-provided section:",
      "## Output Contract",
      "This heading is part of the task, keep it",
      "Continue inspecting behavior after the embedded heading.",
      "",
      "## Assigned Agent",
      "explorer",
      "",
      "## Output Contract",
      "Return your final answer in this format:",
      "## Summary",
      "...",
      "",
      "## Files",
      "- path or none",
      "",
      "## Verification",
      "- command/result or not run",
      "",
      "## Risks",
      "- risk or none",
    ].join("\n");
    manager.completeTask(task.id, "Only a plain result without required sections");

    const tool = buildCollectTool(manager);
    await tool.execute({ taskId: task.id } as any, context);

    const retry = manager.listTasks().find((item) => item.retryOfTaskId === task.id);
    expect(retry?.prompt).toContain("This heading is part of the task, keep it");
    expect(retry?.prompt.match(/Return your final answer in this format:/g) ?? []).toHaveLength(1);
  });

  test("marks blocked delegated review as recovery blocker instead of completed success", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T00:00:00.000Z" });
    const task = createTask(manager);
    manager.completeTask(task.id, "## Summary\nBlocked\n\n## Files\n- none\n\n## Verification\n- not run\n\n## Risks\n- blocked: missing credentials");

    const tool = buildCollectTool(manager);
    const result = await tool.execute({ taskId: task.id } as any, context);

    expect(result).toContain("Task " + task.id + " blocked");
    expect(result).not.toContain("Task " + task.id + " completed:");
    expect(manager.getTask(task.id)?.status).toBe("error");
    expect(manager.getTask(task.id)?.reviewStatus).toBe("blocked");
    expect(manager.toRuntimeState().blockers).toContainEqual(expect.objectContaining({ id: task.id }));
  });

  test("reports pending retry when concurrency prevents immediate retry launch", async () => {
    const manager = new BackgroundManager({ maxConcurrency: 0, now: () => "2026-05-06T00:00:00.000Z" });
    const task = createTask(manager);
    manager.failTask(task.id, "network timeout while fetching package");
    const client = {
      session: {
        create: async () => ({ id: "should-not-launch" }),
        prompt: async () => "unused",
      },
    } as any;

    const tool = buildCollectTool(manager, client);
    const result = await tool.execute({ taskId: task.id } as any, context);

    const retry = manager.listTasks().find((item) => item.retryOfTaskId === task.id);
    expect(result).toContain("Recovery: retry pending");
    expect(retry?.status).toBe("pending");
  });
});
