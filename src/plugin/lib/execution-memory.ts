import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
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
  contextBudgetSummary?: ContextBudgetSummary;
  wisdom: WisdomEntry[];
  taskLearnings: TaskLearning[];
}

export interface WisdomEntry {
  id: string;
  learning: string;
  source: "task" | "delegation" | "debug" | "review" | "release" | "tooling";
  createdAt: string;
  confidence?: "low" | "medium" | "high";
  tags?: string[];
}

export interface TaskLearning {
  id: string;
  taskType: "audit" | "bugfix" | "feature" | "release" | "review" | "unknown";
  trigger: string;
  successfulRecipe: string[];
  verificationCommands: string[];
  touchedAreas: string[];
  createdAt: string;
}

export interface ContextBudgetSummary {
  originalChars: number;
  compressedChars: number;
  estimatedTokensSaved: number;
  estimatedSavingsPercent: number;
  tasks: number;
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
    wisdom: [],
    taskLearnings: [],
  };
}

export function createWisdomEntry(input: {
  learning: string;
  source: WisdomEntry["source"];
  confidence?: WisdomEntry["confidence"];
  tags?: string[];
  now?: string;
}): WisdomEntry {
  const createdAt = input.now ?? new Date().toISOString();
  const normalized = input.learning.trim().replace(/\s+/g, " ");
  return {
    id: `wisdom-${Date.parse(createdAt) || Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    learning: normalized,
    source: input.source,
    createdAt,
    confidence: input.confidence ?? "medium",
    tags: [...new Set(input.tags ?? [])].slice(0, 8),
  };
}

export function addWisdom(memory: ExecutionMemory, entry: WisdomEntry): ExecutionMemory {
  const normalized = entry.learning.toLowerCase();
  const wisdom = (memory.wisdom ?? []).filter((item) => item.learning.trim().toLowerCase() !== normalized);
  return pruneExecutionMemory({ ...memory, wisdom: [...wisdom, entry] });
}

export function createTaskLearning(input: Omit<TaskLearning, "id" | "createdAt"> & { now?: string }): TaskLearning {
  const createdAt = input.now ?? new Date().toISOString();
  return {
    id: `task-learning-${Date.parse(createdAt) || Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    taskType: input.taskType,
    trigger: input.trigger.trim(),
    successfulRecipe: input.successfulRecipe.map((item) => item.trim()).filter(Boolean),
    verificationCommands: input.verificationCommands.map((item) => item.trim()).filter(Boolean),
    touchedAreas: input.touchedAreas.map((item) => item.trim()).filter(Boolean),
    createdAt,
  };
}

export function addTaskLearning(memory: ExecutionMemory, entry: TaskLearning): ExecutionMemory {
  const deduped = (memory.taskLearnings ?? []).filter((item) => item.taskType !== entry.taskType || item.trigger.toLowerCase() !== entry.trigger.toLowerCase());
  return pruneExecutionMemory({ ...memory, taskLearnings: [...deduped, entry] });
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
    contextBudgetSummary: memory.contextBudgetSummary,
    wisdom: newest(memory.wisdom ?? [], 50),
    taskLearnings: newest(memory.taskLearnings ?? [], 25),
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
    contextBudgetSummary: next.contextBudgetSummary ?? previous.contextBudgetSummary,
    wisdom: [...(previous.wisdom ?? []), ...(next.wisdom ?? [])],
  });
}

function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
    renameSync(tmp, path);
  } catch (error) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // Best-effort cleanup path; ignore secondary failures.
    }
    throw error;
  }
}

export function loadExecutionMemory(projectRoot: string, now = new Date().toISOString()): LoadExecutionMemoryResult {
  const path = getExecutionMemoryPath(projectRoot);
  if (!existsSync(path)) {
    return { path, memory: createEmptyExecutionMemory(now), recoveredFromInvalid: false };
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as ExecutionMemory;
    return { path, memory: pruneExecutionMemory({ ...createEmptyExecutionMemory(now), ...parsed, workflowRuns: parsed.workflowRuns ?? [], wisdom: parsed.wisdom ?? [], taskLearnings: parsed.taskLearnings ?? [] }), recoveredFromInvalid: false };
  } catch {
    const backupPath = `${path}.invalid-${Date.now()}`;
    renameSync(path, backupPath);
    return { path, memory: createEmptyExecutionMemory(now), recoveredFromInvalid: true, invalidBackupPath: backupPath };
  }
}

export function saveExecutionMemory(
  projectRoot: string,
  memory: ExecutionMemory,
  now = new Date().toISOString(),
  options: MergeExecutionMemoryOptions = { preserveWorkflowRuntime: true },
): { path: string; memory: ExecutionMemory } {
  const path = getExecutionMemoryPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  const disk = loadExecutionMemory(projectRoot, now).memory;
  const pruned = mergeExecutionMemorySnapshot(disk, { ...memory, updatedAt: now }, options);
  writeJsonAtomic(path, pruned);
  return { path, memory: pruned };
}
