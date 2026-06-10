import { describe, test, expect } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import {
  shouldRestoreGraph,
  restoreOrchestrationFromMemory,
  mergeOrchestrationIntoMemory,
  createEmptyMemoryV2,
  loadMemoryV2,
} from "../../src/plugin/lib/orchestration/execution-memory-v2.js";
import { getRuntimeStatePath } from "../../src/plugin/lib/runtime-state.ts";
import { createOrchestrationMemory, addConstraint } from "../../src/plugin/lib/orchestration/shared-memory.js";
import { createTaskGraph, addNode, transitionNode, completeNode, snapshotGraph } from "../../src/plugin/lib/orchestration/task-graph.js";
import { evaluateCompletionGate, extractToolEvidence } from "../../src/plugin/lib/orchestration/intelligence.js";
import { scoreIntent } from "../../src/plugin/lib/orchestration/intent-router.js";
import {
  STALE_TTL_MS,
  isStaleTimestamp,
  shouldRestorePersistedGraph,
  shouldDropPersistedWorkflow,
} from "../../src/plugin/lib/orchestration/staleness.js";
import type { ExecutionMemoryV2, TaskGraphSnapshot } from "../../src/plugin/lib/orchestration/types.js";

const NOW = "2026-06-10T00:00:00.000Z";
const NOW_MS = Date.parse(NOW);

function snapshotWith(status: TaskGraphSnapshot["status"], updatedAt: string): TaskGraphSnapshot {
  return {
    id: "g1",
    goal: "test",
    status,
    nodes: [],
    edges: [],
    createdAt: updatedAt,
    updatedAt,
    metadata: undefined,
  };
}

describe("C1 — stale graph restoration guard", () => {
  test("does not restore terminal graphs (completed/failed/cancelled)", () => {
    expect(shouldRestoreGraph(snapshotWith("completed", NOW), NOW_MS)).toBe(false);
    expect(shouldRestoreGraph(snapshotWith("failed", NOW), NOW_MS)).toBe(false);
    expect(shouldRestoreGraph(snapshotWith("cancelled", NOW), NOW_MS)).toBe(false);
  });

  test("does not restore graphs older than the TTL", () => {
    const old = new Date(NOW_MS - 24 * 60 * 60 * 1000).toISOString();
    expect(shouldRestoreGraph(snapshotWith("executing", old), NOW_MS)).toBe(false);
  });

  test("restores recent non-terminal graphs", () => {
    const recent = new Date(NOW_MS - 60 * 1000).toISOString();
    expect(shouldRestoreGraph(snapshotWith("executing", recent), NOW_MS)).toBe(true);
  });

  test("undefined or unparsable graph is not restored", () => {
    expect(shouldRestoreGraph(undefined, NOW_MS)).toBe(false);
    expect(shouldRestoreGraph(snapshotWith("executing", "not-a-date"), NOW_MS)).toBe(false);
  });

  test("restoreOrchestrationFromMemory drops a stale graph", () => {
    const mem: ExecutionMemoryV2 = {
      ...createEmptyMemoryV2(NOW),
      graph: snapshotWith("executing", new Date(NOW_MS - 48 * 60 * 60 * 1000).toISOString()),
    };
    const { graph } = restoreOrchestrationFromMemory(mem, NOW);
    expect(graph).toBeUndefined();
  });
});

describe("v1/v2 persistence bridge", () => {
  test("loadMemoryV2 migrates legacy v1 file from jce-worker-execution path", () => {
    const root = mkdtempSync(join(tmpdir(), "opencode-jce-v1v2-"));
    try {
      const legacyPath = getRuntimeStatePath(root);
      mkdirSync(dirname(legacyPath), { recursive: true });
      writeFileSync(legacyPath, JSON.stringify({
        version: 1,
        updatedAt: NOW,
        activeTasks: [],
        completedSummaries: [],
        blockers: [],
        verificationEvidence: [],
        retryHistory: [],
        traceEvents: [],
        workflowRuns: [],
        wisdom: [{ id: "w1", learning: "keep evidence", source: "review", createdAt: NOW }],
        taskLearnings: [{ id: "t1", taskType: "bugfix", trigger: "failing test", successfulRecipe: ["repro"], verificationCommands: ["bun test"], touchedAreas: ["src/plugin"], createdAt: NOW }],
      }, null, 2));

      const loaded = loadMemoryV2(root, NOW);
      expect(loaded.migrated).toBe(true);
      expect(loaded.memory.version).toBe(2);
      expect(loaded.memory.wisdom.some((entry) => entry.id === "w1")).toBe(true);
      expect(loaded.memory.taskLearnings.some((entry) => entry.id === "t1")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("H5 — constraints survive persist/restore", () => {
  test("constraints are persisted and restored", () => {
    let orch = createOrchestrationMemory(NOW);
    orch = addConstraint(orch, { description: "do not touch prod", origin: "user" }, NOW);
    const merged = mergeOrchestrationIntoMemory(createEmptyMemoryV2(NOW), orch, undefined, NOW);
    expect(merged.orchestration?.constraints.length).toBe(1);

    const { memory } = restoreOrchestrationFromMemory(merged, NOW);
    expect(memory.constraints.some((c) => c.description === "do not touch prod")).toBe(true);
  });
});

describe("H2 — orchestration evidence reaches persisted memory", () => {
  test("node evidence is merged into execMemory.evidence", () => {
    let graph = createTaskGraph({ id: "g", goal: "build", now: NOW });
    graph = addNode(graph, { id: "n1", type: "code", title: "impl", description: "d", agent: "self", prompt: "p" }, NOW);
    graph = transitionNode(graph, "n1", "ready", NOW);
    graph = transitionNode(graph, "n1", "running", NOW);
    graph = completeNode(graph, "n1", {
      summary: "done",
      artifacts: [],
      evidence: [{ id: "ev1", type: "test_result", source: "bun test", assertions: [], confidence: 0.95, timestamp: NOW }],
      newFacts: [],
      confidence: 0.95,
    }, NOW);

    const merged = mergeOrchestrationIntoMemory(createEmptyMemoryV2(NOW), createOrchestrationMemory(NOW), graph, NOW);
    expect(merged.evidence.some((e) => e.id === "ev1")).toBe(true);
  });
});

describe("M1 — non-code graphs are not blocked at 0% confidence", () => {
  test("a research-only graph can complete without command evidence", () => {
    let graph = createTaskGraph({ id: "g", goal: "research", now: NOW });
    graph = addNode(graph, { id: "r1", type: "research", title: "gather", description: "d", agent: "jce-researcher", prompt: "p" }, NOW);
    graph = transitionNode(graph, "r1", "ready", NOW);
    graph = transitionNode(graph, "r1", "running", NOW);
    graph = completeNode(graph, "r1", {
      summary: "found sources",
      artifacts: [],
      evidence: [],
      newFacts: [],
      confidence: 0.5,
    }, NOW);

    const result = evaluateCompletionGate(graph);
    expect(result.canComplete).toBe(true);
  });
});

describe("M4 — extractToolEvidence handles zero totals", () => {
  test("0 pass 0 fail does not produce NaN confidence", () => {
    const ev = extractToolEvidence({ tool: "bash", command: "bun test", output: "0 pass 0 fail", exitCode: 0 });
    expect(ev).not.toBeNull();
    expect(Number.isNaN(ev!.confidence)).toBe(false);
  });

  test("case-insensitive tool name records evidence", () => {
    const ev = extractToolEvidence({ tool: "BASH", command: "bun test", output: "10 pass 0 fail", exitCode: 0 });
    expect(ev).not.toBeNull();
  });
});

describe("M2 — review/audit intent wins over incidental keywords", () => {
  test("audit request routes to review, not bugfix", () => {
    const result = scoreIntent("audit JCE-Worker, its skills and orchestration, find issues");
    expect(result.intent).toBe("review");
  });

  test("Indonesian 'cari kekurangan' routes to review", () => {
    const result = scoreIntent("audit agent JCE-Worker beserta skillnya dan orchestrationnya cari kekurangan");
    expect(result.intent).toBe("review");
  });
});

describe("#1 — shared staleness authority (v1 + v2 single source of truth)", () => {
  test("graph and workflow share the same TTL constant", () => {
    expect(STALE_TTL_MS).toBe(6 * 60 * 60 * 1000);
  });

  test("isStaleTimestamp treats missing/invalid/old as stale, recent as fresh", () => {
    expect(isStaleTimestamp(undefined, NOW_MS)).toBe(true);
    expect(isStaleTimestamp("not-a-date", NOW_MS)).toBe(true);
    expect(isStaleTimestamp(new Date(NOW_MS - 48 * 60 * 60 * 1000).toISOString(), NOW_MS)).toBe(true);
    expect(isStaleTimestamp(new Date(NOW_MS - 60 * 1000).toISOString(), NOW_MS)).toBe(false);
  });

  test("graph restore and workflow drop agree on the same stale input", () => {
    const staleAt = new Date(NOW_MS - 48 * 60 * 60 * 1000).toISOString();
    // v2: stale non-terminal graph must NOT restore
    expect(shouldRestorePersistedGraph({ status: "executing", updatedAt: staleAt }, NOW_MS)).toBe(false);
    // v1: same stale timestamp, no active tasks -> must drop
    expect(shouldDropPersistedWorkflow({ status: "verifying", updatedAt: staleAt, hasActiveTasks: false }, NOW_MS)).toBe(true);
  });

  test("v1 workflow with active tasks is preserved even when stale (runtime session)", () => {
    const staleAt = new Date(NOW_MS - 48 * 60 * 60 * 1000).toISOString();
    expect(shouldDropPersistedWorkflow({ status: "verifying", updatedAt: staleAt, hasActiveTasks: true }, NOW_MS)).toBe(false);
  });

  test("v1 terminal workflow is dropped even if recent (work finished)", () => {
    const recent = new Date(NOW_MS - 60 * 1000).toISOString();
    expect(shouldDropPersistedWorkflow({ status: "completed", updatedAt: recent, hasActiveTasks: false }, NOW_MS)).toBe(true);
  });

  test("v1 recent non-terminal workflow without tasks is preserved", () => {
    const recent = new Date(NOW_MS - 60 * 1000).toISOString();
    expect(shouldDropPersistedWorkflow({ status: "ready", updatedAt: recent, hasActiveTasks: false }, NOW_MS)).toBe(false);
  });
});
