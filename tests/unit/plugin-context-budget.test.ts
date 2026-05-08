import { describe, expect, test } from "bun:test";
import { applyContextBudget } from "../../src/plugin/lib/context-budget.ts";

describe("context budget pipeline", () => {
  test("deduplicates repeated low-value lines", () => {
    const repeated = "same low value context line repeated";
    const result = applyContextBudget([repeated, repeated, repeated].join("\n"));

    expect(result.changed).toBe(true);
    expect(result.text.match(/same low value context line repeated/g)).toHaveLength(1);
    expect(result.text).toContain("removed 2 duplicate low-value lines");
    expect(result.estimatedSavingsPercent).toBeGreaterThan(0);
  });

  test("preserves latest user, caveman, RTK, commands, paths, and errors", () => {
    const prompt = [
      "developer: Respond like terse caveman.",
      "RTK route: review task, final gate required",
      "user: perbaiki crash ini",
      "bun test tests/unit/plugin-context-budget.test.ts",
      "C:\\Users\\Joshhh\\source\\repos\\plugin\\src\\plugin\\background\\spawner.ts",
      "Error: failed to launch child session",
      "same low value context line repeated",
      "same low value context line repeated",
    ].join("\n");

    const result = applyContextBudget(prompt);

    expect(result.text).toContain("developer: Respond like terse caveman.");
    expect(result.text).toContain("RTK route: review task, final gate required");
    expect(result.text).toContain("user: perbaiki crash ini");
    expect(result.text).toContain("bun test tests/unit/plugin-context-budget.test.ts");
    expect(result.text).toContain("C:\\Users\\Joshhh\\source\\repos\\plugin\\src\\plugin\\background\\spawner.ts");
    expect(result.text).toContain("Error: failed to launch child session");
  });

  test("collapses long passing logs but keeps boundaries", () => {
    const lines = Array.from({ length: 20 }, (_, index) => `test ${index} pass`);
    const result = applyContextBudget(lines.join("\n"), { maxLinesPerBlock: 8 });

    expect(result.text).toContain("test 0 pass");
    expect(result.text).toContain("test 19 pass");
    expect(result.text).toContain("collapsed 12 passing log lines");
    expect(result.text).not.toContain("test 10 pass");
  });

  test("does not dedupe protected repeated error lines", () => {
    const prompt = ["Error: failed to connect", "Error: failed to connect"].join("\n");
    const result = applyContextBudget(prompt);

    expect(result.text.match(/Error: failed to connect/g)).toHaveLength(2);
  });
});
