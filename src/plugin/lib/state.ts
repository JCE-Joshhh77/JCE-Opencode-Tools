export type JceWorkerState =
  | "intake"
  | "planning"
  | "executing"
  | "delegating"
  | "verifying"
  | "blocked"
  | "awaiting_user"
  | "completed";

const ALLOWED_TRANSITIONS: Record<JceWorkerState, JceWorkerState[]> = {
  intake: ["planning", "executing", "delegating", "blocked", "awaiting_user"],
  planning: ["executing", "delegating", "blocked", "awaiting_user"],
  executing: ["delegating", "verifying", "blocked", "awaiting_user", "completed"],
  delegating: ["executing", "verifying", "blocked", "awaiting_user"],
  verifying: ["executing", "blocked", "awaiting_user", "completed"],
  blocked: ["planning", "executing", "delegating", "verifying", "awaiting_user"],
  awaiting_user: ["planning", "executing", "delegating", "verifying", "blocked"],
  completed: [],
};

export function canTransitionState(from: JceWorkerState, to: JceWorkerState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function transitionState(from: JceWorkerState, to: JceWorkerState): JceWorkerState {
  if (!canTransitionState(from, to)) {
    throw new Error(`Invalid JCE-Worker state transition: ${from} -> ${to}`);
  }
  return to;
}
