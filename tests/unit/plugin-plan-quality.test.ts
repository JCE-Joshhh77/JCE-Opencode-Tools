import { describe, expect, test } from "bun:test";
import { addWorkflowStep, createWorkflowRun } from "../../src/plugin/lib/workflow.ts";
import { validateWorkflowPlan } from "../../src/plugin/lib/plan-quality.ts";

describe("workflow plan quality", () => {
  test("accepts a complete complex plan", () => {
    let run = createWorkflowRun({
      id: "wf-1",
      goal: "Implement runtime",
      acceptanceCriteria: ["workflow model exists", "verification gate exists"],
    });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Add workflow model",
      taskType: "code",
      expectedOutput: "Workflow runtime module",
      verification: ["bun test tests/unit/plugin-workflow.test.ts"],
    });
    run = addWorkflowStep(run, {
      id: "step-2",
      title: "Add verification gate",
      taskType: "code",
      dependsOn: ["step-1"],
      expectedOutput: "Verification gate module",
      verification: ["bun test tests/unit/plugin-verification-gate.test.ts"],
    });

    const result = validateWorkflowPlan(run, { complex: true });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test("requires complex plans to include steps", () => {
    const run = createWorkflowRun({ id: "wf-1", goal: "Implement runtime", acceptanceCriteria: ["workflow model exists"] });
    const result = validateWorkflowPlan(run, { complex: true });

    expect(result.valid).toBe(false);
    expect(result.issues).toContain("Complex workflows must include at least one step.");
  });

  test("requires acceptance criteria to be covered by steps", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Implement runtime", acceptanceCriteria: ["workflow model exists", "certificate exists"] });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Add workflow model",
      taskType: "code",
      expectedOutput: "workflow model exists",
      verification: ["bun test tests/unit/plugin-workflow.test.ts"],
    });

    const result = validateWorkflowPlan(run, { complex: true });

    expect(result.valid).toBe(false);
    expect(result.issues).toContain("Acceptance criterion is not covered by any step: certificate exists");
  });

  test("matches acceptance criteria as whole normalized tokens", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Implement runtime", acceptanceCriteria: ["cat exists"] });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Concatenate runtime inputs",
      taskType: "code",
      expectedOutput: "Runtime concatenation module",
      verification: ["bun test tests/unit/plugin-workflow.test.ts"],
    });

    const result = validateWorkflowPlan(run, { complex: true });

    expect(result.valid).toBe(false);
    expect(result.issues).toContain("Acceptance criterion is not covered by any step: cat exists");
  });

  test("rejects broad sequencing markers in steps", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Implement runtime" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Add model and then wire validation",
      taskType: "code",
      expectedOutput: "Model; validation; runtime wiring",
      verification: ["bun test tests/unit/plugin-workflow.test.ts"],
    });

    const result = validateWorkflowPlan(run, { complex: true });

    expect(result.valid).toBe(false);
    expect(result.issues).toContain("Step step-1 is too broad for one execution unit.");
  });

  test("rejects missing expected output and verification on code steps", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Implement runtime" });
    run = addWorkflowStep(run, { id: "step-1", title: "Add code", taskType: "code" });

    const result = validateWorkflowPlan(run, { complex: true });

    expect(result.valid).toBe(false);
    expect(result.issues).toContain("Step step-1 must define expected output.");
    expect(result.issues).toContain("Step step-1 with task type code must define verification.");
  });

  test("rejects dependencies that reference missing or later steps", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Implement runtime" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Add code",
      taskType: "code",
      dependsOn: ["missing", "step-2"],
      expectedOutput: "Code",
      verification: ["bun test tests/unit/plugin-workflow.test.ts"],
    });
    run = addWorkflowStep(run, {
      id: "step-2",
      title: "Add tests",
      taskType: "code",
      expectedOutput: "Tests",
      verification: ["bun test tests/unit/plugin-workflow.test.ts"],
    });

    const result = validateWorkflowPlan(run, { complex: true });

    expect(result.valid).toBe(false);
    expect(result.issues).toContain("Step step-1 depends on unknown step: missing");
    expect(result.issues).toContain("Step step-1 depends on step step-2 that does not appear earlier in the plan.");
  });
});
