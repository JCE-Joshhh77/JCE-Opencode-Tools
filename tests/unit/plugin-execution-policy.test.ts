import { describe, expect, test } from "bun:test";
import { evaluateExecutionPolicy, formatExecutionPolicyDecision } from "../../src/plugin/lib/execution-policy.ts";
import { addWorkflowStep, attachStepEvidence, createWorkflowRun, updateWorkflowStepStatus } from "../../src/plugin/lib/workflow.ts";
import type { WorkflowIntentRoute } from "../../src/plugin/lib/workflow.ts";

const completionRoute: WorkflowIntentRoute = {
  intent: "completion_claim",
  skills: ["verification-before-completion"],
  reason: "Completion claims require fresh verification evidence.",
  source: "completion",
};

const bugfixRoute: WorkflowIntentRoute = {
  intent: "bugfix",
  skills: ["systematic-debugging", "test-driven-development"],
  reason: "Detected bug or failing test intent.",
  source: "message",
};

const parallelRoute: WorkflowIntentRoute = {
  intent: "parallel_work",
  skills: ["dispatching-parallel-agents"],
  reason: "Independent work can be delegated in parallel.",
  agentHint: "explorer",
  source: "task",
};

const reviewRoute: WorkflowIntentRoute = {
  intent: "review",
  skills: ["requesting-code-review"],
  reason: "Review route requires accepted review evidence before completion.",
  source: "message",
};

function completedCodeRunWithoutEvidence() {
  let run = createWorkflowRun({ id: "wf-policy", goal: "Policy gated completion", acceptanceCriteria: ["tests pass"] });
  run = addWorkflowStep(run, { id: "step-1", title: "Implement", taskType: "code", expectedOutput: "code", verification: ["bun test"] });
  return updateWorkflowStepStatus(run, "step-1", "completed");
}

function completedCodeRunWithEvidence() {
  let run = createWorkflowRun({ id: "wf-policy", goal: "Policy gated completion", acceptanceCriteria: ["tests pass"] });
  run = addWorkflowStep(run, { id: "step-1", title: "Implement", taskType: "code", expectedOutput: "code", verification: ["bun test"] });
  run = attachStepEvidence(run, "step-1", { kind: "command", command: "bun test", summary: "bun test: pass", passed: true });
  return updateWorkflowStepStatus(run, "step-1", "completed");
}

function completedCodeRunWithFileEvidence() {
  let run = createWorkflowRun({ id: "wf-policy", goal: "Policy gated completion", acceptanceCriteria: ["tests pass"] });
  run = addWorkflowStep(run, { id: "step-1", title: "Implement", taskType: "code", expectedOutput: "code", verification: ["bun test"] });
  run = attachStepEvidence(run, "step-1", { kind: "file", file: "src/plugin/lib/execution-policy.ts", summary: "Changed policy evaluator", passed: true });
  return updateWorkflowStepStatus(run, "step-1", "completed");
}

function completedCodeRunWithCommandEvidenceWithoutPassed() {
  let run = createWorkflowRun({ id: "wf-policy", goal: "Policy gated completion", acceptanceCriteria: ["tests pass"] });
  run = addWorkflowStep(run, { id: "step-1", title: "Implement", taskType: "code", expectedOutput: "code", verification: ["bun test"] });
  run = attachStepEvidence(run, "step-1", { kind: "command", command: "bun test", summary: "bun test output captured" });
  return updateWorkflowStepStatus(run, "step-1", "completed");
}

function completedConfigRunWithIrrelevantCommandEvidence() {
  let run = createWorkflowRun({ id: "wf-config", goal: "Update config", acceptanceCriteria: ["config validated"] });
  run = addWorkflowStep(run, { id: "step-config", title: "Update config", taskType: "config", expectedOutput: "config", verification: ["validate config"] });
  run = attachStepEvidence(run, "step-config", { kind: "command", command: "date", summary: "date ran", passed: true });
  return updateWorkflowStepStatus(run, "step-config", "completed");
}

function completedConfigRunWithValidationEvidence() {
  let run = createWorkflowRun({ id: "wf-config", goal: "Update config", acceptanceCriteria: ["config validated"] });
  run = addWorkflowStep(run, { id: "step-config", title: "Update config", taskType: "config", expectedOutput: "config", verification: ["node --check config.js"] });
  run = attachStepEvidence(run, "step-config", { kind: "command", command: "node --check config.js", summary: "node --check config.js: pass", passed: true });
  return updateWorkflowStepStatus(run, "step-config", "completed");
}

function completedShellRunWithIrrelevantCommandEvidence() {
  let run = createWorkflowRun({ id: "wf-shell", goal: "Update script", acceptanceCriteria: ["script syntax checked"] });
  run = addWorkflowStep(run, { id: "step-shell", title: "Update script", taskType: "shell", expectedOutput: "script", verification: ["bash -n scripts/install.sh"] });
  run = attachStepEvidence(run, "step-shell", { kind: "command", command: "bun test", summary: "tests passed", passed: true });
  return updateWorkflowStepStatus(run, "step-shell", "completed");
}

function completedDocsRunWithFileEvidence() {
  let run = createWorkflowRun({ id: "wf-docs", goal: "Update docs", acceptanceCriteria: ["docs updated"] });
  run = addWorkflowStep(run, { id: "step-docs", title: "Update docs", taskType: "docs", expectedOutput: "docs", verification: ["review docs"] });
  run = attachStepEvidence(run, "step-docs", { kind: "file", file: "README.md", summary: "README updated", passed: true });
  return updateWorkflowStepStatus(run, "step-docs", "completed");
}

function completedResearchRunWithSourceEvidence() {
  let run = createWorkflowRun({ id: "wf-research", goal: "Research behavior", acceptanceCriteria: ["source reviewed"] });
  run = addWorkflowStep(run, { id: "step-research", title: "Research", taskType: "research", expectedOutput: "notes", verification: ["manual source review"] });
  run = attachStepEvidence(run, "step-research", { kind: "source", summary: "Reviewed upstream documentation", passed: true });
  return updateWorkflowStepStatus(run, "step-research", "completed");
}

function completedReviewRunWithoutEvidence() {
  let run = createWorkflowRun({ id: "wf-review", goal: "Review implementation", acceptanceCriteria: ["review completed"] });
  run = addWorkflowStep(run, { id: "step-review", title: "Review code", taskType: "review", expectedOutput: "review notes", verification: ["review accepted"] });
  return updateWorkflowStepStatus(run, "step-review", "completed");
}

function completedReviewRunWithReviewEvidence() {
  let run = createWorkflowRun({ id: "wf-review", goal: "Review implementation", acceptanceCriteria: ["review completed"] });
  run = addWorkflowStep(run, { id: "step-review", title: "Review code", taskType: "review", expectedOutput: "review notes", verification: ["review accepted"] });
  run = attachStepEvidence(run, "step-review", { kind: "review", summary: "accepted: review complete", passed: true });
  return updateWorkflowStepStatus(run, "step-review", "completed");
}

function completedUnknownRunWithoutEvidence() {
  let run = createWorkflowRun({ id: "wf-unknown", goal: "Complete unclassified task", acceptanceCriteria: ["work verified"] });
  run = addWorkflowStep(run, { id: "step-unknown", title: "Do work", taskType: "unknown", expectedOutput: "result", verification: ["verify result"] });
  return updateWorkflowStepStatus(run, "step-unknown", "completed");
}

function completedUnknownRunWithEvidence() {
  let run = createWorkflowRun({ id: "wf-unknown", goal: "Complete unclassified task", acceptanceCriteria: ["work verified"] });
  run = addWorkflowStep(run, { id: "step-unknown", title: "Do work", taskType: "unknown", expectedOutput: "result", verification: ["verify result"] });
  run = attachStepEvidence(run, "step-unknown", { kind: "manual", summary: "verified result", passed: true });
  return updateWorkflowStepStatus(run, "step-unknown", "completed");
}

describe("execution policy", () => {
  test("blocks completion claims without passing verification evidence", () => {
    const decision = evaluateExecutionPolicy({
      action: "completion_claim",
      profile: "balanced",
      route: completionRoute,
      workflow: completedCodeRunWithoutEvidence(),
    });

    expect(decision.status).toBe("block");
    expect(decision.policyId).toBe("completion.verification.required");
    expect(decision.reasons).toContain("Completion claim route requires fresh verification evidence before reporting done.");
    expect(decision.requiredEvidence).toContain("passing verification evidence");
  });

  test("blocks bugfix completion without passing command evidence", () => {
    const decision = evaluateExecutionPolicy({
      action: "completion_claim",
      profile: "balanced",
      route: bugfixRoute,
      workflow: completedCodeRunWithoutEvidence(),
    });

    expect(decision.status).toBe("block");
    expect(decision.policyId).toBe("bugfix.regression.required");
    expect(decision.reasons).toContain("Bugfix route requires regression-focused verification evidence before completion.");
  });

  test("allows completion claims with passing command evidence", () => {
    const decision = evaluateExecutionPolicy({
      action: "completion_claim",
      profile: "balanced",
      route: completionRoute,
      workflow: completedCodeRunWithEvidence(),
    });

    expect(decision.status).toBe("allow");
    expect(decision.reasons).toEqual([]);
  });

  test("completion claim remains blocked with file evidence only", () => {
    const decision = evaluateExecutionPolicy({
      action: "completion_claim",
      profile: "balanced",
      route: completionRoute,
      workflow: completedCodeRunWithFileEvidence(),
    });

    expect(decision.status).toBe("block");
    expect(decision.policyId).toBe("completion.verification.required");
  });

  test("completion claim remains blocked with command evidence where passed is undefined", () => {
    const decision = evaluateExecutionPolicy({
      action: "completion_claim",
      profile: "balanced",
      route: completionRoute,
      workflow: completedCodeRunWithCommandEvidenceWithoutPassed(),
    });

    expect(decision.status).toBe("block");
    expect(decision.policyId).toBe("completion.verification.required");
  });

  test("completion policy blocks code steps with only file evidence as task-type verification", () => {
    const decision = evaluateExecutionPolicy({
      action: "completion_claim",
      profile: "balanced",
      workflow: completedCodeRunWithFileEvidence(),
    });

    expect(decision.status).toBe("block");
    expect(decision.policyId).toBe("completion.task_type_verification.required");
    expect(decision.reasons).toContain("Step step-1 requires passing relevant command evidence for task type code.");
    expect(decision.requiredEvidence).toContain("task-type appropriate verification evidence");
  });

  test("completion policy blocks config steps without config validation evidence", () => {
    const decision = evaluateExecutionPolicy({
      action: "completion_claim",
      profile: "balanced",
      workflow: completedConfigRunWithIrrelevantCommandEvidence(),
    });

    expect(decision.status).toBe("block");
    expect(decision.policyId).toBe("completion.task_type_verification.required");
    expect(decision.reasons).toContain("Step step-config requires passing config validation command evidence.");
  });

  test("completion policy allows config steps with config validation evidence", () => {
    const decision = evaluateExecutionPolicy({
      action: "completion_claim",
      profile: "balanced",
      workflow: completedConfigRunWithValidationEvidence(),
    });

    expect(decision.status).toBe("allow");
  });

  test("completion policy blocks shell steps without shell syntax evidence", () => {
    const decision = evaluateExecutionPolicy({
      action: "completion_claim",
      profile: "balanced",
      workflow: completedShellRunWithIrrelevantCommandEvidence(),
    });

    expect(decision.status).toBe("block");
    expect(decision.policyId).toBe("completion.task_type_verification.required");
    expect(decision.reasons).toContain("Step step-shell requires passing shell syntax command evidence.");
  });

  test("completion policy allows docs steps with file evidence", () => {
    const decision = evaluateExecutionPolicy({
      action: "completion_claim",
      profile: "balanced",
      workflow: completedDocsRunWithFileEvidence(),
    });

    expect(decision.status).toBe("allow");
  });

  test("completion policy allows research steps with source evidence", () => {
    const decision = evaluateExecutionPolicy({
      action: "completion_claim",
      profile: "balanced",
      workflow: completedResearchRunWithSourceEvidence(),
    });

    expect(decision.status).toBe("allow");
  });

  test("final_review blocks task-type verification failures", () => {
    const decision = evaluateExecutionPolicy({
      action: "final_review",
      profile: "balanced",
      workflow: completedShellRunWithIrrelevantCommandEvidence(),
    });

    expect(decision.status).toBe("block");
    expect(decision.policyId).toBe("completion.task_type_verification.required");
    expect(decision.reasons).toContain("Step step-shell requires passing shell syntax command evidence.");
  });

  test("completion policy blocks review steps without review evidence", () => {
    const decision = evaluateExecutionPolicy({
      action: "completion_claim",
      profile: "balanced",
      workflow: completedReviewRunWithoutEvidence(),
    });

    expect(decision.status).toBe("block");
    expect(decision.policyId).toBe("completion.task_type_verification.required");
    expect(decision.reasons).toContain("Step step-review requires review evidence for task type review.");
  });

  test("completion policy allows review steps with review evidence", () => {
    const decision = evaluateExecutionPolicy({
      action: "completion_claim",
      profile: "balanced",
      workflow: completedReviewRunWithReviewEvidence(),
    });

    expect(decision.status).toBe("allow");
  });

  test("completion policy blocks unknown steps without evidence", () => {
    const decision = evaluateExecutionPolicy({
      action: "completion_claim",
      profile: "balanced",
      workflow: completedUnknownRunWithoutEvidence(),
    });

    expect(decision.status).toBe("block");
    expect(decision.policyId).toBe("completion.task_type_verification.required");
    expect(decision.reasons).toContain("Step step-unknown requires at least one evidence item for task type unknown.");
  });

  test("completion policy allows unknown steps with evidence", () => {
    const decision = evaluateExecutionPolicy({
      action: "completion_claim",
      profile: "balanced",
      workflow: completedUnknownRunWithEvidence(),
    });

    expect(decision.status).toBe("allow");
  });

  test("bugfix completion remains blocked with command evidence where passed is undefined", () => {
    const decision = evaluateExecutionPolicy({
      action: "completion_claim",
      profile: "balanced",
      route: bugfixRoute,
      workflow: completedCodeRunWithCommandEvidenceWithoutPassed(),
    });

    expect(decision.status).toBe("block");
    expect(decision.policyId).toBe("bugfix.regression.required");
  });

  test("active blockers block completion_claim", () => {
    const decision = evaluateExecutionPolicy({
      action: "completion_claim",
      profile: "balanced",
      route: completionRoute,
      workflow: completedCodeRunWithEvidence(),
      activeBlockers: [{ id: "blocker-1", reason: "Need human decision" }],
    });

    expect(decision.status).toBe("block");
    expect(decision.policyId).toBe("completion.blockers.active");
  });

  test("unresolved exhausted retry blocks completion_claim", () => {
    const decision = evaluateExecutionPolicy({
      action: "completion_claim",
      profile: "balanced",
      route: completionRoute,
      workflow: completedCodeRunWithEvidence(),
      retryHistory: [{ id: "retry-1", retryCount: 2, maxRetries: 2, status: "failed" }],
    });

    expect(decision.status).toBe("block");
    expect(decision.policyId).toBe("completion.retry_exhausted");
  });

  test("malformed infinite retry record does not block", () => {
    const decision = evaluateExecutionPolicy({
      action: "completion_claim",
      profile: "balanced",
      route: completionRoute,
      workflow: completedCodeRunWithEvidence(),
      retryHistory: [{ id: "retry-1", retryCount: 2, maxRetries: Infinity, status: "failed" }],
    });

    expect(decision.status).toBe("allow");
  });

  test("blocks generic route update from overwriting specific route", () => {
    const decision = evaluateExecutionPolicy({
      action: "route_update",
      profile: "balanced",
      route: bugfixRoute,
      nextRoute: {
        intent: "general",
        skills: [],
        reason: "No specialized workflow required for this request.",
        source: "message",
      },
    });

    expect(decision.status).toBe("block");
    expect(decision.policyId).toBe("route.specificity.preserve");
  });

  test("blocks same-intent message route from overwriting task route source", () => {
    const decision = evaluateExecutionPolicy({
      action: "route_update",
      profile: "balanced",
      route: parallelRoute,
      nextRoute: { ...parallelRoute, source: "message" },
    });

    expect(decision.status).toBe("block");
    expect(decision.policyId).toBe("route.source.preserve");
  });

  test("blocks completion claim route from overwriting review route without accepted review evidence", () => {
    const decision = evaluateExecutionPolicy({
      action: "route_update",
      profile: "balanced",
      route: reviewRoute,
      nextRoute: completionRoute,
      delegatedReviews: [],
    });

    expect(decision.status).toBe("block");
    expect(decision.policyId).toBe("route.review.preserve");
    expect(decision.reasons.join(" ")).toMatch(/accepted review evidence/i);
  });

  test("warns for parallel dispatch agent mismatch in balanced profile", () => {
    const decision = evaluateExecutionPolicy({
      action: "dispatch",
      profile: "balanced",
      nextRoute: parallelRoute,
      dispatchAgent: "jce-researcher",
    });

    expect(decision.status).toBe("warn");
    expect(decision.policyId).toBe("dispatch.agent_hint.mismatch");
    expect(decision.warnings).toContain("Dispatch agent jce-researcher does not match route hint explorer.");
  });

  test("blocks parallel dispatch agent mismatch in strict profile", () => {
    const decision = evaluateExecutionPolicy({
      action: "dispatch",
      profile: "strict",
      nextRoute: parallelRoute,
      dispatchAgent: "jce-researcher",
    });

    expect(decision.status).toBe("block");
    expect(decision.policyId).toBe("dispatch.agent_hint.mismatch");
  });

  test("allows matching parallel dispatch agent", () => {
    const decision = evaluateExecutionPolicy({
      action: "dispatch",
      profile: "balanced",
      nextRoute: parallelRoute,
      dispatchAgent: "explorer",
    });

    expect(decision.status).toBe("allow");
  });

  test("final_review blocks review route without accepted review evidence even when delegatedWorkRequired is omitted", () => {
    const decision = evaluateExecutionPolicy({
      action: "final_review",
      profile: "balanced",
      route: reviewRoute,
      workflow: completedCodeRunWithEvidence(),
      delegatedReviews: [],
    });

    expect(decision.status).toBe("block");
    expect(decision.policyId).toBe("review.acceptance.required");
  });

  test("final_review blocks review route without accepted review evidence even when delegatedWorkRequired is false", () => {
    const decision = evaluateExecutionPolicy({
      action: "final_review",
      profile: "balanced",
      route: reviewRoute,
      workflow: completedCodeRunWithEvidence(),
      delegatedReviews: [],
      delegatedWorkRequired: false,
    });

    expect(decision.status).toBe("block");
    expect(decision.policyId).toBe("review.acceptance.required");
  });

  test("final_review allows review route with accepted review evidence and passing command evidence", () => {
    const decision = evaluateExecutionPolicy({
      action: "final_review",
      profile: "balanced",
      route: reviewRoute,
      workflow: completedCodeRunWithEvidence(),
      delegatedReviews: ["accepted: policy reviewed"],
    });

    expect(decision.status).toBe("allow");
  });

  test("formats policy decisions for runtime output", () => {
    const decision = evaluateExecutionPolicy({
      action: "dispatch",
      profile: "balanced",
      nextRoute: parallelRoute,
      dispatchAgent: "jce-researcher",
    });

    expect(formatExecutionPolicyDecision(decision)).toContain("EXECUTION POLICY: warning");
    expect(formatExecutionPolicyDecision(decision)).toContain("dispatch.agent_hint.mismatch");
  });
});
