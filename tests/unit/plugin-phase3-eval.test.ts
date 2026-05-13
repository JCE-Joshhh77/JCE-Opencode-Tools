import { describe, expect, test } from "bun:test";
import { formatEvalScenarios, runEvalScenarios } from "../../src/plugin/lib/phase3-eval.ts";

describe("phase 3 eval scenarios", () => {
  test("defines core JCE-Worker behavioral scenarios", () => {
    const results = runEvalScenarios();

    expect(results.map((result) => result.id)).toEqual(["audit-full-plugin", "release-flow", "delegation-evidence"]);
    expect(results.every((result) => result.passed)).toBe(true);
  });

  test("formats scenario eval score", () => {
    expect(formatEvalScenarios()).toContain("Score: 3/3");
  });
});
