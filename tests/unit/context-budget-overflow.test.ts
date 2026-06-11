import { describe, expect, test } from "bun:test";
import { sanitizeContextBudgetSummary } from "../../src/plugin/lib/runtime-state.ts";

describe("context budget overflow protection", () => {
  test("sanitizes absurd token savings totals to finite safe integers", () => {
    const result = sanitizeContextBudgetSummary({
      originalChars: Number.MAX_VALUE,
      compressedChars: Number.MAX_VALUE,
      estimatedTokensSaved: Number.MAX_VALUE,
      estimatedSavingsPercent: Number.MAX_VALUE,
      tasks: Number.MAX_VALUE,
      byTool: {
        bash: {
          originalChars: Number.MAX_VALUE,
          compressedChars: Number.MAX_VALUE,
          estimatedTokensSaved: Number.MAX_VALUE,
          tasks: Number.MAX_VALUE,
        },
      },
    });

    expect(result?.estimatedTokensSaved).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(result?.tasks).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(result?.estimatedSavingsPercent).toBeLessThanOrEqual(100);
  });
});
