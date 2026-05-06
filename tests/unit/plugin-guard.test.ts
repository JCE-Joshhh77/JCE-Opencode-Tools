import { describe, expect, test } from "bun:test";
import { shouldWarnForMissingVerification, VERIFICATION_WARNING } from "../../src/plugin/hooks/jce-worker-guard.ts";

describe("JCE-Worker guard", () => {
  test("warns when completion claim lacks verification evidence", () => {
    const text = "Implemented the fix and everything is complete.";
    expect(shouldWarnForMissingVerification(text)).toBe(true);
    expect(VERIFICATION_WARNING).toContain("verification");
  });

  test("does not warn when verification evidence is present", () => {
    const text = "Implemented the fix. Verification: bun test (pass), bun run typecheck (pass).";
    expect(shouldWarnForMissingVerification(text)).toBe(false);
  });
});
