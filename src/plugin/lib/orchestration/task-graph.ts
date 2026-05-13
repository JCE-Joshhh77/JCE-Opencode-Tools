/**
 * TaskGraph — DAG-based task orchestration core
 * 
 * Manages a directed acyclic graph of TaskNodes with dependency resolution,
 * status transitions, and immutable state updates.
 */

import type {
  TaskGraph,
  TaskGraphSnapshot,
  TaskNode,
  TaskNodeStatus,
  TaskNodeType,
  AgentRole,
  DependencyEdge,
  GraphStatus,
  Evidence,
  Fact,
  Constraint,
  RetryPolicy,
  Compensation,
  OutputExpectation,
  TaskNodeOutput,
} from "./types.js";

// ─── Creation ─────────────────────────────────────────────────────────────────

export interface CreateGraphInput {
  id: string;
  goal: string;
  now?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateNodeInput {
  id: string;
  type: TaskNodeType;
  title: string;
  description: string;
  agent: AgentRole;
  dependencies?: string[];
  prompt: string;
  context?: Fact[];
  constraints?: Constraint[];
  expectedOutput?: OutputExpectation;
  maxTokenBudget?: number;
  skills?: string[];
  priority?: number;
  retryPolicy?: Partial<RetryPolicy>;
  compensation?: Compensation;
  metadata?: Record<string, unknown>;
}

function timestamp(now?: string): string {
  return now ?? new Date().toISOString();
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  strategy: ["same", "different_approach", "escalate_user"],
  currentRetry: 0,
};

export function createTaskGraph(input: CreateGraphInput): TaskGraph {
  const now = timestamp(input.now);
  return {
    id: input.id,
    goal: input.goal,
    status: "planning",
    nodes: new Map(),
    edges: [],
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata,
  };
}

export function createTaskNode(input: CreateNodeInput, now?: string): TaskNode {
  return {
    id: input.id,
    type: input.type,
    title: input.title,
    description: input.description,
    agent: input.agent,
    status: "pending",
    dependencies: input.dependencies ?? [],
    input: {
      prompt: input.prompt,
      context: input.context ?? [],
      constraints: input.constraints ?? [],
      expectedOutput: input.expectedOutput,
      maxTokenBudget: input.maxTokenBudget,
      skills: input.skills,
    },
    output: undefined,
    evidence: [],
    compensation: input.compensation,
    retryPolicy: {
      ...DEFAULT_RETRY_POLICY,
      ...input.retryPolicy,
      currentRetry: 0,
    },
    priority: input.priority ?? 0,
    createdAt: timestamp(now),
    metadata: input.metadata,
  };
}

// ─── Graph Mutations (Immutable) ──────────────────────────────────────────────

function cloneGraph(graph: TaskGraph, now?: string): TaskGraph {
  return {
    ...graph,
    nodes: new Map(Array.from(graph.nodes.entries()).map(([k, v]) => [k, { ...v, dependencies: [...v.dependencies], evidence: [...v.evidence] }])),
    edges: graph.edges.map((e) => ({ ...e })),
    updatedAt: timestamp(now),
  };
}

export function addNode(graph: TaskGraph, input: CreateNodeInput, now?: string): TaskGraph {
  if (graph.nodes.has(input.id)) {
    throw new Error(`Node already exists: ${input.id}`);
  }
  // Validate dependencies exist
  for (const dep of input.dependencies ?? []) {
    if (!graph.nodes.has(dep)) {
      throw new Error(`Dependency node not found: ${dep} (required by ${input.id})`);
    }
  }
  const next = cloneGraph(graph, now);
  const node = createTaskNode(input, now);
  next.nodes.set(node.id, node);
  // Auto-create blocking edges for dependencies
  for (const dep of node.dependencies) {
    next.edges.push({ from: dep, to: node.id, type: "blocks" });
  }
  return next;
}

export function removeNode(graph: TaskGraph, nodeId: string, now?: string): TaskGraph {
  if (!graph.nodes.has(nodeId)) {
    throw new Error(`Node not found: ${nodeId}`);
  }
  // Check no other node depends on this one (unless they're also being removed)
  const dependents = Array.from(graph.nodes.values()).filter((n) => n.dependencies.includes(nodeId));
  if (dependents.length > 0) {
    throw new Error(`Cannot remove node ${nodeId}: depended on by ${dependents.map((n) => n.id).join(", ")}`);
  }
  const next = cloneGraph(graph, now);
  next.nodes.delete(nodeId);
  next.edges = next.edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
  return next;
}

export function addEdge(graph: TaskGraph, edge: DependencyEdge, now?: string): TaskGraph {
  if (!graph.nodes.has(edge.from)) throw new Error(`Edge source not found: ${edge.from}`);
  if (!graph.nodes.has(edge.to)) throw new Error(`Edge target not found: ${edge.to}`);
  // Check for cycles
  if (wouldCreateCycle(graph, edge.from, edge.to)) {
    throw new Error(`Adding edge ${edge.from} → ${edge.to} would create a cycle`);
  }
  const next = cloneGraph(graph, now);
  next.edges.push({ ...edge });
  const targetNode = next.nodes.get(edge.to)!;
  if (edge.type === "blocks" && !targetNode.dependencies.includes(edge.from)) {
    targetNode.dependencies.push(edge.from);
  }
  return next;
}

// ─── Status Transitions ───────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<TaskNodeStatus, TaskNodeStatus[]> = {
  pending: ["ready", "cancelled", "blocked"],
  ready: ["running", "cancelled", "blocked"],
  running: ["verifying", "done", "failed", "blocked", "cancelled"],
  verifying: ["done", "failed", "blocked"],
  done: [],
  failed: ["pending", "cancelled"],  // Can retry (back to pending)
  blocked: ["pending", "ready", "cancelled"],
  cancelled: [],
};

export function transitionNode(graph: TaskGraph, nodeId: string, newStatus: TaskNodeStatus, now?: string): TaskGraph {
  const node = graph.nodes.get(nodeId);
  if (!node) throw new Error(`Node not found: ${nodeId}`);
  const allowed = VALID_TRANSITIONS[node.status];
  if (!allowed.includes(newStatus)) {
    throw new Error(`Invalid transition: ${node.status} → ${newStatus} for node ${nodeId}`);
  }
  const next = cloneGraph(graph, now);
  const target = next.nodes.get(nodeId)!;
  target.status = newStatus;
  if (newStatus === "running" && !target.startedAt) target.startedAt = timestamp(now);
  if (newStatus === "done" || newStatus === "failed" || newStatus === "cancelled") target.completedAt = timestamp(now);
  return next;
}

export function failNode(graph: TaskGraph, nodeId: string, reason: string, now?: string): TaskGraph {
  const next = transitionNode(graph, nodeId, "failed", now);
  const node = next.nodes.get(nodeId)!;
  node.failureReason = reason;
  return next;
}

export function completeNode(graph: TaskGraph, nodeId: string, output: TaskNodeOutput, now?: string): TaskGraph {
  const next = transitionNode(graph, nodeId, "done", now);
  const node = next.nodes.get(nodeId)!;
  node.output = output;
  node.evidence = [...node.evidence, ...output.evidence];
  return next;
}

export function blockNode(graph: TaskGraph, nodeId: string, reason: string, now?: string): TaskGraph {
  const next = transitionNode(graph, nodeId, "blocked", now);
  const node = next.nodes.get(nodeId)!;
  node.failureReason = reason;
  return next;
}

export function attachEvidence(graph: TaskGraph, nodeId: string, evidence: Evidence, now?: string): TaskGraph {
  const node = graph.nodes.get(nodeId);
  if (!node) throw new Error(`Node not found: ${nodeId}`);
  const next = cloneGraph(graph, now);
  next.nodes.get(nodeId)!.evidence.push({ ...evidence });
  return next;
}

// ─── Dependency Resolution ────────────────────────────────────────────────────

/**
 * Returns nodes whose all blocking dependencies are satisfied (done/cancelled).
 * These are the nodes that can be moved to "ready" status.
 */
export function getReadyNodes(graph: TaskGraph): TaskNode[] {
  const ready: TaskNode[] = [];
  for (const node of graph.nodes.values()) {
    if (node.status !== "pending") continue;
    const blockingDeps = graph.edges
      .filter((e) => e.to === node.id && e.type === "blocks")
      .map((e) => e.from);
    const allSatisfied = blockingDeps.every((depId) => {
      const dep = graph.nodes.get(depId);
      return dep && (dep.status === "done" || dep.status === "cancelled");
    });
    if (allSatisfied) ready.push(node);
  }
  return ready.sort((a, b) => b.priority - a.priority);
}

/**
 * Returns nodes currently in "ready" status that can be dispatched.
 */
export function getDispatchableNodes(graph: TaskGraph): TaskNode[] {
  return Array.from(graph.nodes.values())
    .filter((n) => n.status === "ready")
    .sort((a, b) => b.priority - a.priority);
}

/**
 * Returns nodes currently running.
 */
export function getRunningNodes(graph: TaskGraph): TaskNode[] {
  return Array.from(graph.nodes.values()).filter((n) => n.status === "running");
}

// ─── Cycle Detection ──────────────────────────────────────────────────────────

function wouldCreateCycle(graph: TaskGraph, from: string, to: string): boolean {
  // Check if there's already a path from `to` to `from` (which would make adding from→to a cycle)
  const visited = new Set<string>();
  const queue = [to];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === from) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    // Follow edges from current
    for (const edge of graph.edges) {
      if (edge.from === current && !visited.has(edge.to)) {
        queue.push(edge.to);
      }
    }
  }
  // Also check: does `from` already reach `to` via existing path from `to`?
  // Actually we need to check if `to` can reach `from` via existing edges
  const visited2 = new Set<string>();
  const queue2 = [from];
  while (queue2.length > 0) {
    const current = queue2.shift()!;
    if (current === to) return false; // This is the edge we're adding, not a cycle
    if (visited2.has(current)) continue;
    visited2.add(current);
    for (const edge of graph.edges) {
      if (edge.to === current && !visited2.has(edge.from)) {
        queue2.push(edge.from);
      }
    }
  }
  return false;
}

/**
 * Validates the entire graph has no cycles. Returns the cycle path if found.
 */
export function detectCycle(graph: TaskGraph): string[] | null {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const path: string[] = [];

  function dfs(nodeId: string): boolean {
    visited.add(nodeId);
    inStack.add(nodeId);
    path.push(nodeId);

    const outEdges = graph.edges.filter((e) => e.from === nodeId);
    for (const edge of outEdges) {
      if (!visited.has(edge.to)) {
        if (dfs(edge.to)) return true;
      } else if (inStack.has(edge.to)) {
        path.push(edge.to);
        return true;
      }
    }

    path.pop();
    inStack.delete(nodeId);
    return false;
  }

  for (const nodeId of graph.nodes.keys()) {
    if (!visited.has(nodeId)) {
      if (dfs(nodeId)) return path;
    }
  }
  return null;
}

// ─── Graph Status Derivation ──────────────────────────────────────────────────

export function deriveGraphStatus(graph: TaskGraph): GraphStatus {
  const nodes = Array.from(graph.nodes.values());
  if (nodes.length === 0) return graph.status === "planning" ? "planning" : "completed";

  const allTerminal = nodes.every((n) => n.status === "done" || n.status === "cancelled");
  if (allTerminal) return "completed";

  const anyFailed = nodes.some((n) => n.status === "failed");
  const allBlockedOrFailed = nodes.every((n) => n.status === "done" || n.status === "cancelled" || n.status === "failed" || n.status === "blocked");
  if (allBlockedOrFailed && anyFailed) return "failed";

  const anyRunning = nodes.some((n) => n.status === "running" || n.status === "verifying");
  if (anyRunning) return "executing";

  const anyReady = nodes.some((n) => n.status === "ready");
  if (anyReady) return "executing";

  return graph.status;
}

export function updateGraphStatus(graph: TaskGraph, now?: string): TaskGraph {
  const next = cloneGraph(graph, now);
  const derived = deriveGraphStatus(next);
  next.status = derived;
  if (derived === "completed" || derived === "failed") {
    next.completedAt = timestamp(now);
  }
  return next;
}

// ─── Promotion (pending → ready) ─────────────────────────────────────────────

/**
 * Promotes all eligible pending nodes to ready status.
 * Call this after any node completion to unlock downstream work.
 */
export function promoteReadyNodes(graph: TaskGraph, now?: string): TaskGraph {
  let next = cloneGraph(graph, now);
  const ready = getReadyNodes(next);
  for (const node of ready) {
    const target = next.nodes.get(node.id)!;
    target.status = "ready";
  }
  return next;
}

// ─── Serialization ────────────────────────────────────────────────────────────

export function snapshotGraph(graph: TaskGraph): TaskGraphSnapshot {
  return {
    id: graph.id,
    goal: graph.goal,
    status: graph.status,
    nodes: Array.from(graph.nodes.values()),
    edges: [...graph.edges],
    createdAt: graph.createdAt,
    updatedAt: graph.updatedAt,
    completedAt: graph.completedAt,
    metadata: graph.metadata,
  };
}

export function restoreGraph(snapshot: TaskGraphSnapshot): TaskGraph {
  return {
    id: snapshot.id,
    goal: snapshot.goal,
    status: snapshot.status,
    nodes: new Map(snapshot.nodes.map((n) => [n.id, { ...n, dependencies: [...n.dependencies], evidence: [...n.evidence] }])),
    edges: snapshot.edges.map((e) => ({ ...e })),
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    completedAt: snapshot.completedAt,
    metadata: snapshot.metadata,
  };
}

// ─── Query Helpers ────────────────────────────────────────────────────────────

export function getNodesByStatus(graph: TaskGraph, status: TaskNodeStatus): TaskNode[] {
  return Array.from(graph.nodes.values()).filter((n) => n.status === status);
}

export function getNodesByAgent(graph: TaskGraph, agent: AgentRole): TaskNode[] {
  return Array.from(graph.nodes.values()).filter((n) => n.agent === agent);
}

export function getDependentsOf(graph: TaskGraph, nodeId: string): TaskNode[] {
  const dependentIds = graph.edges.filter((e) => e.from === nodeId).map((e) => e.to);
  return dependentIds.map((id) => graph.nodes.get(id)!).filter(Boolean);
}

export function getDependenciesOf(graph: TaskGraph, nodeId: string): TaskNode[] {
  const depIds = graph.edges.filter((e) => e.to === nodeId).map((e) => e.from);
  return depIds.map((id) => graph.nodes.get(id)!).filter(Boolean);
}

export function getGraphStats(graph: TaskGraph): SchedulerStateFromGraph {
  const nodes = Array.from(graph.nodes.values());
  return {
    total: nodes.length,
    pending: nodes.filter((n) => n.status === "pending").length,
    ready: nodes.filter((n) => n.status === "ready").length,
    running: nodes.filter((n) => n.status === "running").length,
    verifying: nodes.filter((n) => n.status === "verifying").length,
    done: nodes.filter((n) => n.status === "done").length,
    failed: nodes.filter((n) => n.status === "failed").length,
    blocked: nodes.filter((n) => n.status === "blocked").length,
    cancelled: nodes.filter((n) => n.status === "cancelled").length,
  };
}

interface SchedulerStateFromGraph {
  total: number;
  pending: number;
  ready: number;
  running: number;
  verifying: number;
  done: number;
  failed: number;
  blocked: number;
  cancelled: number;
}
