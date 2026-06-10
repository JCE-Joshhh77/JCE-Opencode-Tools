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
  TaskNodeOutput,
  AgentRole,
  ScoredIntent,
  Evidence,
  Fact,
  IntentType,
  PlanDelta,
} from "./types.js";
import {
  createTaskGraph,
  addNode,
  promoteReadyNodes,
  updateGraphStatus,
  snapshotGraph,
  getGraphStats,
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
  sendSignal,
  pruneMemory,
  snapshotMemory,
  getTopFacts,
  getActiveConstraints,
  type OrchestrationMemory,
} from "./shared-memory.js";
import {
  buildAgentRequest,
  formatAgentRequestAsPrompt,
  parseAgentResult,
  resultToNodeOutput,
  type AgentResult,
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

// ─── Controller ───────────────────────────────────────────────────────────────

export class OrchestrationController {
  private graph: TaskGraph | null = null;
  private memory: OrchestrationMemory;
  private execMemory: ExecutionMemoryV2;
  private scheduler: Scheduler;
  private planner: AdaptivePlanner;
  private currentIntent: ScoredIntent | null = null;
  private events: SchedulerEvent[] = [];
  private projectRoot: string;
  private now: () => string;
  private nodeToTaskMap: Map<string, string> = new Map(); // nodeId → background taskId

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

    // Restore orchestration memory and graph from persisted state.
    // Stale/terminal graphs are dropped to prevent cross-session leakage (C1).
    const restored = restoreOrchestrationFromMemory(this.execMemory, this.now());
    this.memory = restored.memory ?? createOrchestrationMemory(this.now());
    this.graph = restored.graph ?? null;
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
   * Create a new task graph from the current intent.
   */
  createPlan(goal: string, intent?: ScoredIntent): TaskGraph {
    const resolvedIntent = intent ?? this.currentIntent ?? scoreIntent(goal);
    this.currentIntent = resolvedIntent;

    // Create graph
    this.graph = createTaskGraph({
      id: `graph-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      goal,
      now: this.now(),
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

    // Record decision
    this.memory = addDecision(this.memory, {
      description: `Plan created for: ${goal}`,
      reasoning: `Intent: ${resolvedIntent.intent} (confidence: ${resolvedIntent.confidence}), ${plan.nodes.length} nodes`,
    }, this.now());

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

      return {
        nodeId: node.id,
        agent: node.agent,
        prompt: formatAgentRequestAsPrompt(request),
        skills: node.input.skills ?? [],
        modelCategory: node.type === "research" ? "exploration" : node.type === "review" ? "deep" : "default",
      };
    });
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

  // ─── Collection & Completion ──────────────────────────────────────────────

  /**
   * Process a completed sub-agent result for a node.
   */
  collectResult(nodeId: string, rawOutput: string): CollectResult {
    if (!this.graph) throw new Error("No active graph.");
    const node = this.graph.nodes.get(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);

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
   * Handle a failed node (called when background task fails).
   */
  handleFailure(nodeId: string, reason: string): { action: "retry" | "blocked" | "escalate"; retryStrategy?: string } {
    if (!this.graph) throw new Error("No active graph.");
    const result = this.scheduler.onNodeFailed(this.graph, nodeId, reason);
    this.graph = result.graph;

    const node = this.graph.nodes.get(nodeId);
    const retryStrategy = node ? this.scheduler.getRetryStrategy(node) : undefined;

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
   * Persist current state to disk.
   */
  persist(): void {
    const stats = this.graph ? getGraphStats(this.graph) : null;
    this.execMemory = endSession(
      this.execMemory,
      stats?.done ?? 0,
      stats?.failed ?? 0,
      this.now(),
    );
    this.execMemory = mergeOrchestrationIntoMemory(this.execMemory, this.memory, this.graph ?? undefined, this.now());
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
    return this.graph;
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

  /**
   * Get parallel execution opportunities.
   */
  getParallelOpportunities(): string[][] {
    if (!this.graph) return [];
    return identifyParallelGroups(this.graph);
  }
}
