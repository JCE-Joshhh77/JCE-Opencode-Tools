export type JceWorkerErrorCategory =
  | "missing_access"
  | "user_approval_required"
  | "verification_failed"
  | "transient_network"
  | "merge_conflict"
  | "ambiguous_requirement"
  | "tool_failure"
  | "delegated_contract_failure"
  | "unknown";

export interface JceWorkerErrorClassification {
  category: JceWorkerErrorCategory;
  reason: string;
}

const RULES: Array<{ category: JceWorkerErrorCategory; reason: string; patterns: RegExp[] }> = [
  { category: "user_approval_required", reason: "User approval is required before continuing.", patterns: [/approval required/i, /requires approval/i, /user approval/i] },
  { category: "merge_conflict", reason: "Merge conflict requires manual resolution.", patterns: [/merge conflict/i, /conflicted files/i] },
  { category: "ambiguous_requirement", reason: "Requirement is ambiguous or unclear.", patterns: [/ambiguous/i, /unclear requirement/i, /unclear scope/i, /conflicting requirement/i] },
  { category: "delegated_contract_failure", reason: "Delegated output contract is incomplete.", patterns: [/missing required sections/i, /missing summary/i, /missing verification/i] },
  { category: "verification_failed", reason: "Verification command failed.", patterns: [/test failed/i, /\b\d+ failures?\b/i, /test failures?/i, /typecheck failed/i, /build failed/i, /verification failed/i] },
  { category: "missing_access", reason: "Missing credentials or access.", patterns: [/\b401\b/i, /unauthorized/i, /access denied/i, /missing token/i, /missing credentials/i] },
  { category: "transient_network", reason: "Failure appears transient or network-related.", patterns: [/network timeout/i, /request timed out/i, /connection timed out/i, /rate limit/i, /service unavailable/i, /temporarily unavailable/i, /connection reset/i, /dns/i, /econnreset/i] },
  { category: "tool_failure", reason: "Tool execution failed.", patterns: [/tool execution failed/i, /exit code \d+/i, /command failed/i, /command timed out/i, /tool timed out/i] },
];

export function classifyJceWorkerError(input: string | Error): JceWorkerErrorClassification {
  const text = typeof input === "string" ? input : input.message;
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) return { category: rule.category, reason: rule.reason };
  }
  return { category: "unknown", reason: "No known error category matched." };
}
