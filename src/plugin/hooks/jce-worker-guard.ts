const COMPLETION_PATTERNS = [
  /\b(?:is\s+)?complete(?:d)?\.?\s*$/im,
  /\band\s+(?:is\s+)?complete\b/i,
  /\b(?:all|everything)\s+(?:is\s+)?done\b/i,
  /\bI(?:'ve|'m|\s+have)\s+(?:finished|completed|done)\b/i,
  /\bsuccessfully\s+(?:implemented|completed|fixed|resolved)\b/i,
  /\bready\s+(?:for\s+review|to\s+merge|to\s+ship)\b/i,
  /\b(?:task|work|implementation|feature|fix|bug|update)\s+(?:is\s+)?complete(?:d)?\b/i,
  /\bfinished\s+(?:implementing|fixing|building|coding|and)\b/i,
  /\bimplemented\s+(?:the|this|all)\b/i,
  /\b(?:selesai|beres|sudah\s+(?:selesai|beres|kelar))\b/i,
];
const EVIDENCE_PATTERNS = [/\bverification\b/i, /\bbun test\b/i, /\btypecheck\b/i, /\bpassed\b/i, /\bbuild\b/i, /\btests?\s+pass/i, /\bno\s+errors?\b/i];

const STOP_EARLY_PATTERNS = [
  /\blet\s+me\s+know\s+if\b/i,
  /\banything\s+else\b/i,
  /\b(?:continue|lanjut)\s+(?:later|nanti)\b/i,
  /\b(?:I'll|I\s+will|saya\s+akan)\s+(?:wait|tunggu)\b/i,
  /\b(?:please|mohon|tolong)\s+(?:confirm|konfirmasi)\b/i,
  /\b(?:can|could)\s+you\s+confirm\b/i,
  /\b(?:stop|stopping|berhenti)\s+(?:here|di\s+sini|dulu)\b/i,
  /\b(?:sisanya|selebihnya|tinggal)\b/i,
  /\b(?:kurang\s+lebih|roughly|more\s+or\s+less)\b/i,
];

export const VERIFICATION_WARNING = "\n\nVERIFICATION CHECK: This looks like a completion claim without clear verification evidence. Return to verification, or explicitly state what has not yet been verified.";

/**
 * Hard negations flip a completion phrase ANYWHERE in the sentence
 * ("the fix is not complete", "belum selesai").
 */
const HARD_NEGATION = /\b(?:not|isn'?t|aren'?t|won'?t|wasn'?t|weren'?t|cannot|can'?t|don'?t|doesn'?t|never|belum|tidak|bukan)\b/i;

/**
 * Interrogative/conditional openers negate a completion phrase ONLY when they
 * LEAD the sentence (they govern the whole clause, e.g. "Once tests pass, it's
 * complete" / "Is it complete?"). A conditional in a trailing clause does NOT
 * negate the claim (e.g. "Sudah selesai, kalau mau dicek lagi" is still a
 * claim). This avoids both false positives and false negatives (#4).
 */
const LEADING_NEGATORS = [
  /^\s*(?:is|are|does|do|did|has|have|will|would|should|shall|can|could|may|might)\b/i,
  /^\s*(?:how|what|why|where|which|when|whether|who)\b/i,
  /^\s*(?:if|once|after|before|until|unless|assuming|provided)\b/i,
  /^\s*(?:apakah|bagaimana|kapan|kalau|jika|jikalau|bila|setelah|sebelum)\b/i,
];

function sentenceNegatesCompletion(sentence: string): boolean {
  if (HARD_NEGATION.test(sentence)) return true;
  if (/\?\s*$/.test(sentence)) return true;
  return LEADING_NEGATORS.some((pattern) => pattern.test(sentence));
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?\n])\s+|\n/).map((s) => s.trim()).filter(Boolean);
}

function sentenceIsCleanClaim(sentence: string): boolean {
  if (!COMPLETION_PATTERNS.some((pattern) => pattern.test(sentence))) return false;
  return !sentenceNegatesCompletion(sentence);
}

export function looksLikeCompletionClaim(text: string): boolean {
  // A claim exists only if at least one SENTENCE asserts completion without a
  // hard negation, trailing question, or leading conditional in that sentence.
  // Per-sentence scoping avoids false positives (prose describing/asking about
  // completion) and false negatives (a real claim with an unrelated trailing
  // clause or a separate follow-up question).
  const sentences = splitSentences(text);
  if (sentences.length === 0) return false;
  return sentences.some(sentenceIsCleanClaim);
}

export function looksLikeStopEarlyOrConfirmation(text: string): boolean {
  return looksLikeCompletionClaim(text) || STOP_EARLY_PATTERNS.some((pattern) => pattern.test(text));
}

export function shouldWarnForMissingVerification(text: string): boolean {
  const hasEvidence = EVIDENCE_PATTERNS.some((pattern) => pattern.test(text));
  return looksLikeCompletionClaim(text) && !hasEvidence;
}
