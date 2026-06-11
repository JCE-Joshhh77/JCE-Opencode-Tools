import { describe, expect, test } from "bun:test";
import { createEmptyMemoryV2, mergeOrchestrationIntoMemory } from "../../src/plugin/lib/orchestration/execution-memory-v2.js";
import { createOrchestrationMemory, addConstraint } from "../../src/plugin/lib/orchestration/shared-memory.js";
import { createTaskGraph } from "../../src/plugin/lib/orchestration/task-graph.js";
import { AdaptivePlanner } from "../../src/plugin/lib/orchestration/planner.js";
import { OrchestrationController } from "../../src/plugin/lib/orchestration/controller.js";
import { tmpdir } from "os";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";

const NOW = "2026-01-01T00:00:00.000Z";

describe("orchestration memory and planner upgrades", () => {
  test("execution memory tracks structured memory tiers", () => {
    const exec = createEmptyMemoryV2(NOW);
    const memory = addConstraint(createOrchestrationMemory(NOW), { description: "Preserve release safety", origin: "user" }, NOW);
    const graph = createTaskGraph({ id: "g1", goal: "Ship release", now: NOW });
    const merged = mergeOrchestrationIntoMemory(exec, memory, graph, NOW);
    expect(merged.memoryTiers?.session.pendingPlan).toContain("Ship release");
    expect(Array.isArray(merged.memoryTiers?.session.blockers)).toBe(true);
  });

  test("planner exposes explicit multi-objective tradeoff scoring", () => {
    const planner = new AdaptivePlanner();
    const fast = planner.scoreTradeoffs({ speedWeight: 0.9, certaintyWeight: 0.1, interruptionWeight: 0.1 }, "feature");
    const careful = planner.scoreTradeoffs({ certaintyWeight: 0.9, blastRadiusWeight: 0.9, reversibilityWeight: 0.9 }, "release");
    expect(fast.mode).toBe("fast");
    expect(careful.mode).toBe("careful");
  });

  test("controller applies cross-task learning after repeated failures", () => {
    const root = mkdtempSync(join(tmpdir(), "orch-learning-"));
    try {
      const controller = new OrchestrationController({ projectRoot: root, now: () => NOW });
      (controller as any).execMemory.sessionHistory = [
        { id: "s1", startedAt: NOW, nodesCompleted: 1, nodesFailed: 1 },
        { id: "s2", startedAt: NOW, nodesCompleted: 0, nodesFailed: 2 },
        { id: "s3", startedAt: NOW, nodesCompleted: 2, nodesFailed: 0 },
      ];
      controller.applyCrossTaskLearning();
      const constraints = controller.getMemory().constraints.map((item) => item.description);
      expect(constraints).toContain("Prefer safer verification-first approach based on recent failures");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("controller learns autonomous bias after repeated successful sessions", () => {
    const root = mkdtempSync(join(tmpdir(), "orch-learning-success-"));
    try {
      const controller = new OrchestrationController({ projectRoot: root, now: () => NOW });
      (controller as any).execMemory.sessionHistory = [
        { id: "s1", startedAt: NOW, nodesCompleted: 3, nodesFailed: 0 },
        { id: "s2", startedAt: NOW, nodesCompleted: 2, nodesFailed: 0 },
        { id: "s3", startedAt: NOW, nodesCompleted: 1, nodesFailed: 1 },
      ];
      controller.applyCrossTaskLearning();
      const constraints = controller.getMemory().constraints.map((item) => item.description);
      expect(constraints).toContain("Recent successful sessions justify broader autonomous execution");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
