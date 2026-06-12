/**
 * Project Memory Summary — a compact, token-bounded restoration of what JCE-Worker
 * already knows about THIS project, injected once at the start of a new session.
 *
 * Goal: stop the AI from re-scanning the project and re-deriving context every
 * session (which wastes tokens). Instead, surface the durable facts it already
 * persisted: stack/scripts, last session's goal + status, recently touched
 * files, top learnings, conventions, dangerous areas, and verification commands.
 *
 * Hard token discipline: every section is capped and the whole block is line-
 * limited, because this is injected into the system prompt. A bloated summary
 * would defeat the purpose. Pure module: no I/O beyond reading package.json.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

// Minimal structural shapes (defensive — real objects come from persisted JSON).
interface MemoryTiersLike {
  session?: { currentTask?: string; blockers?: string[]; pendingPlan?: string };
  project?: { conventions?: string[]; releaseFiles?: string[]; standardVerification?: string[]; dangerousAreas?: string[] };
  failure?: { successfulFixes?: string[] };
}
interface WisdomLike { learning?: string; confidence?: string; usageCount?: number }
interface TaskLearningLike { trigger?: string; successfulRecipe?: string[]; verificationCommands?: string[] }
interface SessionEntryLike { intent?: string; nodesCompleted?: number; nodesFailed?: number; startedAt?: string }
interface WorkflowLike { goal?: string; status?: string }

export interface ProjectMemoryInput {
  projectRoot: string;
  changedFiles?: string[];
  activeWorkflow?: WorkflowLike;
  wisdom?: WisdomLike[];
  taskLearnings?: TaskLearningLike[];
  sessionHistory?: SessionEntryLike[];
  memoryTiers?: MemoryTiersLike;
}

export interface ProjectMemoryOptions {
  /** Max lines in the rendered block (hard cap to protect token budget). */
  maxLines?: number;
}

const DEFAULT_MAX_LINES = 24;

function readPackageJson(projectRoot: string): { version?: string; scripts?: Record<string, string> } | null {
  try {
    const p = join(projectRoot, "package.json");
    if (!existsSync(p)) return null;
    const parsed = JSON.parse(readFileSync(p, "utf-8"));
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // ignore — package.json optional/unreadable
  }
  return null;
}

function clean(items: unknown[] | undefined, limit: number): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((i) => (typeof i === "string" ? i : ""))
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, limit);
}

/**
 * Whether there is enough durable memory to be worth injecting. Avoids adding a
 * near-empty "restored memory" block to brand-new projects (pure token waste).
 */
export function hasRestorableMemory(input: ProjectMemoryInput): boolean {
  const tiers = input.memoryTiers;
  return Boolean(
    (input.changedFiles && input.changedFiles.length > 0) ||
    (input.wisdom && input.wisdom.length > 0) ||
    (input.taskLearnings && input.taskLearnings.length > 0) ||
    (input.sessionHistory && input.sessionHistory.length > 0) ||
    input.activeWorkflow?.goal ||
    (tiers?.project?.conventions && tiers.project.conventions.length > 0) ||
    (tiers?.project?.dangerousAreas && tiers.project.dangerousAreas.length > 0) ||
    tiers?.session?.currentTask,
  );
}

/**
 * Build the compact project-memory block. Returns "" when there is nothing
 * durable worth restoring (brand-new project / empty memory).
 */
export function buildProjectMemorySummary(input: ProjectMemoryInput, options: ProjectMemoryOptions = {}): string {
  if (!hasRestorableMemory(input)) return "";

  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const pkg = readPackageJson(input.projectRoot);
  const tiers = input.memoryTiers ?? {};
  const lines: string[] = [];

  // Stack / scripts (1 line).
  if (pkg) {
    const scripts = Object.keys(pkg.scripts ?? {}).slice(0, 6).join(", ");
    lines.push(`- Project: v${pkg.version ?? "?"}${scripts ? ` | scripts: ${scripts}` : ""}`);
  }

  // Last session goal + status (most useful single line).
  const lastGoal = input.activeWorkflow?.goal ?? tiers.session?.currentTask;
  if (lastGoal) {
    const status = input.activeWorkflow?.status ? ` (${input.activeWorkflow.status})` : "";
    lines.push(`- Last goal: ${lastGoal.slice(0, 160)}${status}`);
  }
  const lastSession = input.sessionHistory?.[input.sessionHistory.length - 1];
  if (lastSession && (lastSession.nodesCompleted || lastSession.nodesFailed)) {
    lines.push(`- Last session: ${lastSession.nodesCompleted ?? 0} done, ${lastSession.nodesFailed ?? 0} failed${lastSession.intent ? ` (${lastSession.intent})` : ""}`);
  }

  // Open blockers from the last session.
  const blockers = clean(tiers.session?.blockers, 3);
  if (blockers.length) lines.push(`- Open blockers: ${blockers.join("; ")}`);

  // Recently touched files.
  const files = clean(input.changedFiles, 8);
  if (files.length) lines.push(`- Recently touched: ${files.join(", ")}`);

  // Conventions.
  const conventions = clean(tiers.project?.conventions, 4);
  if (conventions.length) lines.push(`- Conventions: ${conventions.join("; ")}`);

  // Dangerous areas (high value — avoid re-breaking known-fragile files).
  const danger = clean(tiers.project?.dangerousAreas, 5);
  if (danger.length) lines.push(`- High-risk areas: ${danger.join(", ")}`);

  // Top learnings (highest confidence / most used first).
  const wisdom = (input.wisdom ?? [])
    .filter((w) => typeof w.learning === "string" && w.learning!.trim())
    .sort((a, b) => {
      const c = (x?: string) => (x === "high" ? 3 : x === "medium" ? 2 : 1);
      return c(b.confidence) - c(a.confidence) || (b.usageCount ?? 0) - (a.usageCount ?? 0);
    })
    .slice(0, 3);
  for (const w of wisdom) lines.push(`- Learning: ${w.learning!.trim().slice(0, 140)}`);

  // Verification commands (from tiers or a successful recipe).
  const verify = clean(tiers.project?.standardVerification, 3);
  const recipeVerify = clean(input.taskLearnings?.[0]?.verificationCommands, 3);
  const verifyCmds = verify.length ? verify : recipeVerify;
  if (verifyCmds.length) lines.push(`- Verify with: ${verifyCmds.join("; ")}`);

  if (lines.length === 0) return "";

  const capped = lines.slice(0, maxLines);
  return [
    "<!-- JCE Project Memory (restored — avoid re-scanning what is already known) -->",
    "## Restored Project Memory",
    "You have prior durable memory for this project. Use it instead of re-deriving context:",
    ...capped,
    "If any item conflicts with the current code, the code wins — verify before relying on stale memory.",
  ].join("\n");
}
