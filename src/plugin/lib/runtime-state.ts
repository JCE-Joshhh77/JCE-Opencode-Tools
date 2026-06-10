import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { TraceEvent } from "./trace.js";
import type { WorkflowRun } from "./workflow.js";

export interface SkillCorrectionSession {
  forbidSkills: string[];
  preferSkills: string[];
  agentOverride?: string;
  updatedAt: string;
}

export interface RuntimeState {
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
  skillCorrectionSession?: SkillCorrectionSession;
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
  taskType: "audit" | "bugfix" | "feature" | "release" | "review" | "research" | "unknown";
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
  byTool?: Record<string, {
    originalChars: number;
    compressedChars: number;
    estimatedTokensSaved: number;
    tasks: number;
  }>;
}

export interface LoadRuntimeStateResult {
  path: string;
  runtime: RuntimeState;
  recoveredFromInvalid: boolean;
  invalidBackupPath?: string;
}

export interface MergeRuntimeStateOptions {
  preserveWorkflowRuntime?: boolean;
  clearWorkflowRuntime?: boolean;
}

const RUNTIME_COLLECTIONS = ["completedSummaries", "blockers", "verificationEvidence", "retryHistory"] as const;

export function getRuntimeStatePath(projectRoot: string): string {
  return join(projectRoot, ".opencode-jce", "jce-worker-execution.json");
}

export function createEmptyRuntimeState(now = new Date().toISOString()): RuntimeState {
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

export function createRuntimeWisdomEntry(input: {
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

export function addRuntimeWisdom(runtime: RuntimeState, entry: WisdomEntry): RuntimeState {
  const normalized = entry.learning.toLowerCase();
  const wisdom = (runtime.wisdom ?? []).filter((item) => item.learning.trim().toLowerCase() !== normalized);
  return pruneRuntimeState({ ...runtime, wisdom: [...wisdom, entry] });
}

export function createRuntimeTaskLearning(input: Omit<TaskLearning, "id" | "createdAt"> & { now?: string }): TaskLearning {
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

export function addRuntimeTaskLearning(runtime: RuntimeState, entry: TaskLearning): RuntimeState {
  const deduped = (runtime.taskLearnings ?? []).filter((item) => item.taskType !== entry.taskType || item.trigger.toLowerCase() !== entry.trigger.toLowerCase());
  return pruneRuntimeState({ ...runtime, taskLearnings: [...deduped, entry] });
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

function mergeContextBudgetSummary(previous?: ContextBudgetSummary, next?: ContextBudgetSummary): ContextBudgetSummary | undefined {
  if (!previous) return next;
  if (!next) return previous;
  const originalChars = previous.originalChars + next.originalChars;
  const compressedChars = previous.compressedChars + next.compressedChars;
  const byTool: NonNullable<ContextBudgetSummary["byTool"]> = { ...(previous.byTool ?? {}) };
  for (const [tool, value] of Object.entries(next.byTool ?? {})) {
    const prior = byTool[tool] ?? { originalChars: 0, compressedChars: 0, estimatedTokensSaved: 0, tasks: 0 };
    byTool[tool] = {
      originalChars: prior.originalChars + value.originalChars,
      compressedChars: prior.compressedChars + value.compressedChars,
      estimatedTokensSaved: prior.estimatedTokensSaved + value.estimatedTokensSaved,
      tasks: prior.tasks + value.tasks,
    };
  }
  return {
    originalChars,
    compressedChars,
    estimatedTokensSaved: previous.estimatedTokensSaved + next.estimatedTokensSaved,
    estimatedSavingsPercent: originalChars === 0 ? 0 : Math.max(0, Math.round((1 - compressedChars / originalChars) * 100)),
    tasks: previous.tasks + next.tasks,
    byTool,
  };
}

export function pruneRuntimeState(runtime: RuntimeState): RuntimeState {
  return {
    ...runtime,
    activeTasks: newest(runtime.activeTasks, 25),
    completedSummaries: newest(runtime.completedSummaries, 50),
    blockers: newest(runtime.blockers, 50),
    verificationEvidence: newest(runtime.verificationEvidence, 100),
    retryHistory: newest(runtime.retryHistory, 100),
    traceEvents: newest(runtime.traceEvents, 200),
    activeWorkflow: runtime.activeWorkflow,
    workflowRuns: newest(runtime.workflowRuns ?? [], 10),
    contextBudgetSummary: runtime.contextBudgetSummary,
    wisdom: newest(runtime.wisdom ?? [], 50),
    taskLearnings: newest(runtime.taskLearnings ?? [], 25),
  };
}

export function mergeRuntimeStateSnapshot(previous: RuntimeState, next: RuntimeState, options: MergeRuntimeStateOptions = {}): RuntimeState {
  if (!options.preserveWorkflowRuntime) return pruneRuntimeState(next);

  return pruneRuntimeState({
    ...next,
    ...Object.fromEntries(RUNTIME_COLLECTIONS.map((key) => [key, mergeById(previous[key], next[key])])),
    traceEvents: next.traceEvents.length > 0 ? next.traceEvents : previous.traceEvents,
    activeWorkflow: options.clearWorkflowRuntime ? next.activeWorkflow : next.activeWorkflow ?? previous.activeWorkflow,
    workflowRuns: options.clearWorkflowRuntime ? next.workflowRuns : next.workflowRuns.length > 0 ? next.workflowRuns : previous.workflowRuns,
    contextBudgetSummary: mergeContextBudgetSummary(previous.contextBudgetSummary, next.contextBudgetSummary),
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

export function loadRuntimeState(projectRoot: string, now = new Date().toISOString()): LoadRuntimeStateResult {
  const path = getRuntimeStatePath(projectRoot);
  if (!existsSync(path)) {
    return { path, runtime: createEmptyRuntimeState(now), recoveredFromInvalid: false };
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as RuntimeState;
    return { path, runtime: pruneRuntimeState({ ...createEmptyRuntimeState(now), ...parsed, workflowRuns: parsed.workflowRuns ?? [], wisdom: parsed.wisdom ?? [], taskLearnings: parsed.taskLearnings ?? [] }), recoveredFromInvalid: false };
  } catch {
    const backupPath = `${path}.invalid-${Date.now()}`;
    renameSync(path, backupPath);
    return { path, runtime: createEmptyRuntimeState(now), recoveredFromInvalid: true, invalidBackupPath: backupPath };
  }
}

export function saveRuntimeState(
  projectRoot: string,
  runtime: RuntimeState,
  now = new Date().toISOString(),
  options: MergeRuntimeStateOptions = { preserveWorkflowRuntime: true },
): { path: string; runtime: RuntimeState } {
  const path = getRuntimeStatePath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  const disk = loadRuntimeState(projectRoot, now).runtime;
  const pruned = mergeRuntimeStateSnapshot(disk, { ...runtime, updatedAt: now }, options);
  writeJsonAtomic(path, pruned);
  return { path, runtime: pruned };
}
