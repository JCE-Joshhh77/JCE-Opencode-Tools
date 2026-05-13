import { describe, test, expect } from "bun:test";
import {
  scoreIntent,
  toLegacyRoute,
} from "../../src/plugin/lib/orchestration/intent-router.js";
import type { RouterContext } from "../../src/plugin/lib/orchestration/intent-router.js";

describe("Intent Router v2", () => {
  describe("scoreIntent", () => {
    test("detects bugfix intent from keywords", () => {
      const result = scoreIntent("fix the crash in the login handler");
      expect(result.intent).toBe("bugfix");
      expect(result.confidence).toBeGreaterThan(0.3);
      expect(result.skills).toContain("software-engineering");
    });

    test("detects feature intent", () => {
      const result = scoreIntent("add pagination to the users API");
      expect(result.intent).toBe("feature");
      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
    });

    test("detects refactor intent", () => {
      const result = scoreIntent("refactor the authentication module to use strategy pattern");
      expect(result.intent).toBe("refactor");
    });

    test("detects review intent", () => {
      const result = scoreIntent("review this pull request for security issues");
      expect(result.intent).toBe("review");
    });

    test("detects release intent", () => {
      const result = scoreIntent("prepare release v3.0.0 and update changelog");
      expect(result.intent).toBe("release");
      expect(result.skills).toContain("release-engineering");
    });

    test("detects research intent", () => {
      const result = scoreIntent("research the best practices for WebSocket authentication");
      expect(result.intent).toBe("research");
    });

    test("detects docs intent", () => {
      const result = scoreIntent("document the new API endpoints and write a README");
      expect(result.intent).toBe("docs");
    });

    test("falls back to general for ambiguous input", () => {
      const result = scoreIntent("hello");
      expect(result.intent).toBe("general");
    });

    test("multi-word phrases score higher", () => {
      const result = scoreIntent("the failing test in auth module needs attention");
      expect(result.intent).toBe("bugfix");
    });

    test("git branch context influences scoring", () => {
      const result = scoreIntent("continue working on this", { gitBranch: "fix/login-crash" });
      expect(result.intent).toBe("bugfix");
      expect(result.signals.some((s) => s.source === "git_context")).toBe(true);
    });

    test("explicit intent overrides everything", () => {
      const result = scoreIntent("add a new feature to fix the bug", { explicitIntent: "feature" });
      expect(result.intent).toBe("feature");
    });

    test("history provides continuation bias", () => {
      const result = scoreIntent("continue", { recentIntents: ["bugfix", "bugfix"] });
      expect(result.signals.some((s) => s.source === "history" && s.intent === "bugfix")).toBe(true);
    });

    test("resolves framework-specific skills", () => {
      const result = scoreIntent("fix the React component rendering issue");
      expect(result.skills).toContain("react");
    });

    test("resolves file extension skills", () => {
      const result = scoreIntent("fix this bug", { fileExtensions: [".py"] });
      expect(result.skills).toContain("python");
    });

    test("caps skills at 4", () => {
      const result = scoreIntent("fix the Next.js React TypeScript component with Tailwind styling");
      expect(result.skills.length).toBeLessThanOrEqual(4);
    });
  });

  describe("agent hints", () => {
    test("research → jce-researcher", () => {
      const result = scoreIntent("research the documentation for this library");
      expect(result.agentHint).toBe("jce-researcher");
    });

    test("architecture → oracle", () => {
      const result = scoreIntent("help me with the architecture design decision");
      expect(result.agentHint).toBe("oracle");
    });

    test("UI → frontend", () => {
      const result = scoreIntent("fix the responsive component layout");
      expect(result.agentHint).toBe("frontend");
    });

    test("explore → explorer", () => {
      const result = scoreIntent("find where the authentication logic is defined");
      expect(result.agentHint).toBe("explorer");
    });
  });

  describe("toLegacyRoute", () => {
    test("converts ScoredIntent to legacy format", () => {
      const scored = scoreIntent("fix the bug in login");
      const legacy = toLegacyRoute(scored);
      expect(legacy.intent).toBe("bugfix");
      expect(legacy.skills).toEqual(scored.skills);
      expect(typeof legacy.reason).toBe("string");
    });
  });

  describe("confidence scoring", () => {
    test("clear intent has high confidence", () => {
      const result = scoreIntent("fix this critical bug that crashes the server");
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    test("ambiguous input has lower confidence", () => {
      const result = scoreIntent("do something");
      expect(result.confidence).toBeLessThan(0.8);
    });

    test("multiple competing signals reduce confidence", () => {
      // "fix" → bugfix, "add" → feature — competing signals
      const result = scoreIntent("add a fix for the feature");
      // Should still pick one, but confidence should reflect ambiguity
      expect(result.confidence).toBeLessThan(1.0);
    });
  });
});
