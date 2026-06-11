/**
 * Adaptive Planner — Decomposes intent into TaskNodes, re-plans after each step
 * 
 * The planner is the "brain" that decides what work needs to be done.
 * Unlike a static workflow, it can adapt the plan based on intermediate results.
 */

import type {
  TaskGraph,
  TaskNode,
  TaskNodeType,
  AgentRole,
  PlanDelta,
  PlanAssessment,
  IntentType,
  ScoredIntent,
} from "./types.js";
import { addNode, removeNode, addEdge, type CreateNodeInput } from "./task-graph.js";
import type { OrchestrationMemory } from "./shared-memory.js";
import { getTopFacts, getActiveConstraints } from "./shared-memory.js";

const IMPLEMENTATION_SPLIT_VERBS = /\b(?:add|implement|create|build|update|refactor|extract|wire|support|improve)\b/i;
const SEQUENCE_SIGNALS = /\b(?:first|then|after|before|finally|depends on|dependency|wire into|followed by)\b/i;

function normalizeUnitLabel(text: string): string {
  return text.replace(/^[-*•\d.)\s]+/, "").replace(/\s+/g, " ").trim().replace(/[.;:,]+$/, "");
}

function detectIndependentUnits(goal: string): { units: string[]; reason: string } {
  if (SEQUENCE_SIGNALS.test(goal)) return { units: [], reason: "Sequential dependency signals detected; keep linear plan." };

  const bulletLines = goal
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*•]\s+|^\d+[.)]\s+/.test(line))
    .map(normalizeUnitLabel)
    .filter((line) => line.length > 3);
  if (bulletLines.length >= 2) return { units: Array.from(new Set(bulletLines)), reason: "Explicit list-like units detected." };

  if (!IMPLEMENTATION_SPLIT_VERBS.test(goal)) return { units: [], reason: "No strong implementation split verb detected." };
  const match = goal.match(/\b(?:add|implement|create|build|update|refactor|extract|wire|support|improve)\b\s+(.+)/i);
  const tail = match?.[1]?.trim() ?? "";
  if (!tail) return { units: [], reason: "No tail segment found after implementation verb." };
  if (SEQUENCE_SIGNALS.test(tail)) return { units: [], reason: "Tail contains sequential dependency signals; keep linear plan." };
  const parts = tail
    .split(/,|\band\b|\&/i)
    .map(normalizeUnitLabel)
    .filter((part) => part.length >= 4)
    .filter((part) => !/^(?:tests?|verification|docs?|documentation|review|cleanup)$/i.test(part));
  return parts.length >= 2
    ? { units: Array.from(new Set(parts)), reason: "Multiple explicit implementation units detected in prose." }
    : { units: [], reason: "Not enough clearly independent implementation units detected." };
}

function buildParallelImplementationPlan(args: {
  intent: ScoredIntent;
  goal: string;
  facts: ReturnType<typeof getTopFacts>;
  constraints: ReturnType<typeof getActiveConstraints>;
  objective: { mode: "fast" | "balanced" | "careful"; reason: string };
  units: string[];
}): { nodes: CreateNodeInput[]; edges: Array<{ from: string; to: string }> } {
  const { intent, goal, facts, constraints, objective, units } = args;
  const ids = {
    research: `node-${intent.intent}-research-${Math.random().toString(36).slice(2, 6)}`,
    plan: `node-${intent.intent}-plan-${Math.random().toString(36).slice(2, 6)}`,
    integration: `node-${intent.intent}-integrate-${Math.random().toString(36).slice(2, 6)}`,
    tests: `node-${intent.intent}-tests-${Math.random().toString(36).slice(2, 6)}`,
    verify: `node-${intent.intent}-verify-${Math.random().toString(36).slice(2, 6)}`,
  };
  const sharedMeta = { plannerMode: objective.mode, plannerReason: objective.reason, parallelization: "explicit-independent-units", parallelUnits: units };
  const nodes: CreateNodeInput[] = [
    {
      id: ids.research,
      type: "research",
      title: "Understand requirements and codebase",
      description: `Understand implementation surface for: ${goal}`,
      agent: "explorer",
      dependencies: [],
      prompt: `Explore the codebase to understand where ${goal} should be implemented. Identify relevant files, patterns, and integration points. Also identify whether these explicit units look independent: ${units.join("; ")}.`,
      context: facts,
      constraints,
      skills: ["codebase-intelligence"],
      priority: 10,
      metadata: sharedMeta,
    },
    {
      id: ids.plan,
      type: "plan",
      title: "Design implementation approach",
      description: `Design implementation plan for: ${goal}`,
      agent: "self",
      dependencies: [ids.research],
      prompt: `Design the implementation for: ${goal}. Confirm these units are independent enough for parallel execution: ${units.join("; ")}. Note shared files, contracts, and integration risks.`,
      context: facts,
      constraints,
      skills: intent.skills,
      priority: 9,
      metadata: sharedMeta,
    },
  ];

  const unitIds = units.map((unit, index) => {
    const id = `node-${intent.intent}-unit-${index + 1}-${Math.random().toString(36).slice(2, 6)}`;
    nodes.push({
      id,
      type: "code",
      title: `Implement unit: ${unit}`,
      description: `Implement explicit independent unit: ${unit}`,
      agent: "self",
      dependencies: [ids.plan],
      prompt: `Implement this independent unit for the broader goal "${goal}": ${unit}. Stay scoped to this unit, avoid touching unrelated units except for necessary shared contracts, and note any overlap risks.`,
      context: facts,
      constraints,
      skills: ["software-engineering", ...intent.skills.filter((skill) => skill !== "software-engineering")],
      priority: 8,
      metadata: { ...sharedMeta, parallelUnit: unit, parallelUnitIndex: index + 1 },
    });
    return id;
  });

  nodes.push(
    {
      id: ids.integration,
      type: "review",
      title: "Integrate parallel implementation units",
      description: `Review and integrate parallel units for: ${goal}`,
      agent: "self",
      dependencies: unitIds,
      prompt: `Review outputs from these parallel units for ${goal}: ${units.join("; ")}. Confirm they integrate cleanly, identify conflicts, and ensure no unit was skipped.`,
      context: facts,
      constraints,
      skills: ["software-engineering"],
      priority: 7,
      metadata: sharedMeta,
    },
    {
      id: ids.tests,
      type: "code",
      title: "Write tests",
      description: `Write or update tests for: ${goal}`,
      agent: "self",
      dependencies: [ids.integration],
      prompt: `Write comprehensive tests for: ${goal}. Cover all implemented units (${units.join("; ")}), integration edges, and error scenarios.`,
      context: facts,
      constraints,
      skills: ["software-engineering"],
      priority: 6,
      metadata: sharedMeta,
    },
    {
      id: ids.verify,
      type: "verify",
      title: "Verify implementation",
      description: `Verify final implementation for: ${goal}`,
      agent: "self",
      dependencies: [ids.tests],
      prompt: `Run tests, type checker, and relevant verification for: ${goal}. Confirm all explicit units (${units.join("; ")}) are complete and integrated.`,
      context: facts,
      constraints,
      skills: intent.skills,
      priority: 5,
      metadata: sharedMeta,
    },
  );

  const edges = [
    { from: ids.research, to: ids.plan },
    ...unitIds.map((unitId) => ({ from: ids.plan, to: unitId })),
    ...unitIds.map((unitId) => ({ from: unitId, to: ids.integration })),
    { from: ids.integration, to: ids.tests },
    { from: ids.tests, to: ids.verify },
  ];

  return { nodes, edges };
}

// ─── Plan Templates ───────────────────────────────────────────────────────────

export interface PlanTemplate {
  intent: IntentType;
  nodes: PlanTemplateNode[];
  edges: Array<{ from: number; to: number }>;
}

interface PlanTemplateNode {
  type: TaskNodeType;
  title: string;
  agent: AgentRole;
  promptTemplate: string;
  priority: number;
  optional?: boolean;
  skills?: string[];
}

/**
 * Built-in plan templates for common intents.
 * These provide a starting structure that the planner can adapt.
 */
const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    intent: "bugfix",
    nodes: [
      { type: "research", title: "Reproduce and isolate bug", agent: "self", promptTemplate: "Reproduce the bug: {goal}. Identify the root cause by reading error messages, tracing data flow, and isolating the minimal reproduction.", priority: 10, skills: ["software-engineering"] },
      { type: "code", title: "Write failing test", agent: "self", promptTemplate: "Write a test that reproduces the bug: {goal}. The test should fail with the current code and pass after the fix.", priority: 9, skills: ["software-engineering"] },
      { type: "code", title: "Implement fix", agent: "self", promptTemplate: "Fix the bug: {goal}. Address the root cause, not symptoms. Ensure the failing test now passes.", priority: 8, skills: ["software-engineering"] },
      { type: "verify", title: "Verify fix", agent: "self", promptTemplate: "Run the full test suite and type checker. Verify the fix doesn't break anything else.", priority: 7 },
    ],
    edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }],
  },
  {
    intent: "feature",
    nodes: [
      { type: "research", title: "Understand requirements and codebase", agent: "explorer", promptTemplate: "Explore the codebase to understand where {goal} should be implemented. Identify relevant files, patterns, and integration points.", priority: 10, skills: ["codebase-intelligence"] },
      { type: "plan", title: "Design implementation approach", agent: "self", promptTemplate: "Design the implementation for: {goal}. Consider the codebase patterns discovered, define the API surface, and identify edge cases.", priority: 9 },
      { type: "code", title: "Implement feature", agent: "self", promptTemplate: "Implement: {goal}. Follow the design from the planning step. Write clean, tested code.", priority: 8, skills: ["software-engineering"] },
      { type: "code", title: "Write tests", agent: "self", promptTemplate: "Write comprehensive tests for: {goal}. Cover happy path, edge cases, and error scenarios.", priority: 7, skills: ["software-engineering"] },
      { type: "verify", title: "Verify implementation", agent: "self", promptTemplate: "Run tests, type checker, and linter. Verify the feature works end-to-end.", priority: 6 },
    ],
    edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 }],
  },
  {
    intent: "refactor",
    nodes: [
      { type: "research", title: "Map current structure", agent: "explorer", promptTemplate: "Map the current code structure for: {goal}. Identify dependencies, call sites, and test coverage.", priority: 10, skills: ["codebase-intelligence"] },
      { type: "verify", title: "Baseline tests", agent: "self", promptTemplate: "Run existing tests to establish a passing baseline before refactoring.", priority: 9 },
      { type: "code", title: "Refactor", agent: "self", promptTemplate: "Refactor: {goal}. Preserve behavior while improving structure. Make small, incremental changes.", priority: 8, skills: ["software-engineering"] },
      { type: "verify", title: "Verify no regression", agent: "self", promptTemplate: "Run the full test suite. Verify all tests still pass after refactoring.", priority: 7 },
    ],
    edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }],
  },
  {
    intent: "review",
    nodes: [
      { type: "research", title: "Read and understand changes", agent: "explorer", promptTemplate: "Read all changed files for: {goal}. Understand the intent and scope of changes.", priority: 10, skills: ["codebase-intelligence"] },
      { type: "review", title: "Review for correctness", agent: "self", promptTemplate: "Review the code changes for: {goal}. Check for bugs, edge cases, security issues, and adherence to project conventions.", priority: 9, skills: ["software-engineering"] },
      { type: "verify", title: "Run verification", agent: "self", promptTemplate: "Run tests and type checker to verify the changes don't break anything.", priority: 8 },
    ],
    edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }],
  },
  {
    intent: "research",
    nodes: [
      { type: "research", title: "Gather information", agent: "jce-researcher", promptTemplate: "Research: {goal}. Find documentation, examples, and best practices. Cite sources.", priority: 10 },
      { type: "plan", title: "Synthesize findings", agent: "self", promptTemplate: "Synthesize the research findings for: {goal}. Identify key takeaways, trade-offs, and recommendations.", priority: 9 },
    ],
    edges: [{ from: 0, to: 1 }],
  },
  {
    intent: "release",
    nodes: [
      { type: "verify", title: "Pre-release checks", agent: "self", promptTemplate: "Run all pre-release checks: tests, type checker, linter, version sync.", priority: 10 },
      { type: "config", title: "Update version", agent: "self", promptTemplate: "Update version for release: {goal}. Sync across all version files.", priority: 9 },
      { type: "verify", title: "Post-version verification", agent: "self", promptTemplate: "Verify version sync and run tests again after version bump.", priority: 8 },
    ],
    edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }],
  },
  {
    intent: "config",
    nodes: [
      { type: "research", title: "Understand current config", agent: "self", promptTemplate: "Read and understand the current configuration for: {goal}.", priority: 10 },
      { type: "config", title: "Apply changes", agent: "self", promptTemplate: "Apply configuration changes: {goal}.", priority: 9 },
      { type: "verify", title: "Validate config", agent: "self", promptTemplate: "Validate the configuration changes. Run any config validation tools.", priority: 8 },
    ],
    edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }],
  },
  {
    intent: "docs",
    nodes: [
      { type: "research", title: "Understand what to document", agent: "explorer", promptTemplate: "Explore the codebase to understand what needs documentation: {goal}.", priority: 10 },
      { type: "code", title: "Write documentation", agent: "self", promptTemplate: "Write documentation for: {goal}. Be clear, concise, and include examples.", priority: 9 },
      { type: "review", title: "Review documentation", agent: "self", promptTemplate: "Review the documentation for accuracy, completeness, and clarity.", priority: 8 },
    ],
    edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }],
  },
  {
    intent: "general",
    nodes: [
      { type: "plan", title: "Understand and plan", agent: "self", promptTemplate: "Understand the request: {goal}. Plan the approach.", priority: 10 },
      { type: "code", title: "Execute", agent: "self", promptTemplate: "Execute: {goal}.", priority: 9 },
      { type: "verify", title: "Verify", agent: "self", promptTemplate: "Verify the work is complete and correct.", priority: 8 },
    ],
    edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }],
  },
];

// ─── Planner ──────────────────────────────────────────────────────────────────

export class AdaptivePlanner {
  private templates: PlanTemplate[];

  constructor(templates?: PlanTemplate[], _now?: () => string) {
    this.templates = templates ?? PLAN_TEMPLATES;
  }

  scoreTradeoffs(input: { speedWeight?: number; certaintyWeight?: number; tokenCostWeight?: number; interruptionWeight?: number; blastRadiusWeight?: number; reversibilityWeight?: number }, intent: IntentType): { mode: "fast" | "balanced" | "careful"; reason: string } {
    const weights = {
      speed: input.speedWeight ?? 0.5,
      certainty: input.certaintyWeight ?? 0.5,
      tokenCost: input.tokenCostWeight ?? 0.3,
      interruption: input.interruptionWeight ?? 0.3,
      blastRadius: input.blastRadiusWeight ?? 0.5,
      reversibility: input.reversibilityWeight ?? 0.5,
    };
    const carefulScore = weights.certainty + weights.blastRadius + weights.reversibility;
    const fastScore = weights.speed + (1 - weights.interruption);
    if (intent === "release" || carefulScore >= 1.8) return { mode: "careful", reason: "High certainty/blast-radius/reversibility weighting" };
    if (fastScore >= 1.2) return { mode: "fast", reason: "Speed-weighted objective dominates" };
    return { mode: "balanced", reason: "Mixed trade-off profile" };
  }

  /**
   * Create an initial plan from a scored intent.
   * Returns a set of CreateNodeInput that can be added to a TaskGraph.
   */
  plan(intent: ScoredIntent, goal: string, memory: OrchestrationMemory): { nodes: CreateNodeInput[]; edges: Array<{ from: string; to: string }> } {
    const template = this.templates.find((t) => t.intent === intent.intent) ?? this.templates.find((t) => t.intent === "general")!;
    const facts = getTopFacts(memory, 10);
    const constraints = getActiveConstraints(memory);
    const objective = this.scoreTradeoffs({}, intent.intent);

    if (intent.intent === "feature" || intent.intent === "general" || intent.intent === "refactor") {
      const detection = detectIndependentUnits(goal);
      if (detection.units.length >= 2) {
        return buildParallelImplementationPlan({ intent, goal, facts, constraints, objective, units: detection.units });
      }
    }

    const nodeIds: string[] = [];
    const nodes: CreateNodeInput[] = [];

    for (let i = 0; i < template.nodes.length; i++) {
      const tNode = template.nodes[i];
      const id = `node-${intent.intent}-${i}-${Math.random().toString(36).slice(2, 6)}`;
      nodeIds.push(id);

      const prompt = tNode.promptTemplate.replace(/\{goal\}/g, goal);
      const deps = template.edges.filter((e) => e.to === i).map((e) => nodeIds[e.from]);

      nodes.push({
        id,
        type: tNode.type,
        title: tNode.title,
        description: `${tNode.title} for: ${goal}`,
        agent: tNode.agent,
        dependencies: deps,
        prompt,
        context: facts,
        constraints,
        skills: tNode.skills ?? intent.skills,
        priority: tNode.priority,
        metadata: {
          plannerMode: objective.mode,
          plannerReason: objective.reason,
          parallelization: "linear-fallback",
          parallelFallbackReason: (intent.intent === "feature" || intent.intent === "general" || intent.intent === "refactor") ? detectIndependentUnits(goal).reason : "Intent not eligible for parallel fan-out.",
        },
      });
    }

    const edges = template.edges.map((e) => ({ from: nodeIds[e.from], to: nodeIds[e.to] }));
    return { nodes, edges };
  }

  /**
   * Re-evaluate the plan after a node completes.
   * Returns a PlanDelta describing changes to make.
   */
  replan(graph: TaskGraph, completedNode: TaskNode, _memory: OrchestrationMemory): PlanDelta | null {
    const output = completedNode.output;
    if (!output) return null;

    const changes: PlanDelta = {
      addNodes: [],
      removeNodeIds: [],
      addEdges: [],
      removeEdges: [],
      reason: "",
    };

    // Rule 1: If completed node discovered blockers, add a resolution node
    if (output.blockers && output.blockers.length > 0) {
      const blockerId = `node-resolve-blocker-${Math.random().toString(36).slice(2, 6)}`;
      changes.addNodes.push({
        id: blockerId,
        type: "research",
        title: `Resolve blocker: ${output.blockers[0]}`,
        description: `Investigate and resolve: ${output.blockers.join(", ")}`,
        agent: "oracle",
        dependencies: [completedNode.id],
        input: {
          prompt: `Resolve these blockers discovered during "${completedNode.title}":\n${output.blockers.map((b) => `- ${b}`).join("\n")}\n\nProvide a concrete resolution path.`,
          context: output.newFacts,
          constraints: [],
        },
        retryPolicy: { maxRetries: 1, strategy: ["same", "escalate_user"], currentRetry: 0 },
        priority: completedNode.priority + 1,
      });
      changes.reason = `Blockers discovered: ${output.blockers[0]}`;
      return changes;
    }

    // Rule 2: If confidence is low, add a verification node
    if (output.confidence < 0.5 && completedNode.type !== "verify") {
      const verifyId = `node-extra-verify-${Math.random().toString(36).slice(2, 6)}`;
      changes.addNodes.push({
        id: verifyId,
        type: "verify",
        title: `Extra verification for: ${completedNode.title}`,
        description: `Low confidence (${output.confidence}) on "${completedNode.title}". Run additional verification.`,
        agent: "self",
        dependencies: [completedNode.id],
        input: {
          prompt: `The previous step "${completedNode.title}" completed with low confidence (${output.confidence}). Run additional verification to confirm correctness. Check: tests, type safety, and behavior.`,
          context: output.newFacts,
          constraints: [],
        },
        retryPolicy: { maxRetries: 1, strategy: ["same", "escalate_user"], currentRetry: 0 },
        priority: completedNode.priority - 1,
      });
      changes.reason = `Low confidence (${output.confidence}) requires extra verification`;
      return changes;
    }

    // Rule 3: If new facts suggest scope expansion, consider adding nodes
    if (output.newFacts.length > 3) {
      // Many new facts suggest the problem is more complex than initially thought
      // For now, just note it — future versions could add nodes dynamically
      changes.reason = `${output.newFacts.length} new facts discovered — plan may need expansion`;
      // Don't actually change anything unless facts indicate a clear need
    }

    // Rule 4: Remove optional downstream nodes if the work is already done
    const pendingNodes = Array.from(graph.nodes.values()).filter((n) => n.status === "pending");
    for (const pending of pendingNodes) {
      if (pending.metadata?.optional && output.summary.toLowerCase().includes(pending.title.toLowerCase())) {
        changes.removeNodeIds.push(pending.id);
        changes.reason = `Node "${pending.title}" already addressed in "${completedNode.title}"`;
      }
    }

    return changes.addNodes.length > 0 || changes.removeNodeIds.length > 0 ? changes : null;
  }

  /**
   * Apply a PlanDelta to a TaskGraph.
   */
  applyDelta(graph: TaskGraph, delta: PlanDelta, now?: string): TaskGraph {
    let next = graph;

    // Remove nodes first (to avoid dependency conflicts)
    for (const nodeId of delta.removeNodeIds) {
      try {
        next = removeNode(next, nodeId, now);
      } catch {
        // Node might have dependents — skip removal
      }
    }

    // Add new nodes
    for (const nodeInput of delta.addNodes) {
      const createInput: CreateNodeInput = {
        id: nodeInput.id,
        type: nodeInput.type,
        title: nodeInput.title,
        description: nodeInput.description,
        agent: nodeInput.agent,
        dependencies: nodeInput.dependencies,
        prompt: nodeInput.input.prompt,
        context: nodeInput.input.context,
        constraints: nodeInput.input.constraints,
        skills: nodeInput.input.skills,
        priority: nodeInput.priority,
        retryPolicy: nodeInput.retryPolicy,
        compensation: nodeInput.compensation,
        metadata: nodeInput.metadata,
      };
      next = addNode(next, createInput, now);
    }

    // Add new edges
    for (const edge of delta.addEdges) {
      try {
        next = addEdge(next, { ...edge, type: "blocks" }, now);
      } catch {
        // Edge might create cycle — skip
      }
    }

    return next;
  }

  /**
   * Assess the current plan's health and progress.
   */
  assess(graph: TaskGraph, _memory: OrchestrationMemory): PlanAssessment {
    const nodes = Array.from(graph.nodes.values());
    const total = nodes.length;
    if (total === 0) return { confidence: 0, completionEstimate: 0, risks: ["No nodes in graph"], suggestions: ["Create a plan first"] };

    const done = nodes.filter((n) => n.status === "done" || n.status === "cancelled").length;
    const failed = nodes.filter((n) => n.status === "failed").length;
    const blocked = nodes.filter((n) => n.status === "blocked").length;

    const completionEstimate = done / total;
    const failureRate = total > 0 ? failed / total : 0;

    // Confidence based on progress and failure rate
    let confidence = completionEstimate * 0.6 + (1 - failureRate) * 0.4;
    if (blocked > 0) confidence *= 0.8;

    // Collect evidence confidence from completed nodes
    const evidenceConfidences = nodes
      .filter((n) => n.status === "done" && n.output)
      .map((n) => n.output!.confidence);
    if (evidenceConfidences.length > 0) {
      const avgEvidence = evidenceConfidences.reduce((a, b) => a + b, 0) / evidenceConfidences.length;
      confidence = confidence * 0.5 + avgEvidence * 0.5;
    }

    const risks: string[] = [];
    if (failureRate > 0.3) risks.push(`High failure rate: ${Math.round(failureRate * 100)}%`);
    if (blocked > 0) risks.push(`${blocked} node(s) blocked`);
    if (confidence < 0.5) risks.push("Low overall confidence");

    const suggestions: string[] = [];
    if (blocked > 0) suggestions.push("Resolve blocked nodes before continuing");
    if (failureRate > 0.3) suggestions.push("Consider re-planning with a different approach");
    if (completionEstimate > 0.8 && confidence > 0.7) suggestions.push("Plan is nearly complete — run final verification");

    return {
      confidence: Math.round(confidence * 100) / 100,
      completionEstimate: Math.round(completionEstimate * 100) / 100,
      risks,
      suggestions,
    };
  }
}
