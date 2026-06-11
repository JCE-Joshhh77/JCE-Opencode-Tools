export type TraceEventType =
  | "task.created"
  | "task.running"
  | "task.completed"
  | "task.failed"
  | "task.retry_scheduled"
  | "task.stale_detected"
  | "task.blocked"
  | "planner.explain"
  | "verification.recorded"
  | "summary.generated";

export interface TraceEvent {
  type: TraceEventType;
  taskId?: string;
  message: string;
  at: string;
  metadata?: Record<string, unknown>;
}

export function createTraceEvent(input: TraceEvent): TraceEvent {
  return { ...input };
}

export function pruneTraceEvents(events: TraceEvent[], maxEvents = 200): TraceEvent[] {
  return events.slice(Math.max(0, events.length - maxEvents));
}

export function appendTraceEvent(events: TraceEvent[], event: TraceEvent, maxEvents = 200): TraceEvent[] {
  return pruneTraceEvents([...events, event], maxEvents);
}
