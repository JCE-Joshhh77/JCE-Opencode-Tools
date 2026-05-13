import { validateDelegatedResultSections } from "./contracts.js";

export type EvidenceStrength = "none" | "weak" | "medium" | "strong";

export interface DelegatedEvidenceScore {
  hasSummary: boolean;
  hasFiles: boolean;
  hasVerification: boolean;
  hasRisks: boolean;
  evidenceStrength: EvidenceStrength;
  needsFollowUp: boolean;
}

export function scoreDelegatedEvidence(text: string): DelegatedEvidenceScore {
  const check = validateDelegatedResultSections(text);
  const verificationSection = text.match(/## Verification\s*([\s\S]*?)(?:\n## |$)/i)?.[1] ?? "";
  const hasCommand = /\b(bun|npm|pnpm|yarn|pytest|cargo|go test|tsc|audit|typecheck|test)\b/i.test(verificationSection);
  const saysNotRun = /not run|not verified|skipped|unable/i.test(verificationSection);
  const evidenceStrength: EvidenceStrength = !verificationSection.trim() || saysNotRun
    ? "none"
    : hasCommand
      ? "strong"
      : "medium";
  return {
    hasSummary: !check.missing.includes("Summary"),
    hasFiles: !check.missing.includes("Files"),
    hasVerification: !check.missing.includes("Verification"),
    hasRisks: !check.missing.includes("Risks"),
    evidenceStrength,
    needsFollowUp: !check.valid || evidenceStrength === "none",
  };
}
