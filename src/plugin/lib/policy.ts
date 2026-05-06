import { validateDelegatedResultSections } from "./contracts.js";

export type TaskComplexity = "simple" | "complex";

const COMPLEXITY_MARKERS = ["implement", "refactor", "verify", "test", "fix", "plan", "delegate"];
const JCE_MARKERS = ["fix", "bug", "test", "verify", "implement", "refactor", "debug"];
const VERIFICATION_MARKERS = ["fix", "implement", "update", "refactor", "change", "test"];

export function classifyTaskComplexity(text: string): TaskComplexity {
  const lower = text.toLowerCase();
  const hits = COMPLEXITY_MARKERS.filter((marker) => lower.includes(marker)).length;
  return hits >= 2 || /,| and |\bthen\b/.test(lower) ? "complex" : "simple";
}

export function shouldPreferJceWorkflow(text: string): boolean {
  const lower = text.toLowerCase();
  return JCE_MARKERS.some((marker) => lower.includes(marker));
}

export function requiresVerificationEvidence(text: string): boolean {
  const lower = text.toLowerCase();
  return VERIFICATION_MARKERS.some((marker) => lower.includes(marker));
}

export function validateDelegatedResult(text: string) {
  return validateDelegatedResultSections(text);
}
