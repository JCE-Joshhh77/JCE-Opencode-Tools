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

export interface EvidenceScoringOptions {
  agent?: string;
}

/**
 * Score delegated evidence. Agent-aware: jce-researcher uses source citations
 * as evidence rather than shell commands.
 */
export function scoreDelegatedEvidence(text: string, options: EvidenceScoringOptions = {}): DelegatedEvidenceScore {
  // Research-specific scoring
  if (options.agent === "jce-researcher") {
    return scoreResearchEvidence(text);
  }

  // Default scoring (command-based)
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

/**
 * Research-specific evidence scoring.
 * Research evidence = source citations, evidence tables, confidence labels.
 * NOT shell commands.
 */
function scoreResearchEvidence(text: string): DelegatedEvidenceScore {
  const hasSummary = /## (Short Answer|Summary|Research Scope)/i.test(text);
  const hasEvidence = /## (Evidence|Findings)/i.test(text);
  const hasRisks = /## (Risks|Risks & Unknowns)/i.test(text);

  // Research-specific evidence signals
  const hasEvidenceTable = /\|.*\|.*\|/.test(text) && /\b(Claim|Source|Strength|Confidence)\b/i.test(text);
  const hasSourceCitations = /\b(docs?|documentation|official|github\.com|stackoverflow|RFC|spec)\b/i.test(text);
  const hasConfidenceLabels = /\b(high|medium|low)\s*(confidence|certainty)\b/i.test(text) || /confidence:\s*(high|medium|low|\d+%)/i.test(text);
  const hasReadinessLabel = /\b(ready to implement|needs verification|needs more research|ready|not ready)\b/i.test(text);
  const hasRecommendedNext = /## (Recommended Next Step|Next Step|Recommendation)/i.test(text);

  // Score research evidence strength
  let strengthScore = 0;
  if (hasEvidenceTable) strengthScore += 3;
  if (hasSourceCitations) strengthScore += 2;
  if (hasConfidenceLabels) strengthScore += 1;
  if (hasReadinessLabel) strengthScore += 1;
  if (hasRecommendedNext) strengthScore += 1;

  const evidenceStrength: EvidenceStrength = strengthScore >= 5
    ? "strong"
    : strengthScore >= 3
      ? "medium"
      : strengthScore >= 1
        ? "weak"
        : "none";

  // Research doesn't need "Files" or command-based "Verification"
  const needsFollowUp = !hasSummary || !hasEvidence || evidenceStrength === "none";

  return {
    hasSummary,
    hasFiles: true, // Not required for research
    hasVerification: hasEvidence, // Evidence section serves as verification for research
    hasRisks,
    evidenceStrength,
    needsFollowUp,
  };
}
