import { describe, test, expect } from "bun:test";
import {
  createOrchestrationMemory,
  addFact,
  addFacts,
  getFactsByScope,
  getTopFacts,
  addDecision,
  supersedeDecision,
  getActiveDecisions,
  addConstraint,
  deactivateConstraint,
  getActiveConstraints,
  addArtifact,
  getArtifactsByNode,
  sendSignal,
  consumeSignals,
  getUnconsumedSignals,
  pruneMemory,
  snapshotMemory,
  restoreMemory,
} from "../../src/plugin/lib/orchestration/shared-memory.js";
import type { Fact, Artifact } from "../../src/plugin/lib/orchestration/types.js";

const NOW = "2026-01-01T00:00:00.000Z";

describe("Shared Orchestration Memory", () => {
  describe("facts", () => {
    test("addFact creates a new fact", () => {
      let mem = createOrchestrationMemory(NOW);
      mem = addFact(mem, { key: "test.framework", value: "bun test", source: "tool", confidence: 0.9 }, NOW);
      expect(mem.facts.size).toBe(1);
      expect(mem.facts.get("test.framework")?.value).toBe("bun test");
    });

    test("addFact updates existing fact with higher confidence", () => {
      let mem = createOrchestrationMemory(NOW);
      mem = addFact(mem, { key: "lang", value: "typescript", source: "inference", confidence: 0.5 }, NOW);
      mem = addFact(mem, { key: "lang", value: "TypeScript 5.9", source: "tool", confidence: 0.9 }, NOW);
      expect(mem.facts.get("lang")?.value).toBe("TypeScript 5.9");
    });

    test("addFact does not overwrite with lower confidence", () => {
      let mem = createOrchestrationMemory(NOW);
      mem = addFact(mem, { key: "lang", value: "TypeScript 5.9", source: "tool", confidence: 0.9 }, NOW);
      mem = addFact(mem, { key: "lang", value: "javascript", source: "inference", confidence: 0.3 }, NOW);
      expect(mem.facts.get("lang")?.value).toBe("TypeScript 5.9");
    });

    test("addFacts adds multiple facts", () => {
      let mem = createOrchestrationMemory(NOW);
      const facts: Fact[] = [
        { id: "f1", key: "a", value: "1", source: "user", confidence: 0.8, discoveredAt: NOW },
        { id: "f2", key: "b", value: "2", source: "user", confidence: 0.8, discoveredAt: NOW },
      ];
      mem = addFacts(mem, facts, NOW);
      expect(mem.facts.size).toBe(2);
    });

    test("getFactsByScope filters by key prefix", () => {
      let mem = createOrchestrationMemory(NOW);
      mem = addFact(mem, { key: "project.name", value: "opencode-jce", source: "tool", confidence: 0.9 }, NOW);
      mem = addFact(mem, { key: "project.version", value: "3.0.0", source: "tool", confidence: 0.9 }, NOW);
      mem = addFact(mem, { key: "user.preference", value: "dark", source: "user", confidence: 0.8 }, NOW);

      const projectFacts = getFactsByScope(mem, "project");
      expect(projectFacts).toHaveLength(2);
    });

    test("getFactsByScope filters by tag", () => {
      let mem = createOrchestrationMemory(NOW);
      mem = addFact(mem, { key: "framework", value: "react", source: "tool", confidence: 0.9, tags: ["frontend"] }, NOW);
      mem = addFact(mem, { key: "db", value: "postgres", source: "tool", confidence: 0.9, tags: ["backend"] }, NOW);

      const frontendFacts = getFactsByScope(mem, "frontend");
      expect(frontendFacts).toHaveLength(1);
      expect(frontendFacts[0].key).toBe("framework");
    });

    test("getTopFacts returns sorted by confidence", () => {
      let mem = createOrchestrationMemory(NOW);
      mem = addFact(mem, { key: "low", value: "x", source: "inference", confidence: 0.3 }, NOW);
      mem = addFact(mem, { key: "high", value: "y", source: "tool", confidence: 0.95 }, NOW);
      mem = addFact(mem, { key: "mid", value: "z", source: "agent", confidence: 0.7 }, NOW);

      const top = getTopFacts(mem, 2);
      expect(top).toHaveLength(2);
      expect(top[0].key).toBe("high");
      expect(top[1].key).toBe("mid");
    });
  });

  describe("decisions", () => {
    test("addDecision creates an active decision", () => {
      let mem = createOrchestrationMemory(NOW);
      mem = addDecision(mem, { description: "Use DAG-based orchestration", reasoning: "Better than flat workflow" }, NOW);
      expect(mem.decisions).toHaveLength(1);
      expect(mem.decisions[0].status).toBe("active");
    });

    test("supersedeDecision marks old decision as superseded", () => {
      let mem = createOrchestrationMemory(NOW);
      mem = addDecision(mem, { description: "Use REST", reasoning: "Simple" }, NOW);
      const decId = mem.decisions[0].id;
      mem = addDecision(mem, { description: "Use GraphQL", reasoning: "More flexible" }, NOW);
      const newDecId = mem.decisions[1].id;
      mem = supersedeDecision(mem, decId, newDecId, NOW);

      expect(mem.decisions[0].status).toBe("superseded");
      expect(mem.decisions[0].supersededBy).toBe(newDecId);
    });

    test("getActiveDecisions filters superseded", () => {
      let mem = createOrchestrationMemory(NOW);
      mem = addDecision(mem, { description: "Old", reasoning: "x" }, NOW);
      const oldId = mem.decisions[0].id;
      mem = addDecision(mem, { description: "New", reasoning: "y" }, NOW);
      mem = supersedeDecision(mem, oldId, mem.decisions[1].id, NOW);

      const active = getActiveDecisions(mem);
      expect(active).toHaveLength(1);
      expect(active[0].description).toBe("New");
    });
  });

  describe("constraints", () => {
    test("addConstraint creates active constraint", () => {
      let mem = createOrchestrationMemory(NOW);
      mem = addConstraint(mem, { description: "Don't modify package.json", origin: "user" }, NOW);
      expect(mem.constraints).toHaveLength(1);
      expect(mem.constraints[0].active).toBe(true);
    });

    test("addConstraint deduplicates by description", () => {
      let mem = createOrchestrationMemory(NOW);
      mem = addConstraint(mem, { description: "No breaking changes", origin: "user" }, NOW);
      mem = addConstraint(mem, { description: "no breaking changes", origin: "system" }, NOW);
      expect(mem.constraints).toHaveLength(1);
    });

    test("deactivateConstraint marks inactive", () => {
      let mem = createOrchestrationMemory(NOW);
      mem = addConstraint(mem, { description: "Temp constraint", origin: "system" }, NOW);
      const id = mem.constraints[0].id;
      mem = deactivateConstraint(mem, id, NOW);
      expect(mem.constraints[0].active).toBe(false);
      expect(getActiveConstraints(mem)).toHaveLength(0);
    });
  });

  describe("artifacts", () => {
    test("addArtifact tracks file changes", () => {
      let mem = createOrchestrationMemory(NOW);
      const artifact: Artifact = { id: "a1", path: "src/index.ts", type: "modified", description: "Updated entry", nodeId: "n1", timestamp: NOW };
      mem = addArtifact(mem, artifact, NOW);
      expect(mem.artifacts).toHaveLength(1);
    });

    test("addArtifact deduplicates by path (keeps latest)", () => {
      let mem = createOrchestrationMemory(NOW);
      mem = addArtifact(mem, { id: "a1", path: "src/index.ts", type: "created", description: "First", nodeId: "n1", timestamp: NOW }, NOW);
      mem = addArtifact(mem, { id: "a2", path: "src/index.ts", type: "modified", description: "Second", nodeId: "n2", timestamp: NOW }, NOW);
      expect(mem.artifacts).toHaveLength(1);
      expect(mem.artifacts[0].description).toBe("Second");
    });

    test("getArtifactsByNode filters by nodeId", () => {
      let mem = createOrchestrationMemory(NOW);
      mem = addArtifact(mem, { id: "a1", path: "a.ts", type: "created", description: "x", nodeId: "n1", timestamp: NOW }, NOW);
      mem = addArtifact(mem, { id: "a2", path: "b.ts", type: "created", description: "y", nodeId: "n2", timestamp: NOW }, NOW);
      expect(getArtifactsByNode(mem, "n1")).toHaveLength(1);
    });
  });

  describe("signals", () => {
    test("sendSignal creates unconsumed signal", () => {
      let mem = createOrchestrationMemory(NOW);
      mem = sendSignal(mem, { fromNodeId: "n1", toNodeId: "n2", type: "info", priority: "normal", message: "Found something" }, NOW);
      expect(mem.signals).toHaveLength(1);
      expect(mem.signals[0].consumed).toBe(false);
    });

    test("consumeSignals marks signals as consumed", () => {
      let mem = createOrchestrationMemory(NOW);
      mem = sendSignal(mem, { fromNodeId: "n1", toNodeId: "n2", type: "info", priority: "normal", message: "msg1" }, NOW);
      mem = sendSignal(mem, { fromNodeId: "n1", toNodeId: "n3", type: "warning", priority: "high", message: "msg2" }, NOW);

      const result = consumeSignals(mem, "n2", NOW);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].message).toBe("msg1");
      expect(result.memory.signals.find((s) => s.message === "msg1")?.consumed).toBe(true);
    });

    test("broadcast signals (no toNodeId) are consumed by any node", () => {
      let mem = createOrchestrationMemory(NOW);
      mem = sendSignal(mem, { fromNodeId: "n1", type: "discovery", priority: "normal", message: "broadcast" }, NOW);

      const result = consumeSignals(mem, "n5", NOW);
      expect(result.signals).toHaveLength(1);
    });

    test("getUnconsumedSignals filters by priority", () => {
      let mem = createOrchestrationMemory(NOW);
      mem = sendSignal(mem, { fromNodeId: "n1", type: "info", priority: "low", message: "low" }, NOW);
      mem = sendSignal(mem, { fromNodeId: "n1", type: "warning", priority: "high", message: "high" }, NOW);
      mem = sendSignal(mem, { fromNodeId: "n1", type: "blocker", priority: "critical", message: "critical" }, NOW);

      const highAndAbove = getUnconsumedSignals(mem, "high");
      expect(highAndAbove).toHaveLength(2); // high + critical
    });
  });

  describe("pruning", () => {
    test("prunes facts over limit by confidence", () => {
      let mem = createOrchestrationMemory(NOW);
      for (let i = 0; i < 10; i++) {
        mem = addFact(mem, { key: `fact-${i}`, value: `v${i}`, source: "tool", confidence: i / 10 }, NOW);
      }
      const pruned = pruneMemory(mem, { maxFacts: 5 }, NOW);
      expect(pruned.facts.size).toBe(5);
      // Should keep highest confidence
      expect(pruned.facts.has("fact-9")).toBe(true);
      expect(pruned.facts.has("fact-0")).toBe(false);
    });

    test("prunes expired facts", () => {
      let mem = createOrchestrationMemory(NOW);
      mem = addFact(mem, { key: "expired", value: "x", source: "tool", confidence: 0.9, expiresAt: "2025-01-01T00:00:00Z" }, NOW);
      mem = addFact(mem, { key: "valid", value: "y", source: "tool", confidence: 0.9 }, NOW);

      const pruned = pruneMemory(mem, {}, NOW);
      expect(pruned.facts.has("expired")).toBe(false);
      expect(pruned.facts.has("valid")).toBe(true);
    });

    test("prunes consumed signals", () => {
      let mem = createOrchestrationMemory(NOW);
      mem = sendSignal(mem, { fromNodeId: "n1", type: "info", priority: "normal", message: "msg" }, NOW);
      const consumed = consumeSignals(mem, "n1", NOW);
      const pruned = pruneMemory(consumed.memory, {}, NOW);
      expect(pruned.signals).toHaveLength(0);
    });
  });

  describe("serialization", () => {
    test("snapshot and restore roundtrip", () => {
      let mem = createOrchestrationMemory(NOW);
      mem = addFact(mem, { key: "test", value: "value", source: "user", confidence: 0.8 }, NOW);
      mem = addDecision(mem, { description: "Decision 1", reasoning: "Because" }, NOW);
      mem = addConstraint(mem, { description: "Constraint 1", origin: "user" }, NOW);

      const snapshot = snapshotMemory(mem);
      const restored = restoreMemory(snapshot);

      expect(restored.facts.size).toBe(1);
      expect(restored.facts.get("test")?.value).toBe("value");
      expect(restored.decisions).toHaveLength(1);
      expect(restored.constraints).toHaveLength(1);
    });
  });
});
