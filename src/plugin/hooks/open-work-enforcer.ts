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

export function extractTodoState(text: string): TodoState {
  const openItems: string[] = [];
  for (const match of text.matchAll(TODO_JSON_CONTENT)) openItems.push(match[1] ?? "open TodoWrite item");
  for (const match of text.matchAll(TODO_MARKDOWN)) openItems.push(match[1]?.trim() || "open markdown todo");
  return { hasOpenTodos: openItems.length > 0 || TODO_JSON_STATUS.test(text), openItems: [...new Set(openItems)].slice(0, 8) };
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
