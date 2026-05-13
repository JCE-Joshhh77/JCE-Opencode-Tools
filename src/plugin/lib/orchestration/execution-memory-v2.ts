/**
 * Execution Memory v2 — Structured format with auto-migration, TTL pruning, skill caching
 * 
 * Replaces the flat v1 format with structured orchestration data.
 * Provides automatic migration from v1 format and TTL-based pruning.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type {
  ExecutionMemoryV2,
  TaskGraphSnapshot,
  Fact,
  Decision,
  Artifact,
  Evidence,
  WisdomEntryV2,
  TaskLearningV2,
  ContextBudgetV2,
  SessionEntry,
  IntentType,
} from "./types.js";
import type { OrchestrationMemory, OrchestrationMemorySnapshot } from "./shared-memory.js";
import { snapshotMemory, restoreMemory } from "./shared-memory.js";
import { snapshotGraph, restoreGraph } from "./task-graph.js";
import type { TaskGraph } from "./types.js";

// ─── V1 Compatibility Types ──────────────────────────────────────────────────

interface ExecutionMemoryV1 {
  version: 1;
  updatedAt: string;
  activeTasks: unknown[];
  completedSummaries: unknown[];
  blockers: unknown[];
  verificationEvidence: unknown[];
  retryHistory: unknown[];
  traceEvents: unknown[];
  activeWorkflow?: unknown;
  workflowRuns: unknown[];
  contextBudgetSummary?: { originalChars: number; compressedChars: number; estimatedTokensSaved: number; estimatedSavingsPercent: number; tasks: number; byTool?: Record<string, unknown> };
  wisdom: Array<{ id: string; learning: string; source: string; createdAt: string; confidence?: string; tags?: string[] }>;
  taskLearnings: Array<{ id: string; taskType: string; trigger: string; successfulRecipe: string[]; verificationCommands: string[]; touchedAreas: string[]; createdAt: string }>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MEMORY_DIR = ".opencode-jce";
const MEMORY_FILE = "jce-worker-execution.json";
const SKILL_CACHE_FILE = "skill-cache.json";

const PRUNE_LIMITS = {
  maxFacts: 100,
  maxDecisions: 50,
  maxArtifacts: 200,
  maxEvidence: 200,
  maxWisdom: 75,
  maxTaskLearnings: 50,
  maxSessions: 20,
  wisdomTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  factTtlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  sessionTtlMs: 14 * 24 * 60 * 60 * 1000, // 14 days
};

// ─── Creation ─────────────────────────────────────────────────────────────────

export function createEmptyMemoryV2(now?: string): ExecutionMemoryV2 {
  const ts = now ?? new Date().toISOString();
  return {
    version: 2,
    updatedAt: ts,
    facts: [],
    decisions: [],
    artifacts: [],
    evidence: [],
    wisdom: [],
    taskLearnings: [],
    sessionHistory: [],
  };
}

// ─── Migration from V1 ───────────────────────────────────────────────────────

function isV1Memory(data: unknown): data is ExecutionMemoryV1 {
  return typeof data === "object" && data !== null && "version" in data && (data as { version: unknown }).version === 1;
}

function migrateV1ToV2(v1: ExecutionMemoryV1): ExecutionMemoryV2 {
  const now = v1.updatedAt || new Date().toISOString();

  // Migrate wisdom
  const wisdom: WisdomEntryV2[] = (v1.wisdom ?? []).map((w) => ({
    id: w.id,
    learning: w.learning,
    source: w.source as WisdomEntryV2["source"],
    confidence: (w.confidence as WisdomEntryV2["confidence"]) ?? "medium",
    tags: w.tags ?? [],
    createdAt: w.createdAt,
    usageCount: 0,
  }));

  // Migrate task learnings
  const taskLearnings: TaskLearningV2[] = (v1.taskLearnings ?? []).map((tl) => ({
    id: tl.id,
    taskType: mapV1TaskType(tl.taskType),
    trigger: tl.trigger,
    successfulRecipe: tl.successfulRecipe,
    verificationCommands: tl.verificationCommands,
    touchedAreas: tl.touchedAreas,
    confidence: 0.7,
    createdAt: tl.createdAt,
  }));

  // Migrate context budget
  const contextBudget: ContextBudgetV2 | undefined = v1.contextBudgetSummary ? {
    totalOriginalChars: v1.contextBudgetSummary.originalChars,
    totalCompressedChars: v1.contextBudgetSummary.compressedChars,
    totalTokensSaved: v1.contextBudgetSummary.estimatedTokensSaved,
    savingsPercent: v1.contextBudgetSummary.estimatedSavingsPercent,
    bySource: {},
  } : undefined;

  return {
    version: 2,
    updatedAt: now,
    facts: [],
    decisions: [],
    artifacts: [],
    evidence: [],
    wisdom,
    taskLearnings,
    contextBudget,
    sessionHistory: [],
  };
}

function mapV1TaskType(v1Type: string): IntentType {
  const map: Record<string, IntentType> = {
    audit: "review",
    bugfix: "bugfix",
    feature: "feature",
    release: "release",
    review: "review",
    unknown: "general",
  };
  return map[v1Type] ?? "general";
}

// ─── File Operations ──────────────────────────────────────────────────────────

export function getMemoryPath(projectRoot: string): string {
  return join(projectRoot, MEMORY_DIR, MEMORY_FILE);
}

function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
    renameSync(tmp, path);
  } catch (error) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* best-effort */ }
    throw error;
  }
}

// ─── Load & Save ──────────────────────────────────────────────────────────────

export interface LoadMemoryResult {
  path: string;
  memory: ExecutionMemoryV2;
  migrated: boolean;
  recoveredFromInvalid: boolean;
}

export function loadMemoryV2(projectRoot: string, now?: string): LoadMemoryResult {
  const path = getMemoryPath(projectRoot);
  const ts = now ?? new Date().toISOString();

  if (!existsSync(path)) {
    return { path, memory: createEmptyMemoryV2(ts), migrated: false, recoveredFromInvalid: false };
  }

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);

    // Auto-migrate from v1
    if (isV1Memory(parsed)) {
      const migrated = migrateV1ToV2(parsed);
      return { path, memory: migrated, migrated: true, recoveredFromInvalid: false };
    }

    // V2 format
    if (parsed.version === 2) {
      return { path, memory: parsed as ExecutionMemoryV2, migrated: false, recoveredFromInvalid: false };
    }

    // Unknown version — treat as empty
    return { path, memory: createEmptyMemoryV2(ts), migrated: false, recoveredFromInvalid: true };
  } catch {
    // Corrupted file — backup and start fresh
    const backupPath = `${path}.invalid-${Date.now()}`;
    try { renameSync(path, backupPath); } catch { /* best-effort */ }
    return { path, memory: createEmptyMemoryV2(ts), migrated: false, recoveredFromInvalid: true };
  }
}

export function saveMemoryV2(projectRoot: string, memory: ExecutionMemoryV2, now?: string): { path: string; memory: ExecutionMemoryV2 } {
  const path = getMemoryPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });

  const pruned = pruneMemoryV2({ ...memory, updatedAt: now ?? new Date().toISOString() });
  writeJsonAtomic(path, pruned);
  return { path, memory: pruned };
}

// ─── Pruning ──────────────────────────────────────────────────────────────────

export function pruneMemoryV2(memory: ExecutionMemoryV2, now?: string): ExecutionMemoryV2 {
  const ts = now ?? new Date().toISOString();
  const nowMs = Date.parse(ts);

  // Prune facts by TTL and limit
  let facts = memory.facts.filter((f) => {
    if (f.expiresAt && Date.parse(f.expiresAt) < nowMs) return false;
    return true;
  });
  if (facts.length > PRUNE_LIMITS.maxFacts) {
    facts = facts.sort((a, b) => b.confidence - a.confidence).slice(0, PRUNE_LIMITS.maxFacts);
  }

  // Prune decisions (keep active, trim old superseded)
  let decisions = memory.decisions;
  if (decisions.length > PRUNE_LIMITS.maxDecisions) {
    const active = decisions.filter((d) => d.status === "active");
    const inactive = decisions.filter((d) => d.status !== "active");
    decisions = [...active, ...inactive.slice(-(PRUNE_LIMITS.maxDecisions - active.length))];
  }

  // Prune artifacts (keep latest per path)
  let artifacts = memory.artifacts;
  if (artifacts.length > PRUNE_LIMITS.maxArtifacts) {
    artifacts = artifacts.slice(-PRUNE_LIMITS.maxArtifacts);
  }

  // Prune evidence
  let evidence = memory.evidence;
  if (evidence.length > PRUNE_LIMITS.maxEvidence) {
    evidence = evidence.slice(-PRUNE_LIMITS.maxEvidence);
  }

  // Prune wisdom by TTL and limit
  let wisdom = memory.wisdom.filter((w) => {
    if (w.expiresAt && Date.parse(w.expiresAt) < nowMs) return false;
    const age = nowMs - Date.parse(w.createdAt);
    if (age > PRUNE_LIMITS.wisdomTtlMs && w.usageCount === 0) return false;
    return true;
  });
  if (wisdom.length > PRUNE_LIMITS.maxWisdom) {
    // Keep high-confidence and frequently-used wisdom
    wisdom = wisdom
      .sort((a, b) => {
        const confScore = (b.confidence === "high" ? 3 : b.confidence === "medium" ? 2 : 1) - (a.confidence === "high" ? 3 : a.confidence === "medium" ? 2 : 1);
        if (confScore !== 0) return confScore;
        return b.usageCount - a.usageCount;
      })
      .slice(0, PRUNE_LIMITS.maxWisdom);
  }

  // Prune task learnings
  let taskLearnings = memory.taskLearnings;
  if (taskLearnings.length > PRUNE_LIMITS.maxTaskLearnings) {
    taskLearnings = taskLearnings
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, PRUNE_LIMITS.maxTaskLearnings);
  }

  // Prune session history
  let sessionHistory = memory.sessionHistory.filter((s) => {
    const age = nowMs - Date.parse(s.startedAt);
    return age < PRUNE_LIMITS.sessionTtlMs;
  });
  if (sessionHistory.length > PRUNE_LIMITS.maxSessions) {
    sessionHistory = sessionHistory.slice(-PRUNE_LIMITS.maxSessions);
  }

  return {
    ...memory,
    updatedAt: ts,
    facts,
    decisions,
    artifacts,
    evidence,
    wisdom,
    taskLearnings,
    sessionHistory,
  };
}

// ─── Memory Integration with Orchestration ────────────────────────────────────

/**
 * Merge orchestration memory snapshot into execution memory for persistence.
 */
export function mergeOrchestrationIntoMemory(
  execMemory: ExecutionMemoryV2,
  orchMemory: OrchestrationMemory,
  graph?: TaskGraph,
  now?: string,
): ExecutionMemoryV2 {
  const snapshot = snapshotMemory(orchMemory);
  const ts = now ?? new Date().toISOString();

  return {
    ...execMemory,
    updatedAt: ts,
    graph: graph ? snapshotGraph(graph) : execMemory.graph,
    facts: deduplicateByKey(execMemory.facts, snapshot.facts, "key"),
    decisions: [...execMemory.decisions, ...snapshot.decisions.filter((d) => !execMemory.decisions.some((ed) => ed.id === d.id))],
    artifacts: deduplicateByKey([...execMemory.artifacts, ...snapshot.artifacts], [], "path"),
    evidence: [...execMemory.evidence, ...snapshot.facts.length > 0 ? [] : []], // Evidence comes from nodes, not memory
  };
}

/**
 * Restore orchestration memory from execution memory.
 */
export function restoreOrchestrationFromMemory(execMemory: ExecutionMemoryV2): { memory: OrchestrationMemory; graph?: TaskGraph } {
  const memory = restoreMemory({
    facts: execMemory.facts,
    decisions: execMemory.decisions,
    constraints: [],
    artifacts: execMemory.artifacts,
    signals: [],
    createdAt: execMemory.updatedAt,
    updatedAt: execMemory.updatedAt,
  });

  const graph = execMemory.graph ? restoreGraph(execMemory.graph) : undefined;
  return { memory, graph };
}

// ─── Skill Cache ──────────────────────────────────────────────────────────────

interface SkillCacheEntry {
  path: string;
  content: string;
  loadedAt: string;
  size: number;
}

interface SkillCache {
  entries: Record<string, SkillCacheEntry>;
  updatedAt: string;
}

export function getSkillCachePath(projectRoot: string): string {
  return join(projectRoot, MEMORY_DIR, SKILL_CACHE_FILE);
}

export function loadSkillCache(projectRoot: string): SkillCache {
  const path = getSkillCachePath(projectRoot);
  if (!existsSync(path)) return { entries: {}, updatedAt: new Date().toISOString() };
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SkillCache;
  } catch {
    return { entries: {}, updatedAt: new Date().toISOString() };
  }
}

export function saveSkillCache(projectRoot: string, cache: SkillCache): void {
  const path = getSkillCachePath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeJsonAtomic(path, cache);
}

export function getCachedSkill(cache: SkillCache, skillName: string): string | undefined {
  const entry = cache.entries[skillName];
  if (!entry) return undefined;
  // Cache entries are valid for 1 hour
  const age = Date.now() - Date.parse(entry.loadedAt);
  if (age > 60 * 60 * 1000) return undefined;
  return entry.content;
}

export function setCachedSkill(cache: SkillCache, skillName: string, path: string, content: string): SkillCache {
  return {
    entries: {
      ...cache.entries,
      [skillName]: { path, content, loadedAt: new Date().toISOString(), size: content.length },
    },
    updatedAt: new Date().toISOString(),
  };
}

// ─── Session Tracking ─────────────────────────────────────────────────────────

export function startSession(memory: ExecutionMemoryV2, intent?: IntentType, now?: string): ExecutionMemoryV2 {
  const ts = now ?? new Date().toISOString();
  const session: SessionEntry = {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    startedAt: ts,
    nodesCompleted: 0,
    nodesFailed: 0,
    intent,
  };
  return { ...memory, sessionHistory: [...memory.sessionHistory, session] };
}

export function endSession(memory: ExecutionMemoryV2, nodesCompleted: number, nodesFailed: number, now?: string): ExecutionMemoryV2 {
  const ts = now ?? new Date().toISOString();
  const sessions = [...memory.sessionHistory];
  if (sessions.length > 0) {
    const last = { ...sessions[sessions.length - 1] };
    last.endedAt = ts;
    last.nodesCompleted = nodesCompleted;
    last.nodesFailed = nodesFailed;
    sessions[sessions.length - 1] = last;
  }
  return { ...memory, sessionHistory: sessions };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deduplicateByKey<T>(existing: T[], incoming: T[], key: keyof T): T[] {
  const seen = new Set(existing.map((item) => item[key] as unknown as string));
  const merged = [...existing];
  for (const item of incoming) {
    const val = item[key] as unknown as string;
    if (!seen.has(val)) {
      merged.push(item);
      seen.add(val);
    }
  }
  return merged;
}
