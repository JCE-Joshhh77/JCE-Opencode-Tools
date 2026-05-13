import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createEmptyExecutionMemory,
  createWisdomEntry,
  addWisdom,
  createTaskLearning,
  addTaskLearning,
  getExecutionMemoryPath,
  loadExecutionMemory,
  mergeExecutionMemorySnapshot,
  saveExecutionMemory,
} from "../../src/plugin/lib/execution-memory.ts";
import { applyWorkflowIntentRoute, createWorkflowRun } from "../../src/plugin/lib/workflow.ts";
import type { WorkflowIntentRoute } from "../../src/plugin/lib/workflow.ts";

const roots: string[] = [];

const parallelRoute = {
  intent: "parallel_work",
  skills: ["dispatching-parallel-agents"],
  reason: "Independent work can be delegated in parallel.",
  agentHint: "explorer",
  source: "task",
} satisfies WorkflowIntentRoute;

const bugfixRoute = {
  intent: "bugfix",
  skills: ["systematic-debugging", "test-driven-development"],
  reason: "Detected bug or failing test intent.",
  source: "message",
} satisfies WorkflowIntentRoute;

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "opencode-jce-memory-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("execution memory", () => {
  test("saves and loads bounded execution memory", () => {
    const root = tempRoot();
    const memory = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
    memory.traceEvents = Array.from({ length: 205 }, (_, index) => ({
      type: "task.created",
      taskId: `bg-${index}`,
      message: `event ${index}`,
      at: `2026-05-06T00:00:00.${String(index).padStart(3, "0")}Z`,
    }));

    const saved = saveExecutionMemory(root, memory, "2026-05-06T00:01:00.000Z");
    const loaded = loadExecutionMemory(root);

    expect(existsSync(saved.path)).toBe(true);
    expect(loaded.memory.traceEvents).toHaveLength(200);
    expect(loaded.memory.updatedAt).toBe("2026-05-06T00:01:00.000Z");
  });

  test("backs up malformed memory and returns empty memory", () => {
    const root = tempRoot();
    const filePath = getExecutionMemoryPath(root);
    mkdirSync(join(root, ".opencode-jce"), { recursive: true });
    writeFileSync(filePath, "{not json", "utf-8");

    const loaded = loadExecutionMemory(root, "2026-05-06T00:00:00.000Z");

    expect(loaded.memory.version).toBe(1);
    expect(loaded.recoveredFromInvalid).toBe(true);
    expect(loaded.invalidBackupPath).toContain(".invalid-");
    expect(existsSync(loaded.invalidBackupPath!)).toBe(true);
  });

  test("saves and loads workflow runtime fields", () => {
    const root = tempRoot();
    const memory = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = applyWorkflowIntentRoute(createWorkflowRun({
      id: "wf-active",
      goal: "Active workflow",
      now: "2026-05-06T00:00:00.000Z",
    }), parallelRoute, "2026-05-06T00:00:00.000Z");
    memory.workflowRuns = Array.from({ length: 12 }, (_, index) => ({
      id: `wf-${index}`,
      goal: `Workflow ${index}`,
      status: "completed" as const,
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z",
      steps: [],
      acceptanceCriteria: [],
      evidence: [],
      retryPolicy: { maxRetries: 1 },
      completionGate: { status: "passed" as const, reasons: [] },
    }));
    memory.workflowRuns[2] = applyWorkflowIntentRoute(memory.workflowRuns[2], parallelRoute, "2026-05-06T00:00:00.000Z");

    saveExecutionMemory(root, memory, "2026-05-06T00:01:00.000Z");
    const loaded = loadExecutionMemory(root, "2026-05-06T00:02:00.000Z");

    expect(loaded.memory.activeWorkflow?.id).toBe("wf-active");
    expect(loaded.memory.activeWorkflow?.route).toEqual(parallelRoute);
    expect(loaded.memory.workflowRuns).toHaveLength(10);
    expect(loaded.memory.workflowRuns[0].id).toBe("wf-2");
    expect(loaded.memory.workflowRuns[0].route).toEqual(parallelRoute);
  });

  test("loads older memory files without workflow fields", () => {
    const root = tempRoot();
    const filePath = getExecutionMemoryPath(root);
    mkdirSync(join(root, ".opencode-jce"), { recursive: true });
    writeFileSync(filePath, JSON.stringify({
      version: 1,
      updatedAt: "2026-05-06T00:00:00.000Z",
      activeTasks: [],
      completedSummaries: [],
      blockers: [],
      verificationEvidence: [],
      retryHistory: [],
      traceEvents: [],
    }), "utf-8");

    const loaded = loadExecutionMemory(root, "2026-05-06T00:02:00.000Z");

    expect(loaded.memory.activeWorkflow).toBeUndefined();
    expect(loaded.memory.workflowRuns).toEqual([]);
  });

  test("merges task snapshots without erasing workflow runtime fields", () => {
    const previous = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
    previous.activeWorkflow = applyWorkflowIntentRoute(createWorkflowRun({
      id: "wf-active",
      goal: "Active workflow",
      now: "2026-05-06T00:00:00.000Z",
    }), bugfixRoute, "2026-05-06T00:00:00.000Z");
    previous.workflowRuns = [{
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
    const next = createEmptyExecutionMemory("2026-05-06T00:01:00.000Z");
    next.activeTasks = [{ id: "bg-active" }];
    previous.completedSummaries = [{ id: "bg-done", reviewStatus: "accepted" }];
    previous.blockers = [{ id: "bg-blocked", failureReason: "missing token" }];
    previous.verificationEvidence = [{ id: "bg-done", verificationSummary: "accepted review" }];
    previous.retryHistory = [{ id: "bg-retry", rootTaskId: "wf-active", failureReason: "timeout" }];
    next.traceEvents = [{
      type: "task.created",
      taskId: "bg-active",
      message: "Created task",
      at: "2026-05-06T00:01:00.000Z",
    }];

    const merged = mergeExecutionMemorySnapshot(previous, next, { preserveWorkflowRuntime: true });

    expect(merged.activeWorkflow?.id).toBe("wf-active");
    expect(merged.activeWorkflow?.route).toEqual(bugfixRoute);
    expect(merged.workflowRuns.map((run) => run.id)).toEqual(["wf-completed"]);
    expect(merged.activeTasks).toEqual([{ id: "bg-active" }]);
    expect(merged.completedSummaries).toContainEqual({ id: "bg-done", reviewStatus: "accepted" });
    expect(merged.blockers).toContainEqual({ id: "bg-blocked", failureReason: "missing token" });
    expect(merged.verificationEvidence).toContainEqual({ id: "bg-done", verificationSummary: "accepted review" });
    expect(merged.retryHistory).toContainEqual({ id: "bg-retry", rootTaskId: "wf-active", failureReason: "timeout" });
    expect(merged.traceEvents).toEqual(next.traceEvents);
  });

  test("preserves context budget summary during persisted memory merge", () => {
    const previous = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
    previous.contextBudgetSummary = {
      originalChars: 1000,
      compressedChars: 700,
      estimatedTokensSaved: 75,
      estimatedSavingsPercent: 30,
      tasks: 2,
      byTool: { Read: { originalChars: 1000, compressedChars: 700, estimatedTokensSaved: 75, tasks: 2 } },
    };
    const next = createEmptyExecutionMemory("2026-05-06T00:01:00.000Z");

    const merged = mergeExecutionMemorySnapshot(previous, next, { preserveWorkflowRuntime: true });

    expect(merged.contextBudgetSummary).toEqual(previous.contextBudgetSummary);
  });

  test("preserve merge can explicitly clear workflow runtime fields", () => {
    const previous = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
    previous.activeWorkflow = createWorkflowRun({
      id: "wf-active",
      goal: "Active workflow",
      now: "2026-05-06T00:00:00.000Z",
    });
    previous.workflowRuns = [createWorkflowRun({
      id: "wf-completed",
      goal: "Completed workflow",
      now: "2026-05-06T00:00:00.000Z",
    })];
    const next = createEmptyExecutionMemory("2026-05-06T00:01:00.000Z");

    const merged = mergeExecutionMemorySnapshot(previous, next, { preserveWorkflowRuntime: true, clearWorkflowRuntime: true });

    expect(merged.activeWorkflow).toBeUndefined();
    expect(merged.workflowRuns).toEqual([]);
  });

  test("default merge allows workflow runtime fields to be cleared", () => {
    const previous = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
    previous.activeWorkflow = {
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
    previous.workflowRuns = [{
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
    const next = createEmptyExecutionMemory("2026-05-06T00:01:00.000Z");

    const merged = mergeExecutionMemorySnapshot(previous, next);

    expect(merged.activeWorkflow).toBeUndefined();
    expect(merged.workflowRuns).toEqual([]);
  });

  test("adds structured wisdom entries and deduplicates by learning text", () => {
    const memory = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
    const first = createWisdomEntry({ learning: " Run focused tests before full suite ", source: "debug", confidence: "high", tags: ["tests", "tests"], now: "2026-05-06T00:00:00.000Z" });
    const second = createWisdomEntry({ learning: "Run focused tests before full suite", source: "debug", confidence: "medium", tags: ["debug"], now: "2026-05-06T00:01:00.000Z" });

    const updated = addWisdom(addWisdom(memory, first), second);

    expect(updated.wisdom).toHaveLength(1);
    expect(updated.wisdom[0]).toMatchObject({ learning: "Run focused tests before full suite", confidence: "medium", tags: ["debug"] });
  });

  test("adds structured task learnings and deduplicates by task type and trigger", () => {
    const memory = createEmptyExecutionMemory("2026-05-06T00:00:00.000Z");
    const first = createTaskLearning({ taskType: "release", trigger: "release", successfulRecipe: ["old"], verificationCommands: ["bun test"], touchedAreas: ["package"], now: "2026-05-06T00:00:00.000Z" });
    const second = createTaskLearning({ taskType: "release", trigger: "release", successfulRecipe: ["new"], verificationCommands: ["bun audit"], touchedAreas: ["lockfile"], now: "2026-05-06T00:01:00.000Z" });

    const updated = addTaskLearning(addTaskLearning(memory, first), second);

    expect(updated.taskLearnings).toHaveLength(1);
    expect(updated.taskLearnings[0]).toMatchObject({ successfulRecipe: ["new"], verificationCommands: ["bun audit"], touchedAreas: ["lockfile"] });
  });
});
