import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { getConfigDir } from "../../lib/config.js";
import { determineSkillsForMessage, INTENTIONAL_SKILL_ALIASES, SKILL_NAME_TO_FILE, SKILL_REGISTRY, type SkillRegistryEntry } from "./skill-loader.js";

export interface SkillSyncCheck {
  repoSkills: number;
  userSkills: number;
  missingInUser: string[];
}

export interface SkillStartupAudit {
  ok: boolean;
  skillFolders: number;
  mappings: number;
  missingMappedFiles: string[];
  unmappedSkillFolders: string[];
  duplicateTargets: { target: string; mappings: string[]; reason?: string }[];
  docsSkillCounts: { file: string; count: number }[];
  docCountMismatches: { file: string; expected: number; found: number }[];
  autoReachableSkills: string[];
  notAutoReachableSkills: string[];
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

export function auditSkillStartup(projectRoot: string): SkillStartupAudit {
  const skillsDir = join(projectRoot, "config", "skills");
  const folders = listSkillDirs(skillsDir);
  const folderSet = new Set(folders);
  const concreteMappings = Object.entries(SKILL_NAME_TO_FILE).filter(([name]) => !(name in INTENTIONAL_SKILL_ALIASES));
  const missingMappedFiles = concreteMappings
    .filter(([, file]) => !folderSet.has(file.replace(/\.md$/, "")))
    .map(([name, file]) => `${name} -> ${file}`)
    .sort();
  const mappedFolders = new Set(concreteMappings.map(([, file]) => file.replace(/\.md$/, "")));
  const unmappedSkillFolders = folders.filter((folder) => !mappedFolders.has(folder));

  const byTarget = new Map<string, string[]>();
  for (const [name, file] of Object.entries(SKILL_NAME_TO_FILE)) {
    const list = byTarget.get(file) ?? [];
    list.push(name);
    byTarget.set(file, list);
  }
  const duplicateTargets = [...byTarget.entries()]
    .filter(([, mappings]) => mappings.length > 1)
    .map(([target, mappings]) => ({ target, mappings: mappings.sort(), reason: mappings.every((name) => name in INTENTIONAL_SKILL_ALIASES || target === SKILL_NAME_TO_FILE[name]) ? "intentional workflow aliases" : undefined }))
    .filter((item) => !item.reason || !item.mappings.every((name) => name in INTENTIONAL_SKILL_ALIASES || name === item.target.replace(/\.md$/, "")));

  const docs = [join(projectRoot, "config", "AGENTS.md"), join(projectRoot, "README.md")];
  const docsSkillCounts = docs.flatMap((file) => {
    if (!existsSync(file)) return [];
    const text = readFileSync(file, "utf8");
    const matches = [...text.matchAll(/(\d+)\s+skill(?:\/workflow)?\s+files?/gi)];
    return matches.map((match) => ({ file, count: Number(match[1]) }));
  });
  const docCountMismatches = docsSkillCounts.filter((item) => item.count !== folders.length).map((item) => ({ file: item.file, expected: folders.length, found: item.count }));
  const autoReachableSkills = folders.filter((folder) => {
    const mode = SKILL_REGISTRY[folder]?.routingMode;
    if (mode === "manual_or_keyword" || mode === "internal_support") return true;
    const prompt = SKILL_REGISTRY[folder]?.samplePrompts?.[0];
    return typeof prompt === "string" && determineSkillsForMessage(prompt).includes(folder);
  });
  const notAutoReachableSkills = folders.filter((folder) => !autoReachableSkills.includes(folder));
  return {
    ok: missingMappedFiles.length === 0 && unmappedSkillFolders.length === 0 && duplicateTargets.every((item) => item.reason) && docCountMismatches.length === 0 && notAutoReachableSkills.length === 0,
    skillFolders: folders.length,
    mappings: Object.keys(SKILL_NAME_TO_FILE).length,
    missingMappedFiles,
    unmappedSkillFolders,
    duplicateTargets,
    docsSkillCounts,
    docCountMismatches,
    autoReachableSkills,
    notAutoReachableSkills,
  };
}

export function formatSkillStartupAudit(audit: SkillStartupAudit): string {
  return [
    "Skill Startup Audit",
    `Status: ${audit.ok ? "pass" : "fail"}`,
    `Skill folders: ${audit.skillFolders}`,
    `Mappings: ${audit.mappings}`,
    `Missing mapped files: ${audit.missingMappedFiles.join(", ") || "none"}`,
    `Unmapped skill folders: ${audit.unmappedSkillFolders.join(", ") || "none"}`,
    `Duplicate targets: ${audit.duplicateTargets.map((item) => `${item.target} <= ${item.mappings.join("/")}`).join(", ") || "none"}`,
    `Doc count mismatches: ${audit.docCountMismatches.map((item) => `${item.file}: ${item.found} != ${item.expected}`).join(", ") || "none"}`,
    `Auto-reachable skills: ${audit.autoReachableSkills.length}/${audit.skillFolders}`,
    `Not auto-reachable: ${audit.notAutoReachableSkills.join(", ") || "none"}`,
  ].join("\n");
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  routingMode?: string;
  intents?: string[];
  signals?: string[];
  files?: string[];
  preferredAgents?: string[];
  samplePrompts?: string[];
}

/**
 * Parse machine-readable routing frontmatter from a SKILL.md file (plan.md step 9).
 * Supports scalar fields plus simple YAML inline (`[a, b]`) and block (`- item`) lists.
 */
export function parseSkillFrontmatter(text: string): SkillFrontmatter | undefined {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return undefined;
  const lines = match[1]!.split(/\r?\n/);
  const data: SkillFrontmatter = {};
  let listKey: keyof SkillFrontmatter | undefined;
  const listFields = new Set(["intents", "signals", "files", "preferredAgents", "samplePrompts"]);
  for (const line of lines) {
    const blockItem = line.match(/^\s*-\s+(.*)$/);
    if (blockItem && listKey) {
      ((data[listKey] as string[]) ??= []).push(blockItem[1]!.replace(/^['"]|['"]$/g, "").trim());
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1]! as keyof SkillFrontmatter;
    const value = kv[2]!.trim();
    if (listFields.has(key)) {
      if (value.startsWith("[") && value.endsWith("]")) {
        (data[key] as string[]) = value.slice(1, -1).split(",").map((item) => item.replace(/^['"]|['"]$/g, "").trim()).filter(Boolean);
        listKey = undefined;
      } else if (value === "") {
        listKey = key;
        (data[key] as string[]) ??= [];
      } else {
        (data[key] as unknown as string) = value.replace(/^['"]|['"]$/g, "");
        listKey = undefined;
      }
    } else {
      (data[key] as unknown as string) = value.replace(/^['"]|['"]$/g, "");
      listKey = undefined;
    }
  }
  return data;
}

export interface RegistryHealthReport {
  ok: boolean;
  skillCount: number;
  registryCount: number;
  missingSamplePrompts: string[];
  missingRoutingMode: string[];
  missingIntents: string[];
  frontmatterDrift: { skill: string; field: string; frontmatter: string; registry: string }[];
}

/**
 * CI-grade registry health check (plan.md step 12): skill count drift, missing metadata,
 * sample-prompt coverage, routing-mode coverage, and frontmatter-vs-registry drift.
 */
export function auditSkillRegistryHealth(projectRoot: string): RegistryHealthReport {
  const skillsDir = join(projectRoot, "config", "skills");
  const folders = listSkillDirs(skillsDir);
  const concreteFolders = folders.filter((folder) => folder in SKILL_REGISTRY);
  const missingSamplePrompts: string[] = [];
  const missingRoutingMode: string[] = [];
  const missingIntents: string[] = [];
  const frontmatterDrift: RegistryHealthReport["frontmatterDrift"] = [];

  for (const [skill, entry] of Object.entries(SKILL_REGISTRY) as Array<[string, SkillRegistryEntry]>) {
    if (!entry.samplePrompts.length || !entry.samplePrompts[0]) missingSamplePrompts.push(skill);
    if (!entry.routingMode) missingRoutingMode.push(skill);
    if (!entry.intents.length) missingIntents.push(skill);
  }

  for (const folder of concreteFolders) {
    const path = join(skillsDir, folder, "SKILL.md");
    if (!existsSync(path)) continue;
    const front = parseSkillFrontmatter(readFileSync(path, "utf8"));
    if (!front) continue;
    const registry = SKILL_REGISTRY[folder]!;
    if (front.routingMode && front.routingMode !== registry.routingMode) {
      frontmatterDrift.push({ skill: folder, field: "routingMode", frontmatter: front.routingMode, registry: registry.routingMode });
    }
    if (front.intents && front.intents.length && front.intents.sort().join(",") !== [...registry.intents].sort().join(",")) {
      frontmatterDrift.push({ skill: folder, field: "intents", frontmatter: front.intents.join("|"), registry: registry.intents.join("|") });
    }
  }

  return {
    ok: missingSamplePrompts.length === 0 && missingRoutingMode.length === 0 && missingIntents.length === 0 && frontmatterDrift.length === 0,
    skillCount: folders.length,
    registryCount: Object.keys(SKILL_REGISTRY).length,
    missingSamplePrompts: missingSamplePrompts.sort(),
    missingRoutingMode: missingRoutingMode.sort(),
    missingIntents: missingIntents.sort(),
    frontmatterDrift,
  };
}

export function formatRegistryHealth(report: RegistryHealthReport): string {
  return [
    "Skill Registry Health",
    `Status: ${report.ok ? "pass" : "fail"}`,
    `Skill folders: ${report.skillCount}`,
    `Registry entries: ${report.registryCount}`,
    `Missing sample prompts: ${report.missingSamplePrompts.join(", ") || "none"}`,
    `Missing routing mode: ${report.missingRoutingMode.join(", ") || "none"}`,
    `Missing intents: ${report.missingIntents.join(", ") || "none"}`,
    `Frontmatter drift: ${report.frontmatterDrift.map((item) => `${item.skill}.${item.field}`).join(", ") || "none"}`,
  ].join("\n");
}
