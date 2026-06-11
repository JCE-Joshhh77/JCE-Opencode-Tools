/**
 * Shared Orchestration Memory — Cross-node coordination layer
 * 
 * Provides a structured store for facts, decisions, constraints, artifacts,
 * and signals that agents can read from and write to during orchestration.
 * Includes TTL-based pruning and deduplication.
 */

import type {
  Fact,
  FactSource,
  Decision,
  Constraint,
  ConstraintOrigin,
  Artifact,
  Signal,
  SignalPriority,
} from "./types.js";

// ─── Orchestration Memory ─────────────────────────────────────────────────────

export interface OrchestrationMemory {
  facts: Map<string, Fact>;
  decisions: Decision[];
  constraints: Constraint[];
  artifacts: Artifact[];
  signals: Signal[];
  createdAt: string;
  updatedAt: string;
}

export interface OrchestrationMemorySnapshot {
  facts: Fact[];
  decisions: Decision[];
  constraints: Constraint[];
  artifacts: Artifact[];
  signals: Signal[];
  createdAt: string;
  updatedAt: string;
}

// ─── Creation ─────────────────────────────────────────────────────────────────

export function createOrchestrationMemory(now?: string): OrchestrationMemory {
  const ts = now ?? new Date().toISOString();
  return {
    facts: new Map(),
    decisions: [],
    constraints: [],
    artifacts: [],
    signals: [],
    createdAt: ts,
    updatedAt: ts,
  };
}

// ─── Facts ────────────────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface AddFactInput {
  key: string;
  value: string;
  source: FactSource;
  confidence?: number;
  expiresAt?: string;
  tags?: string[];
}

/**
 * Add or update a fact. If a fact with the same key exists,
 * it's updated only if the new confidence is >= existing.
 */
export function addFact(memory: OrchestrationMemory, input: AddFactInput, now?: string): OrchestrationMemory {
  const ts = now ?? new Date().toISOString();
  const existing = memory.facts.get(input.key);
  const confidence = input.confidence ?? 0.7;

  // Only overwrite if new confidence is higher or equal
  if (existing && existing.confidence > confidence) {
    return memory;
  }

  const fact: Fact = {
    id: existing?.id ?? generateId("fact"),
    key: input.key,
    value: input.value,
    source: input.source,
    confidence,
    discoveredAt: ts,
    expiresAt: input.expiresAt,
    tags: input.tags,
  };

  const next = cloneMemory(memory, ts);
  next.facts.set(input.key, fact);
  return next;
}

/**
 * Add multiple facts at once (from agent discoveries).
 */
export function addFacts(memory: OrchestrationMemory, facts: Fact[], now?: string): OrchestrationMemory {
  let current = memory;
  for (const fact of facts) {
    current = addFact(current, {
      key: fact.key,
      value: fact.value,
      source: fact.source,
      confidence: fact.confidence,
      expiresAt: fact.expiresAt,
      tags: fact.tags,
    }, now);
  }
  return current;
}

/**
 * Get facts relevant to a specific scope (by tags or key prefix).
 */
export function getFactsByScope(memory: OrchestrationMemory, scope: string): Fact[] {
  const results: Fact[] = [];
  for (const fact of memory.facts.values()) {
    if (fact.key.startsWith(scope) || fact.tags?.includes(scope)) {
      results.push(fact);
    }
  }
  return results.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Get top N facts by confidence.
 */
export function getTopFacts(memory: OrchestrationMemory, limit = 20): Fact[] {
  return Array.from(memory.facts.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

// ─── Decisions ────────────────────────────────────────────────────────────────

export interface AddDecisionInput {
  description: string;
  reasoning: string;
  alternatives?: string[];
  nodeId?: string;
}

export function addDecision(memory: OrchestrationMemory, input: AddDecisionInput, now?: string): OrchestrationMemory {
  const ts = now ?? new Date().toISOString();
  const decision: Decision = {
    id: generateId("dec"),
    description: input.description,
    reasoning: input.reasoning,
    alternatives: input.alternatives ?? [],
    status: "active",
    madeAt: ts,
    nodeId: input.nodeId,
  };

  const next = cloneMemory(memory, ts);
  next.decisions.push(decision);
  return next;
}

export function supersedeDecision(memory: OrchestrationMemory, decisionId: string, newDecisionId: string, now?: string): OrchestrationMemory {
  const next = cloneMemory(memory, now);
  const decision = next.decisions.find((d) => d.id === decisionId);
  if (decision) {
    decision.status = "superseded";
    decision.supersededBy = newDecisionId;
  }
  return next;
}

export function getActiveDecisions(memory: OrchestrationMemory): Decision[] {
  return memory.decisions.filter((d) => d.status === "active");
}

// ─── Constraints ──────────────────────────────────────────────────────────────

export interface AddConstraintInput {
  description: string;
  origin: ConstraintOrigin;
  scope?: string;
}

export function addConstraint(memory: OrchestrationMemory, input: AddConstraintInput, now?: string): OrchestrationMemory {
  const ts = now ?? new Date().toISOString();
  // Deduplicate by description
  const existing = memory.constraints.find((c) => c.description.toLowerCase() === input.description.toLowerCase());
  if (existing) return memory;

  const constraint: Constraint = {
    id: generateId("con"),
    description: input.description,
    origin: input.origin,
    scope: input.scope,
    active: true,
    createdAt: ts,
  };

  const next = cloneMemory(memory, ts);
  next.constraints.push(constraint);
  return next;
}

export function deactivateConstraint(memory: OrchestrationMemory, constraintId: string, now?: string): OrchestrationMemory {
  const next = cloneMemory(memory, now);
  const constraint = next.constraints.find((c) => c.id === constraintId);
  if (constraint) constraint.active = false;
  return next;
}

export function getActiveConstraints(memory: OrchestrationMemory): Constraint[] {
  return memory.constraints.filter((c) => c.active);
}

// ─── Artifacts ────────────────────────────────────────────────────────────────

export function addArtifact(memory: OrchestrationMemory, artifact: Artifact, now?: string): OrchestrationMemory {
  const next = cloneMemory(memory, now);
  // Deduplicate by path — keep latest
  next.artifacts = next.artifacts.filter((a) => a.path !== artifact.path);
  next.artifacts.push(artifact);
  return next;
}

export function addArtifacts(memory: OrchestrationMemory, artifacts: Artifact[], now?: string): OrchestrationMemory {
  let current = memory;
  for (const artifact of artifacts) {
    current = addArtifact(current, artifact, now);
  }
  return current;
}

export function getArtifactsByNode(memory: OrchestrationMemory, nodeId: string): Artifact[] {
  return memory.artifacts.filter((a) => a.nodeId === nodeId);
}

// ─── Signals (Inter-node Communication) ───────────────────────────────────────

export interface SendSignalInput {
  fromNodeId: string;
  toNodeId?: string;
  type: Signal["type"];
  priority: SignalPriority;
  message: string;
  data?: unknown;
}

export function sendSignal(memory: OrchestrationMemory, input: SendSignalInput, now?: string): OrchestrationMemory {
  const ts = now ?? new Date().toISOString();
  const signal: Signal = {
    id: generateId("sig"),
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    type: input.type,
    priority: input.priority,
    message: input.message,
    data: input.data,
    timestamp: ts,
    consumed: false,
  };

  const next = cloneMemory(memory, ts);
  next.signals.push(signal);
  return next;
}

export function consumeSignals(memory: OrchestrationMemory, nodeId: string, now?: string): { memory: OrchestrationMemory; signals: Signal[] } {
  const pending = memory.signals.filter((s) => (s.toNodeId === nodeId || s.toNodeId === undefined) && !s.consumed);
  if (pending.length === 0) return { memory, signals: [] };

  const next = cloneMemory(memory, now);
  for (const signal of pending) {
    const target = next.signals.find((s) => s.id === signal.id);
    if (target) target.consumed = true;
  }
  return { memory: next, signals: pending };
}

export function getUnconsumedSignals(memory: OrchestrationMemory, priority?: SignalPriority): Signal[] {
  let signals = memory.signals.filter((s) => !s.consumed);
  if (priority) {
    const priorities: SignalPriority[] = ["critical", "high", "normal", "low"];
    const minIdx = priorities.indexOf(priority);
    signals = signals.filter((s) => priorities.indexOf(s.priority) <= minIdx);
  }
  return signals;
}

// ─── Pruning ──────────────────────────────────────────────────────────────────

export interface PruneOptions {
  maxFacts?: number;
  maxDecisions?: number;
  maxArtifacts?: number;
  maxSignals?: number;
  expireFactsOlderThanMs?: number;
}

const DEFAULT_PRUNE_OPTIONS: Required<PruneOptions> = {
  maxFacts: 100,
  maxDecisions: 50,
  maxArtifacts: 200,
  maxSignals: 100,
  expireFactsOlderThanMs: 24 * 60 * 60 * 1000, // 24 hours
};

export function pruneMemory(memory: OrchestrationMemory, options: PruneOptions = {}, now?: string): OrchestrationMemory {
  const opts = { ...DEFAULT_PRUNE_OPTIONS, ...options };
  const ts = now ?? new Date().toISOString();
  const nowMs = Date.parse(ts);
  const next = cloneMemory(memory, ts);

  // Prune expired facts
  for (const [key, fact] of next.facts.entries()) {
    if (fact.expiresAt && Date.parse(fact.expiresAt) < nowMs) {
      next.facts.delete(key);
    }
  }

  // Prune old low-confidence facts if over limit
  if (next.facts.size > opts.maxFacts) {
    const sorted = Array.from(next.facts.entries()).sort((a, b) => b[1].confidence - a[1].confidence);
    next.facts = new Map(sorted.slice(0, opts.maxFacts));
  }

  // Prune old decisions (keep active, trim superseded)
  if (next.decisions.length > opts.maxDecisions) {
    const active = next.decisions.filter((d) => d.status === "active");
    const inactive = next.decisions.filter((d) => d.status !== "active");
    next.decisions = [...active, ...inactive.slice(-Math.max(0, opts.maxDecisions - active.length))];
  }

  // Prune artifacts (keep latest per path)
  if (next.artifacts.length > opts.maxArtifacts) {
    next.artifacts = next.artifacts.slice(-opts.maxArtifacts);
  }

  // Prune consumed signals
  next.signals = next.signals.filter((s) => !s.consumed).slice(-opts.maxSignals);

  return next;
}

// ─── Serialization ────────────────────────────────────────────────────────────

export function snapshotMemory(memory: OrchestrationMemory): OrchestrationMemorySnapshot {
  return {
    facts: Array.from(memory.facts.values()),
    decisions: [...memory.decisions],
    constraints: [...memory.constraints],
    artifacts: [...memory.artifacts],
    signals: [...memory.signals],
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}

export function restoreMemory(snapshot: OrchestrationMemorySnapshot): OrchestrationMemory {
  return {
    facts: new Map(snapshot.facts.map((f) => [f.key, f])),
    decisions: [...snapshot.decisions],
    constraints: [...snapshot.constraints],
    artifacts: [...snapshot.artifacts],
    signals: [...snapshot.signals],
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function cloneMemory(memory: OrchestrationMemory, now?: string): OrchestrationMemory {
  return {
    facts: new Map(memory.facts),
    decisions: [...memory.decisions],
    constraints: [...memory.constraints],
    artifacts: [...memory.artifacts],
    signals: [...memory.signals],
    createdAt: memory.createdAt,
    updatedAt: now ?? new Date().toISOString(),
  };
}
