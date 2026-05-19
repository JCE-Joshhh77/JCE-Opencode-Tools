import { describe, expect, test } from "bun:test";
import { looksLikeCompletionClaim, looksLikeStopEarlyOrConfirmation, shouldWarnForMissingVerification } from "../../src/plugin/hooks/jce-worker-guard.ts";
import { evaluateOpenWork, extractTodoState } from "../../src/plugin/hooks/open-work-enforcer.ts";
import { createEmptyExecutionMemory } from "../../src/plugin/lib/execution-memory.ts";
import { createWorkflowRun, addWorkflowStep, updateWorkflowStepStatus } from "../../src/plugin/lib/workflow.ts";

describe("JCE-Worker stop-early workflow simulator", () => {
  test("blocks Indonesian completion while TodoWrite and workflow steps remain open", () => {
    let memory = createEmptyExecutionMemory("2026-05-19T00:00:00.000Z");
    const todoState = extractTodoState(JSON.stringify([{ content: "Run verification", status: "pending" }]));
    const workflow = addWorkflowStep(createWorkflowRun({ id: "wf-1", goal: "implement feature" }), { id: "verify", title: "Run verification", taskType: "code", verification: ["bun test"] });
    memory = { ...memory, activeWorkflow: workflow };
    const assistantText = "Sudah selesai, tinggal nanti kalau mau dicek lagi.";

    expect(looksLikeCompletionClaim(assistantText)).toBe(true);
    expect(looksLikeStopEarlyOrConfirmation(assistantText)).toBe(true);
    expect(shouldWarnForMissingVerification(assistantText)).toBe(true);

    const openWork = evaluateOpenWork(memory, "strict", todoState);
    expect(openWork.blocked).toBe(true);
    expect(openWork.prompt).toContain("BOULDER CONTINUATION");
    expect(openWork.reasons.join("\n")).toContain("TodoWrite still has open item");
  });

  test("keeps closed-loop blocked until workflow has passing evidence", () => {
    let run = addWorkflowStep(createWorkflowRun({ id: "wf-2", goal: "fix bug" }), { id: "verify", title: "Regression verification", taskType: "code", verification: ["bun test"] });
    run = updateWorkflowStepStatus(run, "verify", "completed");
    const memory = { ...createEmptyExecutionMemory("2026-05-19T00:00:00.000Z"), activeWorkflow: run };
    const openWork = evaluateOpenWork(memory, "strict", { hasOpenTodos: false, openItems: [] });
    expect(openWork.blocked).toBe(true);
    expect(openWork.reasons.join("\n")).toContain("passing relevant command evidence");
  });
});
