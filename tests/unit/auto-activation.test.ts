import { describe, test, expect } from "bun:test";
import { decideAutoActivation, shouldAutoActivateFromUserMessage } from "../../src/plugin/lib/auto-activation.js";

describe("shouldAutoActivateFromUserMessage", () => {
  describe("activates on direct action instructions", () => {
    test.each([
      "implement a dark mode toggle",
      "fix the login crash in auth.ts",
      "refactor the orchestration controller",
      "audit the whole plugin",
      "perbaiki bug build gradle",
      "tolong rapikan kode ini",
      "lanjutkan pekerjaan sebelumnya",
    ])("activates: %s", (msg) => {
      expect(shouldAutoActivateFromUserMessage(msg)).toBe(true);
    });
  });

  describe("activates on action requests phrased as questions", () => {
    test.each([
      "can you implement pagination on the users endpoint?",
      "could you fix this failing test?",
      "please refactor this module?",
      "bisa tolong perbaiki bug ini?",
      "tolong buatkan fitur login?",
      "audit plugin ini?",
    ])("activates: %s", (msg) => {
      expect(shouldAutoActivateFromUserMessage(msg)).toBe(true);
    });
  });

  describe("does NOT activate on informational / advice questions", () => {
    test.each([
      "how does the scheduler work?",
      "what do you think about refactoring this?",
      "should I refactor this module?",
      "why does the build fail?",
      "bagaimana cara kerja orchestration?",
      "apakah perlu refactor di sini?",
      "kenapa testnya gagal?",
    ])("ignores: %s", (msg) => {
      expect(shouldAutoActivateFromUserMessage(msg)).toBe(false);
    });
  });

  describe("does NOT activate without an action verb", () => {
    test.each([
      "the build is great",
      "thanks for the help",
      "hello there",
      "",
    ])("ignores: %s", (msg) => {
      expect(shouldAutoActivateFromUserMessage(msg)).toBe(false);
    });
  });

  test("returns typed decision with confidence, reason, and signals", () => {
    const decision = decideAutoActivation("can you implement pagination?");
    expect(decision.activate).toBe(true);
    expect(decision.confidence).toBeGreaterThan(0.7);
    expect(decision.reason).toContain("action request");
    expect(decision.signals).toContain("action_verb");
    expect(decision.signals).toContain("action_request_frame");
  });
});
