import { describe, expect, test } from "bun:test";
import {
  recordFailurePattern,
  queryFailurePattern,
  formatFailureWarning,
  pruneFailurePatterns,
} from "../../src/plugin/lib/orchestration/failure-pattern-store.js";
import {
  recordStrategyOutcome,
  computeStrategyStats,
  recommendStrategy,
  selectStrategyWithTelemetry,
} from "../../src/plugin/lib/orchestration/strategy-telemetry.js";
import {
  matchWorkflowTemplate,
  instantiateWorkflowTemplate,
  listWorkflowTemplates,
} from "../../src/plugin/lib/orchestration/workflow-templates.js";
import {
  evaluatePhaseGates,
  assessAdaptiveComplexity,
} from "../../src/plugin/lib/orchestration/intelligence.js";
import { createTaskGraph, addNode, completeNode, transitionNode } from "../../src/plugin/lib/orchestration/task-graph.js";
import type { ScoredIntent } from "../../src/plugin/lib/orchestration/types.js";

const NOW = "2026-01-01T00:00:00.000Z";

function makeIntent(intent: ScoredIntent["intent"]): ScoredIntent {
  return { intent, score: 1, confidence: 0.8, signals: [], skills: ["software-engineering"] };
}

describe("failure pattern store", () => {
  test("records a novel failure and queries it back by signature", () => {
    const after = recordFailurePattern(undefined, { command: "bun test", errorClass: "TypeError", file: "src/a.ts", rootCause: "null deref" }, NOW);
    expect(after).toHaveLength(1);
    const match = queryFailurePattern(after, { command: "bun test", errorClass: "TypeError", file: "src/a.ts" });
    expect(match?.rootCause).toBe("null deref");
  });

  test("tracks bad fixes and a winning fix category", () => {
    let p = recordFailurePattern(undefined, { errorClass: "hilt", fixCategory: "add dependency", fixSucceeded: false }, NOW);
    p = recordFailurePattern(p, { errorClass: "hilt", fixCategory: "add @InstallIn scope", fixSucceeded: true }, NOW);
    const match = queryFailurePattern(p, { errorClass: "hilt" });
    expect(match?.fixCategory).toBe("add @InstallIn scope");
    expect(match?.badFixes).toContain("add dependency");
    expect(match?.successCount).toBe(1);
    expect(match?.failCount).toBe(1);
  });

  test("formats a proactive warning with root cause and bad fixes", () => {
    const p = recordFailurePattern(undefined, { errorClass: "x", rootCause: "missing scope", fixCategory: "add scope", fixSucceeded: true }, NOW);
    const warned = recordFailurePattern(p, { errorClass: "x", fixCategory: "reinstall", fixSucceeded: false }, NOW);
    const match = queryFailurePattern(warned, { errorClass: "x" });
    const msg = formatFailureWarning(match);
    expect(msg).toContain("missing scope");
    expect(msg).toContain("Do NOT repeat");
    expect(msg).toContain("reinstall");
  });

  test("query returns null for novel failure", () => {
    expect(queryFailurePattern([], { errorClass: "nope" })).toBeNull();
    expect(formatFailureWarning(null)).toBe("");
  });

  test("prune keeps most recent and caps size", () => {
    let p: ReturnType<typeof recordFailurePattern> = [];
    for (let i = 0; i < 120; i++) {
      p = recordFailurePattern(p, { errorClass: `e${i}` }, new Date(2026, 0, 1, 0, i).toISOString());
    }
    expect(pruneFailurePatterns(p).length).toBeLessThanOrEqual(100);
  });
});

describe("strategy telemetry", () => {
  test("computes success rate per intent/strategy", () => {
    let t = recordStrategyOutcome(undefined, { intent: "feature", strategy: "multi-phase", outcome: "success" });
    t = recordStrategyOutcome(t, { intent: "feature", strategy: "multi-phase", outcome: "success" });
    t = recordStrategyOutcome(t, { intent: "feature", strategy: "multi-phase", outcome: "failed" });
    const stats = computeStrategyStats(t, "feature");
    const mp = stats.find((s) => s.strategy === "multi-phase");
    expect(mp?.attempts).toBe(3);
    expect(mp?.successes).toBe(2);
    expect(mp?.successRate).toBeCloseTo(0.67, 1);
  });

  test("does not bias strategy below sample threshold", () => {
    const t = recordStrategyOutcome(undefined, { intent: "refactor", strategy: "multi-phase", outcome: "success" });
    const rec = recommendStrategy(t, "refactor");
    expect(rec.recommended).toBeNull();
  });

  test("recommends a strategy once enough samples exist", () => {
    let t: ReturnType<typeof recordStrategyOutcome> = [];
    for (let i = 0; i < 5; i++) t = recordStrategyOutcome(t, { intent: "feature", strategy: "multi-phase", outcome: "success" });
    const rec = recommendStrategy(t, "feature");
    expect(rec.recommended).toBe("multi-phase");
    expect(rec.confidence).toBeGreaterThan(0.5);
  });

  test("telemetry overrides rule-based strategy only with high confidence", () => {
    let t: ReturnType<typeof recordStrategyOutcome> = [];
    for (let i = 0; i < 10; i++) t = recordStrategyOutcome(t, { intent: "migration" as any, strategy: "multi-phase", outcome: "success" });
    const decision = selectStrategyWithTelemetry("direct", "migration" as any, t);
    expect(decision.strategy).toBe("multi-phase");
    expect(decision.source).toBe("telemetry");

    const noData = selectStrategyWithTelemetry("plan-then-exec", "bugfix", []);
    expect(noData.strategy).toBe("plan-then-exec");
    expect(noData.source).toBe("rule");
  });
});

describe("workflow templates", () => {
  test("lists templates without leaking internal steps", () => {
    const templates = listWorkflowTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(5);
    expect((templates[0] as any).steps).toBeUndefined();
  });

  test("matches release goal and instantiates phased nodes with edges", () => {
    const matched = matchWorkflowTemplate("prepare a release for v2.0");
    expect(matched?.id).toBe("release");
    const inst = instantiateWorkflowTemplate("release", "prepare a release for v2.0");
    expect(inst).not.toBeNull();
    expect(inst!.nodes.length).toBeGreaterThanOrEqual(4);
    expect(inst!.edges.length).toBeGreaterThan(0);
    // verify node carries template metadata
    expect(inst!.nodes.every((n) => (n.metadata as any)?.workflowTemplate === "release")).toBe(true);
  });

  test("does not match incidental nouns (migration false positive guard)", () => {
    const matched = matchWorkflowTemplate("First update schema, then wire API, then verify migration");
    expect(matched).toBeNull();
  });

  test("matches genuine migration phrasing", () => {
    expect(matchWorkflowTemplate("migrate from Express to Fastify")?.id).toBe("migration");
  });
});

describe("phase gates", () => {
  test("flags progress in a later phase while an earlier phase is unsatisfied", () => {
    let g = createTaskGraph({ id: "g1", goal: "x", now: NOW });
    g = addNode(g, { id: "impl", type: "code", title: "build", description: "", agent: "self", prompt: "p" }, NOW);
    g = addNode(g, { id: "stage", type: "review", title: "stage", description: "", agent: "self", prompt: "p" }, NOW);
    // Stage done but implement not done → violation
    g = transitionNode(g, "stage", "pending", NOW);
    g = transitionNode(g, "stage", "ready", NOW);
    g = transitionNode(g, "stage", "running", NOW);
    g = completeNode(g, "stage", { summary: "s", artifacts: [], evidence: [], newFacts: [], confidence: 0.9 }, NOW);
    const report = evaluatePhaseGates(g);
    expect(report.canAdvanceToComplete).toBe(false);
    expect(report.violations.length).toBeGreaterThan(0);
  });
});

describe("adaptive complexity", () => {
  test("irreversible action forces CRITICAL + user-gate", () => {
    const r = assessAdaptiveComplexity("deploy to production", makeIntent("release"), { irreversible: true });
    expect(r.level).toBe("CRITICAL");
    expect(r.strategy).toBe("user-gate");
  });

  test("many changed files escalates to HIGH + multi-phase", () => {
    const r = assessAdaptiveComplexity("update modules", makeIntent("refactor"), { changedFiles: 8 });
    expect(r.level).toBe("HIGH");
    expect(r.strategy).toBe("multi-phase");
  });

  test("trivial single-file change stays LOW + direct", () => {
    const r = assessAdaptiveComplexity("fix typo", makeIntent("bugfix"), { changedFiles: 1, hasTestCoverage: true });
    expect(r.level).toBe("LOW");
    expect(r.strategy).toBe("direct");
  });
});
