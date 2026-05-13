/**
 * Evidence System v2 — Parsed exit codes, assertion tracking, computed confidence
 * 
 * Replaces the shallow keyword-based evidence scoring with actual parsing
 * of command outputs, test results, and verification artifacts.
 */

import type { Evidence, EvidenceType, Assertion } from "./types.js";

// ─── Evidence Creation ────────────────────────────────────────────────────────

export interface CreateEvidenceInput {
  type: EvidenceType;
  source: string;
  command?: string;
  exitCode?: number;
  raw?: string;
  assertions?: Assertion[];
}

function generateId(): string {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEvidence(input: CreateEvidenceInput, now?: string): Evidence {
  const assertions = input.assertions ?? inferAssertions(input);
  const confidence = computeEvidenceConfidence(input, assertions);

  return {
    id: generateId(),
    type: input.type,
    source: input.source,
    command: input.command,
    exitCode: input.exitCode,
    assertions,
    confidence,
    raw: input.raw?.slice(0, 2000),
    timestamp: now ?? new Date().toISOString(),
  };
}

// ─── Confidence Computation ───────────────────────────────────────────────────

/**
 * Compute confidence from actual signals, not keyword matching.
 * 
 * Scoring rules:
 * - Exit code 0 with known command → 0.9
 * - Exit code 0 with unknown command → 0.7
 * - Exit code non-zero → 0.0-0.2 depending on type
 * - No exit code but has assertions → based on assertion pass rate
 * - No exit code, no assertions → 0.3 (manual/unverified)
 * - Explicitly says "not run" → 0.0
 */
export function computeEvidenceConfidence(input: CreateEvidenceInput, assertions?: Assertion[]): number {
  const asserts = assertions ?? input.assertions ?? [];

  // If raw output says it wasn't run
  if (input.raw && /not\s*run|not\s*verified|skipped|unable\s*to\s*run/i.test(input.raw)) {
    return 0;
  }

  // Exit code based scoring
  if (input.exitCode !== undefined) {
    if (input.exitCode === 0) {
      // Known verification commands get higher confidence
      if (input.command && isKnownVerificationCommand(input.command)) return 0.95;
      return 0.8;
    }
    // Non-zero exit code
    if (input.exitCode === 1) return 0.1; // Common test failure
    return 0.05; // Crash or severe error
  }

  // Assertion-based scoring
  if (asserts.length > 0) {
    const passed = asserts.filter((a) => a.passed).length;
    return Math.round((passed / asserts.length) * 100) / 100;
  }

  // Type-based fallback
  switch (input.type) {
    case "test_result": return 0.3;
    case "type_check": return 0.3;
    case "lint": return 0.3;
    case "build": return 0.3;
    case "command_output": return 0.4;
    case "file_diff": return 0.5;
    case "review_approval": return 0.7;
    case "manual": return 0.2;
    default: return 0.2;
  }
}

// ─── Assertion Inference ──────────────────────────────────────────────────────

/**
 * Infer assertions from raw output when not explicitly provided.
 */
function inferAssertions(input: CreateEvidenceInput): Assertion[] {
  const assertions: Assertion[] = [];
  const raw = input.raw ?? "";

  // Exit code assertion
  if (input.exitCode !== undefined) {
    assertions.push({
      description: input.command ? `${input.command} exits cleanly` : "Command exits cleanly",
      passed: input.exitCode === 0,
      actual: `exit code ${input.exitCode}`,
      expected: "exit code 0",
    });
  }

  // Test result parsing
  const testResults = parseTestResults(raw);
  if (testResults) {
    assertions.push({
      description: `Test suite: ${testResults.passed} passed, ${testResults.failed} failed`,
      passed: testResults.failed === 0,
      actual: `${testResults.passed} passed, ${testResults.failed} failed, ${testResults.skipped} skipped`,
      expected: "all tests pass",
    });
  }

  // TypeScript type check
  if (input.type === "type_check" || (input.command && /\btsc\b/.test(input.command))) {
    const errorCount = countTypeErrors(raw);
    assertions.push({
      description: "Type check passes",
      passed: errorCount === 0,
      actual: errorCount === 0 ? "no errors" : `${errorCount} type error(s)`,
      expected: "no type errors",
    });
  }

  // Lint check
  if (input.type === "lint" || (input.command && /\b(eslint|biome|prettier)\b/.test(input.command))) {
    const hasErrors = /\d+\s*error/i.test(raw) || /✖|✗/.test(raw);
    assertions.push({
      description: "Lint check passes",
      passed: !hasErrors,
      actual: hasErrors ? "lint errors found" : "clean",
      expected: "no lint errors",
    });
  }

  return assertions;
}

// ─── Output Parsing ───────────────────────────────────────────────────────────

interface TestResults {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration?: number;
}

/**
 * Parse test results from various test runner output formats.
 */
export function parseTestResults(raw: string): TestResults | null {
  // Bun test format: "X pass, Y fail, Z skip"
  const bunMatch = raw.match(/(\d+)\s*pass(?:ed)?.*?(\d+)\s*fail(?:ed)?/i);
  if (bunMatch) {
    const passed = parseInt(bunMatch[1], 10);
    const failed = parseInt(bunMatch[2], 10);
    const skipMatch = raw.match(/(\d+)\s*skip/i);
    const skipped = skipMatch ? parseInt(skipMatch[1], 10) : 0;
    return { passed, failed, skipped, total: passed + failed + skipped };
  }

  // Jest/Vitest format: "Tests: X passed, Y failed, Z total"
  const jestMatch = raw.match(/Tests:\s*(?:(\d+)\s*failed,?\s*)?(?:(\d+)\s*passed,?\s*)?(\d+)\s*total/i);
  if (jestMatch) {
    const failed = jestMatch[1] ? parseInt(jestMatch[1], 10) : 0;
    const passed = jestMatch[2] ? parseInt(jestMatch[2], 10) : 0;
    const total = parseInt(jestMatch[3], 10);
    return { passed, failed, skipped: total - passed - failed, total };
  }

  // pytest format: "X passed, Y failed"
  const pytestMatch = raw.match(/(\d+)\s*passed(?:.*?(\d+)\s*failed)?/i);
  if (pytestMatch) {
    const passed = parseInt(pytestMatch[1], 10);
    const failed = pytestMatch[2] ? parseInt(pytestMatch[2], 10) : 0;
    return { passed, failed, skipped: 0, total: passed + failed };
  }

  // Go test format: "ok" or "FAIL"
  const goOk = (raw.match(/^ok\s/gm) ?? []).length;
  const goFail = (raw.match(/^FAIL\s/gm) ?? []).length;
  if (goOk + goFail > 0) {
    return { passed: goOk, failed: goFail, skipped: 0, total: goOk + goFail };
  }

  // Cargo test format: "test result: ok. X passed; Y failed"
  const cargoMatch = raw.match(/test result:.*?(\d+)\s*passed.*?(\d+)\s*failed/i);
  if (cargoMatch) {
    const passed = parseInt(cargoMatch[1], 10);
    const failed = parseInt(cargoMatch[2], 10);
    return { passed, failed, skipped: 0, total: passed + failed };
  }

  return null;
}

function countTypeErrors(raw: string): number {
  // TypeScript error format: "Found X errors"
  const foundMatch = raw.match(/Found\s+(\d+)\s+error/i);
  if (foundMatch) return parseInt(foundMatch[1], 10);

  // Count individual TS error lines
  const errorLines = (raw.match(/error TS\d+/g) ?? []).length;
  if (errorLines > 0) return errorLines;

  // "X error(s)"
  const genericMatch = raw.match(/(\d+)\s*error/i);
  if (genericMatch) return parseInt(genericMatch[1], 10);

  return 0;
}

// ─── Aggregate Evidence Scoring ───────────────────────────────────────────────

export interface AggregateEvidenceScore {
  overallConfidence: number;
  totalEvidence: number;
  passingEvidence: number;
  failingEvidence: number;
  weakEvidence: number;
  strongEvidence: number;
  hasTestResults: boolean;
  hasTypeCheck: boolean;
  hasBuild: boolean;
  isVerified: boolean;
  summary: string;
}

/**
 * Aggregate multiple evidence items into an overall score.
 */
export function aggregateEvidence(evidence: Evidence[]): AggregateEvidenceScore {
  if (evidence.length === 0) {
    return {
      overallConfidence: 0,
      totalEvidence: 0,
      passingEvidence: 0,
      failingEvidence: 0,
      weakEvidence: 0,
      strongEvidence: 0,
      hasTestResults: false,
      hasTypeCheck: false,
      hasBuild: false,
      isVerified: false,
      summary: "No evidence collected",
    };
  }

  const passing = evidence.filter((e) => e.confidence >= 0.7);
  const failing = evidence.filter((e) => e.confidence < 0.3);
  const weak = evidence.filter((e) => e.confidence >= 0.3 && e.confidence < 0.7);
  const strong = evidence.filter((e) => e.confidence >= 0.9);

  const hasTestResults = evidence.some((e) => e.type === "test_result");
  const hasTypeCheck = evidence.some((e) => e.type === "type_check");
  const hasBuild = evidence.some((e) => e.type === "build");

  // Weighted average: strong evidence counts more
  const weights = evidence.map((e) => {
    if (e.type === "test_result") return 2.0;
    if (e.type === "type_check") return 1.5;
    if (e.type === "build") return 1.5;
    if (e.type === "review_approval") return 1.8;
    return 1.0;
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const weightedConfidence = evidence.reduce((sum, e, i) => sum + e.confidence * weights[i], 0) / totalWeight;

  const isVerified = weightedConfidence >= 0.7 && passing.length > 0 && failing.length === 0;

  const summary = isVerified
    ? `Verified: ${passing.length} passing evidence items (confidence: ${Math.round(weightedConfidence * 100)}%)`
    : failing.length > 0
      ? `Failed: ${failing.length} failing evidence items`
      : `Partial: ${evidence.length} evidence items, confidence ${Math.round(weightedConfidence * 100)}%`;

  return {
    overallConfidence: Math.round(weightedConfidence * 100) / 100,
    totalEvidence: evidence.length,
    passingEvidence: passing.length,
    failingEvidence: failing.length,
    weakEvidence: weak.length,
    strongEvidence: strong.length,
    hasTestResults,
    hasTypeCheck,
    hasBuild,
    isVerified,
    summary,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isKnownVerificationCommand(command: string): boolean {
  const lower = command.toLowerCase();
  return /\b(bun test|npm test|pnpm test|yarn test|jest|vitest|pytest|cargo test|go test|tsc|typecheck|eslint|biome check|prettier --check)\b/.test(lower);
}

/**
 * Determine if evidence collection is sufficient for a given task type.
 */
export function isEvidenceSufficient(evidence: Evidence[], taskType: string): { sufficient: boolean; missing: string[] } {
  const score = aggregateEvidence(evidence);
  const missing: string[] = [];

  switch (taskType) {
    case "code":
    case "bugfix":
    case "feature":
      if (!score.hasTestResults) missing.push("test results");
      if (!score.hasTypeCheck) missing.push("type check");
      if (score.overallConfidence < 0.7) missing.push("sufficient confidence (need ≥70%)");
      break;
    case "refactor":
      if (!score.hasTestResults) missing.push("test results (regression check)");
      if (score.overallConfidence < 0.8) missing.push("high confidence (need ≥80% for refactor)");
      break;
    case "config":
      if (score.totalEvidence === 0) missing.push("any validation evidence");
      break;
    case "verify":
      if (score.failingEvidence > 0) missing.push("all evidence passing");
      break;
    default:
      if (score.totalEvidence === 0) missing.push("any evidence");
  }

  return { sufficient: missing.length === 0, missing };
}
