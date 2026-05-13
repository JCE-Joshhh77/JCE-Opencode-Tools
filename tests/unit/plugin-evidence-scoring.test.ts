import { describe, expect, test } from "bun:test";
import { scoreDelegatedEvidence } from "../../src/plugin/lib/evidence-scoring.ts";

describe("delegated evidence scoring", () => {
  test("scores strong delegated evidence with command verification", () => {
    const score = scoreDelegatedEvidence("## Summary\nDone\n\n## Files\n- src/a.ts\n\n## Verification\n- bun test passed\n\n## Risks\n- none");

    expect(score).toMatchObject({ evidenceStrength: "strong", needsFollowUp: false });
  });

  test("requires follow-up when verification is missing or not run", () => {
    const score = scoreDelegatedEvidence("## Summary\nDone\n\n## Files\n- none\n\n## Verification\n- not run\n\n## Risks\n- none");

    expect(score.evidenceStrength).toBe("none");
    expect(score.needsFollowUp).toBe(true);
  });
});
