/**
 * Pure helper functions extracted from src/plugin/index.ts (audit-2026-06-13
 * decompose). These have no dependency on the plugin factory closure state,
 * so they live here as pure/testable functions and are re-exported by index.ts.
 */
import type { OrchestrationController } from "../lib/orchestration/controller.js";
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { withTimeout } from "../../lib/timeout.js";
import { CONTEXT_FILENAME, getContextTemplate } from "../../lib/context-template.js";
import { extractProjectFacts } from "../lib/orchestration/fact-extraction.js";
import { shouldDropPersistedWorkflow } from "../lib/orchestration/staleness.js";
import { isRecord } from "../lib/shared-predicates.js";
import type { RuntimeState } from "../lib/session-store.js";

export function delegatedReviewStrings(memory: RuntimeState): string[] {
  return [...memory.completedSummaries, ...memory.verificationEvidence]
    .filter(isRecord)
    .map((entry) => {
      const status = typeof entry.reviewStatus === "string" ? entry.reviewStatus : "unknown";
      const notes = Array.isArray(entry.reviewNotes) ? entry.reviewNotes.filter((note): note is string => typeof note === "string").join("; ") : "";
      const summary = typeof entry.verificationSummary === "string" ? entry.verificationSummary : "";
      return `status=${status}${notes ? `; ${notes}` : ""}${summary ? `; ${summary}` : ""}`;
    });
}

export function hasDelegatedWork(memory: RuntimeState): boolean {
  return [...memory.completedSummaries, ...memory.verificationEvidence].some((entry) => isRecord(entry) && typeof entry.reviewStatus === "string" && entry.reviewStatus !== "not_applicable");
}

export type JceWorkerAgentHint = "oracle" | "jce-researcher" | "explorer" | "frontend" | "android";

export function isJceWorkerAgentHint(value: string): value is JceWorkerAgentHint {
  return value === "oracle" || value === "jce-researcher" || value === "explorer" || value === "frontend" || value === "android";
}

export const HOOK_TIMEOUT_MS = 8000;

/** Bound a hook await so a stalled skill read or dispatch cannot freeze the turn. */
export function boundHook<T>(promise: Promise<T>, label: string, fallback: T): Promise<T> {
  return withTimeout(promise, HOOK_TIMEOUT_MS, label, { envOverride: "JCE_HOOK_TIMEOUT_MS" }).catch(() => fallback);
}

// NOTE: the `tool` argument to these helpers MUST already be normalized to
// lowercase via normalizeToolName(). Normalization happens once at the hook
// boundary (tool.execute.after) so tool-name casing can never drift again (L1).
export function shouldTranslateToolOutput(tool: string): boolean {
  return tool === "task" || tool === "bg_collect" || tool === "jce_workflow";
}

const COMPLETION_INSPECTION_TOOLS = new Set(["task", "jce_workflow"]);

export function shouldInspectCompletionOutput(tool: string): boolean {
  return COMPLETION_INSPECTION_TOOLS.has(tool);
}

/** Tools whose output must NOT be compressed — model needs exact bytes for correctness. */
const CONTEXT_BUDGET_EXCLUDED_TOOLS = new Set([
  "read",        // file contents can be large; skip expensive post-processing to avoid worker instability on low-memory VPS
  "write",       // confirmation only — already tiny
  "edit",        // confirmation only — already tiny
  "todowrite",   // parsed downstream for state extraction
  "skill",       // skill content must be exact (instructions)
  "bash",        // verification parser needs the raw pass/fail lines
]);

export function shouldApplyDirectContextBudget(tool: string): boolean {
  // Apply compression to all tools EXCEPT those requiring exact output.
  // Short outputs (<100 chars) are auto-skipped by applyContextBudget itself.
  return !CONTEXT_BUDGET_EXCLUDED_TOOLS.has(tool);
}

/** Single source of truth for tool-name normalization. */
export function normalizeToolName(tool: unknown): string {
  return typeof tool === "string" ? tool.toLowerCase() : "";
}

export function ensureProjectContextFile(projectRoot: string): boolean {
  const contextPath = join(projectRoot, CONTEXT_FILENAME);
  if (existsSync(contextPath)) return false;
  writeFileSync(contextPath, getContextTemplate(), "utf-8");
  return true;
}

export function textPart(text: string) {
  return { type: "text" as const, text } as any;
}

/**
 * Extract facts from tool outputs into orchestration shared memory.
 * Delegates to the precision-tuned extractor (execution-output only) to avoid
 * false positives from file contents that merely mention tool names.
 */
export function extractFactsFromToolOutput(orchestrator: OrchestrationController, tool: string, output: string): void {
  for (const fact of extractProjectFacts(tool, output)) {
    orchestrator.addFact(fact.key, fact.value, fact.source, fact.confidence);
  }
}

/**
 * Drop a stale/terminal persisted activeWorkflow at (re)load using the shared
 * staleness authority. Pure helper so init AND new-session rehydration apply
 * identical logic (root cause of month-old workflows resurrecting was that this
 * only ran once at process init, never on subsequent sessions).
 */
export function dropStaleWorkflowAtLoad(memory: RuntimeState): RuntimeState {
  if (memory.activeWorkflow && shouldDropPersistedWorkflow(
    {
      status: memory.activeWorkflow.status,
      updatedAt: memory.activeWorkflow.updatedAt,
      hasActiveTasks: memory.activeTasks.length > 0,
    },
    Date.now(),
  )) {
    return { ...memory, activeWorkflow: undefined };
  }
  return memory;
}