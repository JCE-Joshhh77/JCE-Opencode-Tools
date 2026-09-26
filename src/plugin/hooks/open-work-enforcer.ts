import type { RuntimeState } from "../lib/runtime-state.js";
import { evaluateFinalReviewGate } from "../lib/final-review-gate.js";
import type { PolicyProfile } from "../lib/verification-gate.js";
import { isRecord } from "../lib/shared-predicates.js";

export interface TodoState {
  hasOpenTodos: boolean;
  openItems: string[];
}

export interface OpenWorkResult {
  blocked: boolean;
  reasons: string[];
  prompt: string;
}

const TODO_JSON_STATUS = /"status"\s*:\s*"(pending|in_progress)"/;
const TODO_JSON_CONTENT = /"content"\s*:\s*"([^"]+)"\s*,\s*"status"\s*:\s*"(pending|in_progress)"/g;
const TODO_MARKDOWN = /^[\s]*-\s*\[\s\]\s*(.+)$/gm;

/** Remove fenced code blocks and inline code so example checklists / JSON
 * snippets inside code (docs, reviews, explanations) don't register as open
 * todos. Parity with todo-enforcer.stripCode — previously extractTodoState
 * flagged EXAMPLE "- [ ]" items in code-blocks as real open work, blocking
 * legitimate completion with a phantom BOULDER gate. */
function stripCode(content: string): string {
  if (typeof content !== "string") return "";
  return content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "");
}

/** True when `text` is a bare TodoWrite-style JSON array (or a single object):
 * starts with `[`/`{` and parses as JSON whose top-level items are objects.
 * Prose that merely MENTIONS `{"status": "pending"}` inline must not match. */
function isTodoWriteJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.length > 0 && items.every((item) => isRecord(item));
  } catch {
    return false;
  }
}

export function extractTodoState(text: string): TodoState {
  const cleaned = stripCode(text);
  const openItems: string[] = [];
  for (const match of cleaned.matchAll(TODO_JSON_CONTENT)) openItems.push(match[1] ?? "open TodoWrite item");
  for (const match of cleaned.matchAll(TODO_MARKDOWN)) openItems.push(match[1]?.trim() || "open markdown todo");
  // TODO_JSON_STATUS (bare pending/in_progress status) is only meaningful for
  // actual TodoWrite JSON output — never for prose mentioning example JSON.
  const hasOpenStatus = TODO_JSON_STATUS.test(cleaned) && isTodoWriteJson(cleaned);
  return { hasOpenTodos: openItems.length > 0 || hasOpenStatus, openItems: [...new Set(openItems)].slice(0, 8) };
}

function hasOpenDelegatedReview(memory: RuntimeState): boolean {
  return [...memory.completedSummaries, ...memory.verificationEvidence].some((entry) => {
    if (!isRecord(entry)) return false;
    const status = entry.reviewStatus;
    return typeof status === "string" && status !== "accepted" && status !== "not_applicable";
  });
}

export function evaluateOpenWork(memory: RuntimeState, profile: PolicyProfile, todoState?: TodoState, options: { includeWorkflowGate?: boolean } = {}): OpenWorkResult {
  const reasons: string[] = [];
  if (todoState?.hasOpenTodos) reasons.push(`TodoWrite still has open item(s): ${(todoState.openItems.length ? todoState.openItems : ["pending/in_progress item"]).join("; ")}`);
  if (memory.activeTasks.length > 0) reasons.push(`Background task(s) still active: ${memory.activeTasks.length}`);
  if (memory.blockers.length > 0) reasons.push(`Active blocker(s) remain: ${memory.blockers.length}`);
  if (options.includeWorkflowGate !== false && memory.activeWorkflow) {
    const gate = evaluateFinalReviewGate(memory.activeWorkflow, {
      profile,
      changedFiles: [],
      delegatedReviews: [],
      residualRisks: [],
      activeBlockers: memory.blockers,
      retryHistory: memory.retryHistory,
      delegatedWorkRequired: hasOpenDelegatedReview(memory),
    });
    if (gate.status === "block") reasons.push(...gate.reasons);
  }
  const unique = [...new Set(reasons)];
  return {
    blocked: unique.length > 0,
    reasons: unique,
    prompt: [`BOULDER CONTINUATION: Open work remains; do not stop or ask for confirmation unless blocked by user input.`, ...unique.map((reason) => `- ${reason}`), `Continue draining actionable todos, or report a concrete blocker with evidence.`].join("\n"),
  };
}
