import type { RuntimeState } from "./runtime-state.js";

type AnyRecord = Record<string, unknown>;

function last<T>(items: T[]): T | undefined {
  return items.length ? items[items.length - 1] : undefined;
}

function asArray<T>(value: T[] | unknown): T[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null;
}

export function getLatestVerificationEvidence(memory: RuntimeState): unknown | undefined {
  return last(asArray(memory.verificationEvidence));
}

export function getAttemptedCommands(memory: RuntimeState): string[] {
  const commands = asArray<RuntimeState["traceEvents"][number]>(memory.traceEvents)
    .map((event) => (isRecord(event.metadata) ? event.metadata.command : undefined))
    .filter((command): command is string => typeof command === "string" && command.trim().length > 0);
  return Array.from(new Set(commands));
}

export function getLatestFailure(memory: RuntimeState): { taskId?: string; message: string; at: string } | undefined {
  const failure = last(asArray<RuntimeState["traceEvents"][number]>(memory.traceEvents).filter((event) => event.type === "task.failed"));
  if (!failure) return undefined;
  return { taskId: failure.taskId, message: failure.message, at: failure.at };
}

export function getActiveBlockers(memory: RuntimeState): unknown[] {
  return [...asArray(memory.blockers)];
}

export function getStaleActiveTasks(memory: RuntimeState): unknown[] {
  return asArray(memory.activeTasks).filter((task) => isRecord(task) && Boolean(task.stale));
}

export function getRetryHistoryFor(memory: RuntimeState, id: string): unknown[] {
  return asArray(memory.retryHistory).filter((entry) => isRecord(entry) && (entry.id === id || entry.rootTaskId === id || entry.retryOfTaskId === id || entry.retryTaskId === id));
}
