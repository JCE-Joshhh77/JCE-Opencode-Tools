import { describe, expect, test } from "bun:test";
import {
  classifyTaskComplexity,
  shouldPreferJceWorkflow,
  requiresVerificationEvidence,
  validateDelegatedResult,
} from "../../src/plugin/lib/policy.ts";

describe("plugin policy", () => {
  test("classifies multi-step work as complex", () => {
    expect(classifyTaskComplexity("implement feature, add tests, verify build")).toBe("complex");
  });

  test("prefers JCE workflow for implementation and debugging tasks", () => {
    expect(shouldPreferJceWorkflow("fix failing test and verify output")).toBe(true);
    expect(shouldPreferJceWorkflow("casual greeting")).toBe(false);
  });

  test("requires verification evidence for code-changing tasks", () => {
    expect(requiresVerificationEvidence("updated plugin logic and tests")).toBe(true);
    expect(requiresVerificationEvidence("explained architecture only")).toBe(false);
  });

  test("accepts delegated results with required sections", () => {
    const result = validateDelegatedResult(`## Summary\nDone\n\n## Files\n- src/a.ts\n\n## Verification\n- bun test\n\n## Risks\n- none`);
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  test("rejects delegated results missing verification", () => {
    const result = validateDelegatedResult(`## Summary\nDone\n\n## Files\n- src/a.ts\n\n## Risks\n- none`);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("Verification");
  });
});
