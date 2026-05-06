import type { PolicyProfile } from "./verification-gate.js";
import { evaluateWorkflowCompletionGate } from "./verification-gate.js";
import type { WorkflowRun } from "./workflow.js";

export interface CompletionCertificateInput {
  profile: PolicyProfile;
  changedFiles: string[];
  delegatedReviews?: string[];
  residualRisks: string[];
}

export interface CompletionCertificateResult {
  valid: boolean;
  certificate: string;
}

function listOrNone(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- none";
}

export function buildCompletionCertificate(run: WorkflowRun, input: CompletionCertificateInput): CompletionCertificateResult {
  const gate = evaluateWorkflowCompletionGate(run, input.profile);
  const isBlocked = run.status === "blocked" || !!run.blocker || run.completionGate.status === "blocked" || gate.status === "blocked";
  const valid = !isBlocked && gate.status === "passed";
  const status = isBlocked ? "blocked" : valid ? "completed" : gate.status;
  const evidence = run.evidence.map((item) => item.summary);
  const gateReasons = [...gate.reasons, ...run.completionGate.reasons, ...(run.blocker ? [run.blocker.reason] : [])];

  const certificate = [
    "## Status",
    status,
    "",
    "## Outcome",
    run.goal,
    "",
    "## Acceptance Criteria",
    listOrNone(run.acceptanceCriteria),
    "",
    "## Evidence",
    listOrNone(evidence),
    "",
    "## Changed Or Inspected Files",
    listOrNone(input.changedFiles),
    "",
    "## Delegated Work Reviewed",
    listOrNone(input.delegatedReviews ?? []),
    "",
    "## Residual Risks",
    listOrNone(input.residualRisks),
    "",
    "## Gate Reasons",
    listOrNone(gateReasons),
  ].join("\n");

  return { valid, certificate };
}
