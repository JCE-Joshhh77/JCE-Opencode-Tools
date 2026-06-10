import { describe, expect, test } from "bun:test";
import { createEmptyRuntimeState, createRuntimeTaskLearning } from "../../src/plugin/lib/runtime-state.ts";
import { formatDecisionRecommendation, recommendNextDecision } from "../../src/plugin/lib/decision-intelligence.ts";
import { createWorkflowRun } from "../../src/plugin/lib/workflow.ts";

describe("JCE-Worker decision intelligence", () => {
  test("recommends verification before completion claims", () => {
    const memory = createEmptyRuntimeState("2026-05-13T00:00:00.000Z");
    memory.activeWorkflow = {
      ...createWorkflowRun({ id: "wf-complete", goal: "finish work" }),
      status: "verifying",
      route: {
        intent: "completion_claim",
        skills: ["verification-discipline", "verification-before-completion"],
        reason: "Completion claims require fresh verification evidence.",
        source: "completion",
      },
    };

    const recommendation = recommendNextDecision(memory);

    expect(recommendation.risk).toBe("high");
    expect(recommendation.recommendedAction).toContain("fresh verification evidence");
    expect(recommendation.reasons).toContain("No latest verification evidence is recorded.");
  });

  test("prioritizes active blockers over route agent hints", () => {
    const memory = createEmptyRuntimeState("2026-05-13T00:00:00.000Z");
    memory.activeWorkflow = {
      ...createWorkflowRun({ id: "wf-parallel", goal: "parallel research" }),
      route: {
        intent: "parallel_work",
        skills: ["delegation-quality", "dispatching-parallel-agents"],
        reason: "Independent work can be delegated in parallel.",
        agentHint: "explorer",
        source: "task",
      },
    };
    memory.blockers = [{ reason: "Missing credentials" }];

    const recommendation = recommendNextDecision(memory);

    expect(recommendation.risk).toBe("high");
    expect(recommendation.recommendedAction).toContain("Resolve active blockers");
    expect(recommendation.recommendedAgent).toBeUndefined();
  });

  test("uses route hints and relevant task learnings for feature work", () => {
    const memory = createEmptyRuntimeState("2026-05-13T00:00:00.000Z");
    memory.activeWorkflow = {
      ...createWorkflowRun({ id: "wf-feature", goal: "add behavior" }),
      route: {
        intent: "feature",
        skills: ["jce-worker-operating-system", "codebase-intelligence"],
        reason: "Feature or behavior changes require design, planning, and TDD.",
        source: "message",
      },
    };
    memory.taskLearnings = [
      createRuntimeTaskLearning({ taskType: "feature", trigger: "phase 5", successfulRecipe: ["route", "verify"], verificationCommands: ["bun test"], touchedAreas: ["src/plugin/lib"] }),
    ];

    const recommendation = recommendNextDecision(memory);
    const formatted = formatDecisionRecommendation(recommendation).join("\n");

    expect(recommendation.risk).toBe("medium");
    expect(recommendation.relevantLearnings[0]?.trigger).toBe("phase 5");
    expect(formatted).toContain("Decision Intelligence");
    expect(formatted).toContain("Relevant learnings: phase 5");
  });
});
