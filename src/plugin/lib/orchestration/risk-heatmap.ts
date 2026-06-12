/**
 * Risk Heatmap — aggregate failure history by file to warn before editing
 * high-risk areas.
 *
 * Builds on the structured FailurePattern store (Tier 2.5): files that recur in
 * failures with low fix-success rates are "hot". Before editing such a file,
 * the orchestrator can surface a warning and bias toward a more careful
 * strategy. Also derives the `dangerousAreas` memory tier (previously never
 * populated).
 *
 * Pure module: derives stats from a FailurePattern[] snapshot.
 */

import type { FailurePattern } from "./failure-pattern-store.js";

export type RiskLevel = "low" | "medium" | "high";

export interface FileRisk {
  file: string;
  /** Distinct failure signatures touching this file. */
  failureCount: number;
  /** Total recorded failures across those signatures. */
  totalFailures: number;
  /** Total recorded successful fixes across those signatures. */
  totalSuccesses: number;
  /** failures / (failures + successes), 0..1. Higher = riskier. */
  failureRate: number;
  level: RiskLevel;
}

export interface RiskHeatmap {
  files: FileRisk[];
  /** File paths considered dangerous (level === "high"). */
  dangerousAreas: string[];
}

const HIGH_FAILURE_RATE = 0.6;
const MEDIUM_FAILURE_RATE = 0.3;
const MIN_FAILURES_FOR_RISK = 2;

function riskLevel(failureRate: number, totalFailures: number): RiskLevel {
  // A single failure is noise, not a pattern — never flag elevated risk on it.
  if (totalFailures < MIN_FAILURES_FOR_RISK) return "low";
  if (failureRate >= HIGH_FAILURE_RATE) return "high";
  if (failureRate >= MEDIUM_FAILURE_RATE) return "medium";
  return "low";
}

/**
 * Build a risk heatmap from failure patterns. Patterns without a file are
 * ignored (they cannot be attributed to a location).
 */
export function buildRiskHeatmap(patterns: FailurePattern[] | undefined): RiskHeatmap {
  if (!patterns || patterns.length === 0) return { files: [], dangerousAreas: [] };

  const byFile = new Map<string, { count: number; failures: number; successes: number }>();
  for (const p of patterns) {
    if (!p.file) continue;
    const entry = byFile.get(p.file) ?? { count: 0, failures: 0, successes: 0 };
    entry.count += 1;
    entry.failures += p.failCount;
    entry.successes += p.successCount;
    byFile.set(p.file, entry);
  }

  const files: FileRisk[] = [];
  for (const [file, entry] of byFile) {
    const denom = entry.failures + entry.successes;
    const failureRate = denom > 0 ? Math.round((entry.failures / denom) * 100) / 100 : 0;
    files.push({
      file,
      failureCount: entry.count,
      totalFailures: entry.failures,
      totalSuccesses: entry.successes,
      failureRate,
      level: riskLevel(failureRate, entry.failures),
    });
  }

  files.sort((a, b) => b.failureRate - a.failureRate || b.totalFailures - a.totalFailures);
  const dangerousAreas = files.filter((f) => f.level === "high").map((f) => f.file);
  return { files, dangerousAreas };
}

/**
 * Look up the risk for a specific file path. Returns null when the file has no
 * recorded failure history.
 */
export function getFileRisk(heatmap: RiskHeatmap, file: string): FileRisk | null {
  return heatmap.files.find((f) => f.file === file) ?? null;
}

/**
 * Build a pre-edit warning for a file, if it is medium/high risk. Returns ""
 * for low-risk or unknown files.
 */
export function formatRiskWarning(risk: FileRisk | null): string {
  if (!risk || risk.level === "low") return "";
  const pct = Math.round(risk.failureRate * 100);
  const advice = risk.level === "high"
    ? "Proceed carefully: add/verify tests first and prefer a checkpointed, multi-phase approach."
    : "Be cautious: verify after the change.";
  return `⚠️ High-risk file (${risk.level}): ${risk.file} has failed ${risk.totalFailures}× (${pct}% failure rate). ${advice}`;
}
