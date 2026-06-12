/**
 * Failure Pattern Store — structured error → root-cause → fix-category memory
 *
 * Extends the existing flat `memoryTiers.failure` string lists and
 * `buildFailureSignature()` with a structured, queryable record that links an
 * error signature to its root cause, the fix category that worked, and fix
 * categories that did NOT work. This lets future sessions reuse known fixes and
 * avoid re-trying known-bad fixes (proactive warnings).
 *
 * Pure module: operates on arrays passed in, returns new arrays. Persisted via
 * the optional `failurePatterns` field on ExecutionMemoryV2.
 */

import { buildFailureSignature, type FailureSignatureInput } from "../failure-signature.js";

export interface FailurePattern {
  /** Stable signature from buildFailureSignature (command.errorClass.file.rootPhrase). */
  signature: string;
  /** Human-readable error class (e.g. "hilt_missing_provides"). */
  errorClass?: string;
  /** File associated with the failure, when known (used by the risk heatmap). */
  file?: string;
  /** The diagnosed root cause, once known. */
  rootCause?: string;
  /** Fix category that resolved it (e.g. "add @InstallIn module scope"). */
  fixCategory?: string;
  /** Fix categories that were tried and FAILED — do not repeat these. */
  badFixes: string[];
  /** Times a fix in fixCategory succeeded. */
  successCount: number;
  /** Times this signature recurred / a fix failed. */
  failCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface RecordFailureInput extends FailureSignatureInput {
  rootCause?: string;
  /** A fix category being attempted or confirmed. */
  fixCategory?: string;
  /** Whether the recorded fix succeeded (true), failed (false), or is unknown (undefined). */
  fixSucceeded?: boolean;
}

const MAX_PATTERNS = 100;
const MAX_BAD_FIXES_PER_PATTERN = 8;

function now(ts?: string): string {
  return ts ?? new Date().toISOString();
}

/**
 * Record (insert or update) a failure pattern. Returns a new array.
 * - On a known signature: increments counts, merges root cause / fix category,
 *   and tracks bad fixes when a fix failed.
 */
export function recordFailurePattern(
  patterns: FailurePattern[] | undefined,
  input: RecordFailureInput,
  ts?: string,
): FailurePattern[] {
  const signature = buildFailureSignature(input);
  const stamp = now(ts);
  const list = patterns ? [...patterns] : [];
  const idx = list.findIndex((p) => p.signature === signature);

  if (idx === -1) {
    const badFixes = input.fixSucceeded === false && input.fixCategory ? [input.fixCategory] : [];
    list.unshift({
      signature,
      errorClass: input.errorClass,
      file: input.file,
      rootCause: input.rootCause,
      fixCategory: input.fixSucceeded === true ? input.fixCategory : undefined,
      badFixes,
      successCount: input.fixSucceeded === true ? 1 : 0,
      failCount: input.fixSucceeded === false ? 1 : 0,
      firstSeenAt: stamp,
      lastSeenAt: stamp,
    });
  } else {
    const existing = list[idx];
    const badFixes = [...existing.badFixes];
    if (input.fixSucceeded === false && input.fixCategory && !badFixes.includes(input.fixCategory)) {
      badFixes.push(input.fixCategory);
    }
    list[idx] = {
      ...existing,
      errorClass: input.errorClass ?? existing.errorClass,
      file: input.file ?? existing.file,
      rootCause: input.rootCause ?? existing.rootCause,
      // A successful fix overwrites/sets the winning category.
      fixCategory: input.fixSucceeded === true ? (input.fixCategory ?? existing.fixCategory) : existing.fixCategory,
      badFixes: badFixes.slice(-MAX_BAD_FIXES_PER_PATTERN),
      successCount: existing.successCount + (input.fixSucceeded === true ? 1 : 0),
      failCount: existing.failCount + (input.fixSucceeded === false ? 1 : 0),
      lastSeenAt: stamp,
    };
    // Move most-recently-touched to front.
    const [touched] = list.splice(idx, 1);
    list.unshift(touched);
  }

  return list.slice(0, MAX_PATTERNS);
}

/**
 * Query a failure pattern by error signals. Returns the matching pattern, or
 * null when this is a novel failure.
 */
export function queryFailurePattern(
  patterns: FailurePattern[] | undefined,
  input: FailureSignatureInput,
): FailurePattern | null {
  if (!patterns || patterns.length === 0) return null;
  const signature = buildFailureSignature(input);
  return patterns.find((p) => p.signature === signature) ?? null;
}

/**
 * Build a proactive warning for a known failure pattern, suitable for injecting
 * before an edit/fix attempt. Returns "" when the pattern has no actionable
 * history.
 */
export function formatFailureWarning(pattern: FailurePattern | null): string {
  if (!pattern) return "";
  const parts: string[] = [];
  if (pattern.rootCause) parts.push(`Known root cause: ${pattern.rootCause}`);
  if (pattern.fixCategory) parts.push(`Fix that worked before: ${pattern.fixCategory}`);
  if (pattern.badFixes.length > 0) parts.push(`Do NOT repeat (failed before): ${pattern.badFixes.join("; ")}`);
  if (parts.length === 0) {
    if (pattern.failCount >= 2) parts.push(`This failure has recurred ${pattern.failCount}× without a known fix — consider a different approach.`);
    else return "";
  }
  return `⚠️ Known failure pattern (${pattern.signature}): ${parts.join(" | ")}`;
}

/**
 * Prune failure patterns: keep the most recently seen up to the limit.
 */
export function pruneFailurePatterns(patterns: FailurePattern[] | undefined): FailurePattern[] {
  if (!patterns) return [];
  return [...patterns]
    .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))
    .slice(0, MAX_PATTERNS);
}
