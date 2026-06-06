import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { getConfigDir } from "../../lib/config.js";
import { scoreIntent, toLegacyRoute } from "./orchestration/intent-router.js";

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
  "human-ui-design": "human-ui-design.md",
  "ui-pattern-library": "ui-pattern-library.md",
  "visual-qa-rubric": "visual-qa-rubric.md",
  "devops": "devops.md",
  "developer-tooling": "developer-tooling.md",
  "ai-optimization": "ai-optimization.md",
  "advanced-patterns": "advanced-patterns.md",
  "sql-database": "sql-database.md",
  "tailwind": "tailwind.md",
  "context-preservation": "context-preservation.md",
  "testing-strategies": "testing-strategies.md",
  "api-design-patterns": "api-design-patterns.md",
  "jce-worker-operating-system": "jce-worker-operating-system.md",
  "codebase-intelligence": "codebase-intelligence.md",
  "release-engineering": "release-engineering.md",
  "verification-discipline": "verification-discipline.md",
  "delegation-quality": "delegation-quality.md",
  "grill-with-docs": "grill-with-docs.md",
  "to-prd": "to-prd.md",
  "to-issues": "to-issues.md",
  "triage": "triage.md",
  "prototype": "prototype.md",
  "write-a-skill": "write-a-skill.md",
  "git-guardrails": "git-guardrails.md",

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
  "astro-remix": "astro-remix.md",

  // Backend Frameworks
  "laravel": "laravel.md",
  "django-fastapi": "django-fastapi.md",
  "express-nestjs": "express-nestjs.md",
  "spring-boot": "spring-boot.md",
  "rails": "rails.md",

  // Desktop & Native
  "tauri": "tauri.md",
  "wasm": "wasm.md",

  // Mobile
  "android-kotlin": "android-kotlin.md",
  "android-gradle": "android-gradle.md",
  "android-testing": "android-testing.md",
  "android-release": "android-release.md",
  "android-compose": "android-compose.md",
  "android-security": "android-security.md",
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
 * Improved routing: more precise patterns, reduced false positives, new skills.
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
  else if (/\.(java|kt|kts)\b/.test(text)) {
    if (/\b(android|androidx|jetpack|compose|gradle|manifest|room|hilt|workmanager|viewmodel|ksp)\b/i.test(lower)) skills.push("android-kotlin");
    skills.push("java-kotlin");
  }
  else if (/\.php\b/.test(text)) skills.push("php");
  else if (/\.rb\b/.test(text)) skills.push("ruby");
  else if (/\.(c|cpp|cc|cxx|h|hpp)\b/.test(text)) skills.push("cpp");
  else if (/\.(sh|bash|zsh)\b/.test(text)) skills.push("shell-bash");
  else if (/\.(ex|exs|heex)\b/.test(text)) skills.push("elixir");
  else if (/\.(scala|sbt)\b/.test(text)) skills.push("scala");
  else if (/\.dart\b/.test(text)) skills.push("flutter-dart");
  else if (/\.swift\b/.test(text)) skills.push("swift-ios");
  else if (/\.(wasm|wat)\b/.test(text)) skills.push("wasm");
  else if (/\.astro\b/.test(text)) skills.push("astro-remix");

  // Framework detection from keywords (mutually exclusive — pick best match)
  if (/\b(android|androidx|androidmanifest|jetpack\s*compose|compose\s*(ui|navigation|material)|gradle\s*android\s*plugin|agp|room|hilt|dagger|workmanager|datastore|viewmodel|lifecycle-runtime|navigation\s*compose|ksp|kapt|adb|logcat|aab|apk)\b/i.test(lower)) skills.push("android-kotlin");
  if (/\b(agp|build\.gradle|build\.gradle\.kts|settings\.gradle|libs\.versions\.toml|dependencyinsight|duplicate class|no matching variant|could not resolve)\b/i.test(lower)) skills.push("android-gradle");
  if (/\b(testdebugunittest|connecteddebugandroidtest|androidtest|robolectric|compose test|migration test|instrumented)\b/i.test(lower)) skills.push("android-testing");
  if (/\b(bundlerelease|assemblerelease|aab|apk|r8|proguard|signingconfig|keystore|play console|versioncode|versionname|mapping\.txt)\b/i.test(lower)) skills.push("android-release");
  if (/\b(@composable|launchedeffect|remember|lazycolumn|collectasstatewithlifecycle|navigation compose|materialtheme)\b/i.test(lower)) skills.push("android-compose");
  if (/\b(android:exported|permission|deep link|deeplink|network security config|cleartext|webview|biometric|backup rules)\b/i.test(lower)) skills.push("android-security");
  else if (/\b(react[\s-]native|expo\s+(router|sdk|go))\b/i.test(lower)) skills.push("react-native");
  else if (/\b(next\.?js|app\s*router|server\s*actions|server\s*components|getServerSideProps|getStaticProps)\b/i.test(lower)) skills.push("nextjs");
  else if (/\b(react|jsx|tsx|hooks?|useState|useEffect|useRef|useMemo|useCallback|useReducer|useContext)\b/i.test(lower)) skills.push("react");
  else if (/\b(vue|nuxt|pinia|composition\s*api|defineComponent|defineModel|v-model|v-if)\b/i.test(lower)) skills.push("vue");
  else if (/\b(svelte|sveltekit|runes|\$state|\$derived|\$effect)\b/i.test(lower)) skills.push("svelte");
  else if (/\b(astro|astro\.config|islands?\s*architecture|content\s*collections?)\b/i.test(lower)) skills.push("astro-remix");
  else if (/\b(remix|loader|action|useFetcher|useLoaderData|useActionData)\b/i.test(lower)) skills.push("astro-remix");
  else if (/\b(angular|@Component|@Injectable|rxjs|NgModule|standalone\s*component)\b/i.test(lower)) skills.push("angular");
  else if (/\b(laravel|eloquent|blade|artisan|livewire|pennant)\b/i.test(lower)) skills.push("laravel");
  else if (/\b(django|fastapi|pydantic|drf|uvicorn|asgi)\b/i.test(lower)) skills.push("django-fastapi");
  else if (/\b(express|nestjs|nest\.js|fastify|@Controller|@Module)\b/i.test(lower)) skills.push("express-nestjs");
  else if (/\b(spring\s*boot|spring\s*security|jpa|@RestController|@Service)\b/i.test(lower)) skills.push("spring-boot");
  else if (/\b(rails|activerecord|hotwire|turbo|stimulus|kamal)\b/i.test(lower)) skills.push("rails");
  else if (/\b(flutter|riverpod|widget|MaterialApp|StatefulWidget)\b/i.test(lower)) skills.push("flutter-dart");
  else if (/\b(tauri|tauri\.conf|invoke|#\[tauri::command\]|wry|tao)\b/i.test(lower)) skills.push("tauri");

  // Domain detection (non-exclusive — multiple can match)
  if (/\b(docker|ci\/cd|deploy|kubernetes|helm|terraform|pulumi|github\s*actions?|gitlab\s*ci)\b/i.test(lower)) skills.push("devops");
  if (/\b(sql|query|migration|schema|database|postgres|mysql|sqlite|prisma|drizzle|knex)\b/i.test(lower)) skills.push("sql-database");
  if (/\b(security|vulnerability|cors|csrf|xss|injection|sanitiz|escape)\b/i.test(lower) && !/\b(oauth|jwt|rbac)\b/i.test(lower)) skills.push("security");
  if (/\b(tailwind|@apply|utility.?first|tw-)\b/i.test(lower)) skills.push("tailwind");
  if (/\b(ui|ux|frontend|component|dashboard|landing\s*page|design|figma|wireframe|mockup|layout|visual|interface|generated\s*by\s*ai|generated\s*ai|ai-looking|human.?crafted|anti.?ai|tailwind|css|responsive)\b/i.test(lower)) skills.push("human-ui-design");
  if (/\b(pattern|catalog|katalog|dashboard|landing\s*page|admin|saas|fintech|billing|ecommerce|marketplace|developer\s*tool|healthcare|settings|onboarding|data\s*dashboard|form|table)\b/i.test(lower)) skills.push("ui-pattern-library");
  if (/\b(visual\s*qa|screenshot|browser\s*review|playwright|visual\s*regression|responsive\s*qa|ui\s*polish|design\s*review|aksesibilitas|accessibility\s*qa)\b/i.test(lower)) skills.push("visual-qa-rubric");
  if (/\b(rest\s*api|graphql|grpc|openapi|swagger|endpoint|route\s*handler)\b/i.test(lower)) skills.push("api-design-patterns");
  if (/\b(websocket|realtime|real.?time|sse|server.?sent|crdt|socket\.io|pusher)\b/i.test(lower)) skills.push("realtime-systems");
  if (/\b(microservice|event.?driven|saga|cqrs|kafka|rabbitmq|nats|outbox)\b/i.test(lower)) skills.push("distributed-systems");
  if (/\b(oauth|oidc|jwt|rbac|abac|mfa|passkey|webauthn|zero.?trust|session)\b/i.test(lower)) skills.push("auth-identity");
  if (/\b(gdpr|soc2|compliance|pii|audit\s*log|data\s*retention|consent)\b/i.test(lower)) skills.push("compliance-governance");
  if (/\b(llm|rag|embedding|vector\s*(db|database|store)|prompt\s*engineering|langchain|openai\s*api|anthropic\s*api)\b/i.test(lower)) skills.push("ai-llm-engineering");
  if (/\b(solidity|web3|smart\s*contract|blockchain|erc-?\d+|foundry|hardhat|ethers)\b/i.test(lower)) skills.push("blockchain-web3");
  if (/\b(monorepo|turborepo|nx\s|pnpm\s*workspace|lerna|changesets?)\b/i.test(lower)) skills.push("monorepo-management");
  if (/\b(observability|prometheus|grafana|tracing|opentelemetry|otel|slo|sli|datadog)\b/i.test(lower)) skills.push("observability");
  if (/\b(wasm|webassembly|wasi|wasm-bindgen|wasm-pack|emscripten|wat)\b/i.test(lower)) skills.push("wasm");
  if (/\b(tauri|desktop\s*app|system\s*tray|native\s*window)\b/i.test(lower) && !/\b(electron)\b/i.test(lower)) skills.push("tauri");
  if (/\b(game\s*(dev|engine|loop)|ecs|entity.?component|physics|rendering|godot|unity|bevy)\b/i.test(lower)) skills.push("game-development");
  if (/\b(design\s*system|storybook|design\s*tokens?|component\s*library|chromatic)\b/i.test(lower)) skills.push("design-systems");
  if (/\b(chaos\s*engineering|error\s*budget|incident|postmortem|sre|load\s*test|k6|gatling)\b/i.test(lower)) skills.push("reliability-engineering");
  if (/\b(backstage|crossplane|argocd|flux|gitops|internal\s*developer\s*platform)\b/i.test(lower)) skills.push("platform-engineering");
  if (/\b(prd|product\s*requirements?|requirements?\s*doc|acceptance\s*criteria|product\s*spec|scope\s*doc)\b/i.test(lower)) skills.push("to-prd");
  if (/\b(github\s*issues?|create\s*issues?|break\s*(this|it)?\s*down|task\s*breakdown|vertical\s*slices?|milestones?)\b/i.test(lower)) skills.push("to-issues");
  if (/\b(triage|severity|issue\s*priority|bug\s*priority|bug\s*report|needs\s*info|repro\s*steps?|duplicate\s*issue)\b/i.test(lower)) skills.push("triage");
  if (/\b(prototype|spike|proof\s*of\s*concept|poc|throwaway|explore\s*design|ui\s*variants?)\b/i.test(lower)) skills.push("prototype");
  if (/\b(write\s*a\s*skill|create\s*a\s*skill|skill\s*author|skill\s*frontmatter|SKILL\.md)\b/i.test(text)) skills.push("write-a-skill");
  if (/\b(git\s*guardrails?|git\s*reset|git\s*clean|force\s*push|git\s*push|git\s*tag|pre-commit|commit\s*safety)\b/i.test(lower)) skills.push("git-guardrails");
  if (/\b(grill\s*(with\s*docs)?|challenge\s*(my\s*)?plan|adr|domain\s*model|decision\s*record|context\.md|architecture\s*decision)\b/i.test(lower)) skills.push("grill-with-docs");

  if (skills.some((skill) => skill.startsWith("android-")) && !skills.includes("android-kotlin")) skills.push("android-kotlin");
  return prioritizeSkills([...new Set(skills)]);
}

function prioritizeSkills(skills: string[]): string[] {
  const priorities = new Map<string, number>([
    ["software-engineering", 0],
    ["human-ui-design", 1],
    ["ui-pattern-library", 2],
    ["visual-qa-rubric", 3],
    ["android-kotlin", 4],
    ["android-release", 5],
    ["android-gradle", 6],
    ["android-compose", 7],
    ["android-testing", 8],
    ["android-security", 9],
    ["java-kotlin", 10],
    ["git-guardrails", 11],
    ["grill-with-docs", 12],
    ["to-prd", 13],
    ["to-issues", 14],
    ["triage", 15],
    ["prototype", 16],
    ["write-a-skill", 17],
  ]);

  const hasAndroid = skills.includes("android-kotlin");
  const filtered = hasAndroid
    ? skills.filter((skill) => skill !== "frontend" || skills.includes("android-compose"))
    : skills;

  return [...filtered].sort((a, b) => (priorities.get(a) ?? 99) - (priorities.get(b) ?? 99));
}

/**
 * Read a skill file from the skills directory.
 * Supports both new structure (skills/name/SKILL.md) and legacy (skills/name.md).
 * Returns null if the file doesn't exist.
 */
async function readSkillFile(skillName: string): Promise<string | null> {
  const fileName = SKILL_NAME_TO_FILE[skillName];
  if (!fileName) return null;

  const configDir = getConfigDir();
  const dirName = fileName.replace(".md", "");

  // New structure: skills/name/SKILL.md
  const newPath = join(configDir, "skills", dirName, "SKILL.md");
  // Legacy structure: skills/name.md
  const legacyPath = join(configDir, "skills", fileName);

  const skillPath = existsSync(newPath) ? newPath : existsSync(legacyPath) ? legacyPath : null;
  if (!skillPath) return null;

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
  const scored = scoreIntent(text);
  const route = toLegacyRoute(scored);
  const contextSkills = detectContextSkills(text);

  // Always include software-engineering for coding intents
  const isCodingIntent = route.intent === "bugfix" || route.intent === "feature" || route.intent === "general";
  const baseSkills = isCodingIntent ? ["software-engineering"] : [];

  // Combine: base + router skills + context skills, deduplicated
  const combined = [...baseSkills, ...route.skills, ...contextSkills];
  return prioritizeSkills([...new Set(combined)]).slice(0, 4);
}

// ─── Sub-Agent Skill Injection ───────────────────────────────

/** Agents eligible for skill injection when dispatched as sub-agents. */
const SKILL_ELIGIBLE_AGENTS = new Set(["oracle", "frontend", "jce-researcher", "android"]);

/** Max skills to inject into sub-agent prompts (lower than main chat to preserve token budget). */
const MAX_SUBAGENT_SKILLS = 2;

/** Max skills for researcher (lower to keep focus on research quality). */
const MAX_RESEARCHER_SKILLS = 1;

/**
 * Determine and resolve skills for a sub-agent delegation prompt.
 * Only injects skills for eligible agents (oracle, frontend).
 * Returns formatted skill content to prepend to the delegation prompt, or empty string.
 */
export async function resolveSubAgentSkills(agent: string, delegationPrompt: string): Promise<string> {
  if (!SKILL_ELIGIBLE_AGENTS.has(agent)) return "";

  const scored = scoreIntent(delegationPrompt);
  const route = toLegacyRoute(scored);
  const contextSkills = detectContextSkills(delegationPrompt);
  const combined = prioritizeSkills([...new Set([...route.skills, ...contextSkills])]);

  if (combined.length === 0) return "";

  const maxSkills = agent === "jce-researcher" ? MAX_RESEARCHER_SKILLS : MAX_SUBAGENT_SKILLS;
  const loadedFiles = new Set<string>();
  const results: string[] = [];

  for (const name of combined) {
    if (results.length >= maxSkills) break;

    const fileName = SKILL_NAME_TO_FILE[name];
    if (!fileName || loadedFiles.has(fileName)) continue;

    const content = await readSkillFile(name);
    if (content) {
      loadedFiles.add(fileName);
      results.push(`<!-- Skill: ${fileName} -->\n${content}`);
    }
  }

  if (results.length === 0) return "";
  return `\n\n<!-- Sub-agent skills (auto-injected) -->\n${results.join("\n\n")}\n\n`;
}
