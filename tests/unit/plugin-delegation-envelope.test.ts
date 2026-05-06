import { describe, expect, test } from "bun:test";
import { buildDelegationEnvelope, formatDelegationEnvelope } from "../../src/plugin/lib/delegation-envelope.ts";

describe("delegation envelope", () => {
  test("formats task envelope with goal, scope, constraints, verification, and contract", () => {
    const envelope = buildDelegationEnvelope({
      goal: "Inspect runtime recovery",
      prompt: "Check retry behavior",
      agent: "explorer",
      expectedVerification: ["bun test tests/unit/plugin-tools-recovery.test.ts"],
      allowedFiles: ["src/plugin/tools/dispatch.ts"],
      constraints: ["Do not commit"],
    });

    const text = formatDelegationEnvelope(envelope);

    expect(text).toContain("## Goal\nInspect runtime recovery");
    expect(text).toContain("## Scope\nCheck retry behavior");
    expect(text).toContain("## Non-Goals\n- Do not modify unrelated files");
    expect(text).toContain("## Constraints\n- Do not commit");
    expect(text).toContain("## Allowed Files\n- src/plugin/tools/dispatch.ts");
    expect(text).toContain("## Expected Verification\n- bun test tests/unit/plugin-tools-recovery.test.ts");
    expect(text).toContain("## Output Contract");
    expect(text).toContain("## Summary");
    expect(envelope.outputContract).toContain("## Summary");
    expect(envelope.outputContract).toContain("## Verification");
    expect(text.slice(text.indexOf("## Output Contract") + "## Output Contract\n".length)).toBe(envelope.outputContract);
  });

  test("uses safe defaults when optional fields are omitted", () => {
    const text = formatDelegationEnvelope(buildDelegationEnvelope({
      goal: "Research CLI state",
      prompt: "Inspect status command",
      agent: "explorer",
    }));

    expect(text).toContain("## Allowed Files\n- unrestricted");
    expect(text).toContain("## Expected Verification\n- report inspected files and confidence");
    expect(text).toContain("## Constraints\n- Preserve existing user changes");
  });

  test("deduplicates constraints and verification commands", () => {
    const envelope = buildDelegationEnvelope({
      goal: "Check tests",
      prompt: "Run tests",
      agent: "explorer",
      constraints: ["Do not commit", "Do not commit"],
      expectedVerification: ["bun test", "bun test"],
    });

    expect(envelope.constraints.filter((item) => item === "Do not commit")).toHaveLength(1);
    expect(envelope.expectedVerification.filter((item) => item === "bun test")).toHaveLength(1);
  });
});
