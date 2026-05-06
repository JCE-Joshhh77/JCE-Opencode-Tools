import { describe, expect, test } from "bun:test";
import { buildExecutionSummary } from "../../src/plugin/lib/execution-summary.ts";

describe("plugin execution summary", () => {
  test("includes status, files, verification, risks, retries, and trace highlights", () => {
    const summary = buildExecutionSummary({
      status: "completed",
      files: ["src/plugin/lib/review.ts"],
      verification: ["bun test tests/unit/plugin-review.test.ts: 4 pass"],
      risks: ["none"],
      blockers: [],
      retries: ["bg-1 retry 1 after timeout"],
      traceHighlights: ["task.created", "task.completed"],
    });

    expect(summary).toContain("## Status");
    expect(summary).toContain("completed");
    expect(summary).toContain("src/plugin/lib/review.ts");
    expect(summary).toContain("bun test");
    expect(summary).toContain("bg-1 retry 1");
  });

  test("explicitly states when verification was not run", () => {
    const summary = buildExecutionSummary({
      status: "blocked",
      files: [],
      verification: [],
      risks: ["integration behavior unverified"],
      blockers: ["missing credentials"],
      retries: [],
      traceHighlights: [],
    });

    expect(summary).toContain("Verification not run");
    expect(summary).toContain("missing credentials");
  });
});
