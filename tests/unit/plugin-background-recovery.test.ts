import { describe, expect, test } from "bun:test";
import { BackgroundManager } from "../../src/plugin/background/manager.ts";
import type { HandoffReportInput } from "../../src/plugin/lib/handoff.ts";

function createManager(): BackgroundManager {
  return new BackgroundManager({ maxConcurrency: 3, now: () => "2026-05-06T00:00:00.000Z" });
}

function createTask(manager: BackgroundManager) {
  return manager.createTask({
    description: "Inspect runtime",
    prompt: "Inspect the runtime",
    agent: "explorer",
    parentSessionId: "parent-session",
    parentMessageId: "parent-message",
    maxRetries: 2,
  });
}

describe("background manager recovery loop metadata", () => {
  test("recording retryable failure does not consume budget before retry task creation", () => {
    const manager = createManager();
    const original = manager.createTask({
      description: "Inspect runtime",
      prompt: "Inspect the runtime",
      agent: "explorer",
      parentSessionId: "parent-session",
      parentMessageId: "parent-message",
      maxRetries: 1,
    });

    const hasBudget = manager.recordRetryableFailure(original.id, "network timeout");
    expect(hasBudget).toBe(true);
    expect(manager.getTask(original.id)?.retryCount).toBe(0);
    expect(manager.getTask(original.id)?.reviewStatus).toBe("retryable_failure");

    const result = manager.createRetryTaskResult(original.id, { prompt: "retry 1", failureReason: "network timeout", category: "transient_network" });

    expect(manager.getTask(original.id)?.retryCount).toBe(1);
    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error(`Unexpected result status: ${result.status}`);
    expect(result.task.retryCount).toBe(1);
  });

  test("creates retry tasks with lineage and retry prompt", () => {
    const manager = createManager();
    const original = createTask(manager);

    const retry = manager.createRetryTask(original.id, {
      prompt: "Retry prompt with prior evidence",
      failureReason: "network timeout",
      category: "transient_network",
    })!;

    expect(retry.id).not.toBe(original.id);
    expect(retry.retryOfTaskId).toBe(original.id);
    expect(retry.rootTaskId).toBe(original.id);
    expect(retry.retryCount).toBe(1);
    expect(retry.maxRetries).toBe(2);
    expect(retry.prompt).toContain("Retry prompt with prior evidence");
    expect(retry.failureReason).toBe("network timeout");
    expect(retry.recoveryCategory).toBe("transient_network");
    expect(manager.getTask(original.id)?.reviewStatus).toBe("retryable_failure");
    expect(manager.getTask(original.id)?.logicalState).toBe("delegating");
    expect(manager.getTraceEvents().map((event) => event.type)).toContain("task.retry_scheduled");
  });

  test("scheduled retry keeps original out of active blockers while recovery is pending", () => {
    const manager = createManager();
    const original = createTask(manager);
    manager.failTask(original.id, "network timeout");

    const retry = manager.createRetryTask(original.id, { prompt: "retry", failureReason: "network timeout", category: "transient_network" })!;
    const memory = manager.toRuntimeState("2026-05-06T00:01:00.000Z");

    expect(retry.status).toBe("pending");
    expect(memory.blockers).not.toContainEqual(expect.objectContaining({ id: original.id }));
    expect(memory.retryHistory).toContainEqual(expect.objectContaining({ id: original.id, retryTaskId: retry.id, reviewStatus: "retryable_failure" }));
  });

  test("creates chained retries until retry budget is exhausted", () => {
    const manager = createManager();
    const original = createTask(manager);
    const retry1 = manager.createRetryTask(original.id, { prompt: "retry 1", failureReason: "network timeout", category: "transient_network" })!;
    const retry2 = manager.createRetryTask(retry1.id, { prompt: "retry 2", failureReason: "network timeout", category: "transient_network" })!;
    const retry3 = manager.createRetryTask(retry2.id, { prompt: "retry 3", failureReason: "network timeout", category: "transient_network" });

    expect(retry2.retryOfTaskId).toBe(retry1.id);
    expect(retry2.rootTaskId).toBe(original.id);
    expect(retry2.retryCount).toBe(2);
    expect(retry3).toBeUndefined();
    expect(manager.getTask(retry2.id)?.reviewStatus).toBe("blocked");
    expect(manager.getTask(retry2.id)?.handoffReason).toContain("Retry budget exhausted");
  });

  test("returns existing retry task when retry already scheduled for a task", () => {
    const manager = createManager();
    const original = createTask(manager);
    const retry1 = manager.createRetryTask(original.id, { prompt: "retry 1", failureReason: "network timeout", category: "transient_network" })!;
    const duplicate = manager.createRetryTask(original.id, { prompt: "retry duplicate", failureReason: "network timeout again", category: "transient_network" });

    expect(duplicate?.id).toBe(retry1.id);
    expect(manager.getTask(original.id)?.reviewStatus).toBe("retryable_failure");
    expect(manager.getTask(original.id)?.handoffReason).toBeUndefined();
    expect(manager.listTasks().filter((task) => task.retryOfTaskId === original.id)).toHaveLength(1);
  });

  test("createRetryTaskResult reports missing retry record without exhausting budget", () => {
    const manager = createManager();
    const original = createTask(manager);
    const retry = manager.createRetryTask(original.id, { prompt: "retry 1", failureReason: "network timeout", category: "transient_network" })!;
    (manager as unknown as { tasks: Map<string, unknown> }).tasks.delete(retry.id);

    const result = manager.createRetryTaskResult(original.id, { prompt: "retry duplicate", failureReason: "network timeout again", category: "transient_network" });

    expect(result.status).toBe("already_scheduled_missing");
    if (result.status !== "already_scheduled_missing") throw new Error(`Unexpected result status: ${result.status}`);
    expect(result.reason).toBe(`Retry already scheduled but task is unavailable: ${retry.id}`);
    expect(manager.getTask(original.id)?.reviewStatus).toBe("retryable_failure");
    expect(manager.getTask(original.id)?.handoffReason ?? "").not.toContain("Retry budget exhausted");
  });

  test("createRetryTaskResult reports exhausted budget explicitly", () => {
    const manager = createManager();
    const original = createTask(manager);
    original.retryCount = original.maxRetries;

    const result = manager.createRetryTaskResult(original.id, { prompt: "retry exhausted", failureReason: "network timeout", category: "transient_network" });

    expect(result.status).toBe("exhausted");
    if (result.status !== "exhausted") throw new Error(`Unexpected result status: ${result.status}`);
    expect(result.reason).toContain("Retry budget exhausted");
    expect(manager.getTask(original.id)?.reviewStatus).toBe("blocked");
    expect(manager.getTask(original.id)?.handoffReason).toContain("Retry budget exhausted");
  });

  test("records blocked recovery with handoff report input", () => {
    const manager = createManager();
    const task = createTask(manager);
    const handoff: HandoffReportInput = {
      status: "blocked",
      completed: [],
      blocker: "missing credentials",
      evidence: ["401 unauthorized"],
      nextOptions: ["Resolve missing access or approval, then retry."],
    };

    manager.blockTaskForRecovery(task.id, "missing_access", "missing credentials", handoff);

    const blocked = manager.getTask(task.id)!;
    expect(blocked.status).toBe("error");
    expect(blocked.logicalState).toBe("blocked");
    expect(blocked.reviewStatus).toBe("blocked");
    expect(blocked.recoveryCategory).toBe("missing_access");
    expect(blocked.handoffReason).toBe("missing credentials");
    expect(blocked.handoff).toEqual(handoff);
    expect(manager.getTraceEvents().map((event) => event.type)).toContain("task.blocked");
  });

  test("runtime state includes retry lineage and handoff metadata", () => {
    const manager = createManager();
    const task = createTask(manager);
    const retry = manager.createRetryTask(task.id, { prompt: "retry prompt", failureReason: "network timeout", category: "transient_network" })!;
    manager.blockTaskForRecovery(retry.id, "verification_failed", "Retry budget exhausted", {
      status: "blocked",
      completed: [],
      blocker: "Retry budget exhausted",
      evidence: ["test failed"],
      nextOptions: ["Inspect failure, adjust task or retry manually."],
    });

    const memory = manager.toRuntimeState("2026-05-06T00:01:00.000Z");

    expect(memory.retryHistory).toContainEqual(expect.objectContaining({ id: task.id, retryTaskId: retry.id, recoveryCategory: "transient_network" }));
    expect(memory.blockers).toContainEqual(expect.objectContaining({ id: retry.id, recoveryCategory: "verification_failed" }));
  });

  test("runtime state preserves delegated review status for completed tasks", () => {
    const manager = createManager();
    const task = createTask(manager);
    manager.completeTask(task.id, "## Summary\nDone\n\n## Files\n- none\n\n## Verification\n- bun test passed\n\n## Risks\n- none");
    manager.markReview(task.id, "accepted", ["accepted: delegated result reviewed"], "delegated output includes required sections");

    const memory = manager.toRuntimeState("2026-05-06T00:01:00.000Z");

    expect(memory.completedSummaries).toContainEqual(expect.objectContaining({
      id: task.id,
      reviewStatus: "accepted",
      reviewNotes: ["accepted: delegated result reviewed"],
      verificationSummary: "delegated output includes required sections",
    }));
    expect(memory.verificationEvidence).toContainEqual(expect.objectContaining({
      id: task.id,
      reviewStatus: "accepted",
      verificationSummary: "delegated output includes required sections",
    }));
  });

  test("runtime state marks retry lineage resolved when retry is accepted", () => {
    const manager = createManager();
    const original = createTask(manager);
    manager.failTask(original.id, "network timeout");
    const retry = manager.createRetryTask(original.id, { prompt: "retry", failureReason: "network timeout", category: "transient_network" })!;
    manager.completeTask(retry.id, "## Summary\nRetried\n\n## Files\n- none\n\n## Verification\n- bun test passed\n\n## Risks\n- none");
    manager.markReview(retry.id, "accepted", ["accepted: retry passed"], "delegated output includes required sections");

    const memory = manager.toRuntimeState("2026-05-06T00:01:00.000Z");

    expect(memory.retryHistory).toContainEqual(expect.objectContaining({ id: original.id, resolved: true }));
    expect(memory.retryHistory).toContainEqual(expect.objectContaining({ id: retry.id, reviewStatus: "accepted", status: "completed", resolved: true }));
  });
});
