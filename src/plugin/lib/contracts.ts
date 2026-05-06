export const REQUIRED_RESULT_SECTIONS = ["Summary", "Files", "Verification", "Risks"] as const;

export interface DelegatedResultCheck {
  valid: boolean;
  missing: string[];
}

export function buildDelegatedResultContractInstructions(): string {
  return [
    "Return your final answer in this format:",
    "## Summary",
    "...",
    "",
    "## Files",
    "- path or none",
    "",
    "## Verification",
    "- command/result or not run",
    "",
    "## Risks",
    "- risk or none",
  ].join("\n");
}

export function validateDelegatedResultSections(text: string): DelegatedResultCheck {
  const missing = REQUIRED_RESULT_SECTIONS.filter((section) => !text.includes(`## ${section}`));
  return { valid: missing.length === 0, missing: [...missing] };
}
