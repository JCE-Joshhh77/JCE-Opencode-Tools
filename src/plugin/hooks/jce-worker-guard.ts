const COMPLETION_PATTERNS = [
  /\bcomplete(?:d)?\b/i,
  /\bdone\b/i,
  /\bfinished\b/i,
  /\bimplemented\b/i,
  /\bfixed\b/i,
];
const EVIDENCE_PATTERNS = [/\bverification\b/i, /\bbun test\b/i, /\btypecheck\b/i, /\bpassed\b/i, /\bbuild\b/i];

export const VERIFICATION_WARNING = "\n\nVERIFICATION CHECK: This looks like a completion claim without clear verification evidence. Return to verification, or explicitly state what has not yet been verified.";

export function looksLikeCompletionClaim(text: string): boolean {
  return COMPLETION_PATTERNS.some((pattern) => pattern.test(text));
}

export function shouldWarnForMissingVerification(text: string): boolean {
  const hasEvidence = EVIDENCE_PATTERNS.some((pattern) => pattern.test(text));
  return looksLikeCompletionClaim(text) && !hasEvidence;
}
