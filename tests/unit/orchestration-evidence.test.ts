import { describe, test, expect } from "bun:test";
import {
  createEvidence,
  computeEvidenceConfidence,
  parseTestResults,
  aggregateEvidence,
  isEvidenceSufficient,
} from "../../src/plugin/lib/orchestration/evidence-system.js";
import type { Evidence } from "../../src/plugin/lib/orchestration/types.js";

describe("Evidence System v2", () => {
  describe("createEvidence", () => {
    test("creates evidence with computed confidence from exit code 0", () => {
      const ev = createEvidence({
        type: "command_output",
        source: "test",
        command: "bun test",
        exitCode: 0,
      });
      expect(ev.confidence).toBeGreaterThan(0.8);
      expect(ev.assertions.length).toBeGreaterThan(0);
      expect(ev.assertions[0].passed).toBe(true);
    });

    test("creates evidence with low confidence from non-zero exit code", () => {
      const ev = createEvidence({
        type: "test_result",
        source: "test",
        command: "bun test",
        exitCode: 1,
      });
      expect(ev.confidence).toBeLessThan(0.3);
      expect(ev.assertions[0].passed).toBe(false);
    });

    test("creates evidence with zero confidence when not run", () => {
      const ev = createEvidence({
        type: "manual",
        source: "agent",
        raw: "Tests were not run due to missing dependencies",
      });
      expect(ev.confidence).toBe(0);
    });

    test("known verification commands get higher confidence", () => {
      const ev = createEvidence({
        type: "command_output",
        source: "test",
        command: "bun test",
        exitCode: 0,
      });
      expect(ev.confidence).toBe(0.95);
    });
  });

  describe("computeEvidenceConfidence", () => {
    test("exit code 0 with known command → 0.95", () => {
      expect(computeEvidenceConfidence({ type: "test_result", source: "x", command: "npm test", exitCode: 0 })).toBe(0.95);
    });

    test("exit code 0 with unknown command → 0.8", () => {
      expect(computeEvidenceConfidence({ type: "command_output", source: "x", command: "custom-script", exitCode: 0 })).toBe(0.8);
    });

    test("exit code 1 → 0.1", () => {
      expect(computeEvidenceConfidence({ type: "test_result", source: "x", exitCode: 1 })).toBe(0.1);
    });

    test("exit code 2+ → 0.05", () => {
      expect(computeEvidenceConfidence({ type: "command_output", source: "x", exitCode: 137 })).toBe(0.05);
    });

    test("not run text → 0", () => {
      expect(computeEvidenceConfidence({ type: "manual", source: "x", raw: "unable to run tests" })).toBe(0);
    });

    test("assertion-based scoring", () => {
      const conf = computeEvidenceConfidence(
        { type: "test_result", source: "x" },
        [
          { description: "test1", passed: true },
          { description: "test2", passed: true },
          { description: "test3", passed: false },
        ],
      );
      expect(conf).toBeCloseTo(0.67, 1);
    });
  });

  describe("parseTestResults", () => {
    test("parses bun test output", () => {
      const result = parseTestResults("61 pass, 0 fail, 3 skip");
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(61);
      expect(result!.failed).toBe(0);
      expect(result!.skipped).toBe(3);
    });

    test("parses jest output", () => {
      const result = parseTestResults("Tests: 2 failed, 48 passed, 50 total");
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(48);
      expect(result!.failed).toBe(2);
      expect(result!.total).toBe(50);
    });

    test("parses pytest output", () => {
      const result = parseTestResults("15 passed, 1 failed in 2.3s");
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(15);
      expect(result!.failed).toBe(1);
    });

    test("parses cargo test output", () => {
      const result = parseTestResults("test result: ok. 42 passed; 0 failed; 0 ignored");
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(42);
      expect(result!.failed).toBe(0);
    });

    test("parses go test output", () => {
      const raw = "ok  \tgithub.com/user/pkg\t0.5s\nok  \tgithub.com/user/pkg2\t1.2s\nFAIL\tgithub.com/user/pkg3\t0.3s";
      const result = parseTestResults(raw);
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(2);
      expect(result!.failed).toBe(1);
    });

    test("returns null for non-test output", () => {
      const result = parseTestResults("Hello world, this is just a log message");
      expect(result).toBeNull();
    });
  });

  describe("aggregateEvidence", () => {
    test("empty evidence returns zero confidence", () => {
      const score = aggregateEvidence([]);
      expect(score.overallConfidence).toBe(0);
      expect(score.isVerified).toBe(false);
      expect(score.summary).toContain("No evidence");
    });

    test("all passing evidence → verified", () => {
      const evidence: Evidence[] = [
        { id: "e1", type: "test_result", source: "bun", exitCode: 0, assertions: [{ description: "tests pass", passed: true }], confidence: 0.95, timestamp: "2026-01-01T00:00:00Z" },
        { id: "e2", type: "type_check", source: "tsc", exitCode: 0, assertions: [{ description: "no errors", passed: true }], confidence: 0.9, timestamp: "2026-01-01T00:00:00Z" },
      ];
      const score = aggregateEvidence(evidence);
      expect(score.isVerified).toBe(true);
      expect(score.overallConfidence).toBeGreaterThan(0.8);
      expect(score.passingEvidence).toBe(2);
      expect(score.failingEvidence).toBe(0);
    });

    test("failing evidence → not verified", () => {
      const evidence: Evidence[] = [
        { id: "e1", type: "test_result", source: "bun", exitCode: 1, assertions: [{ description: "tests fail", passed: false }], confidence: 0.1, timestamp: "2026-01-01T00:00:00Z" },
      ];
      const score = aggregateEvidence(evidence);
      expect(score.isVerified).toBe(false);
      expect(score.failingEvidence).toBe(1);
      expect(score.summary).toContain("Failed");
    });

    test("test results weighted higher than manual evidence", () => {
      const withTests: Evidence[] = [
        { id: "e1", type: "test_result", source: "bun", assertions: [], confidence: 0.8, timestamp: "2026-01-01T00:00:00Z" },
      ];
      const withManual: Evidence[] = [
        { id: "e1", type: "manual", source: "agent", assertions: [], confidence: 0.8, timestamp: "2026-01-01T00:00:00Z" },
      ];
      const testScore = aggregateEvidence(withTests);
      const manualScore = aggregateEvidence(withManual);
      // Both have same raw confidence, but test_result has higher weight
      expect(testScore.hasTestResults).toBe(true);
      expect(manualScore.hasTestResults).toBe(false);
    });
  });

  describe("isEvidenceSufficient", () => {
    test("code task needs test results and type check", () => {
      const result = isEvidenceSufficient([], "code");
      expect(result.sufficient).toBe(false);
      expect(result.missing).toContain("test results");
      expect(result.missing).toContain("type check");
    });

    test("code task with passing tests and typecheck is sufficient", () => {
      const evidence: Evidence[] = [
        { id: "e1", type: "test_result", source: "bun", exitCode: 0, assertions: [{ description: "pass", passed: true }], confidence: 0.95, timestamp: "2026-01-01T00:00:00Z" },
        { id: "e2", type: "type_check", source: "tsc", exitCode: 0, assertions: [{ description: "pass", passed: true }], confidence: 0.9, timestamp: "2026-01-01T00:00:00Z" },
      ];
      const result = isEvidenceSufficient(evidence, "code");
      expect(result.sufficient).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    test("refactor needs higher confidence", () => {
      const evidence: Evidence[] = [
        { id: "e1", type: "test_result", source: "bun", assertions: [{ description: "pass", passed: true }], confidence: 0.7, timestamp: "2026-01-01T00:00:00Z" },
      ];
      const result = isEvidenceSufficient(evidence, "refactor");
      expect(result.sufficient).toBe(false);
      expect(result.missing).toContain("high confidence (need ≥80% for refactor)");
    });

    test("config task just needs any validation", () => {
      const evidence: Evidence[] = [
        { id: "e1", type: "command_output", source: "validate", assertions: [], confidence: 0.5, timestamp: "2026-01-01T00:00:00Z" },
      ];
      const result = isEvidenceSufficient(evidence, "config");
      expect(result.sufficient).toBe(true);
    });
  });
});
