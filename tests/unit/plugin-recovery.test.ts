import { describe, expect, test } from "bun:test";
import { addWorkflowStep, createWorkflowRun, updateWorkflowStepStatus } from "../../src/plugin/lib/workflow.ts";
import { buildRetryPrompt, decideRecovery } from "../../src/plugin/lib/recovery.ts";

describe("JCE-Worker recovery decisions", () => {
  test("retries transient failures while budget remains", () => {
    const decision = decideRecovery({
      errorText: "network timeout",
      retryCount: 0,
      maxRetries: 1,
      workflow: createWorkflowRun({ id: "wf-1", goal: "Recover" }),
      priorEvidence: ["first attempt timed out"],
    });

    expect(decision.action).toBe("retry");
    expect(decision.category).toBe("transient_network");
    expect(decision.reason).toContain("retry budget remains");
  });

  test("blocks transient failures after retry budget is exhausted", () => {
    const decision = decideRecovery({
      errorText: "network timeout",
      retryCount: 1,
      maxRetries: 1,
      workflow: createWorkflowRun({ id: "wf-1", goal: "Recover" }),
      priorEvidence: ["first attempt timed out"],
    });

    expect(decision.action).toBe("blocked");
    expect(decision.handoff?.blocker).toContain("Retry budget exhausted");
  });

  test("blocks immediately for missing access", () => {
    const decision = decideRecovery({
      errorText: "401 unauthorized missing credentials",
      retryCount: 0,
      maxRetries: 3,
      workflow: createWorkflowRun({ id: "wf-1", goal: "Recover" }),
      priorEvidence: ["API returned 401"],
    });

    expect(decision.action).toBe("blocked");
    expect(decision.category).toBe("missing_access");
    expect(decision.handoff?.nextOptions).toContain("Resolve missing access or approval, then retry.");
  });

  test("blocked handoff for missing access has no completed items without completed workflow steps", () => {
    const decision = decideRecovery({
      errorText: "401 unauthorized missing credentials",
      retryCount: 0,
      maxRetries: 3,
      workflow: createWorkflowRun({ id: "wf-1", goal: "Recover" }),
      priorEvidence: ["API returned 401"],
    });

    expect(decision.handoff?.completed).toEqual([]);
  });

  test("blocked handoff includes completed workflow step titles", () => {
    const run = updateWorkflowStepStatus(
      addWorkflowStep(createWorkflowRun({ id: "wf-1", goal: "Recover" }), {
        id: "step-1",
        title: "Inspect workflow runtime",
        taskType: "code",
      }),
      "step-1",
      "completed",
    );

    const decision = decideRecovery({
      errorText: "401 unauthorized missing credentials",
      retryCount: 0,
      maxRetries: 3,
      workflow: run,
      priorEvidence: ["API returned 401"],
    });

    expect(decision.handoff?.completed).toEqual(["Inspect workflow runtime"]);
  });

  test("merge conflict blocked handoff next options mention resolving merge conflicts", () => {
    const decision = decideRecovery({
      errorText: "merge conflict in src/plugin/index.ts",
      retryCount: 0,
      maxRetries: 3,
      workflow: createWorkflowRun({ id: "wf-1", goal: "Recover" }),
      priorEvidence: ["git reported conflicted files"],
    });

    expect(decision.action).toBe("blocked");
    expect(decision.category).toBe("merge_conflict");
    expect(decision.handoff?.nextOptions.join(" ")).toContain("merge conflicts");
    expect(decision.handoff?.nextOptions).not.toContain("Resolve missing access or approval, then retry.");
  });

  test("zero retry budget blocks transient failure", () => {
    const decision = decideRecovery({
      errorText: "network timeout",
      retryCount: 0,
      maxRetries: 0,
      workflow: createWorkflowRun({ id: "wf-1", goal: "Recover" }),
      priorEvidence: ["first attempt timed out"],
    });

    expect(decision.action).toBe("blocked");
    expect(decision.handoff?.blocker).toContain("Retry budget exhausted");
  });

  test("negative retry count is normalized to zero and can retry when budget remains", () => {
    const decision = decideRecovery({
      errorText: "network timeout",
      retryCount: -1,
      maxRetries: 1,
      workflow: createWorkflowRun({ id: "wf-1", goal: "Recover" }),
      priorEvidence: ["invalid retry count from caller"],
    });

    expect(decision.action).toBe("retry");
    expect(decision.reason).toContain("retry budget remains");
  });

  test("negative max retries is normalized to zero and blocks", () => {
    const decision = decideRecovery({
      errorText: "network timeout",
      retryCount: 0,
      maxRetries: -1,
      workflow: createWorkflowRun({ id: "wf-1", goal: "Recover" }),
      priorEvidence: ["invalid retry budget from caller"],
    });

    expect(decision.action).toBe("blocked");
    expect(decision.handoff?.blocker).toContain("Retry budget exhausted");
  });

  test("unknown errors block with generic next option", () => {
    const decision = decideRecovery({
      errorText: "something novel happened",
      retryCount: 0,
      maxRetries: 3,
      workflow: createWorkflowRun({ id: "wf-1", goal: "Recover" }),
      priorEvidence: [],
    });

    expect(decision.action).toBe("blocked");
    expect(decision.category).toBe("unknown");
    expect(decision.handoff?.nextOptions.join(" ")).toContain("Inspect failure and decide next action");
    expect(decision.handoff?.nextOptions).not.toContain("Resolve missing access or approval, then retry.");
  });

  test("tool failure retries while budget remains", () => {
    const decision = decideRecovery({
      errorText: "tool execution failed",
      retryCount: 0,
      maxRetries: 1,
      workflow: createWorkflowRun({ id: "wf-1", goal: "Recover" }),
      priorEvidence: ["tool failed before completing"],
    });

    expect(decision.action).toBe("retry");
    expect(decision.category).toBe("tool_failure");
  });

  test("verification failure after exhausted retries blocks with retry budget exhausted", () => {
    const decision = decideRecovery({
      errorText: "verification failed",
      retryCount: 1,
      maxRetries: 1,
      workflow: createWorkflowRun({ id: "wf-1", goal: "Recover" }),
      priorEvidence: ["test command failed"],
    });

    expect(decision.action).toBe("blocked");
    expect(decision.category).toBe("verification_failed");
    expect(decision.reason).toBe("Retry budget exhausted.");
    expect(decision.handoff?.blocker).toContain("Retry budget exhausted");
  });

  test("asks follow-up for ambiguous requirements", () => {
    const decision = decideRecovery({
      errorText: "ambiguous requirement and unclear scope",
      retryCount: 0,
      maxRetries: 3,
      workflow: createWorkflowRun({ id: "wf-1", goal: "Recover" }),
      priorEvidence: [],
    });

    expect(decision.action).toBe("needs_followup");
    expect(decision.category).toBe("ambiguous_requirement");
  });

  test("builds retry prompt with prior evidence and failure context", () => {
    const prompt = buildRetryPrompt({
      originalPrompt: "Inspect the workflow runtime",
      category: "transient_network",
      failureReason: "network timeout",
      priorEvidence: ["attempt 1 timed out", "no files changed"],
      retryCount: 1,
      maxRetries: 2,
    });

    expect(prompt).toContain("Inspect the workflow runtime");
    expect(prompt).toContain("transient_network");
    expect(prompt).toContain("network timeout");
    expect(prompt).toContain("attempt 1 timed out");
    expect(prompt).toContain("Retry 1 of 2");
  });
});
