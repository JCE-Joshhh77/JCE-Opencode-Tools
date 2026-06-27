interface MessageLike {
  role: string;
  content: string;
}

const INCOMPLETE_TODO_PATTERN = /^[\s]*-\s*\[\s*\]/m;
const TODO_TOOL_PATTERN = /"status"\s*:\s*"(pending|in_progress)"/;

/** Remove fenced code blocks and inline code so example checklists / JSON inside
 * code (e.g. when reviewing or explaining code) don't trigger false positives. */
function stripCode(content: string): string {
  if (typeof content !== "string") return "";
  return content
    .replace(/```[\s\S]*?```/g, "")  // fenced blocks
    .replace(/`[^`]*`/g, "");         // inline code
}

/**
 * Check if the assistant has incomplete todos in recent messages.
 * Looks for both markdown checkboxes and TodoWrite pending/in_progress items.
 */
export function shouldEnforceContinuation(messages: MessageLike[]): boolean {
  // Check last 5 assistant messages for incomplete todos
  const recentAssistant = messages
    .filter((msg) => msg.role === "assistant")
    .slice(-5);

  for (const msg of recentAssistant) {
    const content = stripCode(typeof msg.content === "string" ? msg.content : String(msg.content ?? ""));
    if (INCOMPLETE_TODO_PATTERN.test(content)) return true;
    if (TODO_TOOL_PATTERN.test(content)) return true;
  }
  return false;
}

/**
 * Check if the last assistant message looks like it's trying to stop
 * while there are still incomplete items.
 *
 * Covers both English and Bahasa Indonesia phrasing because the JCE plugin is
 * routinely used by Indonesian-speaking users; the previous English-only
 * regex set let early-stop attempts in Indonesian slip past the boulder
 * continuation gate.
 */
export function detectPrematureStop(lastAssistantMessage: string): boolean {
  const stoppingPhrases = [
    // English early-stop / hand-off phrasing.
    /\ball\s+(done|complete|finished)\b/i,
    /\bthat'?s\s+(it|all|everything)\b/i,
    /\blet\s+me\s+know\s+if\b/i,
    /\banything\s+else\b/i,
    /\b(?:I'?ll|I\s+will)\s+(?:wait|stop|pause)\b/i,
    /\b(?:please|kindly)\s+(?:confirm|advise|let\s+me\s+know)\b/i,
    // Bahasa Indonesia early-stop phrasing — covers common variants.
    /\b(?:sudah|udah)\s*[,\.]?\s*(?:ada\s+yang\s+lain|ada\s+lagi)\b/i,
    /\btinggal\s+(?:segini|segitu|seperti\s+ini)\s+dulu\b/i,
    /\bcukup\s+(?:segitu|segini|sampai\s+sini)\b/i,
    /\b(?:sisanya|selebihnya|sisa(?:nya)?)\s+(?:nanti|menyusul|lanjut\s+nanti)\b/i,
    /\blanjut\s+(?:nanti|besok|setelah)\b/i,
    /\b(?:berhenti|stop)\s+(?:di\s+sini|dulu|sebentar)\b/i,
    /\bmohon\s+(?:konfirmasi|review|cek)\b/i,
    /\b(?:kalau|jika|apabila)\s+(?:ada|butuh|perlu)\s+(?:yang\s+lain|tambahan|lainnya)\b/i,
  ];
  return stoppingPhrases.some((p) => p.test(lastAssistantMessage));
}

export const CONTINUATION_PROMPT = `⚠️ BOULDER CHECK: You have incomplete todo items. You are NOT done.
Keep bouldering — complete ALL remaining items before stopping.
DO NOT respond to the user until all todos are marked completed.
If blocked, report the blocker explicitly instead of stopping.`;
