import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { TraceEvent } from "./trace.js";
import type { WorkflowRun } from "./workflow.js";

export interface ExecutionMemory {
  version: 1;
  updatedAt: string;
  activeTasks: unknown[];
  completedSummaries: unknown[];
  blockers: unknown[];
  verificationEvidence: unknown[];
  retryHistory: unknown[];
  traceEvents: TraceEvent[];
  activeWorkflow?: WorkflowRun;
  workflowRuns: WorkflowRun[];
}

export interface LoadExecutionMemoryResult {
  path: string;
  memory: ExecutionMemory;
  recoveredFromInvalid: boolean;
  invalidBackupPath?: string;
}

export interface MergeExecutionMemoryOptions {
  preserveWorkflowRuntime?: boolean;
  clearWorkflowRuntime?: boolean;
}

const MEMORY_COLLECTIONS = ["completedSummaries", "blockers", "verificationEvidence", "retryHistory"] as const;

export function getExecutionMemoryPath(projectRoot: string): string {
  return join(projectRoot, ".opencode-jce", "jce-worker-execution.json");
}

export function createEmptyExecutionMemory(now = new Date().toISOString()): ExecutionMemory {
  return {
    version: 1,
    updatedAt: now,
    activeTasks: [],
    completedSummaries: [],
    blockers: [],
    verificationEvidence: [],
    retryHistory: [],
    traceEvents: [],
    workflowRuns: [],
  };
}

function newest<T>(items: T[], max: number): T[] {
  return items.slice(Math.max(0, items.length - max));
}

function mergeById(previous: unknown[], next: unknown[]): unknown[] {
  const merged = [...previous];
  for (const item of next) {
    if (!item || typeof item !== "object" || !("id" in item) || typeof item.id !== "string") {
      merged.push(item);
      continue;
    }
    const index = merged.findIndex((existing) => existing && typeof existing === "object" && "id" in existing && existing.id === item.id);
    if (index >= 0) merged[index] = item;
    else merged.push(item);
  }
  return merged;
}

export function pruneExecutionMemory(memory: ExecutionMemory): ExecutionMemory {
  return {
    ...memory,
    activeTasks: newest(memory.activeTasks, 25),
    completedSummaries: newest(memory.completedSummaries, 50),
    blockers: newest(memory.blockers, 50),
    verificationEvidence: newest(memory.verificationEvidence, 100),
    retryHistory: newest(memory.retryHistory, 100),
    traceEvents: newest(memory.traceEvents, 200),
    activeWorkflow: memory.activeWorkflow,
    workflowRuns: newest(memory.workflowRuns ?? [], 10),
  };
}

export function mergeExecutionMemorySnapshot(previous: ExecutionMemory, next: ExecutionMemory, options: MergeExecutionMemoryOptions = {}): ExecutionMemory {
  if (!options.preserveWorkflowRuntime) return pruneExecutionMemory(next);

  return pruneExecutionMemory({
    ...next,
    ...Object.fromEntries(MEMORY_COLLECTIONS.map((key) => [key, mergeById(previous[key], next[key])])),
    traceEvents: next.traceEvents.length > 0 ? next.traceEvents : previous.traceEvents,
    activeWorkflow: options.clearWorkflowRuntime ? next.activeWorkflow : next.activeWorkflow ?? previous.activeWorkflow,
    workflowRuns: options.clearWorkflowRuntime ? next.workflowRuns : next.workflowRuns.length > 0 ? next.workflowRuns : previous.workflowRuns,
  });
}

export function loadExecutionMemory(projectRoot: string, now = new Date().toISOString()): LoadExecutionMemoryResult {
  const path = getExecutionMemoryPath(projectRoot);
  if (!existsSync(path)) {
    return { path, memory: createEmptyExecutionMemory(now), recoveredFromInvalid: false };
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as ExecutionMemory;
    return { path, memory: pruneExecutionMemory({ ...createEmptyExecutionMemory(now), ...parsed, workflowRuns: parsed.workflowRuns ?? [] }), recoveredFromInvalid: false };
  } catch {
    const backupPath = `${path}.invalid-${Date.now()}`;
    renameSync(path, backupPath);
    return { path, memory: createEmptyExecutionMemory(now), recoveredFromInvalid: true, invalidBackupPath: backupPath };
  }
}

export function saveExecutionMemory(projectRoot: string, memory: ExecutionMemory, now = new Date().toISOString()): { path: string; memory: ExecutionMemory } {
  const path = getExecutionMemoryPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  const pruned = pruneExecutionMemory({ ...memory, updatedAt: now });
  writeFileSync(path, `${JSON.stringify(pruned, null, 2)}\n`, "utf-8");
  return { path, memory: pruned };
}
