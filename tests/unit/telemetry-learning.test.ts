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

  test("REGRESSION (audit 2026-09-26): prefer-corrections are positive signal, not noise", () => {
    // User says "pakai react" — the skill must NOT be counted as noise
    // (previously this pushed the preferred skill DOWN the ranking).
    const preferEvents: TelemetryEvent[] = [
      { kind: "user_correction", name: "react", at: "2026-06-10T00:00:00.000Z", metadata: { skill: "react", action: "prefer", reason: "pakai react" } },
    ];
    const preferSummary = summarizeSkillTelemetry(preferEvents);
    expect(preferSummary.noisyBySkill["react"]).toBeUndefined();
    expect(preferSummary.userCorrectionsBySkill["react"]).toBeUndefined();

    // Forbid-style corrections still count as noise.
    const forbidEvents: TelemetryEvent[] = [
      { kind: "user_correction", name: "frontend", at: "2026-06-10T00:00:00.000Z", metadata: { skill: "frontend", action: "forbid", reason: "jangan frontend" } },
    ];
    const forbidSummary = summarizeSkillTelemetry(forbidEvents);
    expect(forbidSummary.noisyBySkill["frontend"]).toBe(1);
    expect(forbidSummary.userCorrectionsBySkill["frontend"]).toBe(1);

    // Legacy events without an action field keep the old (noise) behavior.
    const legacyEvents: TelemetryEvent[] = [
      { kind: "user_correction", name: "oracle", at: "2026-06-10T00:00:00.000Z", metadata: { skill: "oracle" } },
    ];
    const legacySummary = summarizeSkillTelemetry(legacyEvents);
    expect(legacySummary.noisyBySkill["oracle"]).toBe(1);
  });
});
