import { describe, expect, test } from "bun:test";
import { summarizeRoutingQuality, summarizeSkillTelemetry, type TelemetryEvent } from "../../src/plugin/lib/jce-intelligence.ts";

describe("telemetry learning loop", () => {
  test("aggregates useful, noisy, and failed-task skill signals", () => {
    const events: TelemetryEvent[] = [
      { kind: "routing_decision", name: "bugfix", at: "2026-06-10T00:00:00.000Z", metadata: { selectedSkills: ["android-gradle", "android-kotlin"], suppressedSkills: ["frontend"] } },
      { kind: "skill_final_used", name: "android-gradle", at: "2026-06-10T00:00:01.000Z", metadata: { skill: "android-gradle" } },
      { kind: "verification_result", name: "./gradlew assembleDebug", at: "2026-06-10T00:00:02.000Z", metadata: { skill: "android-gradle", passed: true } },
      { kind: "task_outcome", name: "completion", at: "2026-06-10T00:00:03.000Z", metadata: { skills: ["android-gradle"], outcome: "success" } },
      { kind: "user_correction", name: "frontend", at: "2026-06-10T00:00:04.000Z", metadata: { skill: "frontend" } },
      { kind: "verification_result", name: "npm test", at: "2026-06-10T00:00:05.000Z", metadata: { skill: "frontend", passed: false } },
      { kind: "task_outcome", name: "followup_needed", at: "2026-06-10T00:00:06.000Z", metadata: { skills: ["frontend"], outcome: "followup" } },
    ];

    const summary = summarizeSkillTelemetry(events);
    expect(summary.usefulBySkill["android-gradle"]).toBeGreaterThan(0);
    expect(summary.noisyBySkill["frontend"]).toBeGreaterThan(0);
    expect(summary.userCorrectionsBySkill["frontend"]).toBe(1);
    expect(summary.outcomeBySkill["android-gradle"]?.success).toBe(1);
    expect(summary.outcomeBySkill["frontend"]?.followup).toBe(1);

    const quality = summarizeRoutingQuality(events);
    expect(quality.usefulSkills[0]).toEqual(expect.objectContaining({ skill: "android-gradle" }));
    expect(quality.noisySkills[0]).toEqual(expect.objectContaining({ skill: "frontend" }));
    expect(quality.failedTaskSkills[0]).toEqual(expect.objectContaining({ skill: "frontend" }));
  });
});
