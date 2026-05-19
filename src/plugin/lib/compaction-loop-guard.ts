const GREETING_PATTERN = /^(?:h+a+(?:i+)?|h+e+l+o+|hello+|hi+|hey+|yo+|pagi|siang|sore|malam|halo+w*|halow+|halo+|hai+|ass?alamualaikum|permisi|test|tes)[!?.\s]*$/i;

const AWAITING_TASK_PATTERN = /\b(?:awaiting|menunggu)\b.{0,80}\b(?:user|pengguna|task|question|request|pertanyaan|tugas)\b|\bno\s+(?:specific\s+)?(?:task|technical context|active tasks?)\b|\bconversation\s+just\s+started\b/i;

const EMPTY_WORKFLOW_MARKERS = [
  /\bGoal\b[\s\S]{0,160}\b(?:Initial greeting exchange|Awaiting user(?:'s)? task|Awaiting user's task or question)\b/i,
  /\bProgress\b[\s\S]{0,120}\bDone\b[\s\S]{0,80}\(none\)/i,
  /\bIn Progress\b[\s\S]{0,80}\(none\)/i,
  /\bBlocked\b[\s\S]{0,80}\(none\)/i,
  /\bRelevant Files\b[\s\S]{0,80}\(none\)/i,
];

export const POST_COMPACTION_NO_TASK_GUARD = `

<!-- JCE Post-Compaction No-Task Guard -->
If the current turn is only a greeting, test message, or a compacted summary whose Goal/Next Steps merely says awaiting the user's task/question, do not continue Build/Compaction/Workflow reporting. Reply once with a short greeting or clarification question and stop. Do not emit Goal, Progress, Next Steps, Critical Context, Relevant Files, TodoWrite, Build, or Compaction sections for no-op conversations. If two consecutive summaries have no substantive task, files, verification target, or blocker requiring action, treat the session as idle and wait for the user.
`;

export function isNoTaskGreeting(text: string): boolean {
  return GREETING_PATTERN.test(text.trim());
}

export function looksLikeCompactedNoTaskSummary(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const markerMatches = EMPTY_WORKFLOW_MARKERS.filter((pattern) => pattern.test(trimmed)).length;
  return AWAITING_TASK_PATTERN.test(trimmed) && markerMatches >= 2;
}

export function shouldSuppressCompactionAutocontinue(input: { lastUserMessage?: string; summary?: string; message?: string }): boolean {
  const lastUserMessage = input.lastUserMessage?.trim() ?? "";
  const summary = `${input.summary ?? ""}\n${input.message ?? ""}`.trim();
  if (lastUserMessage && isNoTaskGreeting(lastUserMessage)) return true;
  return looksLikeCompactedNoTaskSummary(summary);
}
