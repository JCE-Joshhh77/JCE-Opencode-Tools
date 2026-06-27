import { describe, expect, test } from "bun:test";
import { looksLikeCompletionClaim, looksLikeStopEarlyOrConfirmation, shouldWarnForMissingVerification, VERIFICATION_WARNING } from "../../src/plugin/hooks/jce-worker-guard.ts";

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

  test("detects Indonesian completion and confirmation-stop language", () => {
    expect(looksLikeCompletionClaim("Sudah selesai dan beres.")).toBe(true);
    expect(looksLikeStopEarlyOrConfirmation("Sisanya tinggal dikonfirmasi dulu ya.")).toBe(true);
    expect(looksLikeStopEarlyOrConfirmation("Saya berhenti di sini dulu, lanjut nanti.")).toBe(true);
  });

  describe("#4 — negative-context guards reduce false positives", () => {
    test("question about completion is NOT a claim", () => {
      expect(looksLikeCompletionClaim("Is the implementation complete?")).toBe(false);
      expect(looksLikeCompletionClaim("How do I know when the feature is complete?")).toBe(false);
      expect(looksLikeCompletionClaim("Apakah implementasi sudah selesai?")).toBe(false);
    });

    test("negated/not-yet completion is NOT a claim", () => {
      expect(looksLikeCompletionClaim("The fix is not complete yet.")).toBe(false);
      expect(looksLikeCompletionClaim("This isn't done — more work remains.")).toBe(false);
      expect(looksLikeCompletionClaim("Implementasinya belum selesai.")).toBe(false);
    });

    test("conditional/future completion is NOT a claim", () => {
      expect(looksLikeCompletionClaim("Once the tests pass, the task is complete.")).toBe(false);
      expect(looksLikeCompletionClaim("This will be complete after review.")).toBe(false);
    });

    test("genuine claims are still detected", () => {
      expect(looksLikeCompletionClaim("The fix is complete.")).toBe(true);
      expect(looksLikeCompletionClaim("I've finished implementing the feature.")).toBe(true);
      expect(looksLikeCompletionClaim("Successfully fixed the bug.")).toBe(true);
    });

    test("a real claim is not suppressed by an unrelated trailing question", () => {
      const text = "The fix is complete. Want me to open a PR?";
      expect(looksLikeCompletionClaim(text)).toBe(true);
    });

    test("prose describing what completion would require is NOT a claim", () => {
      const text = "To mark this complete, we would need passing tests and a review.";
      expect(looksLikeCompletionClaim(text)).toBe(false);
    });
  });

  describe("expanded completion regex coverage (release-flow + Bahasa Indonesia)", () => {
    test("detects release-flow English past-tense verbs", () => {
      expect(looksLikeCompletionClaim("The release has been pushed and tagged.")).toBe(true);
      expect(looksLikeCompletionClaim("Successfully released v3.8.22.")).toBe(true);
      expect(looksLikeCompletionClaim("Patch was applied.")).toBe(true);
      expect(looksLikeCompletionClaim("Successfully deployed the fix.")).toBe(true);
    });

    test("detects heading-style DONE/FIXED/RELEASED tokens at end-of-line", () => {
      expect(looksLikeCompletionClaim("Release v3.8.22 — DONE")).toBe(true);
      expect(looksLikeCompletionClaim("Bug FIXED")).toBe(true);
      expect(looksLikeCompletionClaim("All tests RESOLVED.")).toBe(true);
    });

    test("detects Bahasa Indonesia release/patch completion phrasing", () => {
      expect(looksLikeCompletionClaim("Fix sudah diterapkan.")).toBe(true);
      expect(looksLikeCompletionClaim("Rilis sudah selesai dan dipush.")).toBe(true);
      expect(looksLikeCompletionClaim("Patch berhasil diterapkan.")).toBe(true);
      expect(looksLikeCompletionClaim("Sudah rampung semua.")).toBe(true);
      expect(looksLikeCompletionClaim("Semuanya beres.")).toBe(true);
      expect(looksLikeCompletionClaim("Berhasil merilis v3.8.22.")).toBe(true);
    });

    test("Indonesian evidence keywords suppress missing-verification warning", () => {
      // "Verifikasi: bun test lulus" should be recognised as evidence so the
      // completion claim does not trip the missing-verification warning.
      const text = "Fix sudah diterapkan. Verifikasi: bun test lulus, exit 0.";
      expect(shouldWarnForMissingVerification(text)).toBe(false);
    });

    test("negated Indonesian completion is still NOT a claim", () => {
      expect(looksLikeCompletionClaim("Belum berhasil diterapkan.")).toBe(false);
      expect(looksLikeCompletionClaim("Tidak rampung karena ada blocker.")).toBe(false);
    });
  });
});
