import type { RuntimeState } from "./session-store.js";

export function projectRuntimeToLegacyShadow(runtime: RuntimeState): RuntimeState {
  return {
    ...runtime,
    activeTasks: [...runtime.activeTasks],
    completedSummaries: [...runtime.completedSummaries],
    blockers: [...runtime.blockers],
    verificationEvidence: [...runtime.verificationEvidence],
    retryHistory: [...runtime.retryHistory],
    traceEvents: [...runtime.traceEvents],
    workflowRuns: [...runtime.workflowRuns],
    wisdom: [...runtime.wisdom],
    taskLearnings: [...runtime.taskLearnings],
    contextBudgetSummary: runtime.contextBudgetSummary
      ? {
          ...runtime.contextBudgetSummary,
          byTool: runtime.contextBudgetSummary.byTool ? { ...runtime.contextBudgetSummary.byTool } : undefined,
        }
      : undefined,
  };
}
