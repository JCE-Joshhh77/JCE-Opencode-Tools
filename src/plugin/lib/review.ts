import { validateDelegatedResult } from "./policy.js";
import type { ReviewStatus } from "../background/types.js";
import { scoreDelegatedContract } from "./delegated-contract-scoring.js";

export type RichReviewStatus = ReviewStatus | "blocked" | "retryable_failure";

export interface DelegatedReviewVerdict {
  status: RichReviewStatus;
  missing: string[];
  notes: string[];
  retryable: boolean;
  suggestedAgent?: string;
}

export interface DelegatedReviewOptions {
  agent?: string;
}

const BLOCKED_PATTERNS = [/\bblocked\b/i, /missing credentials/i, /approval required/i, /access denied/i, /merge conflict/i, /user action/i];
const RETRYABLE_PATTERNS = [/timeout/i, /rate limit/i, /network/i, /temporar/i, /retry may succeed/i, /service unavailable/i];

function validateResearchResult(text: string): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  // Research needs: Short Answer OR Research Scope, Evidence OR Findings, Risks & Unknowns
  const hasShortAnswer = /## (Short Answer|Research Scope)/i.test(text);
  const hasEvidence = /## (Evidence|Findings)/i.test(text);
  const hasRisks = /## (Risks|Risks & Unknowns)/i.test(text);

  if (!hasShortAnswer) missing.push("Summary (Short Answer or Research Scope)");
  if (!hasEvidence) missing.push("Evidence (Evidence or Findings)");
  if (!hasRisks) missing.push("Risks (Risks & Unknowns)");

  return { valid: missing.length === 0, missing };
}

export function classifyDelegatedReview(text: string, options: DelegatedReviewOptions = {}): DelegatedReviewVerdict {
  if (text.trim().length < 20 && !/^##\s+/m.test(text)) {
    return { status: "needs_followup", missing: [], notes: ["Delegated output quality too low; consider switching agent"], retryable: true, suggestedAgent: options.agent === "explorer" ? "oracle" : "explorer" };
  }
  // Use research-specific validation for jce-researcher
  const contract = options.agent === "jce-researcher"
    ? validateResearchResult(text)
    : validateDelegatedResult(text);

  const blocked = BLOCKED_PATTERNS.some((pattern) => pattern.test(text));
  const retryable = RETRYABLE_PATTERNS.some((pattern) => pattern.test(text));

  if (retryable) {
    return { status: "retryable_failure", missing: contract.missing, notes: ["Delegated output indicates retryable failure"], retryable: true };
  }

  if (blocked) {
    return { status: "blocked", missing: contract.missing, notes: ["Delegated output indicates blocked state"], retryable: false };
  }

  if (!contract.valid) {
    return { status: "needs_followup", missing: contract.missing, notes: [`Missing required sections: ${contract.missing.join(", ")}`], retryable: false };
  }

  const score = scoreDelegatedContract(text);
  if (score.recommendSwitchAgent) {
    return { status: "needs_followup", missing: [], notes: ["Delegated output quality too low; consider switching agent"], retryable: true, suggestedAgent: options.agent === "explorer" ? "oracle" : "explorer" };
  }
  if (score.recommendRetryWithContext) {
    return { status: "needs_followup", missing: [], notes: ["Delegated output needs retry with richer context"], retryable: true };
  }
  if (score.needsFollowup) {
    return { status: "needs_followup", missing: [], notes: ["Delegated output needs follow-up due to weak contract score"], retryable: true };
  }

  return { status: "accepted", missing: [], notes: [], retryable: false };
}
