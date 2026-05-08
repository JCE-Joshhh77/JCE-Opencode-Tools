import type { JceWorkerState } from "../lib/state.js";
import type { JceWorkerErrorCategory } from "../lib/error-taxonomy.js";
import type { HandoffReportInput } from "../lib/handoff.js";
import type { TraceEvent } from "../lib/trace.js";

export type TaskStatus = "pending" | "running" | "completed" | "error" | "cancelled";
export type ReviewStatus = "pending_review" | "accepted" | "needs_followup" | "blocked" | "retryable_failure" | "not_applicable";

export interface BackgroundTask {
  id: string;
  description: string;
  prompt: string;
  agent: string;
  parentSessionId: string;
  parentMessageId: string;
  sessionId?: string;
  status: TaskStatus;
  logicalState: JceWorkerState;
  reviewStatus: ReviewStatus;
  reviewNotes: string[];
  verificationSummary?: string;
  retryCount: number;
  maxRetries: number;
  retryOfTaskId?: string;
  rootTaskId?: string;
  retryTaskId?: string;
  recoveryCategory?: JceWorkerErrorCategory;
  lastActivityAt: string;
  stale: boolean;
  failureReason?: string;
  handoffReason?: string;
  handoff?: HandoffReportInput;
  traceEvents?: TraceEvent[];
  result?: string;
  error?: string;
  contextBudget?: {
    originalChars: number;
    compressedChars: number;
    estimatedSavingsPercent: number;
    changed: boolean;
  };
  createdAt: string;
  completedAt?: string;
}

export interface LaunchInput {
  description: string;
  prompt: string;
  agent: string;
  parentSessionId: string;
  parentMessageId: string;
  maxRetries?: number;
  retryCount?: number;
  retryOfTaskId?: string;
  rootTaskId?: string;
  recoveryCategory?: JceWorkerErrorCategory;
  failureReason?: string;
}

export interface BackgroundManagerOptions {
  maxConcurrency: number;
  staleAfterMs?: number;
  now?: () => string;
}
