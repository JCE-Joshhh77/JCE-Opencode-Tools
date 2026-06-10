/**
 * Orchestration Intelligence — Makes the orchestration system "smart"
 * 
 * This module adds the intelligence layer that makes orchestration truly capable:
 * 1. Auto-activation (detect complex tasks)
 * 2. Cross-node enrichment (inject discoveries into next prompts)
 * 3. Parallel plan optimization (detect independent work)
 * 4. Human escalation (ask user when stuck)
 * 5. Wisdom-informed planning (use past learnings)
 */

import type {
  TaskGraph,
  IntentType,
  ScoredIntent,
  Fact,
  Evidence,
  WisdomEntryV2,
  TaskLearningV2,
} from "./types.js";
import { getTopFacts, type OrchestrationMemory } from "./shared-memory.js";
import { getGraphStats } from "./task-graph.js";
import { aggregateEvidence, type AggregateEvidenceScore } from "./evidence-system.js";

// ─── 1. Auto-Activation: Detect Complex Tasks ────────────────────────────────

export interface ComplexityAssessment {
  isComplex: boolean;
  score: number;
  reasons: string[];
  suggestedNodeCount: number;
}

/**
 * Assess whether a user message describes a complex task that warrants
 * automatic orchestration (plan creation + dispatch).
 * 
 * Complexity signals:
 * - Multiple action verbs (add, fix, update, create, refactor)
 * - Multiple file/component references
 * - Multi-step language ("first...then", "after that", numbered lists)
 * - Scope indicators (across, all, every, multiple)
 * - High word count with technical content
 */
export function assessTaskComplexity(message: string, intent: ScoredIntent): ComplexityAssessment {
  const lower = message.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  // Multiple action verbs
  const actionVerbs = lower.match(/\b(add|fix|update|create|refactor|implement|build|remove|delete|migrate|convert|replace|extract|move|rename|test|verify|deploy|configure|setup)\b/g) ?? [];
  const uniqueActions = new Set(actionVerbs);
  if (uniqueActions.size >= 3) { score += 3; reasons.push(`${uniqueActions.size} distinct actions`); }
  else if (uniqueActions.size >= 2) { score += 1.5; reasons.push(`${uniqueActions.size} actions`); }

  // Multi-step language
  if (/\b(first|then|after that|next|finally|step \d|1\.|2\.|3\.)\b/i.test(message)) {
    score += 2; reasons.push("multi-step language");
  }

  // Numbered/bulleted list
  const listItems = (message.match(/^[\s]*[-*•]\s|^\s*\d+[.)]\s/gm) ?? []).length;
  if (listItems >= 3) { score += 2.5; reasons.push(`${listItems} list items`); }
  else if (listItems >= 2) { score += 1.5; reasons.push(`${listItems} list items`); }

  // Scope indicators
  if (/\b(across|all files|every|multiple|each|throughout|entire|whole)\b/i.test(lower)) {
    score += 1.5; reasons.push("broad scope");
  }

  // Multiple file/component references
  const fileRefs = (message.match(/\b[\w-]+\.(ts|js|tsx|jsx|py|rs|go|java|rb|php|css|html|json|yaml|yml|toml|md)\b/g) ?? []).length;
  if (fileRefs >= 3) { score += 2; reasons.push(`${fileRefs} file references`); }
  else if (fileRefs >= 2) { score += 1; reasons.push(`${fileRefs} file references`); }

  // Word count (long messages tend to be complex)
  const wordCount = message.split(/\s+/).length;
  if (wordCount >= 80) { score += 2; reasons.push("detailed description"); }
  else if (wordCount >= 40) { score += 1; reasons.push("moderate description"); }

  // Intent-based boost
  if (intent.intent === "feature") { score += 1; reasons.push("feature intent"); }
  if (intent.intent === "refactor") { score += 0.5; reasons.push("refactor intent"); }

  // Confidence penalty (low confidence = ambiguous = might be complex)
  if (intent.confidence < 0.4) { score += 0.5; reasons.push("ambiguous intent"); }

  const isComplex = score >= 4;
  const suggestedNodeCount = Math.min(Math.max(Math.round(score), 3), 8);

  return { isComplex, score: Math.round(score * 10) / 10, reasons, suggestedNodeCount };
}

/**
 * Determine if auto-activation should trigger for this message.
 */
export function shouldAutoActivate(message: string, intent: ScoredIntent, hasActivePlan: boolean): boolean {
  if (hasActivePlan) return false; // Don't create new plan if one is active
  if (message.length < 20) return false; // Too short to be complex
  const assessment = assessTaskComplexity(message, intent);
  return assessment.isComplex;
}

// ─── 2. Cross-Node Enrichment ─────────────────────────────────────────────────

/**
 * Build enriched context for a node based on prior node discoveries.
 * Injects relevant facts discovered by completed upstream nodes.
 */
export function buildCrossNodeContext(graph: TaskGraph, nodeId: string, memory: OrchestrationMemory): Fact[] {
  const node = graph.nodes.get(nodeId);
  if (!node) return [];

  // Collect facts from all completed upstream nodes
  const upstreamFacts: Fact[] = [];
  const visited = new Set<string>();

  function collectUpstream(currentId: string): void {
    if (visited.has(currentId)) return;
    visited.add(currentId);

    const current = graph.nodes.get(currentId);
    if (!current) return;

    // Collect facts from this node's output
    if (current.status === "done" && current.output?.newFacts) {
      upstreamFacts.push(...current.output.newFacts);
    }

    // Traverse upstream dependencies
    for (const depId of current.dependencies) {
      collectUpstream(depId);
    }
  }

  // Start from the target node's dependencies
  for (const depId of node.dependencies) {
    collectUpstream(depId);
  }

  // Also include top facts from shared memory
  const sharedFacts = getTopFacts(memory, 10);

  // Merge and deduplicate by key, preferring higher confidence
  const factMap = new Map<string, Fact>();
  for (const fact of [...sharedFacts, ...upstreamFacts]) {
    const existing = factMap.get(fact.key);
    if (!existing || existing.confidence < fact.confidence) {
      factMap.set(fact.key, fact);
    }
  }

  return Array.from(factMap.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 15);
}

/**
 * Format cross-node context as a prompt section.
 */
export function formatCrossNodeContext(facts: Fact[]): string {
  if (facts.length === 0) return "";
  const lines = facts.map((f) => `- **${f.key}**: ${f.value}`);
  return `\n\n## Prior Discoveries\nThe following was discovered by earlier steps:\n${lines.join("\n")}\n`;
}

// ─── 3. Parallel Plan Optimization ───────────────────────────────────────────

/**
 * Analyze a plan and identify nodes that can run in parallel.
 * Returns groups of node IDs that are independent of each other.
 */
export function identifyParallelGroups(graph: TaskGraph): string[][] {
  const nodes = Array.from(graph.nodes.values());
  const groups: string[][] = [];
  const assigned = new Set<string>();

  // Find nodes at the same "depth" level that don't depend on each other
  const depths = computeNodeDepths(graph);
  const byDepth = new Map<number, string[]>();

  for (const [nodeId, depth] of depths.entries()) {
    const node = graph.nodes.get(nodeId);
    if (!node || node.status === "done" || node.status === "cancelled") continue;
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth)!.push(nodeId);
  }

  for (const [_depth, nodeIds] of byDepth.entries()) {
    if (nodeIds.length > 1) {
      // Check that nodes in this group don't depend on each other
      const independent = nodeIds.filter((id) => {
        const node = graph.nodes.get(id)!;
        return !node.dependencies.some((dep) => nodeIds.includes(dep));
      });
      if (independent.length > 1) {
        groups.push(independent);
        for (const id of independent) assigned.add(id);
      }
    }
  }

  return groups;
}

function computeNodeDepths(graph: TaskGraph): Map<string, number> {
  const depths = new Map<string, number>();

  function getDepth(nodeId: string): number {
    if (depths.has(nodeId)) return depths.get(nodeId)!;
    const node = graph.nodes.get(nodeId);
    if (!node || node.dependencies.length === 0) {
      depths.set(nodeId, 0);
      return 0;
    }
    const maxDepDep = Math.max(...node.dependencies.map(getDepth));
    const depth = maxDepDep + 1;
    depths.set(nodeId, depth);
    return depth;
  }

  for (const nodeId of graph.nodes.keys()) {
    getDepth(nodeId);
  }

  return depths;
}

// ─── 4. Evidence-Based Completion Gating ──────────────────────────────────────

export interface CompletionGateResult {
  canComplete: boolean;
  overallConfidence: number;
  evidence: AggregateEvidenceScore;
  blockers: string[];
  warnings: string[];
}

/**
 * Evaluate whether the orchestration graph has sufficient evidence to claim completion.
 * This replaces the old verification gate with real evidence-based scoring.
 */
export function evaluateCompletionGate(graph: TaskGraph, minConfidence = 0.7): CompletionGateResult {
  const nodes = Array.from(graph.nodes.values());
  const completedNodes = nodes.filter((n) => n.status === "done");
  const allEvidence: Evidence[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Collect all evidence from completed nodes
  for (const node of completedNodes) {
    allEvidence.push(...node.evidence);
    if (node.output?.blockers && node.output.blockers.length > 0) {
      blockers.push(...node.output.blockers);
    }
  }

  // Check for incomplete nodes
  const incomplete = nodes.filter((n) => n.status !== "done" && n.status !== "cancelled");
  if (incomplete.length > 0) {
    blockers.push(`${incomplete.length} node(s) not completed: ${incomplete.map((n) => n.title).join(", ")}`);
  }

  // Aggregate evidence
  const evidenceScore = aggregateEvidence(allEvidence);

  // Confidence gating only applies to graphs that produce verifiable artifacts
  // (code/verify nodes). Pure research/review/docs/plan graphs have no command
  // evidence by nature and must not be blocked at "0% confidence" (M1).
  const requiresEvidence = completedNodes.some((n) => n.type === "code" || n.type === "verify");

  // Check confidence threshold
  if (requiresEvidence && evidenceScore.overallConfidence < minConfidence) {
    warnings.push(`Overall confidence ${Math.round(evidenceScore.overallConfidence * 100)}% is below threshold ${Math.round(minConfidence * 100)}%`);
  }

  // Check for failing evidence
  if (evidenceScore.failingEvidence > 0) {
    blockers.push(`${evidenceScore.failingEvidence} failing evidence item(s)`);
  }

  // Check for test coverage
  if (!evidenceScore.hasTestResults && completedNodes.some((n) => n.type === "code")) {
    warnings.push("No test results found for code changes");
  }

  // Check for type safety
  if (!evidenceScore.hasTypeCheck && completedNodes.some((n) => n.type === "code")) {
    warnings.push("No type check evidence found");
  }

  const canComplete = blockers.length === 0 && (!requiresEvidence || evidenceScore.overallConfidence >= minConfidence);

  return {
    canComplete,
    overallConfidence: evidenceScore.overallConfidence,
    evidence: evidenceScore,
    blockers,
    warnings,
  };
}

/**
 * Format completion gate result for output injection.
 */
export function formatCompletionGateResult(result: CompletionGateResult): string {
  if (result.canComplete) {
    return `ORCHESTRATION GATE: ✓ Passed (confidence: ${Math.round(result.overallConfidence * 100)}%, evidence: ${result.evidence.totalEvidence} items)`;
  }

  const parts: string[] = [];
  parts.push(`ORCHESTRATION GATE: Completion blocked`);
  parts.push(`Confidence: ${Math.round(result.overallConfidence * 100)}%`);
  if (result.blockers.length > 0) {
    parts.push(`Blockers:\n${result.blockers.map((b) => `- ${b}`).join("\n")}`);
  }
  if (result.warnings.length > 0) {
    parts.push(`Warnings:\n${result.warnings.map((w) => `- ${w}`).join("\n")}`);
  }
  return parts.join("\n");
}

// ─── 5. Direct Tool Evidence Recording ────────────────────────────────────────

export interface ToolEvidenceInput {
  tool: string;
  command?: string;
  output: string;
  exitCode?: number;
}

/**
 * Determine if a tool output contains evidence worth recording.
 */
export function shouldRecordToolEvidence(tool: string, output: string): boolean {
  if (tool.toLowerCase() !== "bash") return false;
  if (output.length < 10) return false;
  // Only record verification-like commands
  return /\b(test|check|lint|build|typecheck|tsc|eslint|biome|prettier|pytest|cargo test|go test)\b/i.test(output);
}

/**
 * Extract evidence from direct tool execution (not sub-agent).
 */
export function extractToolEvidence(input: ToolEvidenceInput): Evidence | null {
  const { tool, command, output, exitCode } = input;

  // Try to detect the command from the output
  const detectedCommand = command ?? output.match(/^\s*(?:\$|>|#)\s*(.+)/m)?.[1]?.trim();
  if (!detectedCommand && exitCode === undefined) return null;

  // Determine evidence type
  const lower = (detectedCommand ?? output).toLowerCase();
  let type: Evidence["type"] = "command_output";
  if (/\b(test|spec|jest|vitest|pytest|cargo test|go test|bun test)\b/.test(lower)) type = "test_result";
  else if (/\b(tsc|typecheck|mypy|pyright)\b/.test(lower)) type = "type_check";
  else if (/\b(eslint|biome|prettier|clippy)\b/.test(lower)) type = "lint";
  else if (/\b(build|compile|make)\b/.test(lower)) type = "build";

  // Compute confidence from exit code
  let confidence = 0.5;
  if (exitCode === 0) confidence = 0.9;
  else if (exitCode !== undefined && exitCode !== 0) confidence = 0.1;

  // Parse test results for better confidence
  const testMatch = output.match(/(\d+)\s*pass(?:ed)?.*?(\d+)\s*fail/i);
  if (testMatch) {
    const passed = parseInt(testMatch[1], 10);
    const failed = parseInt(testMatch[2], 10);
    const total = passed + failed;
    if (total > 0) {
      confidence = failed === 0 ? 0.95 : passed / total;
    }
  }

  return {
    id: `ev-direct-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    source: `direct:${tool}`,
    command: detectedCommand,
    exitCode,
    assertions: exitCode !== undefined ? [{
      description: detectedCommand ? `${detectedCommand} exits cleanly` : "Command exits cleanly",
      passed: exitCode === 0,
      actual: `exit code ${exitCode}`,
      expected: "exit code 0",
    }] : [],
    confidence,
    raw: output.slice(0, 1000),
    timestamp: new Date().toISOString(),
  };
}

// ─── 6. Human Escalation ──────────────────────────────────────────────────────

export interface EscalationDecision {
  shouldEscalate: boolean;
  reason: string;
  context: string;
  suggestedQuestion?: string;
}

/**
 * Determine if the orchestration should escalate to the user.
 */
export function shouldEscalateToUser(graph: TaskGraph, memory: OrchestrationMemory): EscalationDecision {
  const stats = getGraphStats(graph);
  const nodes = Array.from(graph.nodes.values());

  // Escalate if too many failures
  if (stats.failed >= 3) {
    return {
      shouldEscalate: true,
      reason: "multiple_failures",
      context: `${stats.failed} nodes have failed. The approach may need to change.`,
      suggestedQuestion: "Multiple steps have failed. Should I try a different approach, or do you have specific guidance?",
    };
  }

  // Escalate if all nodes are blocked
  if (stats.blocked > 0 && stats.running === 0 && stats.ready === 0 && stats.pending === 0) {
    const blockedNodes = nodes.filter((n) => n.status === "blocked");
    const reasons = blockedNodes.map((n) => n.failureReason).filter(Boolean).join("; ");
    return {
      shouldEscalate: true,
      reason: "all_blocked",
      context: `All remaining work is blocked: ${reasons}`,
      suggestedQuestion: `I'm blocked on: ${reasons}. Can you help resolve this?`,
    };
  }

  // Escalate if confidence is very low after multiple completions
  if (stats.done >= 2) {
    const completedNodes = nodes.filter((n) => n.status === "done" && n.output);
    const avgConfidence = completedNodes.reduce((sum, n) => sum + (n.output?.confidence ?? 0), 0) / completedNodes.length;
    if (avgConfidence < 0.4) {
      return {
        shouldEscalate: true,
        reason: "low_confidence",
        context: `Average confidence across completed work is ${Math.round(avgConfidence * 100)}%. Results may not be reliable.`,
        suggestedQuestion: "My confidence in the results is low. Would you like me to verify specific parts, or should I take a different approach?",
      };
    }
  }

  // Escalate if a node has exhausted retries
  const exhaustedNodes = nodes.filter((n) => n.status === "blocked" && n.retryPolicy.currentRetry >= n.retryPolicy.maxRetries);
  if (exhaustedNodes.length > 0) {
    return {
      shouldEscalate: true,
      reason: "retries_exhausted",
      context: `"${exhaustedNodes[0].title}" has exhausted all retry attempts.`,
      suggestedQuestion: `I've tried "${exhaustedNodes[0].title}" ${exhaustedNodes[0].retryPolicy.maxRetries} times without success. Should I skip it or try something else?`,
    };
  }

  return { shouldEscalate: false, reason: "none", context: "" };
}

/**
 * Format escalation as an output message.
 */
export function formatEscalation(decision: EscalationDecision): string {
  if (!decision.shouldEscalate) return "";
  return `\n\n⚠️ ORCHESTRATION ESCALATION (${decision.reason})\n${decision.context}\n\n${decision.suggestedQuestion ?? "Please provide guidance on how to proceed."}`;
}

// ─── 7. Wisdom-Informed Planning ──────────────────────────────────────────────

/**
 * Find relevant wisdom entries for a given intent and goal.
 */
export function findRelevantWisdom(wisdom: WisdomEntryV2[], intent: IntentType, goal: string): WisdomEntryV2[] {
  const lower = goal.toLowerCase();
  const tokens = new Set(lower.split(/\s+/).filter((t) => t.length > 3));

  return wisdom
    .filter((w) => {
      // Match by tags
      if (w.tags.includes(intent)) return true;
      // Match by content overlap
      const wTokens = w.learning.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
      const overlap = wTokens.filter((t) => tokens.has(t)).length;
      return overlap >= 2;
    })
    .sort((a, b) => {
      const confA = a.confidence === "high" ? 3 : a.confidence === "medium" ? 2 : 1;
      const confB = b.confidence === "high" ? 3 : b.confidence === "medium" ? 2 : 1;
      return confB - confA || b.usageCount - a.usageCount;
    })
    .slice(0, 5);
}

/**
 * Find relevant task learnings for a given intent.
 */
export function findRelevantLearnings(learnings: TaskLearningV2[], intent: IntentType, goal: string): TaskLearningV2[] {
  return learnings
    .filter((l) => l.taskType === intent || l.trigger.toLowerCase().includes(goal.toLowerCase().slice(0, 30)))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);
}

/**
 * Format wisdom and learnings as planning context.
 */
export function formatWisdomContext(wisdom: WisdomEntryV2[], learnings: TaskLearningV2[]): string {
  if (wisdom.length === 0 && learnings.length === 0) return "";

  const parts: string[] = ["## Prior Learnings"];

  if (wisdom.length > 0) {
    parts.push("Wisdom from past sessions:");
    for (const w of wisdom) {
      parts.push(`- ${w.learning} (confidence: ${w.confidence})`);
    }
  }

  if (learnings.length > 0) {
    parts.push("\nSuccessful recipes from similar tasks:");
    for (const l of learnings) {
      parts.push(`- ${l.trigger}: ${l.successfulRecipe.join(" → ")}`);
      if (l.verificationCommands.length > 0) {
        parts.push(`  Verify with: ${l.verificationCommands.join(", ")}`);
      }
    }
  }

  return parts.join("\n");
}

// ─── 8. Orchestration Status for bg_status ────────────────────────────────────

export interface OrchestrationStatusReport {
  active: boolean;
  graphId: string | null;
  status: string;
  progress: string;
  nodes: string;
  confidence: string;
  parallelGroups: number;
  escalation: EscalationDecision | null;
  completionGate: CompletionGateResult | null;
}

/**
 * Build a comprehensive orchestration status report for bg_status output.
 */
export function buildOrchestrationStatusReport(graph: TaskGraph | null, memory: OrchestrationMemory): OrchestrationStatusReport {
  if (!graph) {
    return {
      active: false,
      graphId: null,
      status: "no_plan",
      progress: "No orchestration plan active",
      nodes: "",
      confidence: "",
      parallelGroups: 0,
      escalation: null,
      completionGate: null,
    };
  }

  const stats = getGraphStats(graph);
  const total = stats.total;
  const done = stats.done;
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

  const parallelGroups = identifyParallelGroups(graph);
  const escalation = shouldEscalateToUser(graph, memory);
  const completionGate = graph.status === "completed" || done === total
    ? evaluateCompletionGate(graph)
    : null;

  // Build node summary
  const nodeLines: string[] = [];
  for (const node of graph.nodes.values()) {
    const statusIcon = node.status === "done" ? "✓" : node.status === "running" ? "▶" : node.status === "failed" ? "✗" : node.status === "blocked" ? "⊘" : node.status === "ready" ? "◉" : "○";
    const conf = node.output ? ` (${Math.round(node.output.confidence * 100)}%)` : "";
    nodeLines.push(`  ${statusIcon} ${node.title} [${node.agent}]${conf}`);
  }

  // Build confidence summary
  const completedNodes = Array.from(graph.nodes.values()).filter((n) => n.status === "done" && n.output);
  const avgConfidence = completedNodes.length > 0
    ? completedNodes.reduce((sum, n) => sum + (n.output?.confidence ?? 0), 0) / completedNodes.length
    : 0;

  return {
    active: true,
    graphId: graph.id,
    status: graph.status,
    progress: `${done}/${total} nodes complete (${progressPct}%)`,
    nodes: nodeLines.join("\n"),
    confidence: avgConfidence > 0 ? `${Math.round(avgConfidence * 100)}% avg confidence` : "no evidence yet",
    parallelGroups: parallelGroups.length,
    escalation: escalation.shouldEscalate ? escalation : null,
    completionGate,
  };
}

/**
 * Format orchestration status for display in bg_status output.
 */
export function formatOrchestrationStatus(report: OrchestrationStatusReport): string {
  if (!report.active) return "";

  const parts: string[] = [];
  parts.push(`\n─── Orchestration ───`);
  parts.push(`Status: ${report.status} | ${report.progress} | ${report.confidence}`);

  if (report.parallelGroups > 0) {
    parts.push(`Parallel opportunities: ${report.parallelGroups} group(s)`);
  }

  if (report.nodes) {
    parts.push(`Nodes:\n${report.nodes}`);
  }

  if (report.escalation) {
    parts.push(`⚠️ Escalation needed: ${report.escalation.reason}`);
  }

  if (report.completionGate) {
    parts.push(report.completionGate.canComplete
      ? `✓ Completion gate: PASSED`
      : `✗ Completion gate: BLOCKED (${report.completionGate.blockers.join("; ")})`);
  }

  return parts.join("\n");
}
