import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { OrchestrationController } from "../../src/plugin/lib/orchestration/controller.js";
import {
  evaluateCompletionGate,
  evaluatePhaseGates,
  formatPhaseGateReport,
  assessAdaptiveComplexity,
  formatAdaptiveComplexity,
} from "../../src/plugin/lib/orchestration/intelligence.js";
import { formatStrategyStats, computeStrategyStats, recordStrategyOutcome } from "../../src/plugin/lib/orchestration/strategy-telemetry.js";
import { createTaskGraph, addNode, transitionNode, completeNode } from "../../src/plugin/lib/orchestration/task-graph.js";
import type { ScoredIntent } from "../../src/plugin/lib/orchestration/types.js";

const NOW = "2026-01-01T00:00:00.000Z";

function makeIntent(intent: ScoredIntent["intent"]): ScoredIntent {
  return { intent, score: 1, confidence: 0.8, signals: [], skills: ["software-engineering"] };
}

describe("controller failure -> retry -> warn round-trip (Fix 4)", () => {
  test("records a failure pattern and injects a proactive warning on retry dispatch", () => {
    const root = mkdtempSync(join(tmpdir(), "orch-fix4-"));
    try {
      const controller = new OrchestrationController({ projectRoot: root, now: () => NOW });
      controller.createPlan("trivial groundwork task to seed a graph", makeIntent("bugfix"));

      // Add a controllable, dependency-free code node targeting a specific file.
      // High priority so it wins the single `self` concurrency slot over any
      // generated plan node on the first dispatch tick.
      controller.addNodeToGraph({
        id: "fix-node",
        type: "code",
        title: "patch null guard in parser",
        description: "fix",
        agent: "self",
        prompt: "implement the fix",
        priority: 100,
        metadata: { file: "src/parser.ts" },
      });

      // First dispatch: node goes running; no warning on attempt 0.
      const first = controller.getNextDispatch();
      const firstNode = first.find((d) => d.nodeId === "fix-node");
      expect(firstNode).toBeDefined();
      expect(firstNode!.prompt).not.toContain("Known failure pattern");

      // Fail it with a retryable (verification) reason.
      const outcome = controller.handleFailure("fix-node", "test failed: assertion error in parser");
      expect(outcome.action).toBe("retry");

      // A structured failure pattern was recorded for this node.
      const patterns = controller.getFailurePatterns();
      expect(patterns.length).toBeGreaterThan(0);
      const recorded = patterns.find((p) => p.badFixes.includes("patch null guard in parser") || p.rootCause?.includes("assertion error"));
      expect(recorded).toBeDefined();

      // Second dispatch: same node now on retry → proactive warning injected.
      const second = controller.getNextDispatch();
      const retryNode = second.find((d) => d.nodeId === "fix-node");
      expect(retryNode).toBeDefined();
      expect(retryNode!.prompt).toContain("Known failure pattern");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("phase-gate enforcement (Fix 2)", () => {
  test("out-of-order phase progress BLOCKS the completion gate", () => {
    // STAGING (review) done while IMPLEMENTING (code) is not → violation.
    let g = createTaskGraph({ id: "pg1", goal: "x", now: NOW });
    g = addNode(g, { id: "impl", type: "code", title: "build", description: "", agent: "self", prompt: "p" }, NOW);
    g = addNode(g, { id: "stage", type: "review", title: "stage", description: "", agent: "self", prompt: "p" }, NOW);
    g = transitionNode(g, "stage", "pending", NOW);
    g = transitionNode(g, "stage", "ready", NOW);
    g = transitionNode(g, "stage", "running", NOW);
    g = completeNode(g, "stage", { summary: "s", artifacts: [], evidence: [], newFacts: [], confidence: 0.9 }, NOW);

    const phase = evaluatePhaseGates(g);
    expect(phase.violations.length).toBeGreaterThan(0);

    const gate = evaluateCompletionGate(g);
    expect(gate.canComplete).toBe(false);
    expect(gate.blockers.some((b) => b.includes("Phase-gate violation"))).toBe(true);
  });

  test("REGRESSION (audit 2026-09-26): non-adjacent phase skips are also violations", () => {
    // PLANNING pending, IMPLEMENTING done (satisfied), TESTING done.
    // The old check compared only against phases[i-1], so TESTING's progress
    // passed silently — only the IMPLEMENTING violation was reported.
    let g = createTaskGraph({ id: "pg4", goal: "x", now: NOW });
    g = addNode(g, { id: "plan", type: "research", title: "map", description: "", agent: "explorer", prompt: "p" }, NOW);
    g = addNode(g, { id: "impl", type: "code", title: "build", description: "", agent: "self", prompt: "p" }, NOW);
    g = addNode(g, { id: "test", type: "verify", title: "verify", description: "", agent: "self", prompt: "p" }, NOW);
    for (const id of ["impl", "test"]) {
      g = transitionNode(g, id, "pending", NOW);
      g = transitionNode(g, id, "ready", NOW);
      g = transitionNode(g, id, "running", NOW);
      g = completeNode(g, id, { summary: "s", artifacts: [], evidence: [], newFacts: [], confidence: 0.9 }, NOW);
    }
    // plan-1 stays pending.

    const report = evaluatePhaseGates(g);
    expect(report.currentPhase).toBe("PLANNING");
    expect(report.violations.some((v) => v.startsWith("TESTING has progress but PLANNING is not satisfied"))).toBe(true);
    expect(report.blockedPhases).toContain("TESTING");

    // The completion gate must stay blocked by the phase violation.
    const gate = evaluateCompletionGate(g);
    expect(gate.canComplete).toBe(false);
    expect(gate.blockers.some((b) => b.includes("TESTING has progress but PLANNING"))).toBe(true);
  });
});

describe("formatter coverage (Fix: untested formatters)", () => {
  test("formatPhaseGateReport renders phases and violations", () => {
    let g = createTaskGraph({ id: "pg2", goal: "x", now: NOW });
    g = addNode(g, { id: "impl", type: "code", title: "build", description: "", agent: "self", prompt: "p" }, NOW);
    const report = evaluatePhaseGates(g);
    const text = formatPhaseGateReport(report);
    expect(text).toContain("Phase Gates");
    expect(text).toContain("IMPLEMENTING");
  });

  test("formatPhaseGateReport returns empty for a graph with no phased work", () => {
    const g = createTaskGraph({ id: "pg3", goal: "x", now: NOW });
    expect(formatPhaseGateReport(evaluatePhaseGates(g))).toBe("");
  });

  test("formatAdaptiveComplexity renders level and strategy", () => {
    const r = assessAdaptiveComplexity("deploy to production", makeIntent("release"), { irreversible: true });
    const text = formatAdaptiveComplexity(r);
    expect(text).toContain("CRITICAL");
    expect(text).toContain("user-gate");
  });

  test("formatStrategyStats renders rows and handles empty input", () => {
    expect(formatStrategyStats([])).toContain("No strategy telemetry");
    let t = recordStrategyOutcome(undefined, { intent: "feature", strategy: "multi-phase", outcome: "success" });
    t = recordStrategyOutcome(t, { intent: "feature", strategy: "multi-phase", outcome: "failed" });
    const text = formatStrategyStats(computeStrategyStats(t, "feature"));
    expect(text).toContain("feature/multi-phase");
  });
});
