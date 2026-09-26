import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { auditSkillRegistryHealth, auditSkillStartup, checkSkillSync, formatRegistryHealth, formatSkillStartupAudit, formatSkillSync, parseSkillFrontmatter } from "../../src/plugin/lib/skill-sync.ts";

describe("skill sync", () => {
  test("detects skills missing from user config", () => {
    const root = mkdtempSync(join(tmpdir(), "opencode-jce-skill-sync-root-"));
    const user = mkdtempSync(join(tmpdir(), "opencode-jce-skill-sync-user-"));
    try {
      mkdirSync(join(root, "config", "skills", "alpha"), { recursive: true });
      mkdirSync(join(root, "config", "skills", "beta"), { recursive: true });
      mkdirSync(join(user, "skills", "alpha"), { recursive: true });
      writeFileSync(join(root, "config", "skills", "alpha", "SKILL.md"), "---\nname: alpha\n---\n", "utf-8");
      writeFileSync(join(root, "config", "skills", "beta", "SKILL.md"), "---\nname: beta\n---\n", "utf-8");
      writeFileSync(join(user, "skills", "alpha", "SKILL.md"), "---\nname: alpha\n---\n", "utf-8");

      const result = checkSkillSync(root, user);

      expect(result).toEqual({ repoSkills: 2, userSkills: 1, missingInUser: ["beta"] });
      expect(formatSkillSync(result)).toContain("Missing in user config: beta");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(user, { recursive: true, force: true });
    }
  });

  test("audits startup skill routing for mapping, duplicates, unused folders, and docs count", () => {
    const result = auditSkillStartup(process.cwd());
    expect(result.ok).toBe(true);
    expect(result.skillFolders).toBeGreaterThanOrEqual(70);
    expect(result.mappings).toBeGreaterThanOrEqual(result.skillFolders);
    expect(result.missingMappedFiles).toEqual([]);
    expect(result.unmappedSkillFolders).toEqual([]);
    expect(result.docCountMismatches).toEqual([]);
    expect(result.autoReachableSkills).toHaveLength(result.skillFolders);
    expect(result.notAutoReachableSkills).toEqual([]);
    expect(formatSkillStartupAudit(result)).toContain("Status: pass");
    expect(formatSkillStartupAudit(result)).toContain(`Auto-reachable skills: ${result.skillFolders}/${result.skillFolders}`);
  });

  test("registry health passes CI gate: no count drift, metadata gaps, or frontmatter drift", () => {
    const report = auditSkillRegistryHealth(process.cwd());
    expect(report.missingSamplePrompts).toEqual([]);
    expect(report.missingRoutingMode).toEqual([]);
    expect(report.missingIntents).toEqual([]);
    expect(report.frontmatterDrift).toEqual([]);
    expect(report.registryCount).toBeGreaterThanOrEqual(70);
    expect(report.ok).toBe(true);
    expect(formatRegistryHealth(report)).toContain("Status: pass");
  });

  test("skill doctor report flags no low-confidence or broken sample prompts", () => {
    const { buildSkillDoctorReport } = require("../../src/plugin/lib/jce-intelligence.ts");
    const report = buildSkillDoctorReport();

    expect(report.lowConfidencePrompts).toEqual(expect.arrayContaining(["game-development", "sql-database", "verification-discipline"]));
    expect(report.samplePromptFailures).toEqual([]);
  });

  test("parses machine-readable routing frontmatter (inline and block lists)", () => {
    const inline = parseSkillFrontmatter("---\nname: demo\nroutingMode: auto\nintents: [bugfix, config]\n---\n");
    expect(inline?.routingMode).toBe("auto");
    expect(inline?.intents).toEqual(["bugfix", "config"]);

    const block = parseSkillFrontmatter("---\nname: demo\nsignals:\n  - eslint\n  - prettier\n---\n");
    expect(block?.signals).toEqual(["eslint", "prettier"]);
  });

  test("REGRESSION (audit 2026-09-26): scalar intents must not crash the registry health audit", () => {
    const root = mkdtempSync(join(tmpdir(), "opencode-jce-med2-"));
    try {
      mkdirSync(join(root, "config", "skills", "security"), { recursive: true });
      writeFileSync(join(root, "config", "skills", "security", "SKILL.md"), "---\nname: security\nintents: bugfix\n---\n# Security\n", "utf-8");
      const report = auditSkillRegistryHealth(root);
      expect(report.frontmatterDrift).toEqual([expect.objectContaining({ skill: "security", field: "intents" })]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("REGRESSION (audit 2026-09-26): accidental duplicate mapping fails the startup audit", () => {
    // Simulate an accidental collision without touching the real repo tree:
    // auditSkillStartup reads SKILL_NAME_TO_FILE live, so plant a duplicate.
    const { SKILL_NAME_TO_FILE } = require("../../src/plugin/lib/skill-loader.ts");
    const planted = "fake-accidental-dup";
    (SKILL_NAME_TO_FILE as Record<string, string>)[planted] = "software-engineering.md";
    try {
      const audit = auditSkillStartup(process.cwd());
      const group = audit.duplicateTargets.find((d) => d.target === "software-engineering.md");
      expect(group).toBeDefined();
      expect(group?.reason).toBeUndefined();
      expect(audit.ok).toBe(false);
    } finally {
      delete (SKILL_NAME_TO_FILE as Record<string, string>)[planted];
    }
    // Clean repo state stays green.
    expect(auditSkillStartup(process.cwd()).ok).toBe(true);
  });
});
