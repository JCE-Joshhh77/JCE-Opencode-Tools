/**
 * Orchestration Controller — Bridge between new orchestration core and existing plugin tools
 * 
 * This controller manages the lifecycle of a TaskGraph within a session,
 * integrating with the existing BackgroundManager for actual sub-agent dispatch
 * while using the new orchestration primitives for planning, scheduling, and evidence.
 */

import type {
  TaskGraph,
  TaskNode,
  AgentRole,
  ScoredIntent,
  Evidence,
  Fact,
  PlanDelta,
  AutonomyLevel,
  OperatorPreferences,
} from "./types.js";
import {
  createTaskGraph,
  addNode,
  promoteReadyNodes,
  updateGraphStatus,
  getGraphStats,
  transitionNodeWithReason,
  type CreateNodeInput,
} from "./task-graph.js";
import { Scheduler, type SchedulerEvent } from "./scheduler.js";
import { AdaptivePlanner } from "./planner.js";
import {
  createOrchestrationMemory,
  addFact,
  addFacts,
  addDecision,
  addConstraint,
  addArtifacts,
  pruneMemory,
  getTopFacts,
  getActiveConstraints,
  type OrchestrationMemory,
} from "./shared-memory.js";
import {
  buildAgentRequest,
  formatAgentRequestAsPrompt,
  parseAgentResult,
  resultToNodeOutput,
} from "./agent-protocol.js";
import { aggregateEvidence, createEvidence, type AggregateEvidenceScore } from "./evidence-system.js";
import { scoreIntent, toLegacyRoute, type RouterContext } from "./intent-router.js";
import {
  loadMemoryV2,
  saveMemoryV2,
  mergeOrchestrationIntoMemory,
  restoreOrchestrationFromMemory,
  startSession,
  endSession,
} from "./execution-memory-v2.js";
import type { ExecutionMemoryV2 } from "./types.js";
import { buildFailureSignature } from "../failure-signature.js";
import { recordFailurePattern, queryFailurePattern, formatFailureWarning } from "./failure-pattern-store.js";
import { recordStrategyOutcome, selectStrategyWithTelemetry } from "./strategy-telemetry.js";
import { buildRiskHeatmap } from "./risk-heatmap.js";
import { withErrorBoundary } from "./reliability.js";
import { assessAdaptiveComplexity, type ExecutionStrategy } from "./intelligence.js";
import { GraphRegistry } from "./graph-registry.js";
import {
  assessTaskComplexity,
  shouldAutoActivate,
  buildCrossNodeContext,
  formatCrossNodeContext,
  evaluateCompletionGate,
  formatCompletionGateResult,
  shouldEscalateToUser,
  formatEscalation,
  shouldRecordToolEvidence,
  extractToolEvidence,
  findRelevantWisdom,
  findRelevantLearnings,
  formatWisdomContext,
  buildOrchestrationStatusReport,
  formatOrchestrationStatus,
  identifyParallelGroups,
  computeNextBestAction,
  type ComplexityAssessment,
  type CompletionGateResult,
  type EscalationDecision,
  type OrchestrationStatusReport,
} from "./intelligence.js";

// ─── Controller State ─────────────────────────────────────────────────────────

export interface OrchestrationControllerConfig {
  projectRoot: string;
  maxConcurrency?: number;
  staleAfterMs?: number;
  now?: () => string;
}

export interface DispatchResult {
  nodeId: string;
  agent: AgentRole;
  prompt: string;
  skills: string[];
  modelCategory: string;
}

export interface CollectResult {
  nodeId: string;
  status: "success" | "partial" | "failed" | "blocked";
  summary: string;
  confidence: number;
  evidence: AggregateEvidenceScore;
  newFacts: Fact[];
  blockers: string[];
  replanAction?: PlanDelta;
}

export interface OrchestrationStatus {
  graphId: string | null;
  graphStatus: string;
  stats: ReturnType<typeof getGraphStats> | null;
  intent: ScoredIntent | null;
  assessment: { confidence: number; completionEstimate: number; risks: string[]; suggestions: string[] } | null;
  events: SchedulerEvent[];
}

const DEFAULT_OPERATOR_PREFERENCES: OperatorPreferences = {
  preferAutonomousCompletion: false,
  askBeforeArchitectureChange: true,
  preferBroadVerification: true,
  preferTerseReports: false,
  defaultReleaseStrictness: "medium",
};

// ─── Controller ───────────────────────────────────────────────────────────────

export class OrchestrationController {
  private graph: TaskGraph | null = null;
  private graphRegistry = new GraphRegistry();
  private memory: OrchestrationMemory;
  private execMemory: ExecutionMemoryV2;
  private scheduler: Scheduler;
  private planner: AdaptivePlanner;
  private currentIntent: ScoredIntent | null = null;
  private events: SchedulerEvent[] = [];
  private projectRoot: string;
  private now: () => string;
  private nodeToTaskMap: Map<string, string> = new Map(); // nodeId → background taskId
  private nodeToGraphMap: Map<string, string> = new Map(); // nodeId → owning graphId (multi-graph)
  private strategyOutcomeRecorded: Set<string> = new Set(); // graphIds already recorded in telemetry
  private autonomyLevel: AutonomyLevel;
  private operatorPreferences: OperatorPreferences;

  constructor(config: OrchestrationControllerConfig) {
    this.projectRoot = config.projectRoot;
    this.now = config.now ?? (() => new Date().toISOString());

    this.scheduler = new Scheduler(
      { maxConcurrency: config.maxConcurrency ?? 5, staleAfterMs: config.staleAfterMs },
      this.now,
    );
    this.scheduler.onEvent((event) => {
      this.events.push(event);
      // Keep last 100 events
      if (this.events.length > 100) this.events = this.events.slice(-100);
    });

    this.planner = new AdaptivePlanner(undefined, this.now);

    // Load persisted state
    const loaded = loadMemoryV2(this.projectRoot, this.now());
    this.execMemory = startSession(loaded.memory, undefined, this.now());
    this.autonomyLevel = loaded.memory.autonomyLevel ?? "balanced";
    this.operatorPreferences = { ...DEFAULT_OPERATOR_PREFERENCES, ...(loaded.memory.operatorPreferences ?? {}) };

    // Restore orchestration memory and graph from persisted state.
    // Stale/terminal graphs are dropped to prevent cross-session leakage (C1).
    const restored = restoreOrchestrationFromMemory(this.execMemory, this.now());
    this.memory = restored.memory ?? createOrchestrationMemory(this.now());
    this.graph = restored.graph ?? null;
    if (this.graph) this.graphRegistry.setActive(this.graph);
  }

  private syncGraphRegistry(): void {
    if (this.graph) this.graphRegistry.update(this.graph);
  }

  // ─── Intent & Planning ────────────────────────────────────────────────────

  /**
   * Route a user message through the intent router.
   * Returns the scored intent and optionally creates a plan.
   */
  routeIntent(message: string, context: RouterContext = {}): ScoredIntent {
    this.currentIntent = scoreIntent(message, context);
    return this.currentIntent;
  }

  /**
   * Prepare controller state before installing a brand-new graph.
   *
   * Clears the node→task mapping so late-completing tasks from a previous graph
   * cannot resolve to stale node IDs (which would throw "Node not found" in
   * collectResult and inject a spurious blocker). If an in-flight (incomplete)
   * graph is being replaced, emit an event so the replacement is never silent.
   */
  private prepareForNewGraph(context: string): void {
    if (this.graph && !this.isComplete()) {
      this.events.push({
        type: "graph.replanning",
        timestamp: this.now(),
        detail: `Replacing in-flight graph ${this.graph.id} (status=${this.graph.status}) with a new plan (${context}). Prior node→task mappings cleared.`,
        metadata: { previousGraphId: this.graph.id, previousStatus: this.graph.status, context },
      });
      if (this.events.length > 100) this.events = this.events.slice(-100);
    }
    this.nodeToTaskMap.clear();
  }

  /**
   * Create a new task graph from the current intent.
   */
  createPlan(goal: string, intent?: ScoredIntent): TaskGraph {
    const resolvedIntent = intent ?? this.currentIntent ?? scoreIntent(goal);
    this.currentIntent = resolvedIntent;

    this.prepareForNewGraph("createPlan");

    // Determine execution strategy: rule-based assessment, then bias by learned
    // telemetry (only overrides when historical confidence is high enough).
    const ruleAssessment = assessAdaptiveComplexity(goal, resolvedIntent);
    const strategyDecision = selectStrategyWithTelemetry(
      ruleAssessment.strategy,
      resolvedIntent.intent,
      this.execMemory.strategyTelemetry,
    );

    // Create graph
    this.graph = createTaskGraph({
      id: `graph-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      goal,
      now: this.now(),
      metadata: {
        executionStrategy: strategyDecision.strategy,
        strategySource: strategyDecision.source,
        plannedIntent: resolvedIntent.intent,
      },
    });

    // Generate plan from intent
    const plan = this.planner.plan(resolvedIntent, goal, this.memory);

    // Add nodes to graph
    for (const nodeInput of plan.nodes) {
      this.graph = addNode(this.graph, nodeInput, this.now());
    }

    // Promote initial ready nodes
    this.graph = promoteReadyNodes(this.graph, this.now());
    this.graph = updateGraphStatus(this.graph, this.now());
    this.graphRegistry.setActive(this.graph);

    // Record decision
    this.memory = addDecision(this.memory, {
      description: `Plan created for: ${goal}`,
      reasoning: `Intent: ${resolvedIntent.intent} (confidence: ${resolvedIntent.confidence}), ${plan.nodes.length} nodes`,
    }, this.now());

    const plannerNodes = plan.nodes.filter((node) => node.metadata?.plannerMode || node.metadata?.parallelization);
    const fanOutNode = plannerNodes.find((node) => node.metadata?.parallelization === "explicit-independent-units");
    const fallbackNode = plannerNodes.find((node) => node.metadata?.parallelization === "linear-fallback");
    this.events.push({
      type: "graph.replanning",
      timestamp: this.now(),
      detail: fanOutNode
        ? `Planner fan-out created ${Array.isArray(fanOutNode.metadata?.parallelUnits) ? fanOutNode.metadata?.parallelUnits.length : 0} explicit unit(s).`
        : `Planner kept linear plan.${typeof fallbackNode?.metadata?.parallelFallbackReason === "string" ? ` ${fallbackNode.metadata.parallelFallbackReason}` : ""}`,
      metadata: {
        workflowId: this.graph.id,
        plannerMode: fanOutNode ? "fanout" : "linear-fallback",
        detectedUnits: Array.isArray(fanOutNode?.metadata?.parallelUnits) ? fanOutNode?.metadata?.parallelUnits : [],
        fallbackReason: typeof fallbackNode?.metadata?.parallelFallbackReason === "string" ? fallbackNode.metadata.parallelFallbackReason : undefined,
      },
    });
    if (this.events.length > 100) this.events = this.events.slice(-100);

    return this.graph;
  }

  createReleaseCommanderPlan(goal: string, targetVersion: string): TaskGraph {
    this.currentIntent = scoreIntent(`release ${goal}`);
    this.prepareForNewGraph("createReleaseCommanderPlan");
    this.graph = createTaskGraph({
      id: `graph-release-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      goal,
      now: this.now(),
      metadata: { mode: "release-commander", targetVersion },
    });

    const releaseStrictness = this.operatorPreferences.defaultReleaseStrictness ?? "medium";
    const includeApprovalNode = releaseStrictness === "high" || this.autonomyLevel === "release-lock";
    const nodes: CreateNodeInput[] = [
      { id: `release-verify-${targetVersion}`, type: "verify", title: "Run pre-release verification", description: `Verify release readiness for ${targetVersion}`, agent: "self", prompt: `Run release verification for ${targetVersion}`, priority: 10, metadata: { releaseCommander: true } },
      { id: `release-sync-${targetVersion}`, type: "config", title: "Check version sync and changelog", description: `Check version/changelog sync for ${targetVersion}`, agent: "self", prompt: `Confirm version sync and changelog truth for ${targetVersion}`, dependencies: [`release-verify-${targetVersion}`], priority: 9, metadata: { releaseCommander: true } },
      { id: `release-compat-${targetVersion}`, type: "review", title: "Check updater compatibility", description: `Check updater/tag compatibility for ${targetVersion}`, agent: "oracle", prompt: `Check updater compatibility and release tag sanity for ${targetVersion}`, dependencies: [`release-sync-${targetVersion}`], priority: 8, metadata: { releaseCommander: true } },
      { id: `release-stage-${targetVersion}`, type: "review", title: "Prepare safe staging plan", description: `Prepare safe staging plan for ${targetVersion}`, agent: "self", prompt: `Build safe staging plan for ${targetVersion} release files and exclude local/context artifacts`, dependencies: [`release-compat-${targetVersion}`], priority: 7, metadata: { releaseCommander: true } },
      { id: `release-notes-${targetVersion}`, type: "plan", title: "Prepare release notes", description: `Prepare release notes for ${targetVersion}`, agent: "self", prompt: `Prepare final release notes and delta summary for ${targetVersion}`, dependencies: [`release-stage-${targetVersion}`], priority: 6, metadata: { releaseCommander: true } },
    ];
    if (includeApprovalNode) {
      nodes.push({ id: `release-approval-${targetVersion}`, type: "review", title: "Approval boundary review", description: `Review approval boundaries for ${targetVersion}`, agent: "self", prompt: `Check commit/push/tag/release approval boundaries for ${targetVersion} before final release execution`, dependencies: [`release-notes-${targetVersion}`], priority: 5, metadata: { releaseCommander: true, approvalBoundary: true } });
    }

    for (const node of nodes) {
      this.graph = addNode(this.graph, node, this.now());
    }
    this.graph = promoteReadyNodes(this.graph, this.now());
    this.graph = updateGraphStatus(this.graph, this.now());
    this.graphRegistry.setActive(this.graph);
    return this.graph;
  }

  advanceReleaseCommanderLifecycle(): TaskGraph | null {
    if (!this.graph || this.graph.metadata?.mode !== "release-commander") return this.graph;
    for (const node of this.graph.nodes.values()) {
      if (node.status === "ready") {
        this.graph = transitionNodeWithReason(this.graph, node.id, "running", `release commander executing ${node.title}`, this.now());
        if (node.type === "verify") {
          this.graph = transitionNodeWithReason(this.graph, node.id, "verifying", `verification started for ${node.title}`, this.now());
        }
        break;
      }
    }
    this.graph = updateGraphStatus(this.graph, this.now());
    return this.graph;
  }

  /**
   * Add a single node to the current graph (for manual/dynamic additions).
   */
  addNodeToGraph(input: CreateNodeInput): TaskGraph {
    if (!this.graph) throw new Error("No active graph. Call createPlan first.");
    this.graph = addNode(this.graph, input, this.now());
    this.graph = promoteReadyNodes(this.graph, this.now());
    this.graph = updateGraphStatus(this.graph, this.now());
    return this.graph;
  }

  // ─── Dispatch ─────────────────────────────────────────────────────────────

  /**
   * Get the next nodes to dispatch. Call this to know what work to send to sub-agents.
   */
  getNextDispatch(): DispatchResult[] {
    if (!this.graph) return [];

    const { graph, toDispatch } = this.scheduler.tick(this.graph);
    this.graph = graph;

    return toDispatch.map((node) => {
      const request = buildAgentRequest(node, {
        facts: getTopFacts(this.memory, 10),
        constraints: getActiveConstraints(this.memory),
        priorArtifacts: [],
        skills: node.input.skills ?? [],
      });

      let prompt = formatAgentRequestAsPrompt(request);

      // On a retry, inject a proactive warning if this failure pattern is known
      // (root cause + fixes that already failed), so the sub-agent avoids them.
      // Uses the same stable key as handleFailure so the lookup actually matches.
      if (node.retryPolicy.currentRetry > 0) {
        const pattern = queryFailurePattern(this.execMemory.failurePatterns, this.failurePatternKey(node));
        const warning = formatFailureWarning(pattern);
        if (warning) prompt = `${warning}\n\n${prompt}`;
      }

      return {
        nodeId: node.id,
        agent: node.agent,
        prompt,
        skills: node.input.skills ?? [],
        modelCategory: node.type === "research" ? "exploration" : node.type === "review" ? "deep" : "default",
      };
    });
  }

  /**
   * Multi-graph dispatch: advance EVERY registered graph under one shared
   * concurrency budget and return dispatch instructions tagged with graphId.
   *
   * Reuses the single-graph request-building logic; only the scheduling pass is
   * cross-graph. The active graph pointer is left unchanged.
   */
  getNextDispatchAll(): Array<DispatchResult & { graphId: string }> {
    this.syncGraphRegistry();
    const graphs = this.graphRegistry.list().filter((g) => g.status !== "completed" && g.status !== "failed" && g.status !== "cancelled");
    if (graphs.length === 0) return [];

    const { graphs: advanced, toDispatch } = this.scheduler.tickAll(graphs);
    for (const graph of advanced) this.graphRegistry.update(graph);
    // Keep this.graph consistent with the (possibly mutated) active graph.
    this.graph = this.graphRegistry.getActive();

    return toDispatch.map(({ graphId, node }) => {
      this.nodeToGraphMap.set(node.id, graphId);
      const request = buildAgentRequest(node, {
        facts: getTopFacts(this.memory, 10),
        constraints: getActiveConstraints(this.memory),
        priorArtifacts: [],
        skills: node.input.skills ?? [],
      });
      return {
        graphId,
        nodeId: node.id,
        agent: node.agent,
        prompt: formatAgentRequestAsPrompt(request),
        skills: node.input.skills ?? [],
        modelCategory: node.type === "research" ? "exploration" : node.type === "review" ? "deep" : "default",
      };
    });
  }

  /**
   * Collect a sub-agent result into a SPECIFIC graph (multi-graph aware).
   *
   * Reuses collectResult by temporarily activating the owning graph, then
   * restores the previous active graph so concurrent workstreams don't clobber
   * each other's active pointer.
   */
  collectResultForGraph(graphId: string, nodeId: string, rawOutput: string): CollectResult {
    this.syncGraphRegistry();
    const previousActiveId = this.graph?.id ?? null;
    if (!this.graphRegistry.switchActive(graphId)) {
      throw new Error(`Unknown graph: ${graphId}`);
    }
    this.graph = this.graphRegistry.getActive();
    try {
      const result = this.collectResult(nodeId, rawOutput);
      if (this.graph) this.graphRegistry.update(this.graph);
      return result;
    } finally {
      if (previousActiveId && this.graphRegistry.switchActive(previousActiveId)) {
        this.graph = this.graphRegistry.getActive();
      }
    }
  }

  /**
   * Map a dispatched node to a background task ID (for tracking).
   */
  mapNodeToTask(nodeId: string, taskId: string): void {
    this.nodeToTaskMap.set(nodeId, taskId);
  }

  /**
   * Get the node ID for a background task ID.
   */
  getNodeForTask(taskId: string): string | undefined {
    for (const [nodeId, tid] of this.nodeToTaskMap.entries()) {
      if (tid === taskId) return nodeId;
    }
    return undefined;
  }

  /**
   * Get the owning graphId for a node (multi-graph dispatch tracking).
   * Returns undefined for nodes dispatched via the single-graph path.
   */
  getGraphForNode(nodeId: string): string | undefined {
    return this.nodeToGraphMap.get(nodeId);
  }

  /**
   * Create MULTIPLE concurrent plans (one graph per independent workstream).
   *
   * Unlike createPlan (which replaces the active graph), each goal becomes its
   * own graph registered alongside the others so the multi-graph scheduler can
   * advance them under one shared concurrency budget. The first plan becomes the
   * active graph for backward-compatible single-graph callers.
   *
   * Returns the created graphs in input order.
   */
  createConcurrentPlans(goals: string[]): TaskGraph[] {
    // Fresh batch: clear any prior/orphan graph (e.g. an approval-gate probe
    // plan) and node maps so only these workstreams are scheduled.
    this.graphRegistry.reset();
    this.nodeToTaskMap.clear();
    this.nodeToGraphMap.clear();
    this.graph = null;
    const created: TaskGraph[] = [];
    for (let i = 0; i < goals.length; i += 1) {
      const goal = goals[i].trim();
      if (!goal) continue;
      const intent = scoreIntent(goal);
      const graph = createTaskGraph({
        id: `graph-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        goal,
        now: this.now(),
        metadata: { concurrentWorkstream: true, workstreamIndex: i },
      });
      let built = graph;
      const plan = this.planner.plan(intent, goal, this.memory);
      for (const nodeInput of plan.nodes) {
        built = addNode(built, nodeInput, this.now());
      }
      built = promoteReadyNodes(built, this.now());
      built = updateGraphStatus(built, this.now());

      // First workstream becomes the active graph; the rest are registered
      // alongside it so tickAll can schedule them concurrently.
      if (i === 0) {
        this.graph = built;
        this.currentIntent = intent;
        this.graphRegistry.setActive(built);
      } else {
        this.graphRegistry.update(built);
      }
      created.push(built);
    }

    this.memory = addDecision(this.memory, {
      description: `Concurrent plans created: ${created.length} workstream(s)`,
      reasoning: goals.map((g) => g.trim()).filter(Boolean).join(" | ").slice(0, 240),
    }, this.now());

    this.events.push({
      type: "graph.replanning",
      timestamp: this.now(),
      detail: `Created ${created.length} concurrent workstream graph(s).`,
      metadata: { concurrent: true, graphIds: created.map((g) => g.id) },
    });
    if (this.events.length > 100) this.events = this.events.slice(-100);

    return created;
  }

  // ─── Collection & Completion ──────────────────────────────────────────────

  /**
   * Process a completed sub-agent result for a node.
   */
  collectResult(nodeId: string, rawOutput: string): CollectResult {
    if (!this.graph) throw new Error("No active graph.");
    const node = this.graph.nodes.get(nodeId);
    if (!node) {
      // The node was removed by a replan, or belongs to a superseded graph
      // whose task completed late. Treat as a benign no-op instead of throwing
      // (a throw here would be turned into a spurious blocker by the caller).
      this.nodeToTaskMap.delete(nodeId);
      this.events.push({
        type: "graph.replanning",
        timestamp: this.now(),
        detail: `Discarded late result for unknown node ${nodeId} (removed by replan or superseded graph).`,
        metadata: { nodeId },
      });
      if (this.events.length > 100) this.events = this.events.slice(-100);
      return {
        nodeId,
        status: "success",
        summary: `Late/orphaned result for ${nodeId} ignored.`,
        confidence: 0,
        evidence: aggregateEvidence([]),
        newFacts: [],
        blockers: [],
      };
    }

    // Parse the raw output into structured result
    const request = buildAgentRequest(node, {
      facts: getTopFacts(this.memory, 10),
      constraints: getActiveConstraints(this.memory),
      priorArtifacts: [],
      skills: node.input.skills ?? [],
    });
    const agentResult = parseAgentResult(rawOutput, request);

    // Convert to node output
    const output = resultToNodeOutput(agentResult);

    // Update graph based on result status
    if (agentResult.status === "success" || agentResult.status === "partial") {
      this.graph = this.scheduler.onNodeComplete(this.graph, nodeId, output);
      // If this node had retried before succeeding, the approach worked — record
      // the winning fix category so future similar failures can reuse it.
      // Uses the same stable key as handleFailure so it updates the SAME pattern.
      if (node.retryPolicy.currentRetry > 0 && agentResult.status === "success") {
        this.execMemory.failurePatterns = recordFailurePattern(
          this.execMemory.failurePatterns,
          { ...this.failurePatternKey(node), fixCategory: node.title, fixSucceeded: true },
          this.now(),
        );
      }
    } else if (agentResult.status === "blocked") {
      this.graph = this.scheduler.onNodeBlocked(this.graph, nodeId, agentResult.blockers.join("; "));
    } else {
      const failResult = this.scheduler.onNodeFailed(this.graph, nodeId, agentResult.summary);
      this.graph = failResult.graph;
    }

    // Propagate new facts to shared memory
    if (agentResult.newFacts.length > 0) {
      this.memory = addFacts(this.memory, agentResult.newFacts, this.now());
    }

    // Propagate artifacts
    if (agentResult.artifacts.length > 0) {
      this.memory = addArtifacts(this.memory, agentResult.artifacts, this.now());
    }

    // Re-plan if needed
    const completedNode = this.graph.nodes.get(nodeId)!;
    let replanAction: PlanDelta | null = null;
    if (completedNode.status === "done") {
      replanAction = this.planner.replan(this.graph, completedNode, this.memory);
      if (replanAction && (replanAction.addNodes.length > 0 || replanAction.removeNodeIds.length > 0)) {
        this.graph = this.planner.applyDelta(this.graph, replanAction, this.now());
        this.graph = promoteReadyNodes(this.graph, this.now());
        this.graph = updateGraphStatus(this.graph, this.now());
      }
    }

    // Aggregate evidence for this node
    const evidenceScore = aggregateEvidence(completedNode.evidence);

    return {
      nodeId,
      status: agentResult.status,
      summary: agentResult.summary,
      confidence: agentResult.confidence,
      evidence: evidenceScore,
      newFacts: agentResult.newFacts,
      blockers: agentResult.blockers,
      replanAction: replanAction ?? undefined,
    };
  }

  /**
   * Manually record evidence for a node (e.g., from direct tool execution).
   */
  recordEvidence(nodeId: string, input: { type: Evidence["type"]; source: string; command?: string; exitCode?: number; raw?: string }): void {
    if (!this.graph) return;
    const evidence = createEvidence(input, this.now());
    const node = this.graph.nodes.get(nodeId);
    if (node) {
      node.evidence.push(evidence);
    }
  }

  /**
   * Stable identity for a node's failure pattern. Intentionally excludes the
   * per-attempt failure `reason` (rootPhrase) so the SAME node produces the SAME
   * signature across the failure path, the retry-warning query, and the
   * success-after-retry path. The varying reason is stored as rootCause data,
   * not as part of the identity.
   */
  private failurePatternKey(node: TaskNode): { command?: string; errorClass?: string; file?: string; stackMarker?: string } {
    return {
      command: node.input.prompt,
      errorClass: node.blockerClass,
      file: typeof node.metadata?.file === "string" ? node.metadata.file : undefined,
      stackMarker: node.title,
    };
  }

  /**
   * Handle a failed node (called when background task fails).
   */
  handleFailure(nodeId: string, reason: string): { action: "retry" | "blocked" | "escalate"; retryStrategy?: string } {
    if (!this.graph) throw new Error("No active graph.");
    const result = this.scheduler.onNodeFailed(this.graph, nodeId, reason);
    this.graph = result.graph;

    const node = this.graph.nodes.get(nodeId);
    const retryStrategy = node ? this.scheduler.getRetryStrategy(node) : undefined;
    if (node) {
      // Legacy flat signature keeps rootPhrase for backward-compatible knownErrors.
      const signature = buildFailureSignature({
        command: node.input.prompt,
        errorClass: node.blockerClass,
        file: typeof node.metadata?.file === "string" ? node.metadata.file : undefined,
        rootPhrase: reason,
        stackMarker: node.title,
      });
      // Structured failure pattern uses the STABLE key (no per-attempt reason) so
      // the failure record, retry-warning query, and success record all resolve
      // to the same pattern. The varying reason is stored as rootCause data.
      this.execMemory.failurePatterns = recordFailurePattern(
        this.execMemory.failurePatterns,
        { ...this.failurePatternKey(node), rootCause: reason, fixCategory: node.title, fixSucceeded: false },
        this.now(),
      );
      this.execMemory.memoryTiers = {
        ...(this.execMemory.memoryTiers ?? {
          session: { blockers: [] },
          project: { conventions: [], releaseFiles: [], standardVerification: [], dangerousAreas: [] },
          failure: { knownErrors: [], badFixes: [], successfulFixes: [] },
          operator: { preferTerseReports: false, preferAutonomousCompletion: false, preferBroadVerification: true },
        }),
        failure: {
          knownErrors: [...new Set([...(this.execMemory.memoryTiers?.failure.knownErrors ?? []), signature])],
          badFixes: this.execMemory.memoryTiers?.failure.badFixes ?? [],
          successfulFixes: this.execMemory.memoryTiers?.failure.successfulFixes ?? [],
        },
      };
    }

    return { action: result.action, retryStrategy };
  }

  // ─── Memory & Facts ───────────────────────────────────────────────────────

  /**
   * Add a fact to shared memory.
   */
  addFact(key: string, value: string, source: Fact["source"] = "agent", confidence = 0.7): void {
    this.memory = addFact(this.memory, { key, value, source, confidence }, this.now());
  }

  /**
   * Add a constraint.
   */
  addConstraint(description: string, origin: "user" | "system" | "discovered" = "user"): void {
    this.memory = addConstraint(this.memory, { description, origin }, this.now());
  }

  /**
   * Get current facts (for context injection).
   */
  getFacts(limit = 20): Fact[] {
    return getTopFacts(this.memory, limit);
  }

  // ─── Status & Persistence ─────────────────────────────────────────────────

  /**
   * Get the current orchestration status.
   */
  getStatus(): OrchestrationStatus {
    this.syncGraphRegistry();
    const assessment = this.graph ? this.planner.assess(this.graph, this.memory) : null;
    return {
      graphId: this.graph?.id ?? null,
      graphStatus: this.graph?.status ?? "no_graph",
      stats: this.graph ? getGraphStats(this.graph) : null,
      intent: this.currentIntent,
      assessment,
      events: this.events.slice(-20),
    };
  }

  setAutonomyLevel(level: AutonomyLevel): void {
    this.autonomyLevel = level;
    this.execMemory.autonomyLevel = level;
  }

  getAutonomyLevel(): AutonomyLevel {
    return this.autonomyLevel;
  }

  setOperatorPreferences(input: Partial<OperatorPreferences>): void {
    this.operatorPreferences = { ...this.operatorPreferences, ...input };
    this.execMemory.operatorPreferences = this.operatorPreferences;
  }

  getOperatorPreferences(): OperatorPreferences {
    return { ...this.operatorPreferences };
  }

  /**
   * Check if the orchestration is complete.
   */
  isComplete(): boolean {
    if (!this.graph) return true;
    return this.graph.status === "completed" || this.graph.status === "failed" || this.graph.status === "cancelled";
  }

  /**
   * Get the legacy skill route (for backward compatibility with existing hooks).
   */
  getLegacyRoute(): { intent: string; skills: string[]; reason: string; agentHint?: string } | null {
    if (!this.currentIntent) return null;
    return toLegacyRoute(this.currentIntent);
  }

  /**
   * Record strategy telemetry for terminal graphs (once per graph). Maps the
   * graph's final status to a strategy outcome so future plans can learn which
   * strategy works for which intent.
   */
  private recordStrategyTelemetryForTerminalGraphs(): void {
    for (const graph of this.graphRegistry.list()) {
      const terminal = graph.status === "completed" || graph.status === "failed" || graph.status === "cancelled";
      if (!terminal || this.strategyOutcomeRecorded.has(graph.id)) continue;
      const strategy = graph.metadata?.executionStrategy as ExecutionStrategy | undefined;
      const intent = graph.metadata?.plannedIntent as ScoredIntent["intent"] | undefined;
      if (!strategy || !intent) { this.strategyOutcomeRecorded.add(graph.id); continue; }
      const stats = getGraphStats(graph);
      const outcome = graph.status === "completed"
        ? (stats.failed > 0 ? "partial" : "success")
        : graph.status === "cancelled" ? "abandoned" : "failed";
      this.execMemory.strategyTelemetry = recordStrategyOutcome(
        this.execMemory.strategyTelemetry,
        { intent, strategy, outcome, retries: stats.failed },
        this.now(),
      );
      this.strategyOutcomeRecorded.add(graph.id);
    }
  }

  /**
   * Persist current state to disk.
   */
  persist(): void {
    // Telemetry recording must never block the core state save. On failure,
    // skip it and continue to persistence (degrade gracefully).
    withErrorBoundary(() => { this.recordStrategyTelemetryForTerminalGraphs(); return null; }, null);
    const stats = this.graph ? getGraphStats(this.graph) : null;
    this.execMemory = endSession(
      this.execMemory,
      stats?.done ?? 0,
      stats?.failed ?? 0,
      this.now(),
    );
    this.execMemory = mergeOrchestrationIntoMemory(this.execMemory, this.memory, this.graph ?? undefined, this.now());
    this.execMemory.autonomyLevel = this.autonomyLevel;
    this.execMemory.operatorPreferences = this.operatorPreferences;

    // Populate the dangerousAreas tier from the failure-pattern risk heatmap
    // (previously this tier was always empty). High-risk files surface as
    // pre-edit warnings in future sessions. Guarded so a heatmap error cannot
    // prevent state from being saved.
    withErrorBoundary(() => {
      if (this.execMemory.failurePatterns && this.execMemory.failurePatterns.length > 0 && this.execMemory.memoryTiers) {
        const heatmap = buildRiskHeatmap(this.execMemory.failurePatterns);
        this.execMemory.memoryTiers = {
          ...this.execMemory.memoryTiers,
          project: {
            ...this.execMemory.memoryTiers.project,
            dangerousAreas: heatmap.dangerousAreas,
          },
        };
      }
      return null;
    }, null);

    saveMemoryV2(this.projectRoot, this.execMemory, this.now());
  }

  /**
   * Prune memory to keep it within limits.
   */
  prune(): void {
    this.memory = pruneMemory(this.memory, {}, this.now());
  }

  /**
   * Get the raw graph (for advanced inspection).
   */
  getGraph(): TaskGraph | null {
    this.syncGraphRegistry();
    return this.graph;
  }

  getGraphRegistrySnapshot() {
    this.syncGraphRegistry();
    return this.graphRegistry.snapshot();
  }

  listGraphs(): TaskGraph[] {
    this.syncGraphRegistry();
    return this.graphRegistry.list();
  }

  switchActiveGraph(id: string): boolean {
    this.syncGraphRegistry();
    const switched = this.graphRegistry.switchActive(id);
    if (switched) this.graph = this.graphRegistry.getActive();
    return switched;
  }

  /**
   * Get the raw memory (for advanced inspection).
   */
  getMemory(): OrchestrationMemory {
    return this.memory;
  }

  // ─── Intelligence Layer ─────────────────────────────────────────────────────

  /**
   * Assess if a message is complex enough to warrant auto-activation.
   */
  assessComplexity(message: string): ComplexityAssessment {
    const intent = this.currentIntent ?? scoreIntent(message);
    return assessTaskComplexity(message, intent);
  }

  /**
   * Check if auto-activation should trigger for this message.
   */
  shouldAutoActivate(message: string): boolean {
    const intent = this.currentIntent ?? scoreIntent(message);
    return shouldAutoActivate(message, intent, this.graph !== null && !this.isComplete());
  }

  /**
   * Get enriched context for a node (cross-node discoveries).
   */
  getCrossNodeContext(nodeId: string): string {
    if (!this.graph) return "";
    const facts = buildCrossNodeContext(this.graph, nodeId, this.memory);
    return formatCrossNodeContext(facts);
  }

  /**
   * Evaluate the completion gate using the new evidence system.
   */
  evaluateCompletionGate(minConfidence = 0.7): CompletionGateResult | null {
    if (!this.graph) return null;
    return evaluateCompletionGate(this.graph, minConfidence);
  }

  /**
   * Format completion gate result for output.
   */
  formatCompletionGate(): string {
    const result = this.evaluateCompletionGate();
    if (!result) return "";
    return formatCompletionGateResult(result);
  }

  /**
   * Check if human escalation is needed.
   */
  checkEscalation(): EscalationDecision {
    if (!this.graph) return { shouldEscalate: false, reason: "none", context: "" };
    return shouldEscalateToUser(this.graph, this.memory);
  }

  /**
   * Format escalation message for output.
   */
  formatEscalation(): string {
    const decision = this.checkEscalation();
    return formatEscalation(decision);
  }

  /**
   * Record evidence from direct tool execution.
   */
  recordDirectToolEvidence(tool: string, output: string, exitCode?: number): void {
    if (!this.graph) return;
    if (!shouldRecordToolEvidence(tool, output)) return;

    const evidence = extractToolEvidence({ tool, output, exitCode });
    if (!evidence) return;

    // Attach to the currently running node (if any)
    const runningNodes = Array.from(this.graph.nodes.values()).filter((n) => n.status === "running");
    if (runningNodes.length > 0) {
      runningNodes[0].evidence.push(evidence);
    } else {
      // Attach to the last completed node
      const doneNodes = Array.from(this.graph.nodes.values()).filter((n) => n.status === "done");
      if (doneNodes.length > 0) {
        doneNodes[doneNodes.length - 1].evidence.push(evidence);
      }
    }
  }

  /**
   * Get wisdom-informed context for planning.
   */
  getWisdomContext(goal: string): string {
    const intent = this.currentIntent?.intent ?? "general";
    const wisdom = findRelevantWisdom(this.execMemory.wisdom, intent, goal);
    const learnings = findRelevantLearnings(this.execMemory.taskLearnings, intent, goal);
    return formatWisdomContext(wisdom, learnings);
  }

  applyCrossTaskLearning(): void {
    const recent = this.execMemory.sessionHistory.slice(-3);
    const repeatedFailures = recent.filter((entry) => entry.nodesFailed > 0).length;
    if (repeatedFailures >= 2) {
      this.memory = addConstraint(this.memory, { description: "Prefer safer verification-first approach based on recent failures", origin: "discovered", scope: "orchestration" }, this.now());
    }
    const repeatedSuccess = recent.filter((entry) => entry.nodesCompleted >= 2 && entry.nodesFailed === 0).length;
    if (repeatedSuccess >= 2) {
      this.memory = addConstraint(this.memory, { description: "Recent successful sessions justify broader autonomous execution", origin: "discovered", scope: "orchestration" }, this.now());
    }
  }

  /**
   * Get full orchestration status report.
   */
  getStatusReport(): OrchestrationStatusReport {
    return buildOrchestrationStatusReport(this.graph, this.memory);
  }

  /**
   * Format orchestration status for bg_status display.
   */
  formatStatusReport(): string {
    const report = this.getStatusReport();
    return formatOrchestrationStatus(report);
  }

  getNextBestAction(): string {
    return computeNextBestAction(this.graph, this.memory, {
      preferBroadVerification: this.operatorPreferences.preferBroadVerification,
      preferAutonomousCompletion: this.operatorPreferences.preferAutonomousCompletion,
    });
  }

  getReleaseCommanderSummary(): string {
    if (!this.graph || this.graph.metadata?.mode !== "release-commander") return "No release commander plan active.";
    const nodes = Array.from(this.graph.nodes.values()).map((node) => `- ${node.title}: ${node.status}`);
    return [
      `Release Commander (${this.graph.metadata?.targetVersion ?? "unknown"})`,
      `Autonomy: ${this.autonomyLevel}`,
      `Release strictness: ${this.operatorPreferences.defaultReleaseStrictness ?? "medium"}`,
      ...nodes,
      `Next action: ${this.getNextBestAction()}`,
    ].join("\n");
  }

  /**
   * Get parallel execution opportunities.
   */
  getParallelOpportunities(): string[][] {
    if (!this.graph) return [];
    return identifyParallelGroups(this.graph);
  }
}
