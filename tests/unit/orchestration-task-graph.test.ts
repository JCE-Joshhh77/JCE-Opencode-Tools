import { describe, test, expect } from "bun:test";
import {
  createTaskGraph,
  addNode,
  removeNode,
  addEdge,
  transitionNode,
  transitionNodeWithReason,
  failNode,
  completeNode,
  blockNode,
  attachEvidence,
  getReadyNodes,
  getDispatchableNodes,
  getRunningNodes,
  detectCycle,
  deriveGraphStatus,
  promoteReadyNodes,
  snapshotGraph,
  restoreGraph,
  getNodesByStatus,
  getGraphStats,
  getDependentsOf,
  getDependenciesOf,
} from "../../src/plugin/lib/orchestration/task-graph.js";
import type { CreateNodeInput } from "../../src/plugin/lib/orchestration/task-graph.js";
import type { TaskNodeOutput, Evidence } from "../../src/plugin/lib/orchestration/types.js";

const NOW = "2026-01-01T00:00:00.000Z";

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

describe("TaskGraph", () => {
  describe("createTaskGraph", () => {
    test("creates empty graph with planning status", () => {
      const graph = createTaskGraph({ id: "g1", goal: "Test goal", now: NOW });
      expect(graph.id).toBe("g1");
      expect(graph.goal).toBe("Test goal");
      expect(graph.status).toBe("planning");
      expect(graph.nodes.size).toBe(0);
      expect(graph.edges).toHaveLength(0);
    });
  });

  describe("addNode", () => {
    test("adds a node to the graph", () => {
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      expect(graph.nodes.size).toBe(1);
      expect(graph.nodes.get("n1")?.status).toBe("intake");
    });

    test("throws on duplicate node id", () => {
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      expect(() => addNode(graph, makeNode({ id: "n1" }), NOW)).toThrow("already exists");
    });

    test("auto-creates blocking edges for dependencies", () => {
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = addNode(graph, makeNode({ id: "n2", dependencies: ["n1"] }), NOW);
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toEqual({ from: "n1", to: "n2", type: "blocks" });
    });

    test("throws if dependency does not exist", () => {
      const graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      expect(() => addNode(graph, makeNode({ id: "n1", dependencies: ["missing"] }), NOW)).toThrow("not found");
    });
  });

  describe("removeNode", () => {
    test("removes a node with no dependents", () => {
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = removeNode(graph, "n1", NOW);
      expect(graph.nodes.size).toBe(0);
    });

    test("throws if node has dependents", () => {
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = addNode(graph, makeNode({ id: "n2", dependencies: ["n1"] }), NOW);
      expect(() => removeNode(graph, "n1", NOW)).toThrow("depended on by");
    });
  });

  describe("addEdge", () => {
    test("adds an edge between existing nodes", () => {
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = addNode(graph, makeNode({ id: "n2" }), NOW);
      graph = addEdge(graph, { from: "n1", to: "n2", type: "informs" }, NOW);
      expect(graph.edges).toHaveLength(1);
    });

    test("throws on missing source", () => {
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      expect(() => addEdge(graph, { from: "missing", to: "n1", type: "blocks" }, NOW)).toThrow("source not found");
    });
  });

  describe("status transitions", () => {
    test("pending → ready → running → done", () => {
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = transitionNode(graph, "n1", "ready", NOW);
      expect(graph.nodes.get("n1")?.status).toBe("ready");
      graph = transitionNode(graph, "n1", "running", NOW);
      expect(graph.nodes.get("n1")?.status).toBe("running");
      expect(graph.nodes.get("n1")?.startedAt).toBe(NOW);
      graph = transitionNode(graph, "n1", "done", NOW);
      expect(graph.nodes.get("n1")?.status).toBe("done");
      expect(graph.nodes.get("n1")?.completedAt).toBe(NOW);
    });

    test("invalid transition throws", () => {
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      expect(() => transitionNode(graph, "n1", "done", NOW)).toThrow("Invalid transition");
    });

    test("transitionNodeWithReason records semantic reason", () => {
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = transitionNodeWithReason(graph, "n1", "ready", "dependencies satisfied", NOW);
      expect(graph.nodes.get("n1")?.transitionHistory?.at(-1)?.reason).toBe("dependencies satisfied");
    });

    test("failNode sets failure reason", () => {
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = transitionNode(graph, "n1", "ready", NOW);
      graph = transitionNode(graph, "n1", "running", NOW);
      graph = failNode(graph, "n1", "Something broke", NOW);
      expect(graph.nodes.get("n1")?.status).toBe("failed");
      expect(graph.nodes.get("n1")?.failureReason).toBe("Something broke");
    });

    test("completeNode sets output", () => {
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = transitionNode(graph, "n1", "ready", NOW);
      graph = transitionNode(graph, "n1", "running", NOW);
      graph = completeNode(graph, "n1", makeOutput(), NOW);
      expect(graph.nodes.get("n1")?.status).toBe("done");
      expect(graph.nodes.get("n1")?.output?.summary).toBe("Done");
    });
  });

  describe("dependency resolution", () => {
    test("getReadyNodes returns nodes with all deps satisfied", () => {
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = addNode(graph, makeNode({ id: "n2", dependencies: ["n1"] }), NOW);
      graph = addNode(graph, makeNode({ id: "n3" }), NOW);

      // n1 and n3 have no deps, n2 depends on n1
      graph = promoteReadyNodes(graph, NOW);
      expect(graph.nodes.get("n1")?.status).toBe("ready");
      expect(graph.nodes.get("n3")?.status).toBe("ready");
    });

    test("getReadyNodes unlocks after dependency completes", () => {
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = addNode(graph, makeNode({ id: "n2", dependencies: ["n1"] }), NOW);

      // Complete n1
      graph = transitionNode(graph, "n1", "ready", NOW);
      graph = transitionNode(graph, "n1", "running", NOW);
      graph = completeNode(graph, "n1", makeOutput(), NOW);

      graph = promoteReadyNodes(graph, NOW);
      expect(graph.nodes.get("n2")?.status).toBe("ready");
    });

    test("promoteReadyNodes moves eligible pending to ready", () => {
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = addNode(graph, makeNode({ id: "n2", dependencies: ["n1"] }), NOW);

      // Complete n1
      graph = transitionNode(graph, "n1", "ready", NOW);
      graph = transitionNode(graph, "n1", "running", NOW);
      graph = completeNode(graph, "n1", makeOutput(), NOW);

      graph = promoteReadyNodes(graph, NOW);
      expect(graph.nodes.get("n2")?.status).toBe("ready");
    });
  });

  describe("cycle detection", () => {
    test("detects no cycle in valid DAG", () => {
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = addNode(graph, makeNode({ id: "n2", dependencies: ["n1"] }), NOW);
      graph = addNode(graph, makeNode({ id: "n3", dependencies: ["n2"] }), NOW);
      expect(detectCycle(graph)).toBeNull();
    });
  });

  describe("graph status derivation", () => {
    test("empty graph stays in current status", () => {
      const graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      expect(deriveGraphStatus(graph)).toBe("planning");
    });

    test("all done → completed", () => {
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = transitionNode(graph, "n1", "ready", NOW);
      graph = transitionNode(graph, "n1", "running", NOW);
      graph = completeNode(graph, "n1", makeOutput(), NOW);
      expect(deriveGraphStatus(graph)).toBe("completed");
    });

    test("any running → executing", () => {
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = addNode(graph, makeNode({ id: "n2" }), NOW);
      graph = transitionNode(graph, "n1", "ready", NOW);
      graph = transitionNode(graph, "n1", "running", NOW);
      expect(deriveGraphStatus(graph)).toBe("executing");
    });

    test("all failed/blocked → failed", () => {
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = transitionNode(graph, "n1", "ready", NOW);
      graph = transitionNode(graph, "n1", "running", NOW);
      graph = failNode(graph, "n1", "error", NOW);
      expect(deriveGraphStatus(graph)).toBe("failed");
    });
  });

  describe("serialization", () => {
    test("snapshot and restore roundtrip", () => {
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = addNode(graph, makeNode({ id: "n2", dependencies: ["n1"] }), NOW);

      const snapshot = snapshotGraph(graph);
      const restored = restoreGraph(snapshot);

      expect(restored.id).toBe(graph.id);
      expect(restored.nodes.size).toBe(2);
      expect(restored.edges).toHaveLength(1);
      expect(restored.nodes.get("n2")?.dependencies).toEqual(["n1"]);
    });
  });

  describe("query helpers", () => {
    test("getNodesByStatus", () => {
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = addNode(graph, makeNode({ id: "n2" }), NOW);
      graph = transitionNode(graph, "n1", "ready", NOW);
      expect(getNodesByStatus(graph, "intake")).toHaveLength(1);
      expect(getNodesByStatus(graph, "ready")).toHaveLength(1);
    });

    test("getDependentsOf and getDependenciesOf", () => {
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = addNode(graph, makeNode({ id: "n2", dependencies: ["n1"] }), NOW);
      graph = addNode(graph, makeNode({ id: "n3", dependencies: ["n1"] }), NOW);

      expect(getDependentsOf(graph, "n1").map((n) => n.id).sort()).toEqual(["n2", "n3"]);
      expect(getDependenciesOf(graph, "n2").map((n) => n.id)).toEqual(["n1"]);
    });

    test("getGraphStats", () => {
      let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
      graph = addNode(graph, makeNode({ id: "n1" }), NOW);
      graph = addNode(graph, makeNode({ id: "n2" }), NOW);
      graph = transitionNode(graph, "n1", "ready", NOW);

      const stats = getGraphStats(graph);
      expect(stats.total).toBe(2);
      expect(stats.pending).toBe(0);
      expect(stats.ready).toBe(1);
    });
  });
});
