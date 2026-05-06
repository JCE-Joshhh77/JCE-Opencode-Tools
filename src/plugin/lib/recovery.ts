import { classifyJceWorkerError } from "./error-taxonomy.js";
import type { JceWorkerErrorCategory } from "./error-taxonomy.js";
import type { HandoffReportInput } from "./handoff.js";
import type { WorkflowRun } from "./workflow.js";

export type RecoveryAction = "retry" | "blocked" | "needs_followup";

export interface RecoveryInput {
  errorText: string;
  retryCount: number;
  maxRetries: number;
  workflow: WorkflowRun;
  priorEvidence: string[];
}

export interface RecoveryDecision {
  action: RecoveryAction;
  category: JceWorkerErrorCategory;
  reason: string;
  handoff?: HandoffReportInput;
}

export interface RetryPromptInput {
  originalPrompt: string;
  category: JceWorkerErrorCategory;
  failureReason: string;
  priorEvidence: string[];
  retryCount: number;
  maxRetries: number;
}

const RETRYABLE: JceWorkerErrorCategory[] = ["transient_network", "tool_failure", "delegated_contract_failure", "verification_failed"];
const BLOCK_IMMEDIATE: JceWorkerErrorCategory[] = ["missing_access", "user_approval_required", "merge_conflict"];

function normalizeRetryCounter(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function completedItems(workflow: WorkflowRun): string[] {
  return workflow.steps.filter((step) => step.status === "completed").map((step) => step.title);
}

function nextOptionsFor(category: JceWorkerErrorCategory, retryExhausted: boolean): string[] {
  if (retryExhausted) return ["Inspect failure, adjust task or retry manually."];
  if (category === "missing_access" || category === "user_approval_required") return ["Resolve missing access or approval, then retry."];
  if (category === "merge_conflict") return ["Resolve merge conflicts, then retry."];
  return ["Inspect failure and decide next action."];
}

function buildBlockedHandoff(input: RecoveryInput, blocker: string, retryExhausted = false): HandoffReportInput {
  const category = classifyJceWorkerError(input.errorText).category;
  return {
    status: "blocked",
    completed: completedItems(input.workflow),
    blocker,
    evidence: input.priorEvidence.length ? input.priorEvidence : [input.errorText],
    nextOptions: nextOptionsFor(category, retryExhausted),
  };
}

export function decideRecovery(input: RecoveryInput): RecoveryDecision {
  const classification = classifyJceWorkerError(input.errorText);
  const retryCount = normalizeRetryCounter(input.retryCount);
  const maxRetries = normalizeRetryCounter(input.maxRetries);

  if (classification.category === "ambiguous_requirement") {
    return { action: "needs_followup", category: classification.category, reason: classification.reason };
  }

  if (BLOCK_IMMEDIATE.includes(classification.category)) {
    return { action: "blocked", category: classification.category, reason: classification.reason, handoff: buildBlockedHandoff(input, classification.reason) };
  }

  if (RETRYABLE.includes(classification.category)) {
    if (retryCount < maxRetries) {
      return { action: "retry", category: classification.category, reason: `${classification.reason} retry budget remains.` };
    }
    return {
      action: "blocked",
      category: classification.category,
      reason: "Retry budget exhausted.",
      handoff: buildBlockedHandoff(input, `Retry budget exhausted: ${classification.reason}`, true),
    };
  }

  return { action: "blocked", category: classification.category, reason: classification.reason, handoff: buildBlockedHandoff(input, classification.reason) };
}

function list(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- none";
}

export function buildRetryPrompt(input: RetryPromptInput): string {
  return [
    input.originalPrompt,
    "",
    "## Retry Context",
    `Retry ${input.retryCount} of ${input.maxRetries}`,
    `Failure category: ${input.category}`,
    `Failure reason: ${input.failureReason}`,
    "",
    "## Prior Evidence",
    list(input.priorEvidence),
    "",
    "Use the prior evidence to avoid repeating failed work. Return the required delegated result contract.",
  ].join("\n");
}
