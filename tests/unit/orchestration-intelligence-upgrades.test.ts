import { describe, expect, test } from "bun:test";
import { classifyBlocker } from "../../src/plugin/lib/orchestration/blocker-classifier.js";
import { createTaskGraph, addNode, transitionNode, completeNode, blockNode } from "../../src/plugin/lib/orchestration/task-graph.js";
import { buildConfidenceVector, buildOrchestrationStatusReport, evaluateCompletionGate } from "../../src/plugin/lib/orchestration/intelligence.js";
import { OrchestrationController } from "../../src/plugin/lib/orchestration/controller.js";
import { tmpdir } from "os";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";

const NOW = "2026-01-01T00:00:00.000Z";

describe("orchestration intelligence upgrades", () => {
  test("blocker classifier maps missing info to safe-assumption retry", () => {
    const result = classifyBlocker("Missing API key and required user info");
    expect(result.classification).toBe("missing_info");
    expect(result.askUser).toBe(false);
    expect(result.continueWithSafeAssumption).toBe(true);
    expect(result.action).toBe("retry_with_more_context");
  });

  test("blocker classifier maps architecture uncertainty to oracle switch", () => {
    const result = classifyBlocker("Architecture trade-off unclear and design uncertainty remains");
    expect(result.classification).toBe("architecture_uncertainty");
    expect(result.delegateToOracle).toBe(true);
    expect(result.action).toBe("switch_agent");
  });

  test("task graph stores blocker class and transition reason", () => {
    let graph = createTaskGraph({ id: "g1", goal: "Test", now: NOW });
    graph = addNode(graph, { id: "n1", type: "code", title: "Node", description: "desc", agent: "self", prompt: "run" }, NOW);
    graph = transitionNode(graph, "n1", "ready", NOW);
    graph = blockNode(graph, "n1", "Need approval", NOW, "permission_boundary");
    expect(graph.nodes.get("n1")?.blockerClass).toBe("permission_boundary");
    expect(graph.nodes.get("n1")?.transitionHistory?.at(-1)?.reason).toBe("Need approval");
  });

  test("confidence model exposes split dimensions", () => {
    let graph = createTaskGraph({ id: "g2", goal: "Test", now: NOW });
    graph = addNode(graph, { id: "n1", type: "code", title: "Code", description: "desc", agent: "self", prompt: "run" }, NOW);
    graph = transitionNode(graph, "n1", "ready", NOW);
    graph = transitionNode(graph, "n1", "running", NOW);
    graph = completeNode(graph, "n1", { summary: "done", artifacts: [], evidence: [], newFacts: [], confidence: 0.8 }, NOW);
    const vector = buildConfidenceVector(graph, 0.9);
    expect(vector.intent).toBe(0.9);
    expect(vector.routing).toBe(0.9);
    expect(vector.implementation).toBeGreaterThan(0);
    expect(vector.completion).toBeGreaterThan(0);
  });

  test("status report includes confidence breakdown", () => {
    let graph = createTaskGraph({ id: "g3", goal: "Test", now: NOW });
    graph = addNode(graph, { id: "n1", type: "code", title: "Code", description: "desc", agent: "self", prompt: "run" }, NOW);
    graph = transitionNode(graph, "n1", "ready", NOW);
    graph = transitionNode(graph, "n1", "running", NOW);
    graph = completeNode(graph, "n1", { summary: "done", artifacts: [], evidence: [], newFacts: [], confidence: 0.7 }, NOW);
    const report = buildOrchestrationStatusReport(graph, { facts: [], constraints: [], decisions: [], artifacts: [], evidence: [], signals: [], createdAt: NOW, updatedAt: NOW } as any);
    expect(report.confidenceByDimension).toBeDefined();
  });

  test("controller persists autonomy level and operator preferences", () => {
    const root = mkdtempSync(join(tmpdir(), "orch-upgrades-"));
    try {
      const controller = new OrchestrationController({ projectRoot: root, now: () => NOW });
      controller.setAutonomyLevel("autonomous");
      controller.setOperatorPreferences({ preferAutonomousCompletion: true, preferTerseReports: true });
      controller.persist();

      const reloaded = new OrchestrationController({ projectRoot: root, now: () => NOW });
      expect(reloaded.getAutonomyLevel()).toBe("autonomous");
      expect(reloaded.getOperatorPreferences().preferAutonomousCompletion).toBe(true);
      expect(reloaded.getOperatorPreferences().preferTerseReports).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("completion gate includes confidence dimensions", () => {
    let graph = createTaskGraph({ id: "g4", goal: "Test", now: NOW });
    graph = addNode(graph, { id: "n1", type: "verify", title: "Verify", description: "desc", agent: "self", prompt: "run" }, NOW);
    graph = transitionNode(graph, "n1", "ready", NOW);
    graph = transitionNode(graph, "n1", "running", NOW);
    graph = completeNode(graph, "n1", { summary: "done", artifacts: [], evidence: [], newFacts: [], confidence: 0.9 }, NOW);
    const gate = evaluateCompletionGate(graph);
    expect(gate.confidenceByDimension).toBeDefined();
    expect(gate.confidenceByDimension?.verification).toBeGreaterThanOrEqual(0);
  });
});
