import { describe, test, expect } from "bun:test";
import { AdaptivePlanner } from "../../src/plugin/lib/orchestration/planner.js";
import { createTaskGraph, addNode, transitionNode, completeNode } from "../../src/plugin/lib/orchestration/task-graph.js";
import { createOrchestrationMemory, addFact, addConstraint } from "../../src/plugin/lib/orchestration/shared-memory.js";
import type { ScoredIntent, TaskNodeOutput } from "../../src/plugin/lib/orchestration/types.js";

const NOW = "2026-01-01T00:00:00.000Z";

function makeIntent(intent: string, skills: string[] = []): ScoredIntent {
  return {
    intent: intent as ScoredIntent["intent"],
    score: 1.0,
    confidence: 0.9,
    signals: [],
    skills,
  };
}

function makeOutput(overrides: Partial<TaskNodeOutput> = {}): TaskNodeOutput {
  return {
    summary: "Done",
    artifacts: [],
    evidence: [],
    newFacts: [],
    confidence: 0.9,
    ...overrides,
  };
}

describe("Adaptive Planner", () => {
  describe("plan", () => {
    test("creates nodes for bugfix intent", () => {
      const planner = new AdaptivePlanner();
      const memory = createOrchestrationMemory(NOW);
      const intent = makeIntent("bugfix", ["software-engineering"]);

      const result = planner.plan(intent, "Fix login crash", memory);
      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.edges.length).toBeGreaterThan(0);
      // Bugfix should have: reproduce, write test, fix, verify
      expect(result.nodes.some((n) => n.title.toLowerCase().includes("reproduce"))).toBe(true);
      expect(result.nodes.some((n) => n.title.toLowerCase().includes("test"))).toBe(true);
      expect(result.nodes.some((n) => n.title.toLowerCase().includes("fix"))).toBe(true);
      expect(result.nodes.some((n) => n.title.toLowerCase().includes("verify"))).toBe(true);
    });

    test("creates nodes for feature intent", () => {
      const planner = new AdaptivePlanner();
      const memory = createOrchestrationMemory(NOW);
      const intent = makeIntent("feature", ["software-engineering"]);

      const result = planner.plan(intent, "Add pagination", memory);
      expect(result.nodes.length).toBeGreaterThanOrEqual(4);
      expect(result.nodes.some((n) => n.title.toLowerCase().includes("understand") || n.title.toLowerCase().includes("requirement"))).toBe(true);
      expect(result.nodes.some((n) => n.title.toLowerCase().includes("implement"))).toBe(true);
    });

    test("creates nodes for refactor intent", () => {
      const planner = new AdaptivePlanner();
      const memory = createOrchestrationMemory(NOW);
      const intent = makeIntent("refactor");

      const result = planner.plan(intent, "Extract auth module", memory);
      expect(result.nodes.some((n) => n.title.toLowerCase().includes("baseline") || n.title.toLowerCase().includes("map"))).toBe(true);
      expect(result.nodes.some((n) => n.title.toLowerCase().includes("refactor"))).toBe(true);
      expect(result.nodes.some((n) => n.title.toLowerCase().includes("verify") || n.title.toLowerCase().includes("regression"))).toBe(true);
    });

    test("creates nodes for research intent", () => {
      const planner = new AdaptivePlanner();
      const memory = createOrchestrationMemory(NOW);
      const intent = makeIntent("research");

      const result = planner.plan(intent, "Compare ORMs", memory);
      expect(result.nodes.some((n) => n.agent === "jce-researcher")).toBe(true);
    });

    test("injects goal into prompt templates", () => {
      const planner = new AdaptivePlanner();
      const memory = createOrchestrationMemory(NOW);
      const intent = makeIntent("bugfix");

      const result = planner.plan(intent, "Fix the memory leak", memory);
      // At least the first node should contain the goal
      expect(result.nodes[0].prompt.includes("Fix the memory leak")).toBe(true);
      // Most nodes should contain the goal (some templates may not use {goal})
      const nodesWithGoal = result.nodes.filter((n) => n.prompt.includes("Fix the memory leak"));
      expect(nodesWithGoal.length).toBeGreaterThanOrEqual(result.nodes.length - 1);
    });

    test("includes facts from memory in node context", () => {
      const planner = new AdaptivePlanner();
      let memory = createOrchestrationMemory(NOW);
      memory = addFact(memory, { key: "runtime", value: "bun", source: "tool", confidence: 0.9 }, NOW);

      const intent = makeIntent("bugfix");
      const result = planner.plan(intent, "Fix bug", memory);
      expect(result.nodes[0].context!.some((f) => f.key === "runtime")).toBe(true);
    });

    test("includes constraints from memory", () => {
      const planner = new AdaptivePlanner();
      let memory = createOrchestrationMemory(NOW);
      memory = addConstraint(memory, { description: "No breaking changes", origin: "user" }, NOW);

      const intent = makeIntent("feature");
      const result = planner.plan(intent, "Add feature", memory);
      expect(result.nodes[0].constraints!.some((c) => c.description.includes("breaking"))).toBe(true);
    });

    test("falls back to general template for unknown intent", () => {
      const planner = new AdaptivePlanner();
      const memory = createOrchestrationMemory(NOW);
      const intent = makeIntent("general");

      const result = planner.plan(intent, "Do something", memory);
      expect(result.nodes.length).toBeGreaterThan(0);
    });

    test("edges create valid dependency chain", () => {
      const planner = new AdaptivePlanner();
      const memory = createOrchestrationMemory(NOW);
      const intent = makeIntent("bugfix");

      const result = planner.plan(intent, "Fix bug", memory);
      // All edge targets should reference valid node ids
      const nodeIds = new Set(result.nodes.map((n) => n.id));
      for (const edge of result.edges) {
        expect(nodeIds.has(edge.from)).toBe(true);
        expect(nodeIds.has(edge.to)).toBe(true);
      }
    });
  });

  describe("replan", () => {
    test("adds blocker resolution node when blockers discovered", () => {
      const planner = new AdaptivePlanner();
      let memory = createOrchestrationMemory(NOW);
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });

      const node = {
        id: "n1",
        type: "research" as const,
        title: "Investigate",
        description: "Investigate the issue",
        agent: "self" as const,
        status: "done" as const,
        dependencies: [],
        input: { prompt: "Investigate", context: [], constraints: [] },
        output: makeOutput({ blockers: ["Need database access", "Missing API key"] }),
        evidence: [],
        retryPolicy: { maxRetries: 2, strategy: ["same" as const, "different_approach" as const, "escalate_user" as const], currentRetry: 0 },
        priority: 5,
        createdAt: NOW,
        completedAt: NOW,
      };

      const delta = planner.replan(graph, node, memory);
      expect(delta).not.toBeNull();
      expect(delta!.addNodes).toHaveLength(1);
      expect(delta!.addNodes[0].title).toContain("blocker");
      expect(delta!.addNodes[0].agent).toBe("oracle");
    });

    test("adds verification node when confidence is low", () => {
      const planner = new AdaptivePlanner();
      const memory = createOrchestrationMemory(NOW);
      const graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });

      const node = {
        id: "n1",
        type: "code" as const,
        title: "Implement feature",
        description: "Implement it",
        agent: "self" as const,
        status: "done" as const,
        dependencies: [],
        input: { prompt: "Implement", context: [], constraints: [] },
        output: makeOutput({ confidence: 0.3 }), // Low confidence
        evidence: [],
        retryPolicy: { maxRetries: 2, strategy: ["same" as const, "different_approach" as const, "escalate_user" as const], currentRetry: 0 },
        priority: 5,
        createdAt: NOW,
        completedAt: NOW,
      };

      const delta = planner.replan(graph, node, memory);
      expect(delta).not.toBeNull();
      expect(delta!.addNodes[0].type).toBe("verify");
      expect(delta!.reason).toContain("confidence");
    });

    test("returns null when no replanning needed", () => {
      const planner = new AdaptivePlanner();
      const memory = createOrchestrationMemory(NOW);
      const graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });

      const node = {
        id: "n1",
        type: "code" as const,
        title: "Implement",
        description: "Implement it",
        agent: "self" as const,
        status: "done" as const,
        dependencies: [],
        input: { prompt: "Implement", context: [], constraints: [] },
        output: makeOutput({ confidence: 0.9, newFacts: [] }),
        evidence: [],
        retryPolicy: { maxRetries: 2, strategy: ["same" as const, "different_approach" as const, "escalate_user" as const], currentRetry: 0 },
        priority: 5,
        createdAt: NOW,
        completedAt: NOW,
      };

      const delta = planner.replan(graph, node, memory);
      expect(delta).toBeNull();
    });
  });

  describe("assess", () => {
    test("empty graph has zero confidence", () => {
      const planner = new AdaptivePlanner();
      const memory = createOrchestrationMemory(NOW);
      const graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });

      const assessment = planner.assess(graph, memory);
      expect(assessment.confidence).toBe(0);
      expect(assessment.risks).toContain("No nodes in graph");
    });

    test("completed graph has high confidence", () => {
      const planner = new AdaptivePlanner();
      const memory = createOrchestrationMemory(NOW);
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, { id: "n1", type: "code", title: "Do", description: "Do it", agent: "self", prompt: "Do", priority: 0 }, NOW);
      graph = transitionNode(graph, "n1", "ready", NOW);
      graph = transitionNode(graph, "n1", "running", NOW);
      graph = completeNode(graph, "n1", makeOutput({ confidence: 0.95 }), NOW);

      const assessment = planner.assess(graph, memory);
      expect(assessment.completionEstimate).toBe(1.0);
      expect(assessment.confidence).toBeGreaterThan(0.5);
    });

    test("failed nodes reduce confidence and add risks", () => {
      const planner = new AdaptivePlanner();
      const memory = createOrchestrationMemory(NOW);
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, { id: "n1", type: "code", title: "Do", description: "Do it", agent: "self", prompt: "Do", priority: 0 }, NOW);
      graph = addNode(graph, { id: "n2", type: "code", title: "Do2", description: "Do it 2", agent: "self", prompt: "Do", priority: 0 }, NOW);
      graph = transitionNode(graph, "n1", "ready", NOW);
      graph = transitionNode(graph, "n1", "running", NOW);
      // Fail n1
      const n1 = graph.nodes.get("n1")!;
      n1.status = "failed";
      n1.failureReason = "error";
      n1.completedAt = NOW;

      const assessment = planner.assess(graph, memory);
      expect(assessment.confidence).toBeLessThan(0.8);
      expect(assessment.risks.some((r) => r.includes("failure rate"))).toBe(true);
    });

    test("blocked nodes add risk warning", () => {
      const planner = new AdaptivePlanner();
      const memory = createOrchestrationMemory(NOW);
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, { id: "n1", type: "code", title: "Do", description: "Do it", agent: "self", prompt: "Do", priority: 0 }, NOW);
      graph = transitionNode(graph, "n1", "blocked", NOW);

      const assessment = planner.assess(graph, memory);
      expect(assessment.risks.some((r) => r.includes("blocked"))).toBe(true);
      expect(assessment.suggestions.some((s) => s.includes("blocked"))).toBe(true);
    });
  });
});
