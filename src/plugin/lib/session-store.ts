import {
  addFailureMemory,
  createEmptyRuntimeState,
  createFailureMemoryEntry,
  createRuntimeTaskLearning,
  createRuntimeWisdomEntry,
  addRuntimeTaskLearning,
  addRuntimeWisdom,
  getRuntimeStatePath,
  loadRuntimeState,
  mergeRuntimeStateSnapshot,
  saveRuntimeState,
  type ContextBudgetSummary,
  type LoadRuntimeStateResult,
  type MergeRuntimeStateOptions,
  type RuntimeState,
  type SkillCorrectionSession,
  type TaskLearning,
  type WisdomEntry,
} from "./runtime-state.js";
import { loadMemoryV2, saveMemoryV2, type LoadMemoryResult } from "./orchestration/execution-memory-v2.js";

export interface SessionStoreSnapshot {
  runtime: RuntimeState;
  orchestration: LoadMemoryResult["memory"];
}

export interface LoadSessionStateResult {
  runtimePath: string;
  orchestrationPath: string;
  state: SessionStoreSnapshot;
  recoveredFromInvalid: {
    runtime: boolean;
    orchestration: boolean;
  };
  migrated: {
    orchestration: boolean;
  };
}

export interface SaveSessionStateOptions {
  runtime?: MergeRuntimeStateOptions;
  saveOrchestration?: boolean;
}

export function loadSessionState(projectRoot: string, now = new Date().toISOString()): LoadSessionStateResult {
  const runtimeLoaded = loadRuntimeState(projectRoot, now);
  const orchestrationLoaded = loadMemoryV2(projectRoot, now);
  return {
    runtimePath: runtimeLoaded.path,
    orchestrationPath: orchestrationLoaded.path,
    state: {
      runtime: runtimeLoaded.runtime,
      orchestration: orchestrationLoaded.memory,
    },
    recoveredFromInvalid: {
      runtime: runtimeLoaded.recoveredFromInvalid,
      orchestration: orchestrationLoaded.recoveredFromInvalid,
    },
    migrated: {
      orchestration: orchestrationLoaded.migrated,
    },
  };
}

export function saveSessionState(
  projectRoot: string,
  state: SessionStoreSnapshot,
  now = new Date().toISOString(),
  options: SaveSessionStateOptions = {},
): { runtime: RuntimeState; orchestration: LoadMemoryResult["memory"] } {
  const runtime = saveRuntimeState(projectRoot, state.runtime, now, options.runtime).runtime;
  const orchestration = options.saveOrchestration === false
    ? state.orchestration
    : saveMemoryV2(projectRoot, state.orchestration, now).memory;
  return { runtime, orchestration };
}

export {
  addFailureMemory,
  addRuntimeTaskLearning,
  addRuntimeWisdom,
  createEmptyRuntimeState,
  createFailureMemoryEntry,
  createRuntimeTaskLearning,
  createRuntimeWisdomEntry,
  getRuntimeStatePath,
  loadRuntimeState,
  mergeRuntimeStateSnapshot,
  saveRuntimeState,
};

export type {
  ContextBudgetSummary,
  LoadRuntimeStateResult,
  MergeRuntimeStateOptions,
  RuntimeState,
  SkillCorrectionSession,
  TaskLearning,
  WisdomEntry,
};
