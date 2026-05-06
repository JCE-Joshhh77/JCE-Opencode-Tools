import { describe, expect, test } from "bun:test";
import { addWorkflowStep, attachStepEvidence, blockWorkflow, createWorkflowRun } from "../../src/plugin/lib/workflow.ts";
import { buildCompletionCertificate } from "../../src/plugin/lib/completion-certificate.ts";

describe("completion certificate", () => {
  test("refuses successful certificate when required evidence is missing", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Code", acceptanceCriteria: ["code verified"] });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Add code",
      taskType: "code",
      expectedOutput: "Code change",
      verification: ["bun test tests/unit/plugin-workflow.test.ts"],
    });

    const result = buildCompletionCertificate(run, { profile: "balanced", changedFiles: ["src/plugin/lib/workflow.ts"], residualRisks: [] });

    expect(result.valid).toBe(false);
    expect(result.certificate).toContain("## Status\nneeds_verification");
    expect(result.certificate).toContain("Step step-1 requires passing relevant command evidence for task type code.");
  });

  test("builds certificate with evidence, files, delegated review, and risks", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Code", acceptanceCriteria: ["code verified"] });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Add code verified",
      taskType: "code",
      expectedOutput: "code verified",
      verification: ["bun test tests/unit/plugin-workflow.test.ts"],
    });
    run = attachStepEvidence(run, "step-1", {
      kind: "command",
      summary: "bun test tests/unit/plugin-workflow.test.ts: pass",
      command: "bun test tests/unit/plugin-workflow.test.ts",
      passed: true,
    });

    const result = buildCompletionCertificate(run, {
      profile: "balanced",
      changedFiles: ["src/plugin/lib/workflow.ts"],
      delegatedReviews: ["bg-1 accepted"],
      residualRisks: ["none"],
    });

    expect(result.valid).toBe(true);
    expect(result.certificate).toContain("## Status\ncompleted");
    expect(result.certificate).toContain("## Outcome\nCode");
    expect(result.certificate).toContain("- code verified");
    expect(result.certificate).toContain("- src/plugin/lib/workflow.ts");
    expect(result.certificate).toContain("- bun test tests/unit/plugin-workflow.test.ts: pass");
    expect(result.certificate).toContain("- bg-1 accepted");
    expect(result.certificate).toContain("- none");
  });

  test("refuses successful certificate for blocked workflow with passing evidence", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Code", acceptanceCriteria: ["code verified"] });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Add code verified",
      taskType: "code",
      expectedOutput: "code verified",
      verification: ["bun test tests/unit/plugin-workflow.test.ts"],
    });
    run = attachStepEvidence(run, "step-1", {
      kind: "command",
      summary: "bun test tests/unit/plugin-workflow.test.ts: pass",
      command: "bun test tests/unit/plugin-workflow.test.ts",
      passed: true,
    });
    run = blockWorkflow(run, {
      reason: "Awaiting security approval",
      category: "review",
      evidence: ["security-review-requested"],
      nextOptions: ["complete security review"],
    });

    const result = buildCompletionCertificate(run, { profile: "balanced", changedFiles: ["src/plugin/lib/workflow.ts"], residualRisks: [] });

    expect(result.valid).toBe(false);
    expect(result.certificate).toContain("## Status\nblocked");
    expect(result.certificate).toContain("Awaiting security approval");
  });

  test("refuses successful certificate when a blocked step has passing evidence", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Code", acceptanceCriteria: ["code verified"] });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Add code verified",
      taskType: "code",
      expectedOutput: "code verified",
      verification: ["bun test tests/unit/plugin-workflow.test.ts"],
    });
    run = attachStepEvidence(run, "step-1", {
      kind: "command",
      summary: "bun test tests/unit/plugin-workflow.test.ts: pass",
      command: "bun test tests/unit/plugin-workflow.test.ts",
      passed: true,
    });
    run.steps[0].status = "blocked";

    const result = buildCompletionCertificate(run, { profile: "balanced", changedFiles: ["src/plugin/lib/workflow.ts"], residualRisks: [] });

    expect(result.valid).toBe(false);
    expect(result.certificate).toContain("## Status\nblocked");
    expect(result.certificate).toContain("Step step-1 is blocked.");
  });

  test("refuses successful certificate when a step blocker has passing evidence", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Code", acceptanceCriteria: ["code verified"] });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Add code verified",
      taskType: "code",
      expectedOutput: "code verified",
      verification: ["bun test tests/unit/plugin-workflow.test.ts"],
    });
    run = attachStepEvidence(run, "step-1", {
      kind: "command",
      summary: "bun test tests/unit/plugin-workflow.test.ts: pass",
      command: "bun test tests/unit/plugin-workflow.test.ts",
      passed: true,
    });
    run.steps[0].blocker = {
      reason: "Awaiting approval",
      category: "review",
      evidence: ["approval-requested"],
      nextOptions: ["complete approval"],
    };

    const result = buildCompletionCertificate(run, { profile: "balanced", changedFiles: ["src/plugin/lib/workflow.ts"], residualRisks: [] });

    expect(result.valid).toBe(false);
    expect(result.certificate).toContain("## Status\nblocked");
    expect(result.certificate).toContain("Step step-1 is blocked: Awaiting approval");
  });
});
