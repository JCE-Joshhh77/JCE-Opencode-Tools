import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkSkillSync, formatSkillSync } from "../../src/plugin/lib/skill-sync.ts";

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
});
