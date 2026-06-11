import type { RuntimeState } from "./runtime-state.js";

export interface SelfCritiqueResult {
  canStop: boolean;
  reasons: string[];
}

export function evaluateSelfCritique(memory: RuntimeState): SelfCritiqueResult {
  const reasons: string[] = [];
  if (memory.activeTasks.length > 0) reasons.push("Active tasks remain.");
  if (memory.blockers.length > 0) reasons.push("Unresolved blockers remain.");
  if (memory.activeWorkflow && memory.activeWorkflow.status !== "completed") reasons.push(`Workflow still ${memory.activeWorkflow.status}.`);
  if (memory.autonomousExecutionSession?.continueUntilDone) reasons.push("Continue-until-done mode is active.");
  return { canStop: reasons.length === 0, reasons };
}
