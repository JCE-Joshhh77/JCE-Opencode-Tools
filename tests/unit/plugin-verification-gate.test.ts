import { describe, expect, test } from "bun:test";
import { addWorkflowStep, attachStepEvidence, createWorkflowRun } from "../../src/plugin/lib/workflow.ts";
import { evaluateWorkflowCompletionGate, evaluateWorkflowStepGate } from "../../src/plugin/lib/verification-gate.ts";

describe("workflow verification gate", () => {
  test("requires command evidence for code steps", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Code" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Add code",
      taskType: "code",
      expectedOutput: "Code change",
      verification: ["bun test tests/unit/plugin-workflow.test.ts"],
    });

    const result = evaluateWorkflowStepGate(run.steps[0], "balanced");

    expect(result.status).toBe("needs_verification");
    expect(result.reasons).toContain("Step step-1 requires passing relevant command evidence for task type code.");
  });

  test("passes code steps with passing command evidence", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Code" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Add code",
      taskType: "code",
      expectedOutput: "Code change",
      verification: ["bun test tests/unit/plugin-workflow.test.ts"],
    });
    run = attachStepEvidence(run, "step-1", {
      kind: "command",
      summary: "bun test tests/unit/plugin-workflow.test.ts: pass",
      command: "bun test tests/unit/plugin-workflow.test.ts",
      passed: true,
    });

    expect(evaluateWorkflowStepGate(run.steps[0], "balanced")).toEqual({ status: "pass", reasons: [] });
  });

  test("rejects unrelated passing command evidence for code steps", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Code" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Add code",
      taskType: "code",
      expectedOutput: "Code change",
      verification: ["bun test tests/unit/plugin-workflow.test.ts"],
    });
    run = attachStepEvidence(run, "step-1", {
      kind: "command",
      summary: "date: pass",
      command: "date",
      passed: true,
    });

    const dateResult = evaluateWorkflowStepGate(run.steps[0], "balanced");

    expect(dateResult.status).toBe("needs_verification");
    expect(dateResult.reasons).toContain("Step step-1 requires passing relevant command evidence for task type code.");

    run = attachStepEvidence(run, "step-1", {
      kind: "command",
      summary: "pwd: pass",
      command: "pwd",
      passed: true,
    });

    const pwdResult = evaluateWorkflowStepGate(run.steps[0], "balanced");

    expect(pwdResult.status).toBe("needs_verification");
    expect(pwdResult.reasons).toContain("Step step-1 requires passing relevant command evidence for task type code.");
  });

  test("passes code steps when command matches verification expectation", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Code" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Add code",
      taskType: "code",
      expectedOutput: "Code change",
      verification: ["bun test tests/unit/plugin-workflow.test.ts"],
    });
    run = attachStepEvidence(run, "step-1", {
      kind: "command",
      summary: "bun test tests/unit/plugin-workflow.test.ts: pass",
      command: "bun test tests/unit/plugin-workflow.test.ts",
      passed: true,
    });

    expect(evaluateWorkflowStepGate(run.steps[0], "balanced")).toEqual({ status: "pass", reasons: [] });
  });

  test("passes code steps with known verification command markers", () => {
    for (const command of ["bun run typecheck", "tsc --noEmit", "bun test", "npm test", "bun run lint", "bun run build", "bun run check"]) {
      let run = createWorkflowRun({ id: `wf-${command}`, goal: "Code" });
      run = addWorkflowStep(run, {
        id: "step-1",
        title: "Add code",
        taskType: "code",
        expectedOutput: "Code change",
        verification: ["run relevant verification"],
      });
      run = attachStepEvidence(run, "step-1", {
        kind: "command",
        summary: `${command}: pass`,
        command,
        passed: true,
      });

      expect(evaluateWorkflowStepGate(run.steps[0], "balanced")).toEqual({ status: "pass", reasons: [] });
    }
  });

  test("rejects command evidence with omitted passed status for code steps", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Code" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Add code",
      taskType: "code",
      expectedOutput: "Code change",
      verification: ["bun test tests/unit/plugin-workflow.test.ts"],
    });
    run = attachStepEvidence(run, "step-1", {
      kind: "command",
      summary: "bun test tests/unit/plugin-workflow.test.ts: unknown",
      command: "bun test tests/unit/plugin-workflow.test.ts",
    });

    const result = evaluateWorkflowStepGate(run.steps[0], "balanced");

    expect(result.status).toBe("needs_verification");
    expect(result.reasons).toContain("Step step-1 requires passing relevant command evidence for task type code.");
  });

  test("rejects failed command evidence for code steps", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Code" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Add code",
      taskType: "code",
      expectedOutput: "Code change",
      verification: ["bun test tests/unit/plugin-workflow.test.ts"],
    });
    run = attachStepEvidence(run, "step-1", {
      kind: "command",
      summary: "bun test tests/unit/plugin-workflow.test.ts: fail",
      command: "bun test tests/unit/plugin-workflow.test.ts",
      passed: false,
    });

    const result = evaluateWorkflowStepGate(run.steps[0], "balanced");

    expect(result.status).toBe("needs_verification");
    expect(result.reasons).toContain("Step step-1 requires passing relevant command evidence for task type code.");
  });

  test("requires config command evidence to indicate parse schema startup or load validation", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Config" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Update config",
      taskType: "config",
      expectedOutput: "Valid config",
      verification: ["node --check config.js"],
    });
    run = attachStepEvidence(run, "step-1", {
      kind: "command",
      summary: "bun test: pass",
      command: "bun test",
      passed: true,
    });

    const generic = evaluateWorkflowStepGate(run.steps[0], "balanced");

    expect(generic.status).toBe("needs_verification");
    expect(generic.reasons).toContain("Step step-1 requires passing config validation command evidence.");

    run = attachStepEvidence(run, "step-1", {
      kind: "command",
      summary: "node --check config.js: pass",
      command: "node --check config.js",
      passed: true,
    });

    expect(evaluateWorkflowStepGate(run.steps[0], "balanced")).toEqual({ status: "pass", reasons: [] });
  });

  test("rejects generic source JavaScript syntax checks for config steps", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Config" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Update config",
      taskType: "config",
      expectedOutput: "Valid config",
      verification: ["node --check config.js"],
    });
    run = attachStepEvidence(run, "step-1", {
      kind: "command",
      summary: "node --check src/plugin/index.js: pass",
      command: "node --check src/plugin/index.js",
      passed: true,
    });

    const result = evaluateWorkflowStepGate(run.steps[0], "balanced");

    expect(result.status).toBe("needs_verification");
    expect(result.reasons).toContain("Step step-1 requires passing config validation command evidence.");
  });

  test("requires shell command evidence to indicate syntax validation", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Shell" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Update install script",
      taskType: "shell",
      expectedOutput: "Valid shell script",
      verification: ["bash -n scripts/install.sh"],
    });
    run = attachStepEvidence(run, "step-1", {
      kind: "command",
      summary: "bun test: pass",
      command: "bun test",
      passed: true,
    });

    const generic = evaluateWorkflowStepGate(run.steps[0], "balanced");

    expect(generic.status).toBe("needs_verification");
    expect(generic.reasons).toContain("Step step-1 requires passing shell syntax command evidence.");

    run = attachStepEvidence(run, "step-1", {
      kind: "command",
      summary: "bash -n scripts/install.sh: pass",
      command: "bash -n scripts/install.sh",
      passed: true,
    });

    expect(evaluateWorkflowStepGate(run.steps[0], "balanced")).toEqual({ status: "pass", reasons: [] });
  });

  test("allows PowerShell parser command evidence for shell syntax validation", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "PowerShell" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Update installer",
      taskType: "shell",
      expectedOutput: "Valid PowerShell script",
      verification: ["powershell -NoProfile -Command \"[scriptblock]::Create(...)\""],
    });
    run = attachStepEvidence(run, "step-1", {
      kind: "command",
      summary: "PowerShell parser: pass",
      command: "powershell -NoProfile -Command \"[scriptblock]::Create(...)\"",
      passed: true,
    });

    expect(evaluateWorkflowStepGate(run.steps[0], "balanced")).toEqual({ status: "pass", reasons: [] });
  });

  test("requires file or review evidence for docs steps", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Docs" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Write docs",
      taskType: "docs",
      expectedOutput: "Documentation",
    });

    const result = evaluateWorkflowStepGate(run.steps[0], "balanced");

    expect(result.status).toBe("needs_verification");
    expect(result.reasons).toContain("Step step-1 requires file or review evidence for docs changes.");
  });

  test("allows research in fast profile when it has a source", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Research" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Inspect code",
      taskType: "research",
      expectedOutput: "Find relevant files",
    });
    run = attachStepEvidence(run, "step-1", {
      kind: "source",
      summary: "Inspected src/plugin/index.ts",
      file: "src/plugin/index.ts",
      passed: true,
    });

    expect(evaluateWorkflowStepGate(run.steps[0], "fast")).toEqual({ status: "pass", reasons: [] });
  });

  test("allows research in fast profile with manual evidence", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Research" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Inspect code",
      taskType: "research",
      expectedOutput: "Find relevant files",
    });
    run = attachStepEvidence(run, "step-1", {
      kind: "manual",
      summary: "Reviewed relevant code paths",
    });

    expect(evaluateWorkflowStepGate(run.steps[0], "fast")).toEqual({ status: "pass", reasons: [] });
  });

  test("rejects manual research evidence in balanced profile", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Research" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Inspect code",
      taskType: "research",
      expectedOutput: "Find relevant files",
    });
    run = attachStepEvidence(run, "step-1", {
      kind: "manual",
      summary: "Reviewed relevant code paths",
    });

    const result = evaluateWorkflowStepGate(run.steps[0], "balanced");

    expect(result.status).toBe("needs_verification");
    expect(result.reasons).toContain("Step step-1 requires source, file, or review evidence for research.");
  });

  test("blocks strict completion when any step lacks required evidence", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Code" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Add code",
      taskType: "code",
      expectedOutput: "Code change",
      verification: ["bun test tests/unit/plugin-workflow.test.ts"],
    });

    const result = evaluateWorkflowCompletionGate(run, "strict");

    expect(result.status).toBe("blocked");
    expect(result.reasons).toContain("Step step-1 requires passing relevant command evidence for task type code.");
  });

  test("blocks completion when any step status is blocked despite passing evidence", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Code" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Add code",
      taskType: "code",
      expectedOutput: "Code change",
      verification: ["bun test tests/unit/plugin-workflow.test.ts"],
    });
    run = attachStepEvidence(run, "step-1", {
      kind: "command",
      summary: "bun test tests/unit/plugin-workflow.test.ts: pass",
      command: "bun test tests/unit/plugin-workflow.test.ts",
      passed: true,
    });
    run.steps[0].status = "blocked";

    const result = evaluateWorkflowCompletionGate(run, "balanced");

    expect(result.status).toBe("blocked");
    expect(result.reasons).toContain("Step step-1 is blocked.");
  });

  test("blocks completion when any step has a blocker despite passing evidence", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Code" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Add code",
      taskType: "code",
      expectedOutput: "Code change",
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

    const result = evaluateWorkflowCompletionGate(run, "balanced");

    expect(result.status).toBe("blocked");
    expect(result.reasons).toContain("Step step-1 is blocked: Awaiting approval");
  });

  test("requires verification for balanced completion when any step lacks required evidence", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Code" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Add code",
      taskType: "code",
      expectedOutput: "Code change",
      verification: ["bun test tests/unit/plugin-workflow.test.ts"],
    });

    const result = evaluateWorkflowCompletionGate(run, "balanced");

    expect(result.status).toBe("needs_verification");
    expect(result.reasons).toContain("Step step-1 requires passing relevant command evidence for task type code.");
  });
});
