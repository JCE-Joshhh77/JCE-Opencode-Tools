import { describe, expect, test } from "bun:test";
import type { RuntimeState } from "../../src/plugin/lib/runtime-state.ts";
import {
  getActiveBlockers,
  getAttemptedCommands,
  getLatestFailure,
  getLatestVerificationEvidence,
  getRetryHistoryFor,
  getStaleActiveTasks,
} from "../../src/plugin/lib/memory-query.ts";

function fixtureMemory(): RuntimeState {
  return {
    version: 1,
    updatedAt: "2026-05-06T00:00:00.000Z",
    activeTasks: [
      { id: "bg-1", description: "running", stale: false, status: "running" },
      { id: "bg-2", description: "stale", stale: true, status: "running" },
    ],
    completedSummaries: [],
    blockers: [{ id: "bg-3", failureReason: "Missing token", logicalState: "blocked" }],
    verificationEvidence: [
      { id: "bg-1", verificationSummary: "bun test: pass" },
      { id: "wf-1", verificationSummary: "bun run typecheck: pass" },
    ],
    retryHistory: [
      { id: "bg-1", retryCount: 1, failureReason: "timeout" },
      { id: "wf-1", retryCount: 2, failureReason: "rate limit" },
    ],
    traceEvents: [
      { type: "verification.recorded", message: "ran bun test", at: "2026-05-06T00:01:00.000Z", metadata: { command: "bun test" } },
      { type: "task.failed", taskId: "bg-1", message: "timeout", at: "2026-05-06T00:02:00.000Z" },
      { type: "verification.recorded", message: "ran bun run typecheck", at: "2026-05-06T00:03:00.000Z", metadata: { command: "bun run typecheck" } },
    ],
    workflowRuns: [],
    wisdom: [],
    taskLearnings: [],
  };
}

describe("runtime state queries", () => {
  test("returns latest verification evidence", () => {
    expect(getLatestVerificationEvidence(fixtureMemory())).toEqual({ id: "wf-1", verificationSummary: "bun run typecheck: pass" });
  });

  test("returns undefined when verification evidence collection is null", () => {
    const memory = fixtureMemory();
    memory.verificationEvidence = null as unknown as RuntimeState["verificationEvidence"];

    expect(getLatestVerificationEvidence(memory)).toBeUndefined();
  });

  test("extracts attempted commands from trace metadata", () => {
    expect(getAttemptedCommands(fixtureMemory())).toEqual(["bun test", "bun run typecheck"]);
  });

  test("returns no attempted commands when trace events collection is null", () => {
    const memory = fixtureMemory();
    memory.traceEvents = null as unknown as RuntimeState["traceEvents"];

    expect(getAttemptedCommands(memory)).toEqual([]);
  });

  test("ignores invalid attempted commands and dedupes preserving first occurrence", () => {
    const memory = fixtureMemory();
    memory.traceEvents = [
      { type: "verification.recorded", message: "missing metadata", at: "2026-05-06T00:01:00.000Z" },
      { type: "verification.recorded", message: "null command", at: "2026-05-06T00:02:00.000Z", metadata: { command: null } },
      { type: "verification.recorded", message: "blank command", at: "2026-05-06T00:03:00.000Z", metadata: { command: "   " } },
      { type: "verification.recorded", message: "ran bun test", at: "2026-05-06T00:04:00.000Z", metadata: { command: "bun test" } },
      { type: "verification.recorded", message: "ran bun run typecheck", at: "2026-05-06T00:05:00.000Z", metadata: { command: "bun run typecheck" } },
      { type: "verification.recorded", message: "ran bun test again", at: "2026-05-06T00:06:00.000Z", metadata: { command: "bun test" } },
    ];

    expect(getAttemptedCommands(memory)).toEqual(["bun test", "bun run typecheck"]);
  });

  test("returns latest failure from trace events", () => {
    expect(getLatestFailure(fixtureMemory())).toEqual({ taskId: "bg-1", message: "timeout", at: "2026-05-06T00:02:00.000Z" });
  });

  test("returns undefined latest failure when trace events collection is not an array", () => {
    const memory = fixtureMemory();
    memory.traceEvents = "bad" as unknown as RuntimeState["traceEvents"];

    expect(getLatestFailure(memory)).toBeUndefined();
  });

  test("returns active blockers", () => {
    expect(getActiveBlockers(fixtureMemory())).toEqual([{ id: "bg-3", failureReason: "Missing token", logicalState: "blocked" }]);
  });

  test("returns no active blockers when blockers collection is null", () => {
    const memory = fixtureMemory();
    memory.blockers = null as unknown as RuntimeState["blockers"];

    expect(getActiveBlockers(memory)).toEqual([]);
  });

  test("returns a shallow copy of active blockers", () => {
    const memory = fixtureMemory();
    const blockers = getActiveBlockers(memory);

    blockers.push({ id: "new-blocker" });

    expect(memory.blockers).toHaveLength(1);
  });

  test("returns stale active tasks", () => {
    expect(getStaleActiveTasks(fixtureMemory())).toEqual([{ id: "bg-2", description: "stale", stale: true, status: "running" }]);
  });

  test("returns no stale active tasks when active tasks collection is null", () => {
    const memory = fixtureMemory();
    memory.activeTasks = null as unknown as RuntimeState["activeTasks"];

    expect(getStaleActiveTasks(memory)).toEqual([]);
  });

  test("ignores malformed active tasks when returning stale tasks", () => {
    const memory = fixtureMemory();
    memory.activeTasks = [null, "bad", { stale: true, id: "ok" }] as unknown as RuntimeState["activeTasks"];

    expect(getStaleActiveTasks(memory)).toEqual([{ stale: true, id: "ok" }]);
  });

  test("returns retry history for task or workflow id", () => {
    expect(getRetryHistoryFor(fixtureMemory(), "wf-1")).toEqual([{ id: "wf-1", retryCount: 2, failureReason: "rate limit" }]);
  });

  test("returns retry history linked by root task id", () => {
    const memory = fixtureMemory();
    memory.retryHistory = [
      { id: "bg-original", retryTaskId: "bg-retry", rootTaskId: "wf-1", retryCount: 1, failureReason: "timeout" },
      { id: "bg-retry", retryOfTaskId: "bg-original", rootTaskId: "wf-1", retryCount: 1, failureReason: "timeout" },
    ];

    expect(getRetryHistoryFor(memory, "wf-1")).toHaveLength(2);
  });

  test("returns no retry history when retry history collection is null", () => {
    const memory = fixtureMemory();
    memory.retryHistory = null as unknown as RuntimeState["retryHistory"];

    expect(getRetryHistoryFor(memory, "wf-1")).toEqual([]);
  });

  test("ignores malformed retry history when returning matches", () => {
    const memory = fixtureMemory();
    memory.retryHistory = [null, "bad", { id: "wf-1", retryCount: 1 }] as unknown as RuntimeState["retryHistory"];

    expect(getRetryHistoryFor(memory, "wf-1")).toEqual([{ id: "wf-1", retryCount: 1 }]);
  });
});
