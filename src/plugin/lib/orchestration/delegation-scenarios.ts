/**
 * Delegation Scenario Presets — ready-made inputs for the existing
 * buildDelegationEnvelope() builder.
 *
 * These do NOT duplicate the envelope builder; they provide scenario-specific
 * defaults (agent, required tools, must-do / must-not-do, expected verification)
 * for recurring delegation patterns. Callers merge a preset with a concrete goal
 * and pass it to buildDelegationEnvelope().
 */

import type { DelegationEnvelopeInput } from "../delegation-envelope.js";

export type DelegationScenario =
  | "security-audit"
  | "performance-review"
  | "migration-plan"
  | "dependency-upgrade"
  | "bug-investigation"
  | "code-review";

export interface ScenarioPreset {
  scenario: DelegationScenario;
  agent: string;
  description: string;
  build: (goal: string) => DelegationEnvelopeInput;
}

const PRESETS: Record<DelegationScenario, ScenarioPreset> = {
  "security-audit": {
    scenario: "security-audit",
    agent: "oracle",
    description: "Audit code for security issues, ordered by severity.",
    build: (goal) => ({
      goal,
      agent: "oracle",
      prompt: `Perform a security audit for: ${goal}`,
      expectedOutcome: "Findings ordered by severity (with file/line refs), separating confirmed from suspected, plus remediation suggestions.",
      requiredTools: ["Read", "Grep", "Glob"],
      mustDo: [
        "Inspect entry points, auth boundaries, input handling, and secret usage",
        "Order findings by severity (critical → low)",
        "Cite file paths and line numbers for each finding",
        "Distinguish confirmed vulnerabilities from suspected ones",
      ],
      mustNotDo: ["Do not modify code", "Do not run destructive commands", "Do not report findings without a location reference"],
      expectedVerification: ["Static inspection notes per finding"],
    }),
  },
  "performance-review": {
    scenario: "performance-review",
    agent: "oracle",
    description: "Identify performance bottlenecks and quantify where possible.",
    build: (goal) => ({
      goal,
      agent: "oracle",
      prompt: `Review performance for: ${goal}`,
      expectedOutcome: "Ranked bottlenecks with evidence (complexity, query patterns, allocations) and concrete optimization suggestions.",
      requiredTools: ["Read", "Grep", "Glob", "Bash"],
      mustDo: [
        "Profile or reason about hot paths before suggesting changes",
        "Quantify impact where measurable (Big-O, query count, payload size)",
        "Rank suggestions by expected impact vs effort",
      ],
      mustNotDo: ["Do not optimize without identifying the actual bottleneck first", "Do not modify code in this review pass"],
      expectedVerification: ["Profiling output or measured baseline where available"],
    }),
  },
  "migration-plan": {
    scenario: "migration-plan",
    agent: "explorer",
    description: "Map migration scope and propose an ordered, batched plan.",
    build: (goal) => ({
      goal,
      agent: "explorer",
      prompt: `Map the scope and propose a migration plan for: ${goal}`,
      expectedOutcome: "Full list of affected files, dependency-ordered batches, per-batch rollback points, and risk notes.",
      requiredTools: ["Read", "Grep", "Glob"],
      mustDo: [
        "Enumerate all affected files and call sites",
        "Order batches by dependency",
        "Define a rollback point per batch",
        "Flag shared contracts that could break consumers",
      ],
      mustNotDo: ["Do not start migrating in this planning pass", "Do not omit files that import the migrated surface"],
      expectedVerification: ["Characterization test plan for behavior preservation"],
    }),
  },
  "dependency-upgrade": {
    scenario: "dependency-upgrade",
    agent: "jce-researcher",
    description: "Research a dependency upgrade's compatibility and breaking changes.",
    build: (goal) => ({
      goal,
      agent: "jce-researcher",
      prompt: `Research compatibility and breaking changes for: ${goal}`,
      expectedOutcome: "Version compatibility matrix, breaking changes with sources, and a recommended upgrade path with confidence.",
      requiredTools: ["Read", "Grep"],
      mustDo: [
        "Cite official changelogs/release notes/migration guides",
        "List breaking changes relevant to current usage",
        "State confidence (high/medium/low) with reasoning",
      ],
      mustNotDo: ["Do not change dependency versions in this pass", "Do not rely on memory for version-specific behavior — cite sources"],
      expectedVerification: ["Source citations for each breaking-change claim"],
    }),
  },
  "bug-investigation": {
    scenario: "bug-investigation",
    agent: "explorer",
    description: "Trace a bug to its root cause before any fix.",
    build: (goal) => ({
      goal,
      agent: "explorer",
      prompt: `Investigate and trace the root cause for: ${goal}`,
      expectedOutcome: "Reproduction path, traced root cause with file/line evidence, and the smallest correct fix location.",
      requiredTools: ["Read", "Grep", "Glob", "Bash"],
      mustDo: [
        "Reproduce or precisely characterize the failure first",
        "Trace data flow from symptom to source",
        "Identify the root cause, not just the symptom",
      ],
      mustNotDo: ["Do not apply a fix in this investigation pass", "Do not guess the cause without tracing evidence"],
      expectedVerification: ["Reproduction steps and the traced code path"],
    }),
  },
  "code-review": {
    scenario: "code-review",
    agent: "oracle",
    description: "Review a change for correctness, regressions, and edge cases.",
    build: (goal) => ({
      goal,
      agent: "oracle",
      prompt: `Review the change for: ${goal}`,
      expectedOutcome: "Findings ordered by severity with file/line refs; explicit note if no issues found, plus residual risks.",
      requiredTools: ["Read", "Grep", "Bash"],
      mustDo: [
        "Check correctness, regressions, edge cases, and missing tests",
        "Order findings by severity",
        "Reference file and line for each finding",
      ],
      mustNotDo: ["Do not rewrite the code in this review", "Do not approve without checking edge cases"],
      expectedVerification: ["Test/typecheck status of the reviewed change"],
    }),
  },
};

export function listDelegationScenarios(): Array<{ scenario: DelegationScenario; agent: string; description: string }> {
  return Object.values(PRESETS).map(({ scenario, agent, description }) => ({ scenario, agent, description }));
}

export function getDelegationScenario(scenario: DelegationScenario): ScenarioPreset | undefined {
  return PRESETS[scenario];
}

/**
 * Build a DelegationEnvelopeInput for a known scenario + concrete goal.
 * Pass the result to buildDelegationEnvelope() to get the full prompt.
 */
export function buildScenarioEnvelopeInput(scenario: DelegationScenario, goal: string): DelegationEnvelopeInput | null {
  const preset = PRESETS[scenario];
  return preset ? preset.build(goal) : null;
}

/**
 * Suggest the most relevant delegation scenario for a free-text goal, or null.
 */
export function matchDelegationScenario(goal: string): DelegationScenario | null {
  const lower = goal.toLowerCase();
  if (/\b(security|vulnerabilit|auth\b|exploit|injection|xss|csrf)\b/.test(lower)) return "security-audit";
  if (/\b(slow|performance|optimi[sz]e|latency|bottleneck|memory leak|profil)\b/.test(lower)) return "performance-review";
  if (/\b(migrate|migration|port\s+to|move\s+from\s+\w+\s+to)\b/.test(lower)) return "migration-plan";
  if (/\b(upgrade|bump|dependency|package version|sdk version|framework version)\b/.test(lower)) return "dependency-upgrade";
  if (/\b(bug|crash(?:es|ed|ing)?|error|broken|regression|not working|fails?|failing)\b/.test(lower)) return "bug-investigation";
  if (/\b(review|audit this change|check this code|pr review)\b/.test(lower)) return "code-review";
  return null;
}
