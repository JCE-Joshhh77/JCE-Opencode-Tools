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

  test("parses machine-readable routing frontmatter (inline and block lists)", () => {
    const inline = parseSkillFrontmatter("---\nname: demo\nroutingMode: auto\nintents: [bugfix, config]\n---\n");
    expect(inline?.routingMode).toBe("auto");
    expect(inline?.intents).toEqual(["bugfix", "config"]);

    const block = parseSkillFrontmatter("---\nname: demo\nsignals:\n  - eslint\n  - prettier\n---\n");
    expect(block?.signals).toEqual(["eslint", "prettier"]);
  });
});
