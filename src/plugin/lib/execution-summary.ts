export interface ExecutionSummaryInput {
  status: "completed" | "blocked" | "awaiting_user";
  files: string[];
  verification: string[];
  risks: string[];
  blockers: string[];
  retries: string[];
  traceHighlights: string[];
}

function listOrNone(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- none";
}

export function buildExecutionSummary(input: ExecutionSummaryInput): string {
  const verification = input.verification.length ? input.verification : ["Verification not run"];
  return [
    "## Status",
    input.status,
    "",
    "## Files",
    listOrNone(input.files),
    "",
    "## Verification",
    listOrNone(verification),
    "",
    "## Risks",
    listOrNone(input.risks),
    "",
    "## Blockers",
    listOrNone(input.blockers),
    "",
    "## Retries",
    listOrNone(input.retries),
    "",
    "## Trace Highlights",
    listOrNone(input.traceHighlights),
  ].join("\n");
}
