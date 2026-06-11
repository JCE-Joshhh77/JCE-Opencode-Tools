import { describe, expect, test } from "bun:test";
import { createTaskGraph, addNode, promoteReadyNodes } from "../../src/plugin/lib/orchestration/task-graph.js";
import { computeNextBestAction } from "../../src/plugin/lib/orchestration/intelligence.js";
import { createOrchestrationMemory } from "../../src/plugin/lib/orchestration/shared-memory.js";
import { OrchestrationController } from "../../src/plugin/lib/orchestration/controller.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const NOW = "2026-01-01T00:00:00.000Z";

describe("orchestration deep upgrades", () => {
  test("new nodes start in intake and promote to pending/ready", () => {
    let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
    graph = addNode(graph, { id: "n1", type: "code", title: "Node", description: "desc", agent: "self", prompt: "run" }, NOW);
    expect(graph.nodes.get("n1")?.status).toBe("intake");
    graph = promoteReadyNodes(graph, NOW);
    expect(["pending", "ready"]).toContain(graph.nodes.get("n1")?.status as string);
  });

  test("graph-native next best action prioritizes ready nodes", () => {
    let graph = createTaskGraph({ id: "g2", goal: "Test", now: NOW });
    graph = addNode(graph, { id: "n1", type: "code", title: "Implement feature", description: "desc", agent: "self", prompt: "run" }, NOW);
    graph = promoteReadyNodes(graph, NOW);
    const action = computeNextBestAction(graph, createOrchestrationMemory(NOW), { preferBroadVerification: true });
    expect(action).toContain("Dispatch next ready node");
  });

  test("next best action respects autonomous preference for pending continuation", () => {
    let graph = createTaskGraph({ id: "g2b", goal: "Test", now: NOW });
    graph = addNode(graph, { id: "n1", type: "code", title: "Implement feature", description: "desc", agent: "self", prompt: "run" }, NOW);
    graph = addNode(graph, { id: "n2", type: "verify", title: "Verify feature", description: "desc", agent: "self", prompt: "verify", dependencies: ["n1"] }, NOW);
    graph = promoteReadyNodes(graph, NOW);
    graph.nodes.get("n1")!.status = "done";
    const action = computeNextBestAction(graph, createOrchestrationMemory(NOW), { preferBroadVerification: true, preferAutonomousCompletion: true });
    expect(action).toContain("autonomous execution");
  });

  test("controller auto-captures failure signature into memory tiers", () => {
    const root = mkdtempSync(join(tmpdir(), "orch-deep-"));
    try {
      const controller = new OrchestrationController({ projectRoot: root, now: () => NOW });
      controller.createPlan("Fix updater integrity failure");
      const graph = controller.getGraph()!;
      const node = Array.from(graph.nodes.values())[0]!;
      const failure = controller.handleFailure(node.id, "annotated tag mismatch");
      expect(["retry", "blocked", "escalate"]).toContain(failure.action);
      const memoryTiers = (controller as any).execMemory.memoryTiers;
      expect(memoryTiers.failure.knownErrors.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
