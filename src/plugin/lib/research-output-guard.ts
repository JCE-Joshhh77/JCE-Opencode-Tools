export interface ResearchOutputEvaluation {
  ok: boolean;
  missing: string[];
  warning?: string;
}

export const RESEARCH_QUALITY_WARNING_PREFIX = "RESEARCH QUALITY WARNING: missing required research evidence contract fields:";

const REQUIRED_SECTIONS = ["Research Scope", "Short Answer", "Evidence", "Risks & Unknowns", "Implementation Readiness", "Recommended Next Step"] as const;
const REQUIRED_EVIDENCE_COLUMNS = ["Claim", "Source", "Strength", "Confidence"] as const;
const READINESS_LABELS = ["Ready to implement", "Needs verification", "Needs more research", "Ready", "Needs Validation", "Not Ready"] as const;

function hasSection(text: string, section: string): boolean {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\n)#{1,6}\\s+${escaped}\\s*(\\n|$)`, "i").test(text);
}

function hasEvidenceColumn(text: string, column: string): boolean {
  const tableLines = text.split(/\r?\n/).filter((line) => line.trim().startsWith("|") && line.includes("|"));
  return tableLines.some((line) => line.split("|").map((cell) => cell.trim().toLowerCase()).includes(column.toLowerCase()));
}

function hasReadinessLabel(text: string): boolean {
  return READINESS_LABELS.some((label) => new RegExp(`(^|\\n|\\b)${label.replace(/ /g, "\\s+")}(\\b|\\n|$)`, "i").test(text));
}

export function evaluateResearchOutput(text: string): ResearchOutputEvaluation {
  const missing: string[] = [];
  for (const section of REQUIRED_SECTIONS) {
    if (!hasSection(text, section)) missing.push(`Section: ${section}`);
  }
  for (const column of REQUIRED_EVIDENCE_COLUMNS) {
    if (!hasEvidenceColumn(text, column)) missing.push(`Evidence table column: ${column}`);
  }
  if (!hasReadinessLabel(text)) missing.push("Implementation Readiness label");

  if (missing.length === 0) return { ok: true, missing: [] };
  return {
    ok: false,
    missing,
    warning: `${RESEARCH_QUALITY_WARNING_PREFIX}\n${missing.map((item) => `- ${item}`).join("\n")}`,
  };
}

export function appendResearchOutputWarning(text: string): string {
  if (text.includes(RESEARCH_QUALITY_WARNING_PREFIX)) return text;
  const result = evaluateResearchOutput(text);
  if (result.ok || !result.warning) return text;
  return `${text.trimEnd()}\n\n${result.warning}`;
}
