import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { getConfigDir } from "../../lib/config.js";
import { routeJceWorkerIntent } from "./skill-router.js";

/**
 * Map skill-router skill names to actual .md filenames in ~/.config/opencode/skills/
 * The router returns conceptual names; this maps them to real files.
 */
const SKILL_NAME_TO_FILE: Record<string, string> = {
  // Core engineering
  "software-engineering": "software-engineering.md",
  "security": "security.md",
  "architecture": "architecture.md",
  "frontend": "frontend.md",
  "devops": "devops.md",
  "developer-tooling": "developer-tooling.md",
  "ai-optimization": "ai-optimization.md",
  "advanced-patterns": "advanced-patterns.md",
  "sql-database": "sql-database.md",
  "tailwind": "tailwind.md",
  "context-preservation": "context-preservation.md",
  "testing-strategies": "testing-strategies.md",
  "api-design-patterns": "api-design-patterns.md",

  // Distributed & Platform
  "distributed-systems": "distributed-systems.md",
  "platform-engineering": "platform-engineering.md",
  "reliability-engineering": "reliability-engineering.md",
  "observability": "observability.md",
  "realtime-systems": "realtime-systems.md",
  "monorepo-management": "monorepo-management.md",

  // Security & Compliance
  "auth-identity": "auth-identity.md",
  "compliance-governance": "compliance-governance.md",

  // AI & Specialized
  "ai-llm-engineering": "ai-llm-engineering.md",
  "blockchain-web3": "blockchain-web3.md",
  "game-development": "game-development.md",
  "design-systems": "design-systems.md",

  // Frontend Frameworks
  "react": "react.md",
  "vue": "vue.md",
  "svelte": "svelte.md",
  "nextjs": "nextjs.md",
  "angular": "angular.md",

  // Backend Frameworks
  "laravel": "laravel.md",
  "django-fastapi": "django-fastapi.md",
  "express-nestjs": "express-nestjs.md",
  "spring-boot": "spring-boot.md",
  "rails": "rails.md",

  // Mobile
  "react-native": "react-native.md",
  "flutter-dart": "flutter-dart.md",
  "swift-ios": "swift-ios.md",

  // Languages
  "typescript": "typescript.md",
  "python": "python.md",
  "rust": "rust.md",
  "go": "go.md",
  "csharp": "csharp.md",
  "java-kotlin": "java-kotlin.md",
  "php": "php.md",
  "ruby": "ruby.md",
  "cpp": "cpp.md",
  "shell-bash": "shell-bash.md",
  "elixir": "elixir.md",
  "scala": "scala.md",

  // Workflow skills (from skill-router)
  "systematic-debugging": "software-engineering.md",
  "test-driven-development": "testing-strategies.md",
  "brainstorming": "software-engineering.md",
  "writing-plans": "software-engineering.md",
  "verification-before-completion": "software-engineering.md",
  "finishing-a-development-branch": "software-engineering.md",
  "requesting-code-review": "software-engineering.md",
  "dispatching-parallel-agents": "software-engineering.md",
};

/**
 * Detect language/framework from file extensions and keywords in the message.
 */
function detectContextSkills(text: string): string[] {
  const skills: string[] = [];
  const lower = text.toLowerCase();

  // Language detection from file extensions mentioned
  if (/\.(ts|tsx|js|jsx|mjs|cjs)\b/.test(text)) skills.push("typescript");
  else if (/\.py\b/.test(text)) skills.push("python");
  else if (/\.rs\b/.test(text)) skills.push("rust");
  else if (/\.go\b/.test(text)) skills.push("go");
  else if (/\.cs\b/.test(text)) skills.push("csharp");
  else if (/\.(java|kt)\b/.test(text)) skills.push("java-kotlin");
  else if (/\.php\b/.test(text)) skills.push("php");
  else if (/\.rb\b/.test(text)) skills.push("ruby");
  else if (/\.(c|cpp|h|hpp)\b/.test(text)) skills.push("cpp");
  else if (/\.(sh|bash)\b/.test(text)) skills.push("shell-bash");
  else if (/\.(ex|exs)\b/.test(text)) skills.push("elixir");
  else if (/\.scala\b/.test(text)) skills.push("scala");
  else if (/\.dart\b/.test(text)) skills.push("flutter-dart");
  else if (/\.swift\b/.test(text)) skills.push("swift-ios");

  // Framework detection from keywords
  if (/\b(react|jsx|tsx|hooks?|usestate|useeffect)\b/i.test(lower)) skills.push("react");
  else if (/\b(vue|nuxt|pinia|composition api)\b/i.test(lower)) skills.push("vue");
  else if (/\b(svelte|sveltekit|runes)\b/i.test(lower)) skills.push("svelte");
  else if (/\b(next\.?js|app router|server actions|server components)\b/i.test(lower)) skills.push("nextjs");
  else if (/\b(angular|rxjs|signals)\b/i.test(lower)) skills.push("angular");
  else if (/\b(laravel|eloquent|blade|artisan)\b/i.test(lower)) skills.push("laravel");
  else if (/\b(django|fastapi|pydantic|drf)\b/i.test(lower)) skills.push("django-fastapi");
  else if (/\b(express|nestjs|nest\.js)\b/i.test(lower)) skills.push("express-nestjs");
  else if (/\b(spring boot|spring security|jpa)\b/i.test(lower)) skills.push("spring-boot");
  else if (/\b(rails|activerecord|hotwire)\b/i.test(lower)) skills.push("rails");
  else if (/\b(react native|expo)\b/i.test(lower)) skills.push("react-native");
  else if (/\b(flutter|riverpod|widget)\b/i.test(lower)) skills.push("flutter-dart");

  // Domain detection
  if (/\b(docker|ci\/cd|deploy|kubernetes|helm|terraform)\b/i.test(lower)) skills.push("devops");
  if (/\b(sql|query|migration|schema|database|postgres|mysql)\b/i.test(lower)) skills.push("sql-database");
  if (/\b(security|auth|vulnerability|cors|csrf|xss)\b/i.test(lower)) skills.push("security");
  if (/\b(tailwind|utility.?first)\b/i.test(lower)) skills.push("tailwind");
  if (/\b(api|endpoint|rest|graphql|grpc|openapi)\b/i.test(lower)) skills.push("api-design-patterns");
  if (/\b(websocket|realtime|sse|crdt)\b/i.test(lower)) skills.push("realtime-systems");
  if (/\b(microservice|event.?driven|saga|cqrs|kafka)\b/i.test(lower)) skills.push("distributed-systems");
  if (/\b(oauth|oidc|jwt|rbac|mfa|zero.?trust)\b/i.test(lower)) skills.push("auth-identity");
  if (/\b(gdpr|soc2|compliance|pii|audit)\b/i.test(lower)) skills.push("compliance-governance");
  if (/\b(llm|rag|embedding|vector|prompt engineering)\b/i.test(lower)) skills.push("ai-llm-engineering");
  if (/\b(solidity|web3|smart contract|blockchain)\b/i.test(lower)) skills.push("blockchain-web3");
  if (/\b(monorepo|turborepo|nx|workspace)\b/i.test(lower)) skills.push("monorepo-management");
  if (/\b(observability|prometheus|grafana|tracing|slo)\b/i.test(lower)) skills.push("observability");

  return [...new Set(skills)];
}

/**
 * Read a skill file from the skills directory.
 * Returns null if the file doesn't exist.
 */
async function readSkillFile(skillName: string): Promise<string | null> {
  const fileName = SKILL_NAME_TO_FILE[skillName];
  if (!fileName) return null;

  const configDir = getConfigDir();
  const skillPath = join(configDir, "skills", fileName);

  if (!existsSync(skillPath)) return null;

  try {
    const content = await readFile(skillPath, "utf-8");
    if (!content.trim()) return null;
    return content;
  } catch {
    return null;
  }
}

/**
 * Resolve skill names to loaded content.
 * Deduplicates by filename (multiple skill names can map to the same file).
 * Limits to max 4 skills to avoid context overflow.
 */
export async function resolveSkills(skillNames: string[]): Promise<string[]> {
  const loadedFiles = new Set<string>();
  const results: string[] = [];
  const MAX_SKILLS = 4;

  for (const name of skillNames) {
    if (results.length >= MAX_SKILLS) break;

    const fileName = SKILL_NAME_TO_FILE[name];
    if (!fileName || loadedFiles.has(fileName)) continue;

    const content = await readSkillFile(name);
    if (content) {
      loadedFiles.add(fileName);
      results.push(`<!-- Skill: ${fileName} -->\n${content}`);
    }
  }

  return results;
}

/**
 * Determine which skills to inject based on the latest user message.
 * Combines intent-based routing with context detection.
 * Always includes software-engineering.md for coding tasks.
 */
export function determineSkillsForMessage(text: string): string[] {
  const route = routeJceWorkerIntent(text);
  const contextSkills = detectContextSkills(text);

  // Always include software-engineering for coding intents
  const isCodingIntent = route.intent === "bugfix" || route.intent === "feature" || route.intent === "general";
  const baseSkills = isCodingIntent ? ["software-engineering"] : [];

  // Combine: base + router skills + context skills, deduplicated
  const combined = [...baseSkills, ...route.skills, ...contextSkills];
  return [...new Set(combined)];
}
