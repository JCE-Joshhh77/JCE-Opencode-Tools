import { describe, expect, test } from "bun:test";
import { addWorkflowStep, attachStepEvidence, blockWorkflow, createWorkflowRun, updateWorkflowStepStatus } from "../../src/plugin/lib/workflow.ts";
import { evaluateFinalReviewGate } from "../../src/plugin/lib/final-review-gate.ts";

function completedCodeRun() {
  let run = createWorkflowRun({ id: "wf-1", goal: "Ship reliable orchestration", acceptanceCriteria: ["tests pass"] });
  run = addWorkflowStep(run, {
    id: "step-1",
    title: "Implement feature",
    taskType: "code",
    expectedOutput: "feature code",
    verification: ["bun test"],
  });
  run = attachStepEvidence(run, "step-1", { kind: "command", command: "bun test", summary: "tests passed", passed: true });
  run = updateWorkflowStepStatus(run, "step-1", "completed");
  return run;
}

describe("JCE-Worker final review gate", () => {
  test("passes when workflow, evidence, delegated reviews, and certificate are ready", () => {
    const result = evaluateFinalReviewGate(completedCodeRun(), {
      profile: "balanced",
      changedFiles: ["src/plugin/lib/final-review-gate.ts"],
      delegatedReviews: ["accepted: explorer reviewed output"],
      residualRisks: ["none"],
      activeBlockers: [],
      retryHistory: [],
    });

    expect(result.status).toBe("pass");
    expect(result.reasons).toEqual([]);
    expect(result.certificate.valid).toBe(true);
    expect(result.summary).toContain("Final review gate passed");
  });

  test("blocks when workflow verification evidence is missing", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Ship without evidence" });
    run = addWorkflowStep(run, { id: "step-1", title: "Code", taskType: "code", expectedOutput: "code", verification: ["bun test"] });
    run = updateWorkflowStepStatus(run, "step-1", "completed");

    const result = evaluateFinalReviewGate(run, {
      profile: "balanced",
      changedFiles: ["src/plugin/lib/final-review-gate.ts"],
      delegatedReviews: [],
      residualRisks: ["none"],
      activeBlockers: [],
      retryHistory: [],
    });

    expect(result.status).toBe("block");
    expect(result.reasons.join("\n")).toContain("requires passing relevant command evidence");
  });

  test("adds explicit route guidance for completion claims without evidence", () => {
    let run = createWorkflowRun({ id: "wf-claim", goal: "Claim completion", acceptanceCriteria: ["tests pass"] });
    run = addWorkflowStep(run, { id: "step-1", title: "Code", taskType: "code", expectedOutput: "code", verification: ["bun test"] });
    run = updateWorkflowStepStatus(run, "step-1", "completed");
    run.route = {
      intent: "completion_claim",
      skills: ["verification-before-completion"],
      reason: "Completion claims require fresh verification evidence.",
      source: "completion",
    };

    const result = evaluateFinalReviewGate(run, {
      profile: "balanced",
      changedFiles: ["src/plugin/lib/final-review-gate.ts"],
      delegatedReviews: [],
      residualRisks: ["none"],
      activeBlockers: [],
      retryHistory: [],
    });

    expect(result.status).toBe("block");
    expect(result.reasons).toContain("Completion claim route requires fresh verification evidence before reporting done.");
  });

  test("adds explicit route guidance for review intent without accepted review", () => {
    const run = {
      ...completedCodeRun(),
      route: {
        intent: "review" as const,
        skills: ["requesting-code-review"],
        reason: "Review requests require a code-review workflow.",
        source: "message" as const,
      },
    };

    const result = evaluateFinalReviewGate(run, {
      profile: "balanced",
      changedFiles: ["src/plugin/lib/final-review-gate.ts"],
      delegatedReviews: [],
      residualRisks: ["none"],
      activeBlockers: [],
      retryHistory: [],
    });

    expect(result.status).toBe("block");
    expect(result.reasons).toContain("Review route requires accepted review evidence before completion.");
  });

  test("includes execution policy reasons in final review result", () => {
    const result = evaluateFinalReviewGate(completedCodeRun(), {
      profile: "balanced",
      changedFiles: ["src/plugin/lib/final-review-gate.ts"],
      delegatedReviews: ["accepted"],
      residualRisks: ["none"],
      activeBlockers: [],
      retryHistory: [],
      policyReasons: ["Execution policy blocked completion."],
    });

    expect(result.status).toBe("block");
    expect(result.reasons).toContain("Execution policy blocked completion.");
  });

  test("does not duplicate execution policy and route guidance reasons", () => {
    let run = createWorkflowRun({ id: "wf-claim", goal: "Claim completion", acceptanceCriteria: ["tests pass"] });
    run = addWorkflowStep(run, { id: "step-1", title: "Code", taskType: "code", expectedOutput: "code", verification: ["bun test"] });
    run = updateWorkflowStepStatus(run, "step-1", "completed");
    run.route = {
      intent: "completion_claim",
      skills: ["verification-before-completion"],
      reason: "Completion claims require fresh verification evidence.",
      source: "completion",
    };

    const result = evaluateFinalReviewGate(run, {
      profile: "balanced",
      changedFiles: ["src/plugin/lib/final-review-gate.ts"],
      delegatedReviews: [],
      residualRisks: ["none"],
      activeBlockers: [],
      retryHistory: [],
      policyReasons: ["Completion claim route requires fresh verification evidence before reporting done."],
    });

    expect(result.reasons.filter((reason) => reason === "Completion claim route requires fresh verification evidence before reporting done.")).toHaveLength(1);
  });

  test("blocks when active blockers remain", () => {
    const result = evaluateFinalReviewGate(completedCodeRun(), {
      profile: "balanced",
      changedFiles: ["src/plugin/lib/final-review-gate.ts"],
      delegatedReviews: ["accepted"],
      residualRisks: ["none"],
      activeBlockers: [{ reason: "missing credentials" }],
      retryHistory: [],
    });

    expect(result.status).toBe("block");
    expect(result.reasons).toContain("Active blocker remains: missing credentials");
  });

  test("blocks when delegated work lacks accepted review", () => {
    const result = evaluateFinalReviewGate(completedCodeRun(), {
      profile: "balanced",
      changedFiles: ["src/plugin/tools/dispatch.ts"],
      delegatedReviews: ["needs_followup: missing verification"],
      residualRisks: ["none"],
      activeBlockers: [],
      retryHistory: [],
      delegatedWorkRequired: true,
    });

    expect(result.status).toBe("block");
    expect(result.reasons).toContain("Delegated review has not been accepted yet.");
  });

  test("blocks when retry history has unresolved exhausted recovery", () => {
    const result = evaluateFinalReviewGate(completedCodeRun(), {
      profile: "balanced",
      changedFiles: ["src/plugin/tools/dispatch.ts"],
      delegatedReviews: ["accepted"],
      residualRisks: ["none"],
      activeBlockers: [],
      retryHistory: [{ id: "bg-1", failureReason: "Retry budget exhausted: network timeout" }],
    });

    expect(result.status).toBe("block");
    expect(result.reasons).toContain("Retry history contains unresolved exhausted recovery: bg-1");
  });

  test("blocks when retry history contains structured exhausted recovery", () => {
    const result = evaluateFinalReviewGate(completedCodeRun(), {
      profile: "balanced",
      changedFiles: ["src/plugin/tools/dispatch.ts"],
      delegatedReviews: ["accepted"],
      residualRisks: ["none"],
      activeBlockers: [],
      retryHistory: [
        { id: "bg-2", status: "exhausted", resolved: false },
        { id: "bg-3", retryExhausted: true },
        { id: "bg-4", retryCount: 2, maxRetries: 2, status: "blocked", resolved: false },
      ],
    });

    expect(result.status).toBe("block");
    expect(result.reasons).toContain("Retry history contains unresolved exhausted recovery: bg-2");
    expect(result.reasons).toContain("Retry history contains unresolved exhausted recovery: bg-3");
    expect(result.reasons).toContain("Retry history contains unresolved exhausted recovery: bg-4");
  });

  test("does not block resolved exhausted retry record", () => {
    const result = evaluateFinalReviewGate(completedCodeRun(), {
      profile: "balanced",
      changedFiles: ["src/plugin/tools/dispatch.ts"],
      delegatedReviews: ["accepted"],
      residualRisks: ["none"],
      activeBlockers: [],
      retryHistory: [{ id: "bg-5", status: "exhausted", resolved: true }],
    });

    expect(result.status).toBe("pass");
    expect(result.reasons).toEqual([]);
  });

  test("does not block normal retry child history without exhausted or failure marker", () => {
    const result = evaluateFinalReviewGate(completedCodeRun(), {
      profile: "balanced",
      changedFiles: ["src/plugin/tools/dispatch.ts"],
      delegatedReviews: ["accepted"],
      residualRisks: ["none"],
      activeBlockers: [],
      retryHistory: [{ id: "bg-retry", retryCount: 1, maxRetries: 1, recoveryCategory: "transient_network" }],
    });

    expect(result.status).toBe("pass");
    expect(result.reasons).toEqual([]);
  });

  test("blocks retry counts at max when paired with unresolved failure marker", () => {
    const result = evaluateFinalReviewGate(completedCodeRun(), {
      profile: "balanced",
      changedFiles: ["src/plugin/tools/dispatch.ts"],
      delegatedReviews: ["accepted"],
      residualRisks: ["none"],
      activeBlockers: [],
      retryHistory: [{ id: "bg-exhausted", retryCount: 1, maxRetries: 1, failureReason: "network timeout", status: "blocked" }],
    });

    expect(result.status).toBe("block");
    expect(result.reasons).toContain("Retry history contains unresolved exhausted recovery: bg-exhausted");
  });

  test("does not block successful accepted retry lineage", () => {
    const result = evaluateFinalReviewGate(completedCodeRun(), {
      profile: "balanced",
      changedFiles: ["src/plugin/tools/dispatch.ts"],
      delegatedReviews: ["status=accepted"],
      residualRisks: ["none"],
      activeBlockers: [],
      retryHistory: [
        { id: "bg-original", retryCount: 1, maxRetries: 1, failureReason: "network timeout", status: "error", reviewStatus: "retryable_failure", resolved: true },
        { id: "bg-retry", retryCount: 1, maxRetries: 1, failureReason: "network timeout", status: "completed", reviewStatus: "accepted" },
      ],
    });

    expect(result.status).toBe("pass");
    expect(result.reasons).toEqual([]);
  });

  test("blocks delegated work review with negated accepted text", () => {
    const result = evaluateFinalReviewGate(completedCodeRun(), {
      profile: "balanced",
      changedFiles: ["src/plugin/tools/dispatch.ts"],
      delegatedReviews: ["needs_followup: not accepted by reviewer"],
      residualRisks: ["none"],
      activeBlockers: [],
      retryHistory: [],
      delegatedWorkRequired: true,
    });

    expect(result.status).toBe("block");
    expect(result.reasons).toContain("Delegated review has not been accepted yet.");
  });

  test("blocks delegated work review when any delegated review entry is unaccepted", () => {
    const result = evaluateFinalReviewGate(completedCodeRun(), {
      profile: "balanced",
      changedFiles: ["src/plugin/tools/dispatch.ts"],
      delegatedReviews: ["status=accepted", "status=pending_review"],
      residualRisks: ["none"],
      activeBlockers: [],
      retryHistory: [],
      delegatedWorkRequired: true,
    });

    expect(result.status).toBe("block");
    expect(result.reasons).toContain("Delegated review has not been accepted yet.");
  });

  test("passes delegated work review with explicit accepted formats", () => {
    for (const delegatedReviews of [["accepted: explorer reviewed output"], ["status=accepted"]]) {
      const result = evaluateFinalReviewGate(completedCodeRun(), {
        profile: "balanced",
        changedFiles: ["src/plugin/tools/dispatch.ts"],
        delegatedReviews,
        residualRisks: ["none"],
        activeBlockers: [],
        retryHistory: [],
        delegatedWorkRequired: true,
      });

      expect(result.status).toBe("pass");
      expect(result.reasons).toEqual([]);
    }
  });

  test("blocks when workflow itself is blocked", () => {
    const run = blockWorkflow(completedCodeRun(), {
      reason: "approval required",
      category: "user_approval_required",
      evidence: ["needs approval"],
      nextOptions: ["Ask user"],
    });

    const result = evaluateFinalReviewGate(run, {
      profile: "balanced",
      changedFiles: ["src/plugin/tools/dispatch.ts"],
      delegatedReviews: ["accepted"],
      residualRisks: ["none"],
      activeBlockers: [],
      retryHistory: [],
    });

    expect(result.status).toBe("block");
    expect(result.reasons.join("\n")).toContain("approval required");
  });
});
