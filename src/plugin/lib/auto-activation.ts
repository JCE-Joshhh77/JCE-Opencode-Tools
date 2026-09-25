/**
 * Auto-activation gate for full orchestration.
 *
 * Decides whether a user message should trigger a DAG plan (full orchestration)
 * versus advisory-only routing.
 *
 * Design goals:
 * - Activate on clear action intent ("implement X", "fix the build").
 * - Still activate on action REQUESTS phrased as questions
 *   ("can you implement X?", "tolong perbaiki bug ini?").
 * - Do NOT activate on informational/evaluation questions
 *   ("how does X work?", "what do you think about Y?", "should I refactor?"),
 *   which previously were over-broadly blocked by a blanket "?" rejection and
 *   would otherwise risk no-task orchestration loops.
 *
 * Note: callers still apply additional gates (no-task guard, complexity
 * assessment, rate limiter) on top of this decision.
 */

const ACTION_VERBS = /\b(fix|debug|investigate|implement|update|refactor|audit|review|analyze|analyse|check|verify|repair|add|remove|clean|create|migrate|optimize|optimise|implementasikan|lanjutkan|perbaiki|cek|analisis|ubah|hapus|rapikan|buat(?:kan)?|tambah(?:kan)?|optimalkan)\b/i;

// Interrogatives that lead an information-seeking or advice-seeking question.
// "can"/"could you" are intentionally excluded — they commonly front action
// requests ("can you implement ...").
const INFORMATIONAL_LEAD = /^(how|what|why|when|where|which|who|is|are|does|do|should|whether|apa|apakah|bagaimana|gimana|kenapa|mengapa|kapan|di\s?mana|dimana|haruskah)\b/i;

// Explicit request framing that signals "please perform this action".
const ACTION_REQUEST = /\b(can you|could you|would you|will you|please|pls|kindly|help me|tolong|mohon|bisa(?:kah)?|coba(?:kan)?)\b/i;

export interface AutoActivationDecision {
  activate: boolean;
  confidence: number;
  reason: string;
  signals: string[];
}

export function decideAutoActivation(message: string): AutoActivationDecision {
  const trimmed = message.trim();
  const signals: string[] = [];
  if (!trimmed) return { activate: false, confidence: 0, reason: "empty message", signals };

  const hasActionVerb = ACTION_VERBS.test(trimmed);
  if (hasActionVerb) signals.push("action_verb");
  else return { activate: false, confidence: 0.1, reason: "no concrete action verb", signals };

  const isQuestion = trimmed.includes("?");
  if (!isQuestion) return { activate: true, confidence: 0.85, reason: "direct action instruction", signals };

  signals.push("question_mark");
  if (INFORMATIONAL_LEAD.test(trimmed)) {
    signals.push("informational_lead");
    return { activate: false, confidence: 0.2, reason: "informational or advice question", signals };
  }
  if (ACTION_REQUEST.test(trimmed)) {
    signals.push("action_request_frame");
    return { activate: true, confidence: 0.75, reason: "action request phrased as question", signals };
  }
  // Bare imperative with a question mark ("audit X?", "perbaiki Y?") is still an action.
  signals.push("imperative_question");
  return { activate: true, confidence: 0.7, reason: "imperative action phrased as a question", signals };
}

export function shouldAutoActivateFromUserMessage(message: string): boolean {
  return decideAutoActivation(message).activate;
}
