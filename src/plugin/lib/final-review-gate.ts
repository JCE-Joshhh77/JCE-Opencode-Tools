import { buildCompletionCertificate } from "./completion-certificate.js";
import type { PolicyProfile } from "./verification-gate.js";
import { evaluateWorkflowCompletionGate } from "./verification-gate.js";
import type { WorkflowRun } from "./workflow.js";

export interface FinalReviewGateInput {
  profile: PolicyProfile;
  changedFiles: string[];
  delegatedReviews: string[];
  residualRisks: string[];
  activeBlockers: unknown[];
  retryHistory: unknown[];
  delegatedWorkRequired?: boolean;
  policyReasons?: string[];
}

export interface FinalReviewGateResult {
  status: "pass" | "block";
  reasons: string[];
  summary: string;
  certificate: ReturnType<typeof buildCompletionCertificate>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function describeBlocker(blocker: unknown): string {
  if (!isRecord(blocker)) return String(blocker);
  const reason = blocker.reason ?? blocker.handoffReason ?? blocker.failureReason ?? blocker.id;
  return typeof reason === "string" ? reason : JSON.stringify(blocker);
}

function retryId(entry: unknown): string {
  return isRecord(entry) && typeof entry.id === "string" ? entry.id : "unknown";
}

function hasExhaustedRetry(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  if (entry.resolved === true) return false;
  if (entry.reviewStatus === "accepted" || entry.status === "completed") return false;
  const hasExhaustedText = [entry.failureReason, entry.handoffReason, entry.status, entry.recoveryStatus].some(
    (value) => typeof value === "string" && /(?:retry (?:budget|limit) )?exhausted/i.test(value),
  );
  if (hasExhaustedText || entry.retryExhausted === true || entry.exhausted === true) return true;
  const hasUnresolvedFailureMarker = [entry.status, entry.reviewStatus, entry.logicalState].some(
    (value) => typeof value === "string" && /^(blocked|error|failed)$/i.test(value.trim()),
  ) || typeof entry.failureReason === "string" || typeof entry.handoffReason === "string";
  return (
    typeof entry.retryCount === "number" &&
    typeof entry.maxRetries === "number" &&
    Number.isFinite(entry.maxRetries) &&
    entry.maxRetries >= 0 &&
    entry.retryCount >= entry.maxRetries &&
    hasUnresolvedFailureMarker
  );
}

function hasAcceptedDelegatedReview(reviews: string[]): boolean {
  return reviews.some((review) => /^accepted(?:$|[:\s])/i.test(review.trim()) || /\b(?:status|review)\s*[:=]\s*accepted\b/i.test(review));
}

function hasAcceptedAllDelegatedReviews(reviews: string[]): boolean {
  return reviews.length > 0 && reviews.every((review) => /^accepted(?:$|[:\s])/i.test(review.trim()) || /\b(?:status|review)\s*[:=]\s*accepted\b/i.test(review));
}

function routePolicyReasons(run: WorkflowRun, gateReasons: string[], hasAcceptedReview: boolean): string[] {
  if (!run.route) return [];
  if (run.route.intent === "completion_claim" && gateReasons.length > 0) {
    return ["Completion claim route requires fresh verification evidence before reporting done."];
  }
  if (run.route.intent === "review" && !hasAcceptedReview) return ["Review route requires accepted review evidence before completion."];
  if (run.route.intent === "bugfix" && gateReasons.length > 0) {
    return ["Bugfix route requires regression-focused verification evidence before completion."];
  }
  return [];
}

export function evaluateFinalReviewGate(run: WorkflowRun, input: FinalReviewGateInput): FinalReviewGateResult {
  const gate = evaluateWorkflowCompletionGate(run, input.profile);
  const certificate = buildCompletionCertificate(run, {
    profile: input.profile,
    changedFiles: input.changedFiles,
    delegatedReviews: input.delegatedReviews,
    residualRisks: input.residualRisks,
  });
  const hasAcceptedReview = hasAcceptedDelegatedReview(input.delegatedReviews);
  const hasAcceptedRequiredDelegatedReviews = hasAcceptedAllDelegatedReviews(input.delegatedReviews);
  const reasons = [
    ...gate.reasons,
    ...routePolicyReasons(run, gate.reasons, hasAcceptedReview),
    ...(input.policyReasons ?? []),
    ...input.activeBlockers.map((blocker) => `Active blocker remains: ${describeBlocker(blocker)}`),
    ...input.retryHistory.filter(hasExhaustedRetry).map((entry) => `Retry history contains unresolved exhausted recovery: ${retryId(entry)}`),
  ];

  if (run.status === "blocked" || run.blocker) reasons.push(run.blocker?.reason ?? "Workflow is blocked.");
  if (!certificate.valid) reasons.push("Completion certificate is not valid.");
  if (input.delegatedWorkRequired && !hasAcceptedRequiredDelegatedReviews) reasons.push("Delegated review has not been accepted yet.");

  const uniqueReasons = Array.from(new Set(reasons));
  const status = uniqueReasons.length === 0 ? "pass" : "block";
  return {
    status,
    reasons: uniqueReasons,
    certificate,
    summary: status === "pass" ? "Final review gate passed." : `Final review gate blocked: ${uniqueReasons.join("; ")}`,
  };
}
