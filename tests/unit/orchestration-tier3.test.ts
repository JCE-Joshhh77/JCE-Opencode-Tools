import { describe, expect, test } from "bun:test";
import { buildRiskHeatmap, getFileRisk, formatRiskWarning } from "../../src/plugin/lib/orchestration/risk-heatmap.js";
import { recordFailurePattern } from "../../src/plugin/lib/orchestration/failure-pattern-store.js";
import { planSpeculativePrefetch, formatSpeculativePlan } from "../../src/plugin/lib/orchestration/speculative-prefetch.js";
import {
  listDelegationScenarios,
  buildScenarioEnvelopeInput,
  matchDelegationScenario,
} from "../../src/plugin/lib/orchestration/delegation-scenarios.js";
import { buildDelegationEnvelope, formatDelegationEnvelope } from "../../src/plugin/lib/delegation-envelope.js";

const NOW = "2026-01-01T00:00:00.000Z";

describe("risk heatmap", () => {
  test("flags a file as high risk when failures dominate", () => {
    let p: ReturnType<typeof recordFailurePattern> = [];
    // Same file, repeated failures, no success.
    p = recordFailurePattern(p, { file: "src/hot.ts", errorClass: "e1", fixCategory: "a", fixSucceeded: false }, NOW);
    p = recordFailurePattern(p, { file: "src/hot.ts", errorClass: "e2", fixCategory: "b", fixSucceeded: false }, NOW);
    p = recordFailurePattern(p, { file: "src/hot.ts", errorClass: "e3", fixCategory: "c", fixSucceeded: false }, NOW);
    const heatmap = buildRiskHeatmap(p);
    const risk = getFileRisk(heatmap, "src/hot.ts");
    expect(risk?.level).toBe("high");
    expect(heatmap.dangerousAreas).toContain("src/hot.ts");
    expect(formatRiskWarning(risk)).toContain("High-risk file");
  });

  test("a file with mostly successful fixes is low risk", () => {
    let p: ReturnType<typeof recordFailurePattern> = [];
    p = recordFailurePattern(p, { file: "src/ok.ts", errorClass: "e1", fixCategory: "fix", fixSucceeded: false }, NOW);
    p = recordFailurePattern(p, { file: "src/ok.ts", errorClass: "e1", fixCategory: "fix", fixSucceeded: true }, NOW);
    p = recordFailurePattern(p, { file: "src/ok.ts", errorClass: "e1", fixCategory: "fix", fixSucceeded: true }, NOW);
    const heatmap = buildRiskHeatmap(p);
    const risk = getFileRisk(heatmap, "src/ok.ts");
    expect(risk?.level).toBe("low");
    expect(formatRiskWarning(risk)).toBe("");
  });

  test("ignores patterns without a file and handles empty input", () => {
    expect(buildRiskHeatmap(undefined).files).toEqual([]);
    const p = recordFailurePattern([], { errorClass: "no-file", fixSucceeded: false }, NOW);
    expect(buildRiskHeatmap(p).files).toEqual([]);
  });
});

describe("speculative pre-fetch", () => {
  test("suggests read-only exploration for a feature goal", () => {
    const plan = planSpeculativePrefetch("Implement a new billing dashboard with charts", "feature");
    expect(plan.worthwhile).toBe(true);
    expect(plan.tasks.some((t) => t.agent === "explorer")).toBe(true);
    expect(plan.tasks.every((t) => /read-only|do not modify|report/i.test(t.prompt))).toBe(true);
  });

  test("suggests version research when deps are mentioned", () => {
    const plan = planSpeculativePrefetch("Upgrade the React framework to the latest version", "refactor");
    expect(plan.tasks.some((t) => t.agent === "jce-researcher")).toBe(true);
  });

  test("skips trivial goals", () => {
    const plan = planSpeculativePrefetch("fix typo", "bugfix");
    expect(plan.worthwhile).toBe(false);
    expect(formatSpeculativePlan(plan)).toBe("");
  });

  test("never suggests more than 2 speculative tasks", () => {
    const plan = planSpeculativePrefetch("Migrate and upgrade the entire API framework and dependencies", "refactor");
    expect(plan.tasks.length).toBeLessThanOrEqual(2);
  });
});

describe("delegation scenarios", () => {
  test("lists presets without leaking build fn", () => {
    const list = listDelegationScenarios();
    expect(list.length).toBeGreaterThanOrEqual(6);
    expect((list[0] as any).build).toBeUndefined();
  });

  test("builds a security-audit envelope input usable by buildDelegationEnvelope", () => {
    const input = buildScenarioEnvelopeInput("security-audit", "audit the auth module");
    expect(input).not.toBeNull();
    const envelope = buildDelegationEnvelope(input!);
    const text = formatDelegationEnvelope(envelope);
    expect(text).toContain("MUST DO");
    expect(text).toContain("severity");
    expect(envelope.agent).toBe("oracle");
  });

  test("matches free-text goals to the right scenario", () => {
    expect(matchDelegationScenario("there is a security vulnerability in login")).toBe("security-audit");
    expect(matchDelegationScenario("the page is really slow to load")).toBe("performance-review");
    expect(matchDelegationScenario("migrate from Express to Fastify")).toBe("migration-plan");
    expect(matchDelegationScenario("upgrade the lodash dependency")).toBe("dependency-upgrade");
    expect(matchDelegationScenario("the app crashes on startup")).toBe("bug-investigation");
    expect(matchDelegationScenario("write a poem")).toBeNull();
  });
});
