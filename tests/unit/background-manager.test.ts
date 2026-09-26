import { describe, expect, test } from "bun:test";
import { BackgroundManager } from "../../src/plugin/background/manager.ts";

describe("background manager", () => {
  test("creates a task with pending status", () => {
    const manager = new BackgroundManager({ maxConcurrency: 3 });
    const task = manager.createTask({
      description: "Explore codebase",
      prompt: "Find all API endpoints",
      agent: "explorer",
      parentSessionId: "session-1",
      parentMessageId: "msg-1",
    });
    expect(task.id).toMatch(/^bg-/);
    expect(task.status).toBe("pending");
    expect(task.description).toBe("Explore codebase");
  });

  test("lists all tasks", () => {
    const manager = new BackgroundManager({ maxConcurrency: 3 });
    manager.createTask({ description: "t1", prompt: "p1", agent: "explorer", parentSessionId: "s1", parentMessageId: "m1" });
    manager.createTask({ description: "t2", prompt: "p2", agent: "oracle", parentSessionId: "s1", parentMessageId: "m2" });
    expect(manager.listTasks()).toHaveLength(2);
  });

  test("cancels a pending task", () => {
    const manager = new BackgroundManager({ maxConcurrency: 3 });
    const task = manager.createTask({ description: "t1", prompt: "p1", agent: "explorer", parentSessionId: "s1", parentMessageId: "m1" });
    expect(manager.cancelTask(task.id)).toBe(true);
    expect(manager.getTask(task.id)?.status).toBe("cancelled");
  });

  test("cannot cancel a completed task", () => {
    const manager = new BackgroundManager({ maxConcurrency: 3 });
    const task = manager.createTask({ description: "t1", prompt: "p1", agent: "explorer", parentSessionId: "s1", parentMessageId: "m1" });
    manager.completeTask(task.id, "done");
    expect(manager.cancelTask(task.id)).toBe(false);
  });

  test("completes a task with result", () => {
    const manager = new BackgroundManager({ maxConcurrency: 3 });
    const task = manager.createTask({ description: "t1", prompt: "p1", agent: "explorer", parentSessionId: "s1", parentMessageId: "m1" });
    manager.completeTask(task.id, "Found 5 endpoints");
    const updated = manager.getTask(task.id)!;
    expect(updated.status).toBe("completed");
    expect(updated.result).toBe("Found 5 endpoints");
    expect(updated.completedAt).toBeDefined();
  });

  test("fails a task with error", () => {
    const manager = new BackgroundManager({ maxConcurrency: 3 });
    const task = manager.createTask({ description: "t1", prompt: "p1", agent: "explorer", parentSessionId: "s1", parentMessageId: "m1" });
    manager.failTask(task.id, "Network error");
    expect(manager.getTask(task.id)?.status).toBe("error");
    expect(manager.getTask(task.id)?.error).toBe("Network error");
  });

  test("tracks running count and canLaunch", () => {
    const manager = new BackgroundManager({ maxConcurrency: 2 });
    const t1 = manager.createTask({ description: "t1", prompt: "p1", agent: "explorer", parentSessionId: "s1", parentMessageId: "m1" });
    const t2 = manager.createTask({ description: "t2", prompt: "p2", agent: "oracle", parentSessionId: "s1", parentMessageId: "m2" });

    expect(manager.canLaunch()).toBe(true);
    manager.markRunning(t1.id, "sess-1");
    expect(manager.canLaunch()).toBe(true);
    manager.markRunning(t2.id, "sess-2");
    expect(manager.canLaunch()).toBe(false);

    manager.completeTask(t1.id, "done");
    expect(manager.canLaunch()).toBe(true);
  });

  test("reserves launch slots before tasks become running", () => {
    const manager = new BackgroundManager({ maxConcurrency: 1 });
    expect(manager.reserveLaunch()).toBe(true);
    expect(manager.reserveLaunch()).toBe(false);
    manager.releaseLaunch();
    expect(manager.canLaunch()).toBe(true);
  });

  test("stale running task becomes error and frees launch slot on status read", () => {
    let now = "2026-05-06T00:00:00.000Z";
    const manager = new BackgroundManager({ maxConcurrency: 1, staleAfterMs: 1000, now: () => now });
    const running = manager.createTask({ description: "t1", prompt: "p1", agent: "explorer", parentSessionId: "s1", parentMessageId: "m1" });

    manager.markRunning(running.id, "sess-1");
    expect(manager.canLaunch()).toBe(false);

    now = "2026-05-06T00:00:02.000Z";
    const updated = manager.getTask(running.id)!;

    expect(updated.status).toBe("error");
    expect(updated.stale).toBe(true);
    expect(updated.failureReason).toContain("Task stale");
    expect(manager.canLaunch()).toBe(true);
  });
});
