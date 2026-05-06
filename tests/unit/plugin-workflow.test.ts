import { describe, expect, test } from "bun:test";
import {
  addWorkflowStep,
  applyWorkflowIntentRoute,
  attachStepEvidence,
  blockWorkflow,
  createWorkflowRun,
  deriveWorkflowStatus,
  updateWorkflowStepStatus,
} from "../../src/plugin/lib/workflow.ts";

describe("workflow runtime", () => {
  test("applies intent route metadata without changing workflow status", () => {
    const run = createWorkflowRun({ id: "wf-route", goal: "Fix bug", now: "2026-05-06T00:00:00.000Z" });

    const routed = applyWorkflowIntentRoute(run, {
      intent: "bugfix",
      skills: ["systematic-debugging", "test-driven-development"],
      reason: "Detected bug or failing test intent.",
      source: "message",
    }, "2026-05-06T00:01:00.000Z");

    expect(routed.status).toBe("planning");
    expect(routed.route).toEqual({
      intent: "bugfix",
      skills: ["systematic-debugging", "test-driven-development"],
      reason: "Detected bug or failing test intent.",
      source: "message",
    });
    expect(routed.updatedAt).toBe("2026-05-06T00:01:00.000Z");
  });

  test("preserves route metadata when cloning workflow changes", () => {
    let run = createWorkflowRun({ id: "wf-route", goal: "Review implementation", now: "2026-05-06T00:00:00.000Z" });
    run = applyWorkflowIntentRoute(run, {
      intent: "review",
      skills: ["requesting-code-review"],
      reason: "Review requests require a code-review workflow.",
      source: "message",
    });

    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Inspect code",
      taskType: "review",
      expectedOutput: "Review findings",
      verification: ["review notes"],
    });

    expect(run.route?.intent).toBe("review");
    expect(run.steps).toHaveLength(1);
  });

  test("clone-based workflow updates isolate nested route evidence and blocker data", () => {
    let original = createWorkflowRun({ id: "wf-clone", goal: "Keep snapshots isolated", now: "2026-05-06T00:00:00.000Z" });
    original = applyWorkflowIntentRoute(original, {
      intent: "bugfix",
      skills: ["systematic-debugging"],
      reason: "Detected bug or failing test intent.",
      source: "message",
    });
    original = addWorkflowStep(original, {
      id: "step-1",
      title: "Verify isolation",
      taskType: "code",
      verification: ["bun test"],
    });
    original = attachStepEvidence(original, "step-1", {
      kind: "command",
      summary: "bun test: pass",
      command: "bun test",
      passed: true,
    });
    original.steps[0].blocker = {
      reason: "Step blocked",
      category: "review",
      evidence: ["step-evidence"],
      nextOptions: ["step-option"],
    };
    original = blockWorkflow(original, {
      reason: "Workflow blocked",
      category: "missing_access",
      evidence: ["workflow-evidence"],
      nextOptions: ["workflow-option"],
    });

    const cloned = updateWorkflowStepStatus(original, "step-1", "running");
    cloned.route?.skills.push("mutated-route");
    cloned.steps[0].evidence[0].summary = "mutated step evidence";
    cloned.evidence[0].summary = "mutated workflow evidence";
    cloned.steps[0].blocker?.evidence.push("mutated-step-evidence");
    cloned.steps[0].blocker?.nextOptions.push("mutated-step-option");
    cloned.blocker?.evidence.push("mutated-workflow-evidence");
    cloned.blocker?.nextOptions.push("mutated-workflow-option");

    expect(original.route?.skills).toEqual(["systematic-debugging"]);
    expect(original.steps[0].evidence[0].summary).toBe("bun test: pass");
    expect(original.evidence[0].summary).toBe("bun test: pass");
    expect(original.steps[0].blocker?.evidence).toEqual(["step-evidence"]);
    expect(original.steps[0].blocker?.nextOptions).toEqual(["step-option"]);
    expect(original.blocker?.evidence).toEqual(["workflow-evidence"]);
    expect(original.blocker?.nextOptions).toEqual(["workflow-option"]);
  });

  test("creates a workflow run with explicit lifecycle defaults", () => {
    const run = createWorkflowRun({
      id: "wf-1",
      goal: "Implement runtime",
      acceptanceCriteria: ["workflow exists"],
      now: "2026-05-06T00:00:00.000Z",
    });

    expect(run).toMatchObject({
      id: "wf-1",
      goal: "Implement runtime",
      status: "planning",
      activeStepId: undefined,
      acceptanceCriteria: ["workflow exists"],
      evidence: [],
      steps: [],
      retryPolicy: { maxRetries: 1 },
      completionGate: { status: "pending", reasons: [] },
    });
    expect(run.createdAt).toBe("2026-05-06T00:00:00.000Z");
    expect(run.updatedAt).toBe("2026-05-06T00:00:00.000Z");
  });

  test("adds steps and derives active execution state", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Ship", now: "2026-05-06T00:00:00.000Z" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Write tests",
      taskType: "code",
      expectedOutput: "Failing tests",
      verification: ["bun test tests/unit/plugin-workflow.test.ts"],
    }, "2026-05-06T00:01:00.000Z");

    expect(run.steps).toHaveLength(1);
    expect(run.steps[0].status).toBe("pending");
    expect(run.status).toBe("ready");

    run = updateWorkflowStepStatus(run, "step-1", "running", "2026-05-06T00:02:00.000Z");
    expect(run.activeStepId).toBe("step-1");
    expect(deriveWorkflowStatus(run)).toBe("executing");
  });

  test("attaches evidence to a step and the workflow", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Verify", now: "2026-05-06T00:00:00.000Z" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Run test",
      taskType: "code",
      expectedOutput: "Passing tests",
      verification: ["bun test tests/unit/plugin-workflow.test.ts"],
    });

    run = attachStepEvidence(run, "step-1", {
      kind: "command",
      summary: "bun test tests/unit/plugin-workflow.test.ts: 3 pass",
      command: "bun test tests/unit/plugin-workflow.test.ts",
      passed: true,
    }, "2026-05-06T00:03:00.000Z");

    expect(run.steps[0].evidence).toHaveLength(1);
    expect(run.evidence).toHaveLength(1);
    expect(run.evidence[0].summary).toContain("3 pass");
  });

  test("blocks workflow with actionable blocker", () => {
    const run = createWorkflowRun({ id: "wf-1", goal: "Needs access", now: "2026-05-06T00:00:00.000Z" });
    const blocked = blockWorkflow(run, {
      reason: "Missing credentials",
      category: "missing_access",
      evidence: ["API returned 401"],
      nextOptions: ["Provide credentials", "Skip integration check"],
    }, "2026-05-06T00:04:00.000Z");

    expect(blocked.status).toBe("blocked");
    expect(blocked.blocker?.reason).toBe("Missing credentials");
    expect(blocked.blocker?.nextOptions).toContain("Provide credentials");
  });

  test("derives blocked when any step is blocked despite passing evidence", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Blocked step", now: "2026-05-06T00:00:00.000Z" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Validate code",
      taskType: "code",
      expectedOutput: "Passing tests",
      verification: ["bun test tests/unit/plugin-workflow.test.ts"],
    });
    run = attachStepEvidence(run, "step-1", {
      kind: "command",
      summary: "bun test tests/unit/plugin-workflow.test.ts: pass",
      command: "bun test tests/unit/plugin-workflow.test.ts",
      passed: true,
    });
    run = updateWorkflowStepStatus(run, "step-1", "blocked");

    expect(deriveWorkflowStatus(run)).toBe("blocked");
  });

  test("derives blocked when any step has a blocker despite passing evidence", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Blocked step", now: "2026-05-06T00:00:00.000Z" });
    run = addWorkflowStep(run, {
      id: "step-1",
      title: "Validate code",
      taskType: "code",
      expectedOutput: "Passing tests",
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

    expect(deriveWorkflowStatus(run)).toBe("blocked");
  });

  test("throws for unknown step updates", () => {
    const run = createWorkflowRun({ id: "wf-1", goal: "Ship" });
    expect(() => updateWorkflowStepStatus(run, "missing", "running")).toThrow("Workflow step not found: missing");
  });
});
