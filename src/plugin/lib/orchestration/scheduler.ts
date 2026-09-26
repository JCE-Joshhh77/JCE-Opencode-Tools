/**
 * Scheduler — Picks ready nodes, respects concurrency, dispatches execution
 * 
 * The scheduler is the "engine" that drives the TaskGraph forward.
 * It decides what to run next, manages concurrency per agent, and
 * handles the lifecycle of node execution.
 */

import type {
  TaskGraph,
  TaskNode,
  AgentRole,
  SchedulerConfig,
  TaskNodeOutput,
} from "./types.js";
import {
  getDispatchableNodes,
  getRunningNodes,
  transitionNode,
  completeNode,
  failNode,
  blockNode,
  promoteReadyNodes,
  updateGraphStatus,
  getReadyNodes,
} from "./task-graph.js";
import { classifyBlocker, recoveryActionToRetryStrategy } from "./blocker-classifier.js";

// ─── Scheduler Configuration ──────────────────────────────────────────────────

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  maxConcurrency: 5,
  maxConcurrencyPerAgent: {
    self: 1,
    oracle: 2,
    "jce-researcher": 2,
    explorer: 3,
    frontend: 1,
    android: 1,
  },
  staleAfterMs: 30 * 60 * 1000,
  defaultRetryPolicy: {
    maxRetries: 2,
    strategy: ["same", "different_approach", "escalate_user"],
    currentRetry: 0,
  },
};

// ─── Scheduler Events ─────────────────────────────────────────────────────────

export type SchedulerEventType =
  | "node.promoted"
  | "node.dispatched"
  | "node.completed"
  | "node.failed"
  | "node.blocked"
  | "node.retrying"
  | "node.stale"
  | "graph.completed"
  | "graph.failed"
  | "graph.replanning";

export interface SchedulerEvent {
  type: SchedulerEventType;
  nodeId?: string;
  timestamp: string;
  detail?: string;
  metadata?: Record<string, unknown>;
}

export type SchedulerEventHandler = (event: SchedulerEvent) => void;

// ─── Scheduler ────────────────────────────────────────────────────────────────

export class Scheduler {
  private config: SchedulerConfig;
  private eventHandlers: SchedulerEventHandler[] = [];
  private now: () => string;

  constructor(config: Partial<SchedulerConfig> = {}, now?: () => string) {
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
    this.now = now ?? (() => new Date().toISOString());
  }

  onEvent(handler: SchedulerEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
    };
  }

  private emit(event: SchedulerEvent): void {
    for (const handler of this.eventHandlers) {
      try { handler(event); } catch { /* swallow handler errors */ }
    }
  }

  /**
   * Advance the graph: promote pending → ready, return nodes to dispatch.
   * This is the main "tick" of the scheduler.
   */
  tick(graph: TaskGraph): { graph: TaskGraph; toDispatch: TaskNode[] } {
    // Step 1: Promote pending nodes whose dependencies are satisfied
    let next = promoteReadyNodes(graph, this.now());
    const promoted = getReadyNodes(graph); // nodes that were pending and are now ready
    for (const node of promoted) {
      this.emit({ type: "node.promoted", nodeId: node.id, timestamp: this.now() });
    }

    // Step 2: Get dispatchable nodes respecting concurrency
    const dispatchable = this.selectForDispatch(next);

    // Step 3: Mark selected nodes as running
    for (const node of dispatchable) {
      next = transitionNode(next, node.id, "running", this.now());
      this.emit({ type: "node.dispatched", nodeId: node.id, timestamp: this.now(), detail: `agent: ${node.agent}` });
    }

    // Step 4: Update graph status
    next = updateGraphStatus(next, this.now());
    if (next.status === "completed") {
      this.emit({ type: "graph.completed", timestamp: this.now() });
    } else if (next.status === "failed") {
      this.emit({ type: "graph.failed", timestamp: this.now() });
    }

    return { graph: next, toDispatch: dispatchable };
  }

  /**
   * Advance MANY graphs in one pass with a SHARED concurrency budget.
   *
   * Agents (and the global slot count) are shared resources across every active
   * graph, so per-graph ticking would oversubscribe them. This computes running
   * counts across all graphs, then dispatches fairly (round-robin) so no single
   * graph starves the others.
   *
   * Returns the updated graphs (same order) plus a flat dispatch list tagged
   * with the owning graphId.
   */
  tickAll(graphs: TaskGraph[]): { graphs: TaskGraph[]; toDispatch: Array<{ graphId: string; node: TaskNode }> } {
    // Step 1: promote ready nodes in every graph first.
    const promotedGraphs = graphs.map((graph) => {
      const next = promoteReadyNodes(graph, this.now());
      for (const node of getReadyNodes(graph)) {
        this.emit({ type: "node.promoted", nodeId: node.id, timestamp: this.now() });
      }
      return next;
    });

    // Step 2: seed shared running counts from ALL graphs.
    let globalRunning = 0;
    const agentCounts = new Map<AgentRole, number>();
    for (const graph of promotedGraphs) {
      for (const node of getRunningNodes(graph)) {
        globalRunning += 1;
        agentCounts.set(node.agent, (agentCounts.get(node.agent) ?? 0) + 1);
      }
    }

    // Step 3: build per-graph candidate queues (priority-sorted).
    const queues = promotedGraphs.map((graph) => ({
      graphId: graph.id,
      candidates: getDispatchableNodes(graph),
    }));

    // Step 4: round-robin selection across graphs under the shared budget.
    const selectedByGraph = new Map<string, Set<string>>();
    const toDispatch: Array<{ graphId: string; node: TaskNode }> = [];
    let progress = true;
    while (globalRunning < this.config.maxConcurrency && progress) {
      progress = false;
      for (const queue of queues) {
        if (globalRunning >= this.config.maxConcurrency) break;
        const chosen = selectedByGraph.get(queue.graphId) ?? new Set<string>();
        const node = queue.candidates.find((candidate) => {
          if (chosen.has(candidate.id)) return false;
          const agentCount = agentCounts.get(candidate.agent) ?? 0;
          const agentLimit = this.config.maxConcurrencyPerAgent[candidate.agent] ?? this.config.maxConcurrency;
          return agentCount < agentLimit;
        });
        if (!node) continue;
        chosen.add(node.id);
        selectedByGraph.set(queue.graphId, chosen);
        agentCounts.set(node.agent, (agentCounts.get(node.agent) ?? 0) + 1);
        globalRunning += 1;
        toDispatch.push({ graphId: queue.graphId, node });
        progress = true;
      }
    }

    // Step 5: transition selected nodes to running and refresh graph status.
    const resultGraphs = promotedGraphs.map((graph) => {
      let next = graph;
      const chosen = selectedByGraph.get(graph.id);
      if (chosen) {
        for (const nodeId of chosen) {
          next = transitionNode(next, nodeId, "running", this.now());
          this.emit({ type: "node.dispatched", nodeId, timestamp: this.now(), detail: `agent: ${next.nodes.get(nodeId)?.agent}` });
        }
      }
      next = updateGraphStatus(next, this.now());
      if (next.status === "completed") this.emit({ type: "graph.completed", timestamp: this.now(), metadata: { graphId: next.id } });
      else if (next.status === "failed") this.emit({ type: "graph.failed", timestamp: this.now(), metadata: { graphId: next.id } });
      return next;
    });

    return { graphs: resultGraphs, toDispatch };
  }

  /**
   * Select nodes to dispatch, respecting global and per-agent concurrency limits.
   */
  private selectForDispatch(graph: TaskGraph): TaskNode[] {
    const running = getRunningNodes(graph);
    const globalSlots = this.config.maxConcurrency - running.length;
    if (globalSlots <= 0) return [];

    const agentCounts = new Map<AgentRole, number>();
    for (const node of running) {
      agentCounts.set(node.agent, (agentCounts.get(node.agent) ?? 0) + 1);
    }

    const candidates = getDispatchableNodes(graph);
    const selected: TaskNode[] = [];

    for (const node of candidates) {
      if (selected.length >= globalSlots) break;
      const agentCount = agentCounts.get(node.agent) ?? 0;
      const agentLimit = this.config.maxConcurrencyPerAgent[node.agent] ?? this.config.maxConcurrency;
      if (agentCount >= agentLimit) continue;

      selected.push(node);
      agentCounts.set(node.agent, agentCount + 1);
    }

    return selected;
  }

  /**
   * Handle successful node completion. Returns updated graph.
   */
  onNodeComplete(graph: TaskGraph, nodeId: string, output: TaskNodeOutput): TaskGraph {
    let next = completeNode(graph, nodeId, output, this.now());
    this.emit({ type: "node.completed", nodeId, timestamp: this.now(), detail: `confidence: ${output.confidence}` });

    // Promote downstream nodes
    next = promoteReadyNodes(next, this.now());
    next = updateGraphStatus(next, this.now());

    if (next.status === "completed") {
      this.emit({ type: "graph.completed", timestamp: this.now() });
    }

    return next;
  }

  /**
   * Handle node failure. Decides whether to retry or block.
   */
  onNodeFailed(graph: TaskGraph, nodeId: string, reason: string): { graph: TaskGraph; action: "retry" | "blocked" | "escalate" } {
    const node = graph.nodes.get(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);

    const retryPolicy = node.retryPolicy;
    const blocker = classifyBlocker(reason);
    let next: TaskGraph;

    if (blocker.askUser) {
      next = blockNode(graph, nodeId, reason, this.now(), blocker.classification);
      this.emit({ type: "node.blocked", nodeId, timestamp: this.now(), detail: `classified: ${blocker.classification}` });
      next = updateGraphStatus(next, this.now());
      return { graph: next, action: "escalate" };
    }

    if (retryPolicy.currentRetry < retryPolicy.maxRetries) {
      // Retry: reset to pending with incremented retry counter
      next = failNode(graph, nodeId, reason, this.now());
      const failedNode = next.nodes.get(nodeId)!;
      failedNode.status = "pending";
       failedNode.blockerClass = blocker.classification;
      // Blocker-aware recovery strategy for the NEXT attempt. Stored as an
      // override field (not written into strategy[]) because getRetryStrategy
      // indexes by currentRetry AFTER the increment — writing to index 0 (the
      // already-consumed first-attempt slot) meant the classifier's strategy
      // was never actually used, while mutating the array corrupts the static
      // escalate-vs-block decision that reads strategy[last].
      failedNode.retryPolicy = {
        ...failedNode.retryPolicy,
        currentRetry: failedNode.retryPolicy.currentRetry + 1,
        nextRetryStrategy: recoveryActionToRetryStrategy(blocker.action),
      };
      // Clear the old execution lease: transitionNode only sets startedAt when
      // it is absent, so keeping the pre-failure startedAt would make the
      // re-dispatched node instantly stale again (stale churn loop — the node
      // would burn its whole retry budget seconds after a fresh dispatch).
      failedNode.startedAt = undefined;
      failedNode.completedAt = undefined;

      this.emit({
        type: "node.retrying",
        nodeId,
        timestamp: this.now(),
        detail: `retry ${failedNode.retryPolicy.currentRetry}/${retryPolicy.maxRetries}, strategy: ${this.getRetryStrategy(failedNode)}`,
      });

      next = updateGraphStatus(promoteReadyNodes(next, this.now()), this.now());
      return { graph: next, action: "retry" };
    }

    // Check if we should escalate to user
    const lastStrategy = retryPolicy.strategy[retryPolicy.strategy.length - 1];
    if (lastStrategy === "escalate_user") {
      next = blockNode(graph, nodeId, `Exhausted retries (${retryPolicy.maxRetries}): ${reason}`, this.now(), blocker.classification);
      this.emit({ type: "node.blocked", nodeId, timestamp: this.now(), detail: "escalating to user" });
      next = updateGraphStatus(next, this.now());
      return { graph: next, action: "escalate" };
    }

    // Block permanently
    next = failNode(graph, nodeId, reason, this.now());
    this.emit({ type: "node.failed", nodeId, timestamp: this.now(), detail: reason });
    next = updateGraphStatus(next, this.now());
    return { graph: next, action: "blocked" };
  }

  /**
   * Handle node blocked (external dependency, user input needed, etc.)
   */
  onNodeBlocked(graph: TaskGraph, nodeId: string, reason: string): TaskGraph {
    let next = blockNode(graph, nodeId, reason, this.now());
    this.emit({ type: "node.blocked", nodeId, timestamp: this.now(), detail: reason });
    next = updateGraphStatus(next, this.now());
    return next;
  }

  /**
   * Detect and handle stale nodes (running too long without activity).
   */
  detectStaleNodes(graph: TaskGraph): { graph: TaskGraph; staleNodes: TaskNode[] } {
    const nowMs = Date.parse(this.now());
    const running = getRunningNodes(graph);
    const stale: TaskNode[] = [];
    let next = graph;

    for (const node of running) {
      const startMs = node.startedAt ? Date.parse(node.startedAt) : nowMs;
      if (nowMs - startMs > this.config.staleAfterMs) {
        stale.push(node);
        this.emit({ type: "node.stale", nodeId: node.id, timestamp: this.now(), detail: `stale for ${nowMs - startMs}ms` });
      }
    }

    // Fail stale nodes so they can be retried
    for (const node of stale) {
      const result = this.onNodeFailed(next, node.id, `Node stale: no activity for ${this.config.staleAfterMs}ms`);
      next = result.graph;
    }

    return { graph: next, staleNodes: stale };
  }

  /**
   * Get the current retry strategy for a node.
   * A blocker-aware override (set by onNodeFailed from the failure
   * classification) takes precedence over the static strategy slot.
   */
  getRetryStrategy(node: TaskNode): string {
    if (node.retryPolicy.nextRetryStrategy) return node.retryPolicy.nextRetryStrategy;
    const idx = Math.min(node.retryPolicy.currentRetry, node.retryPolicy.strategy.length - 1);
    return node.retryPolicy.strategy[idx] ?? "same";
  }

  /**
   * Check if the scheduler can accept more work.
   */
  canAcceptWork(graph: TaskGraph): boolean {
    return getRunningNodes(graph).length < this.config.maxConcurrency;
  }

  /**
   * Get scheduler state summary.
   */
  getState(graph: TaskGraph): { running: number; pending: number; ready: number; capacity: number } {
    const running = getRunningNodes(graph).length;
    const nodes = Array.from(graph.nodes.values());
    return {
      running,
      pending: nodes.filter((n) => n.status === "pending").length,
      ready: nodes.filter((n) => n.status === "ready").length,
      capacity: this.config.maxConcurrency - running,
    };
  }
}
