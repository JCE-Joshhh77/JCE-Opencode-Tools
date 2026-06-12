/**
 * Strategy Telemetry — track which execution strategy was chosen for a task
 * type and whether it succeeded, then feed the result back into future strategy
 * selection.
 *
 * This closes the loop on the Adaptive Strategy Selector (Tier 1): instead of
 * always mapping complexity → strategy with fixed rules, we learn that e.g.
 * "migration tasks succeed 80% with multi-phase vs 40% with direct" and bias
 * future selection accordingly.
 *
 * Pure module: operates on arrays, returns new arrays / derived stats.
 */

import type { ExecutionStrategy } from "./intelligence.js";
import type { IntentType } from "./types.js";

export type StrategyOutcome = "success" | "partial" | "failed" | "abandoned";

export interface StrategyTelemetryEntry {
  intent: IntentType;
  strategy: ExecutionStrategy;
  outcome: StrategyOutcome;
  /** Optional retries consumed before the outcome (signal of friction). */
  retries?: number;
  recordedAt: string;
}

export interface StrategyStats {
  intent: IntentType;
  strategy: ExecutionStrategy;
  attempts: number;
  successes: number;
  /** success / attempts, 0..1. */
  successRate: number;
  avgRetries: number;
}

export interface StrategyRecommendation {
  /** Best strategy by observed success rate, or null when no data. */
  recommended: ExecutionStrategy | null;
  /** Confidence in the recommendation (0..1), scaled by sample size. */
  confidence: number;
  reason: string;
  stats: StrategyStats[];
}

const MAX_ENTRIES = 200;
const MIN_SAMPLES_FOR_BIAS = 3;

function now(ts?: string): string {
  return ts ?? new Date().toISOString();
}

/**
 * Record the outcome of a strategy choice. Returns a new array (most recent first).
 */
export function recordStrategyOutcome(
  entries: StrategyTelemetryEntry[] | undefined,
  input: { intent: IntentType; strategy: ExecutionStrategy; outcome: StrategyOutcome; retries?: number },
  ts?: string,
): StrategyTelemetryEntry[] {
  const list = entries ? [...entries] : [];
  list.unshift({
    intent: input.intent,
    strategy: input.strategy,
    outcome: input.outcome,
    retries: input.retries,
    recordedAt: now(ts),
  });
  return list.slice(0, MAX_ENTRIES);
}

/**
 * Compute per-(intent, strategy) success statistics from telemetry.
 * If `intent` is provided, only stats for that intent are returned.
 */
export function computeStrategyStats(
  entries: StrategyTelemetryEntry[] | undefined,
  intent?: IntentType,
): StrategyStats[] {
  if (!entries || entries.length === 0) return [];
  const filtered = intent ? entries.filter((e) => e.intent === intent) : entries;
  const groups = new Map<string, StrategyTelemetryEntry[]>();
  for (const entry of filtered) {
    const key = `${entry.intent}|${entry.strategy}`;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }

  const stats: StrategyStats[] = [];
  for (const [key, group] of groups) {
    const [intentPart, strategyPart] = key.split("|") as [IntentType, ExecutionStrategy];
    const attempts = group.length;
    const successes = group.filter((e) => e.outcome === "success").length;
    const totalRetries = group.reduce((sum, e) => sum + (e.retries ?? 0), 0);
    stats.push({
      intent: intentPart,
      strategy: strategyPart,
      attempts,
      successes,
      successRate: attempts > 0 ? Math.round((successes / attempts) * 100) / 100 : 0,
      avgRetries: attempts > 0 ? Math.round((totalRetries / attempts) * 100) / 100 : 0,
    });
  }
  return stats.sort((a, b) => b.successRate - a.successRate || b.attempts - a.attempts);
}

/**
 * Recommend a strategy for an intent based on learned outcomes.
 * Only biases when there is enough signal (>= MIN_SAMPLES_FOR_BIAS attempts on
 * the leading strategy); otherwise returns low confidence so callers keep the
 * rule-based default.
 */
export function recommendStrategy(
  entries: StrategyTelemetryEntry[] | undefined,
  intent: IntentType,
): StrategyRecommendation {
  const stats = computeStrategyStats(entries, intent);
  if (stats.length === 0) {
    return { recommended: null, confidence: 0, reason: "No telemetry for this intent yet.", stats };
  }

  const leader = stats[0];
  if (leader.attempts < MIN_SAMPLES_FOR_BIAS) {
    return {
      recommended: null,
      confidence: Math.round((leader.attempts / MIN_SAMPLES_FOR_BIAS) * 0.4 * 100) / 100,
      reason: `Insufficient samples (${leader.attempts}/${MIN_SAMPLES_FOR_BIAS}) to bias strategy; keep rule-based default.`,
      stats,
    };
  }

  // Confidence scales with sample size and how decisively the leader wins.
  const runnerUp = stats[1];
  const margin = runnerUp ? leader.successRate - runnerUp.successRate : leader.successRate;
  const sampleConfidence = Math.min(1, leader.attempts / 10);
  const confidence = Math.round(Math.max(0, Math.min(1, leader.successRate * 0.6 + margin * 0.2 + sampleConfidence * 0.2)) * 100) / 100;

  return {
    recommended: leader.strategy,
    confidence,
    reason: `${leader.strategy} succeeded ${leader.successes}/${leader.attempts} (${Math.round(leader.successRate * 100)}%) for ${intent} tasks.`,
    stats,
  };
}

/**
 * Combine the rule-based strategy (from assessAdaptiveComplexity) with learned
 * telemetry. The learned recommendation only overrides when its confidence is
 * high enough, preventing premature bias from a handful of samples.
 */
export function selectStrategyWithTelemetry(
  ruleBased: ExecutionStrategy,
  intent: IntentType,
  entries: StrategyTelemetryEntry[] | undefined,
  overrideThreshold = 0.6,
): { strategy: ExecutionStrategy; source: "rule" | "telemetry"; reason: string } {
  const rec = recommendStrategy(entries, intent);
  if (rec.recommended && rec.recommended !== ruleBased && rec.confidence >= overrideThreshold) {
    return {
      strategy: rec.recommended,
      source: "telemetry",
      reason: `Telemetry override (confidence ${rec.confidence}): ${rec.reason}`,
    };
  }
  return {
    strategy: ruleBased,
    source: "rule",
    reason: rec.recommended === ruleBased
      ? `Rule-based and telemetry agree on ${ruleBased}.`
      : `Rule-based ${ruleBased} kept (telemetry confidence ${rec.confidence} below ${overrideThreshold}).`,
  };
}

export function formatStrategyStats(stats: StrategyStats[]): string {
  if (stats.length === 0) return "No strategy telemetry recorded.";
  const lines = stats.map(
    (s) => `  ${s.intent}/${s.strategy}: ${s.successes}/${s.attempts} (${Math.round(s.successRate * 100)}%)${s.avgRetries > 0 ? `, ~${s.avgRetries} retries` : ""}`,
  );
  return ["Strategy telemetry:", ...lines].join("\n");
}
