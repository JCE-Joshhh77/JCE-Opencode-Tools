import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { auditAgents, auditSkills, resolveSkillConflicts, resolveSkillConflictsV2, buildAnalyticsRecommendations, buildCapabilityRegistry, buildSkillCapabilityMatrix, appendEvidence, appendTelemetry, loadEvidence, summarizeCommandEvidence, summarizeSkillTelemetry, summarizeTelemetry, assessJceDoctor, generateAgentsCanonicalMarkdown } from "../../src/plugin/lib/jce-intelligence.ts";
import { buildWebAdvancedFlow } from "../../src/plugin/lib/web/index.ts";
import { buildApiAdvancedFlow } from "../../src/plugin/lib/api/index.ts";
import { buildDevopsAdvancedFlow } from "../../src/plugin/lib/devops/index.ts";
import { buildSecurityAdvancedFlow } from "../../src/plugin/lib/security-flow/index.ts";

function fixture(): string { return mkdtempSync(join(tmpdir(), "opencode-jce-intel-")); }

describe("JCE priorities 1-10 intelligence", () => {
  test("audits skill quality and reports weak guidance", () => {
    const root = fixture();
    const skillDir = join(root, "skills", "demo-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: demo-skill\ndescription: Use when testing demo skill routing and verification guidance.\n---\n# Demo\nWorkflow: inspect, implement, verify with tests.\n", "utf8");
    const report = auditSkills(join(root, "skills"));
    expect(report.total).toBe(1);
    expect(report.results[0]?.score).toBeGreaterThanOrEqual(85);
  });

  test("resolves skill conflicts by preferring specific skills", () => {
    const result = resolveSkillConflicts(["frontend", "nextjs", "react", "typescript", "software-engineering"], 3);
    expect(result.selected).toContain("nextjs");
    expect(result.selected).toContain("typescript");
    expect(result.suppressed.some((item) => item.skill === "frontend")).toBe(true);
  });

  test("resolver v2 uses intent and file context", () => {
    const result = resolveSkillConflictsV2(["architecture", "api-design-patterns", "security", "auth-identity", "typescript"], { intent: "fix jwt auth endpoint", files: ["src/routes/auth.ts"], max: 3 });
    expect(result.selected).toContain("auth-identity");
    expect(result.selected).toContain("api-design-patterns");
    expect(result.suppressed.some((item) => item.skill === "security")).toBe(true);
    expect(result.trace?.selected.some((item) => item.skill === "api-design-patterns")).toBe(true);
    expect(result.trace?.rejected.some((item) => item.skill === "security" && item.source === "conflict")).toBe(true);
  });

  test("registers priority capabilities", () => {
    const ids = buildCapabilityRegistry().capabilities.map((capability) => capability.id);
    expect(ids).toContain("jce.skill-audit");
    expect(ids).toContain("nextjs.advanced-flow");
    expect(ids).toContain("security.advanced-flow");
  });

  test("stores evidence records", () => {
    const root = fixture();
    const record = appendEvidence(root, { taskId: "task-1", type: "command", summary: "tests passed", status: "pass", command: "bun test" });
    expect(record.id).toStartWith("ev-");
    expect(loadEvidence(root)).toHaveLength(1);
  });

  test("summarizes command evidence for auto-capture", () => {
    const evidence = summarizeCommandEvidence("bun test tests/unit/foo.test.ts", "12 pass\n0 fail");
    expect(evidence?.status).toBe("pass");
    expect(evidence?.type).toBe("command");
  });

  test("summarizes telemetry locally", () => {
    const summary = summarizeTelemetry([{ kind: "skill_selected", name: "react", at: "now" }, { kind: "skill_selected", name: "react", at: "now" }]);
    expect(summary["skill_selected:react"]).toBe(2);
  });

  test("stores skill telemetry and exposes capability matrix", () => {
    const root = fixture();
    const event = appendTelemetry(root, { kind: "skill_selected", name: "android-gradle", metadata: { testsPass: true, delegationAccepted: true } });
    expect(event.name).toBe("android-gradle");
    const matrix = buildSkillCapabilityMatrix();
    expect(Object.keys(matrix).length).toBeGreaterThanOrEqual(74);
    expect(matrix["android-gradle"]?.signals).toContain("duplicate class");
    expect(matrix["android-gradle"]?.verification).toContain("./gradlew :app:assembleDebug");
    expect(matrix["write-a-skill"]?.routingMode).toBe("manual_or_keyword");
    expect(matrix["developer-tooling"]?.files).toContain("tsconfig.json");
  });

  test("summarizes skill telemetry outcomes", () => {
    const summary = summarizeSkillTelemetry([
      { kind: "skill_selected", name: "evt1", at: "now", metadata: { skill: "android-gradle" } },
      { kind: "skill_final_used", name: "evt2", at: "now", metadata: { skill: "android-gradle" } },
      { kind: "skill_followup", name: "evt3", at: "now", metadata: { skill: "android-gradle" } },
      { kind: "delegation_accepted", name: "evt4", at: "now", metadata: { skill: "android-gradle" } },
      { kind: "verification_result", name: "evt5", at: "now", metadata: { skill: "android-gradle", passed: true } },
      { kind: "delegation_rejected", name: "evt6", at: "now", metadata: { skill: "react" } },
    ]);
    expect(summary.selectedByIntent["android-gradle"]).toBe(1);
    expect(summary.finalUsed["android-gradle"]).toBe(1);
    expect(summary.followups["android-gradle"]).toBe(1);
    expect(summary.acceptedDelegations["android-gradle"]).toBe(1);
    expect(summary.verificationPassBySkill["android-gradle"]).toBe(1);
    expect(summary.rejectedDelegations["react"]).toBe(1);
  });

  test("builds analytics recommendations from evidence gaps", () => {
    expect(buildAnalyticsRecommendations([], [])).toContain("Enable/verify evidence auto-capture: no verification evidence has been stored.");
  });

  test("audits agent registry and generates canonical protocol docs", () => {
    const report = auditAgents(process.cwd());
    expect(report.total).toBeGreaterThan(0);
    expect(generateAgentsCanonicalMarkdown()).toContain("IntentGate");
  });

  test("doctor reports repository intelligence checks", () => {
    const report = assessJceDoctor(process.cwd());
    expect(report.checks.length).toBeGreaterThan(0);
    expect(report.summary.fail).toBe(0);
  });

  test("advanced flow baselines detect web api devops and security surfaces", () => {
    expect(buildWebAdvancedFlow(["app/page.tsx", "next.config.js"]).framework).toBe("nextjs");
    expect(buildApiAdvancedFlow(["src/user.controller.ts", "jwt auth", "zod schema"]).surfaces).toContain("auth boundary");
    expect(buildDevopsAdvancedFlow([".github/workflows/ci.yml", "Dockerfile"]).surfaces).toContain("ci");
    expect(buildSecurityAdvancedFlow(["auth jwt token sql query"]).threatModel).toContain("identity/session assets");
  });
});
