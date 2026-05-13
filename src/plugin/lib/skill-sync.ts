import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { getConfigDir } from "../../lib/config.js";

export interface SkillSyncCheck {
  repoSkills: number;
  userSkills: number;
  missingInUser: string[];
}

function listSkillDirs(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path).filter((entry) => existsSync(join(path, entry, "SKILL.md"))).sort();
}

export function checkSkillSync(projectRoot: string, userConfigDir = getConfigDir()): SkillSyncCheck {
  const repo = listSkillDirs(join(projectRoot, "config", "skills"));
  const user = listSkillDirs(join(userConfigDir, "skills"));
  const userSet = new Set(user);
  return { repoSkills: repo.length, userSkills: user.length, missingInUser: repo.filter((skill) => !userSet.has(skill)) };
}

export function formatSkillSync(check: SkillSyncCheck): string {
  return [
    "Skill Sync",
    `Repo skills: ${check.repoSkills}`,
    `User skills: ${check.userSkills}`,
    check.missingInUser.length ? `Missing in user config: ${check.missingInUser.join(", ")}` : "Missing in user config: none",
  ].join("\n");
}
