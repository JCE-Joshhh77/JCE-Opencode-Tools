/**
 * Orchestration Bridge — Connects OrchestrationController to BackgroundManager
 * 
 * This bridge enables the orchestration loop:
 * Plan → Dispatch → Collect → Evaluate → Re-plan → Dispatch → ... → Complete
 * 
 * It wraps the existing BackgroundManager dispatch/collect flow with
 * TaskGraph-driven orchestration while maintaining backward compatibility.
 */

import type { BackgroundManager } from "../../background/manager.js";
import type { OpenCodeClient } from "../../background/types.js";
import { spawnBackgroundTask } from "../../background/spawner.js";
import { resolveModelForCategory } from "../../background/types.js";
import type { TaskCategory } from "../../background/types.js";
import { OrchestrationController, type DispatchResult, type CollectResult } from "./controller.js";
import { buildDelegationEnvelope, formatDelegationEnvelope } from "../delegation-envelope.js";
import { resolveSubAgentSkills } from "../skill-loader.js";
import { type ChineseTranslator } from "../chinese-output-filter.js";

// ─── Bridge Types ─────────────────────────────────────────────────────────────

export interface OrchestrationBridgeConfig {
  manager: BackgroundManager;
  client: OpenCodeClient;
  orchestrator: OrchestrationController;
  chineseTranslator?: ChineseTranslator;
  onPersist?: () => void;
}

export interface DispatchLoopResult {
  dispatched: Array<{ nodeId: string; taskId: string; agent: string }>;
  graphStatus: string;
  message: string;
}

export interface CollectLoopResult {
  nodeId: string;
  result: CollectResult;
  nextDispatched: Array<{ nodeId: string; taskId: string; agent: string }>;
  graphStatus: string;
  isComplete: boolean;
  message: string;
}

// ─── Bridge ───────────────────────────────────────────────────────────────────

export class OrchestrationBridge {
  private manager: BackgroundManager;
  private client: OpenCodeClient;
  private orchestrator: OrchestrationController;
  private chineseTranslator?: ChineseTranslator;
  private onPersist?: () => void;

  constructor(config: OrchestrationBridgeConfig) {
    this.manager = config.manager;
    this.client = config.client;
    this.orchestrator = config.orchestrator;
    this.chineseTranslator = config.chineseTranslator;
    this.onPersist = config.onPersist;
  }

  /**
   * Create a plan and dispatch the first ready nodes.
   * This is the entry point for orchestrated execution.
   */
  async planAndDispatch(goal: string, parentSessionId: string, parentMessageId: string): Promise<DispatchLoopResult> {
    // Create plan from intent
    const graph = this.orchestrator.createPlan(goal);

    // Get nodes to dispatch
    const toDispatch = this.orchestrator.getNextDispatch();
    if (toDispatch.length === 0) {
      return { dispatched: [], graphStatus: graph.status, message: "Plan created but no nodes ready for dispatch." };
    }

    // Dispatch each node via BackgroundManager
    const dispatched = await this.dispatchNodes(toDispatch, parentSessionId, parentMessageId);

    return {
      dispatched,
      graphStatus: this.orchestrator.getStatus().graphStatus,
      message: `Plan created: ${graph.nodes.size} nodes. Dispatched ${dispatched.length} task(s).`,
    };
  }

  /**
   * Collect a completed task result and feed it through the orchestration loop.
   * After collection, automatically dispatches next ready nodes.
   */
  async collectAndContinue(taskId: string, rawResult: string, parentSessionId: string, parentMessageId: string): Promise<CollectLoopResult> {
    // Find the node for this task
    const nodeId = this.orchestrator.getNodeForTask(taskId);
    if (!nodeId) {
      // Task not tracked by orchestrator — return raw result without orchestration
      return {
        nodeId: "",
        result: { nodeId: "", status: "success", summary: rawResult.slice(0, 200), confidence: 0.5, evidence: { overallConfidence: 0, totalEvidence: 0, passingEvidence: 0, failingEvidence: 0, weakEvidence: 0, strongEvidence: 0, hasTestResults: false, hasTypeCheck: false, hasBuild: false, isVerified: false, summary: "Not orchestrated" }, newFacts: [], blockers: [] },
        nextDispatched: [],
        graphStatus: this.orchestrator.getStatus().graphStatus,
        isComplete: this.orchestrator.isComplete(),
        message: rawResult,
      };
    }

    // Feed result through orchestration controller (parses, evaluates, re-plans)
    const collectResult = this.orchestrator.collectResult(nodeId, rawResult);

    // Auto-dispatch next ready nodes (the orchestration loop)
    const nextToDispatch = this.orchestrator.getNextDispatch();
    const nextDispatched = nextToDispatch.length > 0
      ? await this.dispatchNodes(nextToDispatch, parentSessionId, parentMessageId)
      : [];

    const status = this.orchestrator.getStatus();
    const isComplete = this.orchestrator.isComplete();

    // Persist state
    this.onPersist?.();

    // Build message
    const parts: string[] = [];
    parts.push(`Node ${nodeId}: ${collectResult.status} (confidence: ${collectResult.confidence})`);
    if (collectResult.newFacts.length > 0) {
      parts.push(`Discovered ${collectResult.newFacts.length} new fact(s)`);
    }
    if (collectResult.replanAction) {
      parts.push(`Re-planned: ${collectResult.replanAction.reason}`);
    }
    if (nextDispatched.length > 0) {
      parts.push(`Auto-dispatched ${nextDispatched.length} next task(s): ${nextDispatched.map((d) => `${d.agent}(${d.nodeId})`).join(", ")}`);
    }
    if (isComplete) {
      parts.push(`Graph ${status.graphStatus}`);
    }

    return {
      nodeId,
      result: collectResult,
      nextDispatched,
      graphStatus: status.graphStatus,
      isComplete,
      message: parts.join("\n"),
    };
  }

  /**
   * Handle a failed task and decide recovery action.
   */
  handleTaskFailure(taskId: string, reason: string): { action: string; retryStrategy?: string } {
    const nodeId = this.orchestrator.getNodeForTask(taskId);
    if (!nodeId) return { action: "not_orchestrated" };
    return this.orchestrator.handleFailure(nodeId, reason);
  }

  /**
   * Check if orchestration is active (has a plan).
   */
  hasActivePlan(): boolean {
    return this.orchestrator.getGraph() !== null && !this.orchestrator.isComplete();
  }

  /**
   * Get orchestration status summary for bg_status output.
   */
  getOrchestrationSummary(): string | null {
    const status = this.orchestrator.getStatus();
    if (!status.stats) return null;

    const { stats, graphStatus, assessment } = status;
    const parts: string[] = [];
    parts.push(`Orchestration: ${graphStatus} (${stats.done}/${stats.total} done, ${stats.running} running, ${stats.failed} failed)`);
    if (assessment) {
      parts.push(`Confidence: ${Math.round(assessment.confidence * 100)}%, Completion: ${Math.round(assessment.completionEstimate * 100)}%`);
      if (assessment.risks.length > 0) parts.push(`Risks: ${assessment.risks.join("; ")}`);
    }
    return parts.join("\n");
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async dispatchNodes(
    nodes: DispatchResult[],
    parentSessionId: string,
    parentMessageId: string,
  ): Promise<Array<{ nodeId: string; taskId: string; agent: string }>> {
    const dispatched: Array<{ nodeId: string; taskId: string; agent: string }> = [];

    for (const node of nodes) {
      try {
        // Enrich prompt with cross-node context (prior discoveries)
        const crossNodeContext = this.orchestrator.getCrossNodeContext(node.nodeId);

        // Enrich prompt with wisdom from past sessions
        const wisdomContext = this.orchestrator.getWisdomContext(node.prompt.slice(0, 100));

        // Enrich prompt with skills
        const skillContent = await resolveSubAgentSkills(node.agent, node.prompt);

        const enrichedPrompt = `${node.prompt}${crossNodeContext}${wisdomContext}${skillContent ? skillContent : ""}`;

        // Wrap in delegation envelope
        const envelope = formatDelegationEnvelope(buildDelegationEnvelope({
          goal: node.nodeId,
          prompt: enrichedPrompt,
          agent: node.agent,
        }));

        // Resolve model
        const category = node.modelCategory as TaskCategory;
        const modelHint = resolveModelForCategory(node.agent, category);

        // Spawn via BackgroundManager
        const taskId = await spawnBackgroundTask(this.manager, this.client, {
          description: `[orchestrated] ${node.nodeId}`,
          prompt: envelope,
          agent: node.agent,
          parentSessionId,
          parentMessageId,
          modelHint,
        });

        // Map node to task for collection
        this.orchestrator.mapNodeToTask(node.nodeId, taskId);
        dispatched.push({ nodeId: node.nodeId, taskId, agent: node.agent });
      } catch (err) {
        // If dispatch fails, mark node as failed
        this.orchestrator.handleFailure(node.nodeId, err instanceof Error ? err.message : String(err));
      }
    }

    return dispatched;
  }
}
