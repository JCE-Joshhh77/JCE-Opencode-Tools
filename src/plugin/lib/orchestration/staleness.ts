/**
 * Staleness Authority — single source of truth for "is this persisted state too
 * old / terminal to resurrect onto a new session?"
 *
 * Both memory systems consult this module so the definition of "stale" can never
 * drift between them (the structural root cause of the C1/C2 cross-session
 * leakage bugs):
 *   - v2 orchestration graph  -> shouldRestorePersistedGraph()
 *   - v1 activeWorkflow        -> shouldDropPersistedWorkflow()
 *
 * Each store still respects its own activity model (v2 = TTL+terminal,
 * v1 = TTL+terminal gated by active background tasks), but they share ONE TTL
 * constant and ONE timestamp/terminal definition.
 */

/** Maximum age before persisted in-progress state is considered stale. */
export const STALE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * True when `updatedAt` is missing, unparsable, or older than `ttlMs` relative
 * to `now` (epoch ms). Missing/invalid timestamps are treated as stale.
 */
export function isStaleTimestamp(updatedAt: string | undefined, now: number, ttlMs: number = STALE_TTL_MS): boolean {
  if (!updatedAt) return true;
  const ms = Date.parse(updatedAt);
  if (Number.isNaN(ms)) return true;
  return now - ms > ttlMs;
}

/** Terminal states for a v2 orchestration graph (work is finished/abandoned). */
export function isTerminalGraphStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

/** Terminal state for a v1 workflow run. */
export function isTerminalWorkflowStatus(status: string): boolean {
  return status === "completed";
}

export interface GraphStalenessInput {
  status: string;
  updatedAt: string;
}

/**
 * v2: a persisted graph is restored only when it is non-terminal AND recent.
 */
export function shouldRestorePersistedGraph(graph: GraphStalenessInput | undefined, now: number, ttlMs: number = STALE_TTL_MS): boolean {
  if (!graph) return false;
  if (isTerminalGraphStatus(graph.status)) return false;
  return !isStaleTimestamp(graph.updatedAt, now, ttlMs);
}

export interface WorkflowStalenessInput {
  status: string;
  updatedAt: string;
  /** Whether background tasks are still active for this workflow's session. */
  hasActiveTasks: boolean;
}

/**
 * v1: a persisted activeWorkflow is DROPPED when it is no longer backed by any
 * active background task AND it is either terminal or stale by TTL.
 *
 * The active-tasks gate preserves genuinely in-progress runtime sessions while
 * discarding abandoned month-old workflows (the C2 scenario: 0 tasks + stale +
 * a bogus goal seeded from tool output).
 */
export function shouldDropPersistedWorkflow(workflow: WorkflowStalenessInput | undefined, now: number, ttlMs: number = STALE_TTL_MS): boolean {
  if (!workflow) return false;
  if (workflow.hasActiveTasks) return false;
  return isTerminalWorkflowStatus(workflow.status) || isStaleTimestamp(workflow.updatedAt, now, ttlMs);
}
