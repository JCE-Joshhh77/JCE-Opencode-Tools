import { createTaskLearning, createWisdomEntry, type ExecutionMemory, type TaskLearning, type WisdomEntry } from "../lib/execution-memory.js";
import type { JceWorkerErrorCategory } from "../lib/error-taxonomy.js";
import type { HandoffReportInput } from "../lib/handoff.js";
import { appendTraceEvent, createTraceEvent } from "../lib/trace.js";
import type { TraceEvent, TraceEventType } from "../lib/trace.js";
import type { BackgroundTask, BackgroundManagerOptions, LaunchInput, ReviewStatus } from "./types.js";

interface RetryTaskInput {
  prompt: string;
  failureReason: string;
  category: JceWorkerErrorCategory;
}

export type RetryTaskResult =
  | { status: "created" | "existing"; task: BackgroundTask }
  | { status: "not_found" | "exhausted" | "already_scheduled_missing"; reason: string };

export class BackgroundManager {
  private tasks: Map<string, BackgroundTask> = new Map();
  private maxConcurrency: number;
  private staleAfterMs: number;
  private now: () => string;
  private traceEvents: TraceEvent[] = [];
  private wisdom: WisdomEntry[] = [];
  private taskLearnings: TaskLearning[] = [];
  private launchPending?: (taskId: string) => void;

  constructor(options: BackgroundManagerOptions) {
    this.maxConcurrency = options.maxConcurrency;
    this.staleAfterMs = options.staleAfterMs ?? 30 * 60 * 1000;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private recordTrace(type: TraceEventType, taskId: string | undefined, message: string, metadata?: Record<string, unknown>): void {
    const event = createTraceEvent({ type, taskId, message, at: this.now(), metadata });
    this.traceEvents = appendTraceEvent(this.traceEvents, event);
    if (taskId) {
      const task = this.tasks.get(taskId);
      if (task) task.traceEvents = appendTraceEvent(task.traceEvents ?? [], event, 50);
    }
  }

  private touch(task: BackgroundTask): void {
    task.lastActivityAt = this.now();
  }

  setPendingLauncher(launcher: (taskId: string) => void): void {
    this.launchPending = launcher;
  }

  private pumpPending(): void {
    if (!this.launchPending) return;
    for (const task of this.tasks.values()) {
      if (!this.canLaunch()) return;
      if (task.status === "pending") this.launchPending(task.id);
    }
  }

  createTask(input: LaunchInput): BackgroundTask {
    const timestamp = this.now();
    const task: BackgroundTask = {
      id: `bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      description: input.description,
      prompt: input.prompt,
      agent: input.agent,
      parentSessionId: input.parentSessionId,
      parentMessageId: input.parentMessageId,
      status: "pending",
      logicalState: "delegating",
      reviewStatus: "pending_review",
      reviewNotes: [],
      retryCount: input.retryCount ?? 0,
      maxRetries: input.maxRetries ?? 1,
      retryOfTaskId: input.retryOfTaskId,
      rootTaskId: input.rootTaskId ?? input.retryOfTaskId,
      recoveryCategory: input.recoveryCategory,
      lastActivityAt: timestamp,
      stale: false,
      failureReason: input.failureReason,
      modelHint: input.modelHint,
      createdAt: timestamp,
    };
    this.tasks.set(task.id, task);
    this.recordTrace("task.created", task.id, `Created task: ${task.description}`);
    return task;
  }

  getTask(id: string): BackgroundTask | undefined {
    this.markStaleTasks(this.staleAfterMs, { pumpPending: false });
    return this.tasks.get(id);
  }

  listTasks(): BackgroundTask[] {
    this.markStaleTasks(this.staleAfterMs, { pumpPending: false });
    return Array.from(this.tasks.values());
  }

  getTraceEvents(): TraceEvent[] {
    return [...this.traceEvents];
  }

  recordAcceptedDelegationLearning(task: BackgroundTask, evidenceStrength: string): void {
    this.wisdom.push(createWisdomEntry({
      learning: `Accepted ${task.agent} delegation for ${task.description} with ${evidenceStrength} evidence.`,
      source: "delegation",
      confidence: evidenceStrength === "strong" ? "high" : "medium",
      tags: ["delegation", task.agent],
      now: this.now(),
    }));
    this.taskLearnings.push(createTaskLearning({
      taskType: task.agent === "jce-researcher" ? "review" : "unknown",
      trigger: task.description,
      successfulRecipe: ["delegate atomic work", "collect result", "review evidence contract"],
      verificationCommands: task.verificationSummary ? [task.verificationSummary] : [],
      touchedAreas: [task.agent],
      now: this.now(),
    }));
  }

  cancelTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status === "completed" || task.status === "cancelled") return false;
    task.status = "cancelled";
    task.logicalState = "blocked";
    this.touch(task);
    this.recordTrace("task.blocked", task.id, "Task cancelled");
    return true;
  }

  completeTask(id: string, result: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.status === "cancelled") {
      this.recordTrace("verification.recorded", task.id, `Ignored late completion for ${task.status} task`);
      return;
    }
    task.status = "completed";
    task.result = result;
    task.completedAt = this.now();
    this.touch(task);
    this.recordTrace("task.completed", task.id, "Task completed");
    this.pumpPending();
  }

  failTask(id: string, error: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.status === "cancelled" || task.status === "completed") {
      this.recordTrace("verification.recorded", task.id, `Ignored late failure for ${task.status} task`, { error });
      return;
    }
    task.status = "error";
    task.error = error;
    task.failureReason = error;
    task.logicalState = "blocked";
    task.completedAt = this.now();
    this.touch(task);
    this.recordTrace("task.failed", task.id, error);
    this.pumpPending();
  }

  markRunning(id: string, sessionId: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.status !== "pending") return;
    task.status = "running";
    task.sessionId = sessionId;
    this.touch(task);
    this.recordTrace("task.running", task.id, "Task running", { sessionId });
  }

  recordContextBudget(id: string, budget: NonNullable<BackgroundTask["contextBudget"]>): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.contextBudget = budget;
    this.recordTrace("verification.recorded", task.id, "Context budget applied", budget);
  }

  markReview(id: string, reviewStatus: ReviewStatus, reviewNotes: string[], verificationSummary?: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.reviewStatus = reviewStatus;
    task.reviewNotes = reviewNotes;
    task.verificationSummary = verificationSummary;
    task.logicalState = reviewStatus === "accepted" ? "verifying" : reviewStatus === "blocked" ? "blocked" : "delegating";
    task.handoffReason = reviewStatus === "blocked" ? reviewNotes.join(", ") : task.handoffReason;
    this.touch(task);
    this.recordTrace(reviewStatus === "blocked" ? "task.blocked" : "verification.recorded", task.id, `Review: ${reviewStatus}`);
  }

  markStaleTasks(staleAfterMs: number = this.staleAfterMs, options: { pumpPending?: boolean } = {}): BackgroundTask[] {
    const nowMs = Date.parse(this.now());
    const stale: BackgroundTask[] = [];
    for (const task of this.tasks.values()) {
      if ((task.status === "pending" || task.status === "running") && nowMs - Date.parse(task.lastActivityAt) > staleAfterMs) {
        task.stale = true;
        stale.push(task);
        this.recordTrace("task.stale_detected", task.id, "Task is stale", { staleAfterMs });
        if (task.status === "running") {
          task.status = "error";
          task.logicalState = "blocked";
          task.failureReason = `Task stale for more than ${staleAfterMs}ms`;
          task.completedAt = this.now();
          this.recordTrace("task.failed", task.id, task.failureReason);
        }
      }
    }
    if (options.pumpPending !== false) this.pumpPending();
    return stale;
  }

  recordRetryableFailure(id: string, reason: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    task.failureReason = reason;
    task.reviewStatus = "retryable_failure";
    task.reviewNotes = [reason];
    if (task.retryCount < task.maxRetries) {
      this.touch(task);
      this.recordTrace("verification.recorded", task.id, reason, { retryCount: task.retryCount, maxRetries: task.maxRetries });
      return true;
    }
    task.reviewStatus = "blocked";
    task.logicalState = "blocked";
    task.reviewNotes = [`Retry limit exhausted: ${reason}`];
    this.touch(task);
    this.recordTrace("task.blocked", task.id, `Retry limit exhausted: ${reason}`);
    return false;
  }

  createRetryTask(id: string, input: RetryTaskInput): BackgroundTask | undefined {
    const result = this.createRetryTaskResult(id, input);
    return result.status === "created" || result.status === "existing" ? result.task : undefined;
  }

  createRetryTaskResult(id: string, input: RetryTaskInput): RetryTaskResult {
    const task = this.tasks.get(id);
    if (!task) return { status: "not_found", reason: `Task not found: ${id}` };
    const rootTaskId = task.rootTaskId ?? task.id;
    if (task.retryTaskId) {
      const existingRetry = this.tasks.get(task.retryTaskId);
      if (existingRetry) return { status: "existing", task: existingRetry };
      return { status: "already_scheduled_missing", reason: `Retry already scheduled but task is unavailable: ${task.retryTaskId}` };
    }

    if (task.retryCount >= task.maxRetries) {
      const reason = `Retry budget exhausted: ${input.failureReason}`;
      task.reviewStatus = "blocked";
      task.logicalState = "blocked";
      task.failureReason = input.failureReason;
      task.recoveryCategory = input.category;
      task.handoffReason = reason;
      this.touch(task);
      this.recordTrace("task.blocked", task.id, task.handoffReason, { category: input.category, retryCount: task.retryCount, maxRetries: task.maxRetries });
      return { status: "exhausted", reason };
    }

    const nextRetryCount = task.retryCount + 1;

    task.retryCount = nextRetryCount;
    task.reviewStatus = "retryable_failure";
    task.reviewNotes = [input.failureReason];
    task.failureReason = input.failureReason;
    task.recoveryCategory = input.category;
    task.logicalState = "delegating";
    task.handoffReason = undefined;
    task.handoff = undefined;
    this.touch(task);

    const retry = this.createTask({
      description: `${task.description} (retry ${nextRetryCount}/${task.maxRetries})`,
      prompt: input.prompt,
      agent: task.agent,
      parentSessionId: task.parentSessionId,
      parentMessageId: task.parentMessageId,
      maxRetries: task.maxRetries,
      retryCount: nextRetryCount,
      retryOfTaskId: task.id,
      rootTaskId,
      recoveryCategory: input.category,
      failureReason: input.failureReason,
    });

    task.retryTaskId = retry.id;
    this.recordTrace("task.retry_scheduled", task.id, input.failureReason, { retryTaskId: retry.id, category: input.category, retryCount: nextRetryCount, maxRetries: task.maxRetries });
    return { status: "created", task: retry };
  }

  blockTaskForRecovery(id: string, category: JceWorkerErrorCategory, reason: string, handoff: HandoffReportInput): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = "error";
    task.logicalState = "blocked";
    task.reviewStatus = "blocked";
    task.failureReason = reason;
    task.handoffReason = reason;
    task.recoveryCategory = category;
    task.handoff = handoff;
    task.completedAt = this.now();
    this.touch(task);
    this.recordTrace("task.blocked", task.id, reason, { category, handoff });
  }

  getRunningCount(): number {
    return this.listTasks().filter((t) => t.status === "running").length;
  }

  canLaunch(): boolean {
    return this.getRunningCount() < this.maxConcurrency;
  }

  toExecutionMemory(updatedAt = this.now()): ExecutionMemory {
    const tasks = this.listTasks();
    const budgets = tasks.map((task) => task.contextBudget).filter((budget): budget is NonNullable<BackgroundTask["contextBudget"]> => Boolean(budget));
    const originalChars = budgets.reduce((sum, budget) => sum + budget.originalChars, 0);
    const compressedChars = budgets.reduce((sum, budget) => sum + budget.compressedChars, 0);
    const estimatedTokensSaved = budgets.reduce((sum, budget) => sum + budget.estimatedTokensSaved, 0);
    const resolvedRetryRootIds = new Set(
      tasks
        .filter((task) => task.status === "completed" && task.reviewStatus === "accepted" && task.rootTaskId)
        .map((task) => task.rootTaskId as string),
    );
    return {
      version: 1,
      updatedAt,
      activeTasks: tasks.filter((task) => task.status === "pending" || task.status === "running"),
      completedSummaries: tasks.filter((task) => task.status === "completed").map((task) => ({
        id: task.id,
        description: task.description,
        result: task.result,
        completedAt: task.completedAt,
        reviewStatus: task.reviewStatus,
        reviewNotes: task.reviewNotes,
        verificationSummary: task.verificationSummary,
        retryCount: task.retryCount,
        maxRetries: task.maxRetries,
        retryOfTaskId: task.retryOfTaskId,
        rootTaskId: task.rootTaskId,
      })),
      blockers: tasks.filter((task) => task.logicalState === "blocked" || task.reviewStatus === "blocked").map((task) => ({
        id: task.id,
        description: task.description,
        failureReason: task.failureReason,
        handoffReason: task.handoffReason,
        recoveryCategory: task.recoveryCategory,
        handoff: task.handoff,
      })),
      verificationEvidence: tasks.filter((task) => task.verificationSummary).map((task) => ({
        id: task.id,
        verificationSummary: task.verificationSummary,
        reviewStatus: task.reviewStatus,
        reviewNotes: task.reviewNotes,
        rootTaskId: task.rootTaskId,
      })),
      retryHistory: tasks.filter((task) => task.retryCount > 0 || task.retryTaskId || task.retryOfTaskId).map((task) => ({
        id: task.id,
        retryCount: task.retryCount,
        maxRetries: task.maxRetries,
        retryTaskId: task.retryTaskId,
        retryOfTaskId: task.retryOfTaskId,
        rootTaskId: task.rootTaskId,
        recoveryCategory: task.recoveryCategory,
        failureReason: task.failureReason,
        reviewStatus: task.reviewStatus,
        status: task.status,
        logicalState: task.logicalState,
        resolved: task.reviewStatus === "accepted" || (Boolean(task.retryTaskId) && resolvedRetryRootIds.has(task.rootTaskId ?? task.id)),
      })),
      traceEvents: this.getTraceEvents(),
      workflowRuns: [],
      wisdom: [...this.wisdom],
      taskLearnings: [...this.taskLearnings],
      contextBudgetSummary: budgets.length > 0 ? {
        originalChars,
        compressedChars,
        estimatedTokensSaved,
        estimatedSavingsPercent: originalChars === 0 ? 0 : Math.max(0, Math.round((1 - compressedChars / originalChars) * 100)),
        tasks: budgets.length,
      } : undefined,
    };
  }
}
