import { describe, expect, test } from "bun:test";
import { classifyJceWorkerError } from "../../src/plugin/lib/error-taxonomy.ts";

describe("JCE-Worker error taxonomy", () => {
  test.each([
    ["missing_access", "API returned 401 unauthorized access denied"],
    ["user_approval_required", "approval required before continuing"],
    ["verification_failed", "test failed with 2 failures"],
    ["transient_network", "network timeout rate limit service unavailable"],
    ["merge_conflict", "merge conflict in src/index.ts"],
    ["ambiguous_requirement", "unclear requirement, ambiguous scope"],
    ["tool_failure", "tool execution failed with exit code 1"],
    ["delegated_contract_failure", "missing required sections Summary Files Verification Risks"],
    ["unknown", "something unexpected happened"],
  ] as const)("classifies %s", (expected, text) => {
    const result = classifyJceWorkerError(text);

    expect(result.category).toBe(expected);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  test("uses first matching high-priority category", () => {
    const result = classifyJceWorkerError("approval required after test failed");

    expect(result.category).toBe("user_approval_required");
  });

  test.each([
    ["unknown", "generic runtime failure happened"],
    ["delegated_contract_failure", "missing required sections with failure details"],
    ["verification_failed", "tool execution failed with verification failed output"],
    ["tool_failure", "command failed with exit code 1"],
    ["verification_failed", "test failed with 2 failures"],
    ["verification_failed", "test failed: expected 401 unauthorized"],
    ["merge_conflict", "build failed because merge conflict marker remained"],
    ["ambiguous_requirement", "ambiguous requirement caused verification failed"],
    ["tool_failure", "command timed out while running local tests"],
    ["transient_network", "network timeout while fetching package"],
    ["unknown", "temporary file failure"],
  ] as const)("classifies overlap case as %s", (expected, text) => {
    const result = classifyJceWorkerError(text);

    expect(result.category).toBe(expected);
  });
});
