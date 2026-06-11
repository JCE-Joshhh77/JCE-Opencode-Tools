import { describe, test, expect } from "bun:test";
import { Scheduler, DEFAULT_SCHEDULER_CONFIG } from "../../src/plugin/lib/orchestration/scheduler.js";
import { createTaskGraph, addNode, transitionNode, promoteReadyNodes } from "../../src/plugin/lib/orchestration/task-graph.js";
import type { CreateNodeInput, TaskNodeOutput, SchedulerEvent } from "../../src/plugin/lib/orchestration/index.js";

const NOW = "2026-01-01T00:00:00.000Z";
let timeCounter = 0;
const mockNow = () => { timeCounter++; return `2026-01-01T00:00:${String(timeCounter).padStart(2, "0")}.000Z`; };

function makeNode(overrides: Partial<CreateNodeInput> = {}): CreateNodeInput {
  return {
    id: overrides.id ?? `node-${Math.random().toString(36).slice(2, 6)}`,
    type: overrides.type ?? "code",
    title: overrides.title ?? "Test node",
    description: overrides.description ?? "A test node",
    agent: overrides.agent ?? "self",
    dependencies: overrides.dependencies ?? [],
    prompt: overrides.prompt ?? "Do something",
    priority: overrides.priority ?? 0,
    ...overrides,
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

describe("Scheduler", () => {
  describe("tick", () => {
    test("promotes pending nodes to ready and dispatches them", () => {
      timeCounter = 0;
      // Use explorer agent (concurrency limit 3) so both can dispatch
      const scheduler = new Scheduler({}, mockNow);
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1", agent: "explorer" }), NOW);
      graph = addNode(graph, makeNode({ id: "n2", agent: "explorer" }), NOW);
      graph = promoteReadyNodes(graph, NOW);

      const result = scheduler.tick(graph);
      expect(result.toDispatch).toHaveLength(2);
      expect(result.graph.nodes.get("n1")?.status).toBe("running");
      expect(result.graph.nodes.get("n2")?.status).toBe("running");
    });

    test("respects dependency ordering", () => {
      timeCounter = 0;
      const scheduler = new Scheduler({}, mockNow);
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = addNode(graph, makeNode({ id: "n2", dependencies: ["n1"] }), NOW);
      graph = promoteReadyNodes(graph, NOW);

      const result = scheduler.tick(graph);
      // Only n1 should be dispatched (n2 depends on n1)
      expect(result.toDispatch).toHaveLength(1);
      expect(result.toDispatch[0].id).toBe("n1");
      expect(result.graph.nodes.get("n2")?.status).toBe("pending");
    });

    test("respects global concurrency limit", () => {
      timeCounter = 0;
      const scheduler = new Scheduler({ maxConcurrency: 2, maxConcurrencyPerAgent: { self: 5, oracle: 5, "jce-researcher": 5, explorer: 5, frontend: 5, android: 5 } }, mockNow);
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = addNode(graph, makeNode({ id: "n2" }), NOW);
      graph = addNode(graph, makeNode({ id: "n3" }), NOW);
      graph = promoteReadyNodes(graph, NOW);

      const result = scheduler.tick(graph);
      expect(result.toDispatch).toHaveLength(2);
    });

    test("respects per-agent concurrency limit", () => {
      timeCounter = 0;
      const scheduler = new Scheduler({ maxConcurrency: 10, maxConcurrencyPerAgent: { ...DEFAULT_SCHEDULER_CONFIG.maxConcurrencyPerAgent, self: 1 } }, mockNow);
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1", agent: "self" }), NOW);
      graph = addNode(graph, makeNode({ id: "n2", agent: "self" }), NOW);
      graph = addNode(graph, makeNode({ id: "n3", agent: "explorer" }), NOW);
      graph = promoteReadyNodes(graph, NOW);

      const result = scheduler.tick(graph);
      // Only 1 self agent + 1 explorer
      const selfNodes = result.toDispatch.filter((n) => n.agent === "self");
      expect(selfNodes).toHaveLength(1);
    });

    test("dispatches by priority (higher first)", () => {
      timeCounter = 0;
      const scheduler = new Scheduler({ maxConcurrency: 1 }, mockNow);
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "low", priority: 1 }), NOW);
      graph = addNode(graph, makeNode({ id: "high", priority: 10 }), NOW);
      graph = promoteReadyNodes(graph, NOW);

      const result = scheduler.tick(graph);
      expect(result.toDispatch).toHaveLength(1);
      expect(result.toDispatch[0].id).toBe("high");
    });
  });

  describe("onNodeComplete", () => {
    test("completes node and promotes downstream", () => {
      timeCounter = 0;
      const scheduler = new Scheduler({}, mockNow);
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = addNode(graph, makeNode({ id: "n2", dependencies: ["n1"] }), NOW);
      graph = transitionNode(graph, "n1", "ready", NOW);
      graph = transitionNode(graph, "n1", "running", NOW);

      graph = scheduler.onNodeComplete(graph, "n1", makeOutput());
      expect(graph.nodes.get("n1")?.status).toBe("done");
      expect(graph.nodes.get("n2")?.status).toBe("ready");
    });

    test("marks graph completed when all nodes done", () => {
      timeCounter = 0;
      const scheduler = new Scheduler({}, mockNow);
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = transitionNode(graph, "n1", "ready", NOW);
      graph = transitionNode(graph, "n1", "running", NOW);

      graph = scheduler.onNodeComplete(graph, "n1", makeOutput());
      expect(graph.status).toBe("completed");
    });
  });

  describe("onNodeFailed", () => {
    test("retries when budget available", () => {
      timeCounter = 0;
      const scheduler = new Scheduler({}, mockNow);
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1", retryPolicy: { maxRetries: 2, strategy: ["same", "different_approach", "escalate_user"], currentRetry: 0 } }), NOW);
      graph = transitionNode(graph, "n1", "ready", NOW);
      graph = transitionNode(graph, "n1", "running", NOW);

      const result = scheduler.onNodeFailed(graph, "n1", "timeout");
      expect(result.action).toBe("retry");
      expect(result.graph.nodes.get("n1")?.status).toBe("pending");
      expect(result.graph.nodes.get("n1")?.retryPolicy.currentRetry).toBe(1);
    });

    test("blocks when retry budget exhausted", () => {
      timeCounter = 0;
      const scheduler = new Scheduler({}, mockNow);
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      // currentRetry already equals maxRetries → budget exhausted
      graph = addNode(graph, makeNode({ id: "n1", retryPolicy: { maxRetries: 1, strategy: ["same", "escalate_user"], currentRetry: 0 } }), NOW);
      graph = transitionNode(graph, "n1", "ready", NOW);
      graph = transitionNode(graph, "n1", "running", NOW);
      // First failure uses the retry
      const first = scheduler.onNodeFailed(graph, "n1", "first error");
      expect(first.action).toBe("retry");
      // Now node is pending with currentRetry=1, run it again
      graph = first.graph;
      graph = transitionNode(graph, "n1", "ready", NOW);
      graph = transitionNode(graph, "n1", "running", NOW);
      // Second failure should exhaust budget
      const second = scheduler.onNodeFailed(graph, "n1", "persistent error");
      expect(second.action).toBe("escalate");
      expect(second.graph.nodes.get("n1")?.status).toBe("blocked");
    });
  });

  describe("events", () => {
    test("emits events on node lifecycle", () => {
      timeCounter = 0;
      const scheduler = new Scheduler({}, mockNow);
      const events: SchedulerEvent[] = [];
      scheduler.onEvent((e) => events.push(e));

      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = promoteReadyNodes(graph, NOW);

      const tickResult = scheduler.tick(graph);
      graph = tickResult.graph;

      scheduler.onNodeComplete(graph, "n1", makeOutput());

      const types = events.map((e) => e.type);
      expect(types).toContain("node.dispatched");
      expect(types).toContain("node.completed");
    });
  });

  describe("stale detection", () => {
    test("detects stale running nodes", () => {
      const staleMs = 1000;
      const scheduler = new Scheduler({ staleAfterMs: staleMs }, () => "2026-01-01T01:00:00.000Z");
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = transitionNode(graph, "n1", "ready", NOW);
      graph = transitionNode(graph, "n1", "running", NOW);
      // startedAt is NOW, current time is 1 hour later → stale
      const result = scheduler.detectStaleNodes(graph);
      expect(result.staleNodes).toHaveLength(1);
      expect(result.staleNodes[0].id).toBe("n1");
    });
  });

  describe("canAcceptWork", () => {
    test("returns true when under capacity", () => {
      const scheduler = new Scheduler({ maxConcurrency: 5 }, mockNow);
      const graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      expect(scheduler.canAcceptWork(graph)).toBe(true);
    });

    test("returns false when at capacity", () => {
      timeCounter = 0;
      const scheduler = new Scheduler({ maxConcurrency: 1 }, mockNow);
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = transitionNode(graph, "n1", "ready", NOW);
      graph = transitionNode(graph, "n1", "running", NOW);
      expect(scheduler.canAcceptWork(graph)).toBe(false);
    });
  });
});
