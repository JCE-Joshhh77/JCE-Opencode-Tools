/**
 * Speculative Pre-fetch — suggest likely-needed groundwork to start while a plan
 * awaits confirmation, without committing to changes.
 *
 * This is conservative by design: it only suggests READ-ONLY, reversible
 * groundwork (codebase exploration, doc/version research, test baseline reads)
 * that is almost always useful regardless of how the plan is finalized. It NEVER
 * suggests edits, deploys, or destructive actions. Callers decide whether to
 * actually dispatch the suggestions.
 *
 * Pure module: derives suggestions from the goal + intent.
 */

import type { AgentRole, IntentType } from "./types.js";

export interface SpeculativeTask {
  /** Short label for the speculative work. */
  label: string;
  /** Suggested agent to run it. */
  agent: AgentRole;
  /** Why this is safe to start before confirmation. */
  rationale: string;
  /** Read-only prompt for the agent. */
  prompt: string;
}

export interface SpeculativePlan {
  /** True when speculation is worthwhile (non-trivial goal). */
  worthwhile: boolean;
  tasks: SpeculativeTask[];
  reason: string;
}

const TRIVIAL_GOAL_MAX_LEN = 25;

/**
 * Decide whether speculative groundwork is worth starting, and what.
 * Always read-only and reversible — safe to run before user confirms the plan.
 */
export function planSpeculativePrefetch(goal: string, intent: IntentType): SpeculativePlan {
  const trimmed = goal.trim();
  if (trimmed.length < TRIVIAL_GOAL_MAX_LEN) {
    return { worthwhile: false, tasks: [], reason: "Goal too small to benefit from speculative groundwork." };
  }

  const tasks: SpeculativeTask[] = [];
  const lower = trimmed.toLowerCase();

  // Codebase exploration is safe and useful for almost any implementation work.
  if (intent === "feature" || intent === "bugfix" || intent === "refactor" || intent === "general") {
    tasks.push({
      label: "Explore relevant code",
      agent: "explorer",
      rationale: "Read-only codebase mapping is useful regardless of final plan shape.",
      prompt: `Explore the codebase to locate files, patterns, and integration points relevant to: ${trimmed}. Read-only — do not modify anything. Report findings only.`,
    });
  }

  // Library/version research for tasks that mention external deps or upgrades.
  if (/\b(upgrade|migrate|version|library|dependency|package|api|sdk|framework)\b/i.test(lower)) {
    tasks.push({
      label: "Research versions/compatibility",
      agent: "jce-researcher",
      rationale: "Documentation/version research is read-only and de-risks the plan early.",
      prompt: `Research official documentation and version compatibility relevant to: ${trimmed}. Cite sources. Do not make any changes.`,
    });
  }

  // For refactors, reading the existing test baseline is safe groundwork.
  if (intent === "refactor") {
    tasks.push({
      label: "Read existing test coverage",
      agent: "explorer",
      rationale: "Knowing current test coverage is read-only and informs a behavior-preserving refactor.",
      prompt: `Identify existing tests covering the area to be refactored for: ${trimmed}. Read-only. Report which behaviors are covered and which are gaps.`,
    });
  }

  if (tasks.length === 0) {
    return { worthwhile: false, tasks: [], reason: `Intent "${intent}" has no clearly safe speculative groundwork.` };
  }

  return {
    worthwhile: true,
    tasks: tasks.slice(0, 2), // keep speculation cheap
    reason: `${tasks.length} read-only groundwork task(s) can start before plan confirmation.`,
  };
}

export function formatSpeculativePlan(plan: SpeculativePlan): string {
  if (!plan.worthwhile) return "";
  const lines = plan.tasks.map((t) => `  - ${t.label} [${t.agent}]: ${t.rationale}`);
  return [`Speculative groundwork (read-only, safe to start now):`, ...lines].join("\n");
}
