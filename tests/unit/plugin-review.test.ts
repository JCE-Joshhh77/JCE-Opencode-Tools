import { describe, expect, test } from "bun:test";
import { classifyDelegatedReview } from "../../src/plugin/lib/review.ts";

const completeResult = `## Summary
Done

## Files
- src/a.ts

## Verification
- bun test passed

## Risks
- none`;

describe("plugin review", () => {
  test("accepts complete delegated output", () => {
    const review = classifyDelegatedReview(completeResult);
    expect(review.status).toBe("accepted");
    expect(review.missing).toHaveLength(0);
  });

  test("marks missing contract sections as needs followup", () => {
    const review = classifyDelegatedReview("## Summary\nDone");
    expect(review.status).toBe("needs_followup");
    expect(review.missing).toContain("Files");
    expect(review.notes.join(" ")).toContain("Missing required sections");
  });

  test("marks access and approval issues as blocked", () => {
    const review = classifyDelegatedReview(`${completeResult}\nBlocked: missing credentials and user approval required.`);
    expect(review.status).toBe("blocked");
    expect(review.notes.join(" ")).toContain("blocked");
  });

  test("marks transient failures as retryable", () => {
    const review = classifyDelegatedReview(`${completeResult}\nNetwork timeout from provider, retry may succeed.`);
    expect(review.status).toBe("retryable_failure");
    expect(review.retryable).toBe(true);
  });
});
