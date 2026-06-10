import type { JceWorkerAgentHint } from "./skill-router.js";
import { evaluateWorkflowCompletionGate, type PolicyProfile } from "./verification-gate.js";
import type { WorkflowIntentRoute, WorkflowRun } from "./workflow.js";
import { hasAcceptedReview, hasUnresolvedExhaustedRetry } from "./shared-predicates.js";

export type ExecutionPolicyAction = "route_update" | "dispatch" | "completion_claim" | "final_review";
export type ExecutionPolicyDecisionStatus = "allow" | "warn" | "block";

export interface ExecutionPolicyDecision {
  status: ExecutionPolicyDecisionStatus;
  policyId: string;
  reasons: string[];
  warnings: string[];
  requiredEvidence: string[];
}

export interface ExecutionPolicyInput {
  action: ExecutionPolicyAction;
  profile: PolicyProfile;
  route?: WorkflowIntentRoute;
  nextRoute?: WorkflowIntentRoute;
  workflow?: WorkflowRun;
  dispatchAgent?: JceWorkerAgentHint;
  delegatedReviews?: string[];
  activeBlockers?: unknown[];
  retryHistory?: unknown[];
  finalReviewReasons?: string[];
  delegatedWorkRequired?: boolean;
}

function decision(status: ExecutionPolicyDecisionStatus, policyId: string, reasons: string[] = [], warnings: string[] = [], requiredEvidence: string[] = []): ExecutionPolicyDecision {
  return { status, policyId, reasons, warnings, requiredEvidence };
}

function allow(policyId = "policy.allow"): ExecutionPolicyDecision {
  return decision("allow", policyId);
}

function hasPassingCommandEvidence(workflow?: WorkflowRun): boolean {
  return !!workflow?.evidence.some((evidence) => evidence.kind === "command" && evidence.command && evidence.passed === true);
}

function evaluateTaskTypeVerification(input: ExecutionPolicyInput): ExecutionPolicyDecision | undefined {
  if (!input.workflow) return undefined;
  const gate = evaluateWorkflowCompletionGate(input.workflow, input.profile);
  if (gate.status === "passed") return undefined;
  return decision("block", "completion.task_type_verification.required", gate.reasons, [], ["task-type appropriate verification evidence"]);
}

function evaluateCompletionClaim(input: ExecutionPolicyInput): ExecutionPolicyDecision {
  if ((input.activeBlockers ?? []).length > 0) return decision("block", "completion.blockers.active", ["Active blockers must be resolved before completion."]);
  if ((input.retryHistory ?? []).some(hasUnresolvedExhaustedRetry)) return decision("block", "completion.retry_exhausted", ["Unresolved exhausted retry history blocks completion."]);
  if (input.route?.intent === "completion_claim" && !hasPassingCommandEvidence(input.workflow)) {
    return decision("block", "completion.verification.required", ["Completion claim route requires fresh verification evidence before reporting done."], [], ["passing verification evidence"]);
  }
  if (input.route?.intent === "bugfix" && !hasPassingCommandEvidence(input.workflow)) {
    return decision("block", "bugfix.regression.required", ["Bugfix route requires regression-focused verification evidence before completion."], [], ["passing command/test evidence"]);
  }
  const taskTypeDecision = evaluateTaskTypeVerification(input);
  if (taskTypeDecision) return taskTypeDecision;
  return allow("completion.allow");
}

function evaluateRouteUpdate(input: ExecutionPolicyInput): ExecutionPolicyDecision {
  if (!input.nextRoute) return allow("route.noop");
  if (input.route?.intent === "review" && input.nextRoute.intent === "completion_claim" && !hasAcceptedReview(input.delegatedReviews)) {
    return decision("block", "route.review.preserve", ["Review route requires accepted review evidence before completion claim routing can overwrite it."], [], ["accepted review evidence"]);
  }
  if (input.route && input.nextRoute.intent === "general") {
    return decision("block", "route.specificity.preserve", ["Generic route updates cannot overwrite an existing specific route."]);
  }
  if (input.route && input.nextRoute.source === "message" && input.route.intent === input.nextRoute.intent && input.route.source !== "message") {
    return decision("block", "route.source.preserve", ["Message route updates cannot overwrite a more specific route source."]);
  }
  return allow("route.update.allow");
}

function evaluateDispatch(input: ExecutionPolicyInput): ExecutionPolicyDecision {
  const route = input.nextRoute ?? input.route;
  if (!route?.agentHint || !input.dispatchAgent || route.agentHint === input.dispatchAgent) return allow("dispatch.allow");
  const warning = `Dispatch agent ${input.dispatchAgent} does not match route hint ${route.agentHint}.`;
  if (input.profile === "strict") return decision("block", "dispatch.agent_hint.mismatch", [warning], [], [`dispatch agent ${route.agentHint}`]);
  if (input.profile === "balanced") return decision("warn", "dispatch.agent_hint.mismatch", [], [warning]);
  return allow("dispatch.allow_fast");
}

function evaluateFinalReview(input: ExecutionPolicyInput): ExecutionPolicyDecision {
  if ((input.finalReviewReasons ?? []).length > 0) return decision("block", "final_review.blocked", input.finalReviewReasons ?? []);
  if (input.route?.intent === "review" && !hasAcceptedReview(input.delegatedReviews)) {
    return decision("block", "review.acceptance.required", ["Review route requires accepted review evidence before completion."], [], ["accepted review evidence"]);
  }
  return evaluateCompletionClaim({ ...input, action: "completion_claim" });
}

export function evaluateExecutionPolicy(input: ExecutionPolicyInput): ExecutionPolicyDecision {
  switch (input.action) {
  case "completion_claim":
    return evaluateCompletionClaim(input);
  case "route_update":
    return evaluateRouteUpdate(input);
  case "dispatch":
    return evaluateDispatch(input);
  case "final_review":
    return evaluateFinalReview(input);
  }
}

export function formatExecutionPolicyDecision(decision: ExecutionPolicyDecision): string {
  const label = decision.status === "block" ? "blocked" : decision.status === "warn" ? "warning" : "allowed";
  const details = [...decision.reasons, ...decision.warnings, ...decision.requiredEvidence.map((item) => `Required evidence: ${item}`)];
  return [`EXECUTION POLICY: ${label}`, `Policy: ${decision.policyId}`, ...details.map((item) => `- ${item}`)].join("\n");
}
