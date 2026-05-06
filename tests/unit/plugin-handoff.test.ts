import { describe, expect, test } from "bun:test";
import { buildHandoffReport, validateHandoffReport } from "../../src/plugin/lib/handoff.ts";

describe("plugin handoff", () => {
  test("builds a blocked handoff report with required sections", () => {
    const report = buildHandoffReport({
      status: "blocked",
      completed: ["Implemented policy helpers", "Ran focused tests"],
      blocker: "Missing credentials for the target service.",
      evidence: ["API call returned 401 Unauthorized"],
      nextOptions: ["Provide credentials", "Skip integration verification and accept risk"],
    });

    expect(report).toContain("## Status");
    expect(report).toContain("blocked");
    expect(report).toContain("## Completed");
    expect(report).toContain("Missing credentials");
    expect(validateHandoffReport(report).valid).toBe(true);
  });

  test("rejects handoff reports missing evidence", () => {
    const validation = validateHandoffReport("## Status\nblocked\n\n## Completed\n- done\n\n## Blocker\nmissing\n\n## Next Options\n- retry");
    expect(validation.valid).toBe(false);
    expect(validation.missing).toContain("Evidence");
  });
});
