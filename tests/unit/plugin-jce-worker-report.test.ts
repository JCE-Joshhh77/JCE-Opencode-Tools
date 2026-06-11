import { describe, expect, test } from "bun:test";
import { addFailureMemory, createEmptyRuntimeState, createFailureMemoryEntry } from "../../src/plugin/lib/runtime-state.ts";
import { addWorkflowStep, attachStepEvidence, createWorkflowRun, updateWorkflowStepStatus } from "../../src/plugin/lib/workflow.ts";
import { formatJceWorkerReport, formatJceWorkerStatus, formatJceWorkerTrace, formatPlannerExplain, getJceWorkerNextAction } from "../../src/plugin/lib/jce-worker-report.ts";

describe("JCE-Worker CLI report helpers", () => {
  test("formats status from active workflow memory", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Ship Phase 6", now: "2026-05-06T00:00:00.000Z" });
    run = addWorkflowStep(run, { id: "step-1", title: "Add CLI", taskType: "code", expectedOutput: "CLI command", verification: ["bun test"] }, "2026-05-06T00:01:00.000Z");
    run = updateWorkflowStepStatus(run, "step-1", "running", "2026-05-06T00:02:00.000Z");
    const memory = createEmptyRuntimeState("2026-05-06T00:03:00.000Z");
    memory.activeWorkflow = run;
    memory.verificationEvidence = [{ summary: "typecheck passed" }];

    const output = formatJceWorkerStatus(memory);

    expect(output).toContain("Goal: Ship Phase 6");
    expect(output).toContain("State: executing");
    expect(output).toContain("Active step: Add CLI");
    expect(output).toContain("Latest verification: typecheck passed");
    expect(output).toContain("Next action: Continue active workflow step.");
  });

  test("formats status safely when no active workflow exists", () => {
    const output = formatJceWorkerStatus(createEmptyRuntimeState("2026-05-06T00:00:00.000Z"));

    expect(output).toContain("Goal: none");
    expect(output).toContain("State: idle");
    expect(output).toContain("Next action: Start a workflow or dispatch a task.");
  });

  test("formats status safely when legacy active workflow lacks completion gate", () => {
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = {
      id: "wf-legacy",
      goal: "Resume legacy workflow",
      status: "planning",
      steps: [],
      evidence: [],
    } as any;

    expect(() => formatJceWorkerStatus(memory)).not.toThrow();
    const output = formatJceWorkerStatus(memory);

    expect(output).toContain("Goal: Resume legacy workflow");
    expect(output).toContain("State: planning");
    expect(output).toContain("Next action: Review plan and start the next pending step.");
  });

  test("formats status with verification summary from latest memory evidence", () => {
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.verificationEvidence = [
      { id: "old", verificationSummary: "old evidence" },
      { id: "latest-id", verificationSummary: "latest verification content" },
    ];

    const output = formatJceWorkerStatus(memory);

    expect(output).toContain("Latest verification: latest verification content");
    expect(output).not.toContain("Latest verification: latest-id");
  });

  test("formats trace events newest first with task filtering", () => {
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.traceEvents = [
      { type: "task.created", taskId: "task-a", message: "older", at: "2026-05-06T00:01:00.000Z" },
      { type: "task.failed", taskId: "task-b", message: "newer", at: "2026-05-06T00:02:00.000Z" },
    ];

    expect(formatJceWorkerTrace(memory)).toContain("task.failed task-b newer");
    expect(formatJceWorkerTrace(memory, { taskId: "task-a" })).toContain("task.created task-a older");
    expect(formatJceWorkerTrace(memory, { taskId: "task-a" })).not.toContain("task-b");
  });

  test("filters trace events by workflow id", () => {
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.traceEvents = [
      { type: "task.created", taskId: "task-a", message: "workflow one", at: "2026-05-06T00:01:00.000Z", metadata: { workflowId: "wf-1" } },
      { type: "task.created", taskId: "task-b", message: "workflow two", at: "2026-05-06T00:02:00.000Z", metadata: { workflowId: "wf-2" } },
      { type: "task.created", taskId: "task-c", message: "no workflow", at: "2026-05-06T00:03:00.000Z" },
    ];

    const output = formatJceWorkerTrace(memory, { workflowId: "wf-2" });

    expect(output).toContain("task.created task-b workflow two");
    expect(output).not.toContain("workflow one");
    expect(output).not.toContain("no workflow");
  });

  test("limits trace events to newest entries", () => {
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.traceEvents = [
      { type: "task.created", taskId: "task-a", message: "oldest", at: "2026-05-06T00:01:00.000Z" },
      { type: "task.created", taskId: "task-b", message: "middle", at: "2026-05-06T00:02:00.000Z" },
      { type: "task.created", taskId: "task-c", message: "newest", at: "2026-05-06T00:03:00.000Z" },
    ];

    const output = formatJceWorkerTrace(memory, { limit: 2 });

    expect(output).toContain("task.created task-c newest");
    expect(output).toContain("task.created task-b middle");
    expect(output).not.toContain("oldest");
    expect(output.indexOf("newest")).toBeLessThan(output.indexOf("middle"));
  });

  test("sorts trace events by timestamp before applying limit", () => {
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.traceEvents = [
      { type: "task.created", taskId: "task-newest", message: "newest by time", at: "2026-05-06T00:03:00.000Z" },
      { type: "task.created", taskId: "task-oldest", message: "oldest by time", at: "2026-05-06T00:01:00.000Z" },
      { type: "task.created", taskId: "task-middle", message: "middle by time", at: "2026-05-06T00:02:00.000Z" },
    ];

    const output = formatJceWorkerTrace(memory, { limit: 2 });

    expect(output).toContain("task.created task-newest newest by time");
    expect(output).toContain("task.created task-middle middle by time");
    expect(output).not.toContain("oldest by time");
    expect(output.indexOf("newest by time")).toBeLessThan(output.indexOf("middle by time"));
  });

  test("formats operator report with blockers, evidence, commands, retries, and stale tasks", () => {
    let run = createWorkflowRun({ id: "wf-1", goal: "Recover workflow", now: "2026-05-06T00:00:00.000Z" });
    run = addWorkflowStep(run, { id: "step-1", title: "Verify fix", taskType: "code", expectedOutput: "green tests", verification: ["bun test"] }, "2026-05-06T00:01:00.000Z");
    run = attachStepEvidence(run, "step-1", { kind: "command", command: "bun test", summary: "tests passed", passed: true }, "2026-05-06T00:02:00.000Z");
    const memory = createEmptyRuntimeState("2026-05-06T00:03:00.000Z");
    memory.activeWorkflow = run;
    memory.blockers = [{ reason: "waiting for credentials" }];
    memory.retryHistory = [{ id: "wf-1", reason: "network timeout" }];
    memory.activeTasks = [{ id: "task-1", stale: true }];
    memory.traceEvents = [{ type: "task.created", message: "ran test", at: "2026-05-06T00:04:00.000Z", metadata: { command: "bun test" } }];

    const output = formatJceWorkerReport(memory);

    expect(output).toContain("Goal: Recover workflow");
    expect(output).toContain("Blockers");
    expect(output).toContain("waiting for credentials");
    expect(output).toContain("tests passed");
    expect(output).toContain("bun test");
    expect(output).toContain("network timeout");
    expect(output).toContain("task-1");
  });

  test("formats operator report with memory-level verification evidence when workflow evidence is empty", () => {
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = createWorkflowRun({ id: "wf-1", goal: "Use memory evidence" });
    memory.verificationEvidence = [{ verificationSummary: "memory verification passed" }];

    const output = formatJceWorkerReport(memory);

    expect(output).toContain("Evidence");
    expect(output).toContain("memory verification passed");
  });

  test("formats operator report with workflow-linked retry history", () => {
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = createWorkflowRun({ id: "wf-1", goal: "Recover delegated task" });
    memory.retryHistory = [{ id: "bg-original", rootTaskId: "wf-1", retryTaskId: "bg-retry", failureReason: "network timeout" }];

    const output = formatJceWorkerReport(memory);

    expect(output).toContain("Retry History");
    expect(output).toContain("network timeout");
  });

  test("formats active route in status and operator report", () => {
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory.activeWorkflow = {
      ...createWorkflowRun({ id: "wf-route", goal: "Run parallel research" }),
      route: {
        intent: "parallel_work",
        skills: ["dispatching-parallel-agents"],
        reason: "Independent work can be delegated in parallel.",
        agentHint: "explorer",
        source: "task",
      },
    };

    const status = formatJceWorkerStatus(memory);
    const report = formatJceWorkerReport(memory);

    expect(status).toContain("Intent: parallel_work");
    expect(status).toContain("Suggested skills: dispatching-parallel-agents");
    expect(status).toContain("Agent hint: explorer");
    expect(report).toContain("Routing");
    expect(report).toContain("Intent: parallel_work");
    expect(report).toContain("Source: task");
    expect(report).toContain("Reason: Independent work can be delegated in parallel.");
  });

  test("formats operator report with recent failure memory", () => {
    let memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    memory = addFailureMemory(memory, createFailureMemoryEntry({
      signature: "integrity-check-failed",
      summary: "Updater integrity mismatch on annotated tag",
      rootCause: "Annotated tag SHA compared as commit SHA",
      fixNote: "Resolve peeled tag commit or use lightweight tag",
      failedCommands: ["opencode-jce update"],
      now: "2026-05-06T00:04:00.000Z",
    }));

    const output = formatJceWorkerReport(memory);

    expect(output).toContain("Failure Memory");
    expect(output).toContain("Updater integrity mismatch on annotated tag");
    expect(output).toContain("Annotated tag SHA compared as commit SHA");
    expect(output).toContain("Resolve peeled tag commit or use lightweight tag");
    expect(output).toContain("opencode-jce update");
  });

  test("formats planner rationale from orchestration graph metadata", () => {
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    const orchestration = {
      graph: {
        id: "graph-1",
        goal: "Implement login flow, settings page, and admin audit log",
        status: "executing",
        nodes: [
          { id: "n1", metadata: { plannerMode: "balanced", plannerReason: "Mixed trade-off profile", parallelization: "explicit-independent-units", parallelUnits: ["login flow", "settings page", "admin audit log"] } },
          { id: "n2", metadata: { plannerMode: "balanced", plannerReason: "Mixed trade-off profile", parallelUnits: ["login flow", "settings page", "admin audit log"] } },
        ],
      },
    } as any;

    const status = formatJceWorkerStatus(memory, undefined, orchestration);
    const report = formatJceWorkerReport(memory, undefined, orchestration);

    expect(status).toContain("Parallel fan-out: yes");
    expect(status).toContain("Detected units: login flow, settings page, admin audit log");
    expect(report).toContain("Planner Rationale");
    expect(report).toContain("Planner mode: balanced");
    expect(report).toContain("Planner reason: Mixed trade-off profile");
  });

  test("formats linear fallback reason when planner keeps linear plan", () => {
    const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    const orchestration = {
      graph: {
        id: "graph-2",
        goal: "First update schema, then wire API, then verify migration",
        status: "planning",
        nodes: [
          { id: "n1", metadata: { plannerMode: "careful", plannerReason: "High certainty/blast-radius/reversibility weighting", parallelization: "linear-fallback", parallelFallbackReason: "Sequential dependency signals detected; keep linear plan." } },
        ],
      },
    } as any;

    const report = formatJceWorkerReport(memory, undefined, orchestration);
    expect(report).toContain("Parallel fan-out: no");
    expect(report).toContain("Linear fallback reason: Sequential dependency signals detected; keep linear plan.");
  });

  test("formats standalone planner explain output", () => {
    const orchestration = {
      graph: {
        id: "graph-3",
        goal: "Planner explain",
        status: "planning",
        nodes: [
          { id: "n1", metadata: { plannerMode: "balanced", plannerReason: "Mixed trade-off profile", parallelization: "linear-fallback", parallelFallbackReason: "Not enough clearly independent implementation units detected." } },
        ],
      },
    } as any;

    const text = formatPlannerExplain(orchestration);
    expect(text).toContain("JCE-Worker Planner Explain");
    expect(text).toContain("Parallel fan-out: no");
    expect(text).toContain("Linear fallback reasons: Not enough clearly independent implementation units detected.");
  });

  test("returns conservative next actions for all workflow states", () => {
    const idle = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
    expect(getJceWorkerNextAction(idle)).toBe("Start a workflow or dispatch a task.");

    const expectedByStatus = {
      intake: "Review plan and start the next pending step.",
      planning: "Review plan and start the next pending step.",
      ready: "Review plan and start the next pending step.",
      executing: "Continue active workflow step.",
      delegating: "Continue active workflow step.",
      verifying: "Run or attach required verification evidence.",
      blocked: "Resolve blocker before continuing.",
      awaiting_user: "Wait for user input before continuing.",
      completed: "Review completion certificate or clear runtime memory.",
    } as const;

    for (const [status, expected] of Object.entries(expectedByStatus)) {
      const memory = createEmptyRuntimeState("2026-05-06T00:00:00.000Z");
      memory.activeWorkflow = { ...createWorkflowRun({ id: `wf-${status}`, goal: status }), status: status as keyof typeof expectedByStatus };
      expect(getJceWorkerNextAction(memory)).toBe(expected);
    }
  });
});
