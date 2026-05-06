import { validateDelegatedResult } from "./policy.js";
import type { ReviewStatus } from "../background/types.js";

export type RichReviewStatus = ReviewStatus | "blocked" | "retryable_failure";

export interface DelegatedReviewVerdict {
  status: RichReviewStatus;
  missing: string[];
  notes: string[];
  retryable: boolean;
}

const BLOCKED_PATTERNS = [/\bblocked\b/i, /missing credentials/i, /approval required/i, /access denied/i, /merge conflict/i, /user action/i];
const RETRYABLE_PATTERNS = [/timeout/i, /rate limit/i, /network/i, /temporar/i, /retry may succeed/i, /service unavailable/i];

export function classifyDelegatedReview(text: string): DelegatedReviewVerdict {
  const contract = validateDelegatedResult(text);
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

  return { status: "accepted", missing: [], notes: [], retryable: false };
}
