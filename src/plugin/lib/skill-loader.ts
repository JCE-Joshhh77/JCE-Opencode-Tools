import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { getConfigDir } from "../../lib/config.js";
import { scoreIntent, toLegacyRoute } from "./orchestration/intent-router.js";

/**
 * Map skill-router skill names to actual .md filenames in ~/.config/opencode/skills/
 * The router returns conceptual names; this maps them to real files.
 */
export const SKILL_NAME_TO_FILE: Record<string, string> = {
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

  // Advanced Orchestration (meta-orchestration skills)
  "orchestration-patterns": "orchestration-patterns.md",
  "failure-recovery": "failure-recovery.md",
  "multi-agent-coordination": "multi-agent-coordination.md",
  "estimation-planning": "estimation-planning.md",
  "code-archaeology": "code-archaeology.md",
  "incident-response": "incident-response.md",

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

export const INTENTIONAL_SKILL_ALIASES: Record<string, string> = {
  "systematic-debugging": "Workflow alias for software-engineering.",
  "test-driven-development": "Workflow alias for testing-strategies.",
  "brainstorming": "Workflow alias for software-engineering.",
  "writing-plans": "Workflow alias for software-engineering.",
  "verification-before-completion": "Workflow alias for software-engineering.",
  "finishing-a-development-branch": "Workflow alias for software-engineering.",
  "requesting-code-review": "Workflow alias for software-engineering.",
  "dispatching-parallel-agents": "Workflow alias for software-engineering.",
};

export interface SkillSelectionItem { skill: string; reason: string }
export interface SkillSelectionExplanation { selected: SkillSelectionItem[]; rejected: SkillSelectionItem[] }
export interface SkillRegistryEntry {
  routingMode: SkillRoutingMode;
  priority: number;
  intents: string[];
  signals: string[];
  files: string[];
  preferredAgents: string[];
  verification: string[];
  conflictsWith?: string[];
  preferredOver?: string[];
  samplePrompts: string[];
}
export interface SkillScoreBreakdown {
  skill: string;
  total: number;
  contributions: Array<{ source: "intent" | "regex" | "file" | "agent" | "history" | "priority" | "negative"; score: number; reason: string }>;
}
export interface SkillExplainReport {
  intent: string;
  candidates: SkillScoreBreakdown[];
  selected: SkillSelectionItem[];
  rejected: SkillSelectionItem[];
  confidence: number;
}
export interface SkillCorrection {
  forbid: string[];
  prefer: string[];
  agent?: string;
  reason?: string;
}

export const AUTO_ROUTE_KEYWORD_HINTS: Record<string, string[]> = {
  "advanced-patterns": ["solid", "12-factor", "feature flag", "performance engineering", "maintainability", "scalability pattern"],
  "ai-optimization": ["token", "context window", "prompt efficiency", "model selection", "cost optimization", "latency optimization"],
  "context-preservation": ["context", "handoff", "session summary", ".opencode-context.md", "continuity", "next session"],
  "delegation-quality": ["delegate", "delegation", "sub-agent", "dispatch", "parallel agent", "review delegated work"],
  "developer-tooling": ["eslint", "prettier", "lint", "formatter", "tsconfig", "lsp", "codegen", "language server"],
};

export const AUTO_ROUTE_CANONICAL_PROMPTS: Record<string, string> = {
  "advanced-patterns": "Refactor with SOLID, 12-factor, feature flag, and performance engineering patterns",
  "ai-llm-engineering": "Design RAG pipeline with embeddings, vector DB, and prompt evaluation",
  "ai-optimization": "Optimize token usage, prompt efficiency, model selection, and latency optimization",
  "android-compose": "Review @Composable screen with LaunchedEffect, remember, and collectAsStateWithLifecycle",
  "android-gradle": "Fix duplicate class in build.gradle.kts and libs.versions.toml for Android Gradle project",
  "android-kotlin": "Fix AndroidManifest.xml and MainActivity.kt issue with Room and Hilt",
  "android-release": "Fix bundleRelease R8 ProGuard signingConfig versionCode release issue",
  "android-security": "Review android:exported, deep links, WebView, and network security config",
  "android-testing": "Add Robolectric and connectedDebugAndroidTest coverage for Android app",
  "angular": "Fix Angular standalone component with RxJS signal bug",
  "api-design-patterns": "Review REST API endpoint pagination OpenAPI schema and route handler design",
  "architecture": "Review system architecture trade-off for caching and resilience",
  "astro-remix": "Fix Astro islands architecture route loader action issue",
  "auth-identity": "Implement OAuth OIDC JWT RBAC session auth flow",
  "blockchain-web3": "Audit Solidity smart contract gas optimization with Foundry",
  "code-archaeology": "Understand legacy code and why this code was written this way using git blame",
  "codebase-intelligence": "Map repository structure entry points and impact scan before refactor",
  "compliance-governance": "Review GDPR SOC2 PII audit logging and consent handling",
  "context-preservation": "Update .opencode-context.md handoff and session summary for next session continuity",
  "cpp": "Fix CMake and modern C++ header ownership issue in .cpp file",
  "csharp": "Fix ASP.NET Core C# controller bug in .cs service",
  "delegation-quality": "Improve sub-agent delegation and dispatch review delegated work quality",
  "design-systems": "Build Storybook design tokens and component library variants",
  "developer-tooling": "Fix ESLint Prettier tsconfig LSP formatter and codegen tooling drift",
  "devops": "Set up Docker CI/CD Kubernetes deployment pipeline",
  "distributed-systems": "Design event-driven saga CQRS flow with Kafka outbox",
  "django-fastapi": "Fix FastAPI Pydantic endpoint bug in Django/FastAPI service",
  "elixir": "Fix Phoenix LiveView OTP Elixir process issue in .ex file",
  "estimation-planning": "Scope this large task and decide execution strategy with critical path and complexity detection",
  "express-nestjs": "Fix NestJS Express controller route handler auth bug",
  "failure-recovery": "Verification keeps failing and I am stuck in a fix loop needing rollback and retry strategy",
  "flutter-dart": "Fix Flutter Riverpod widget state bug in Dart app",
  "frontend": "Improve frontend accessibility responsive state management and i18n behavior",
  "game-development": "Design ECS game loop physics rendering architecture",
  "git-guardrails": "Review git push tag force-push safety and destructive git commands",
  "go": "Fix goroutine bug in .go module",
  "grill-with-docs": "Challenge ADR plan against domain docs and decision record",
  "human-ui-design": "Create dashboard UI that looks human-crafted and not AI-generated",
  "incident-response": "Production is down after a deploy and we need to rollback and triage the incident",
  "java-kotlin": "Fix Kotlin JVM service bug in .kt file",
  "jce-worker-operating-system": "Improve JCE-Worker operating loop and completion discipline",
  "laravel": "Fix Laravel Eloquent Blade Artisan bug",
  "monorepo-management": "Fix pnpm workspace Nx monorepo affected build issue",
  "multi-agent-coordination": "Coordinate multiple sub-agents and resolve conflicting findings with consensus and evidence grading",
  "nextjs": "Fix Next.js App Router Server Actions bug in React app",
  "observability": "Add OpenTelemetry tracing Prometheus metrics and SLO alerting",
  "orchestration-patterns": "Plan a complex multi-phase migration across many files with checkpoints and resume",
  "php": "Fix PHP Composer service bug in .php file",
  "platform-engineering": "Set up ArgoCD GitOps Helm Terraform platform workflow",
  "prototype": "Build throwaway prototype spike to compare UI variants",
  "python": "Fix Python typing bug in .py module",
  "rails": "Fix Rails ActiveRecord Hotwire bug",
  "react": "Fix React hooks useEffect component bug in TSX",
  "react-native": "Fix React Native Expo mobile app bug",
  "realtime-systems": "Design WebSocket SSE CRDT realtime sync architecture",
  "release-engineering": "Prepare version sync changelog and release verification plan",
  "reliability-engineering": "Run chaos engineering incident response and error budget review",
  "ruby": "Fix Ruby gem service bug in .rb file",
  "rust": "Fix Rust async ownership bug in .rs module",
  "scala": "Fix Scala Akka Cats service bug in .scala file",
  "security": "Review CORS CSP XSS injection vulnerability and input validation",
  "shell-bash": "Fix Bash shell script Makefile automation issue in .sh file",
  "software-engineering": "Refactor code safely with tests and debugging",
  "spring-boot": "Fix Spring Boot JPA service bug in Java app",
  "sql-database": "Optimize SQL query schema migration index design",
  "svelte": "Fix SvelteKit runes state bug in Svelte component",
  "swift-ios": "Fix SwiftUI iOS screen bug in .swift app",
  "tailwind": "Style responsive UI with Tailwind utility classes",
  "tauri": "Fix Tauri desktop app invoke command issue",
  "testing-strategies": "Add property-based mutation and contract testing strategy",
  "to-issues": "Break this plan into GitHub issues and vertical slices",
  "to-prd": "Convert this idea into PRD and acceptance criteria",
  "triage": "Triage bug report severity duplicate issue and repro steps",
  "typescript": "Fix TypeScript tsconfig issue in .ts project",
  "ui-pattern-library": "Build SaaS dashboard pattern catalog for onboarding billing and forms",
  "verification-discipline": "Enforce verification evidence and fresh verification before completion gate",
  "visual-qa-rubric": "Run screenshot Playwright visual QA and responsive browser review",
  "vue": "Fix Vue 3 Pinia composition API bug",
  "wasm": "Fix WebAssembly WASI wasm-bindgen component issue",
  "write-a-skill": "Create SKILL.md frontmatter for new write-a-skill workflow",
};

export type SkillRoutingMode = "auto" | "manual_or_keyword" | "internal_support";

export const SKILL_ROUTING_MODE: Record<string, SkillRoutingMode> = {
  "jce-worker-operating-system": "internal_support",
  "write-a-skill": "manual_or_keyword",
  "orchestration-patterns": "manual_or_keyword",
  "failure-recovery": "manual_or_keyword",
  "multi-agent-coordination": "manual_or_keyword",
  "estimation-planning": "manual_or_keyword",
  "code-archaeology": "manual_or_keyword",
  "incident-response": "manual_or_keyword",
};

export const SKILL_FILE_HINTS: Record<string, string[]> = {
  "android-gradle": ["build.gradle", "build.gradle.kts", "settings.gradle", "libs.versions.toml"],
  "android-kotlin": ["AndroidManifest.xml", "MainActivity.kt"],
  "android-testing": ["src/test", "src/androidTest"],
  "android-release": ["proguard-rules.pro", "build.gradle.kts"],
  "android-security": ["AndroidManifest.xml", "network_security_config.xml"],
  "react": ["*.tsx", "*.jsx"],
  "nextjs": ["next.config.js", "app/page.tsx"],
  "vue": ["*.vue"],
  "svelte": ["*.svelte"],
  "angular": ["angular.json", "*.component.ts"],
  "developer-tooling": ["tsconfig.json", ".eslintrc.*", "prettier.config.*"],
  "context-preservation": [".opencode-context.md", ".opencode-jce/context/session.md"],
  "write-a-skill": ["config/skills/*/SKILL.md"],
};

export const SKILL_PREFERRED_AGENTS: Record<string, string[]> = {
  "architecture": ["oracle"],
  "advanced-patterns": ["oracle"],
  "verification-discipline": ["oracle"],
  "developer-tooling": ["oracle"],
  "human-ui-design": ["frontend"],
  "visual-qa-rubric": ["frontend"],
  "ui-pattern-library": ["frontend"],
  "android-kotlin": ["android"],
  "android-gradle": ["android"],
  "android-testing": ["android"],
  "android-release": ["android"],
  "android-security": ["android"],
  "android-compose": ["android"],
  "codebase-intelligence": ["jce-researcher"],
  "grill-with-docs": ["jce-researcher"],
  "ai-optimization": ["jce-researcher"],
  "delegation-quality": ["jce-researcher"],
  "context-preservation": ["jce-researcher"],
};

export const SKILL_VERIFICATION_HINTS: Record<string, string[]> = {
  "developer-tooling": ["bun run typecheck", "lint command"],
  "verification-discipline": ["targeted verification command", "wider regression command"],
  "context-preservation": ["context file updated", "context checkpoint"],
  "delegation-quality": ["delegated output includes evidence sections", "review accepted"],
  "write-a-skill": ["skill audit", "sample prompt route test"],
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
  if (/\b(ux|dashboard|landing\s*page|figma|wireframe|mockup|visual|generated\s*by\s*ai|generated\s*ai|ai-looking|human.?crafted|anti.?ai|ui\s*polish|design\s*review)\b/i.test(lower)) skills.push("human-ui-design");
  if (/\b(pattern|catalog|katalog|dashboard|landing\s*page|admin|saas|fintech|billing|ecommerce|marketplace|developer\s*tool|healthcare|settings|onboarding|data\s*dashboard|form|table)\b/i.test(lower)) skills.push("ui-pattern-library");
  if (/\b(visual\s*qa|screenshot|browser\s*review|playwright|visual\s*regression|responsive\s*qa|ui\s*polish|design\s*review|aksesibilitas|accessibility\s*qa)\b/i.test(lower)) skills.push("visual-qa-rubric");
  if (/\b(frontend|accessibility|responsive|state\s*management|i18n|component\s*library|ui\s*component)\b/i.test(lower)) skills.push("frontend");
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
  if (/\b(architecture|trade.?off|caching|resilience|system\s*design)\b/i.test(lower)) skills.push("architecture");
  if (/\b(repository\s*structure|entry\s*points?|impact\s*scan|codebase|repository\s*map|map\s*repository)\b/i.test(lower)) skills.push("codebase-intelligence");
  if (/\b(goroutine|go\s*module|go\s+service|\.go\b)\b/i.test(lower)) skills.push("go");
  if (/\b(property-?based|mutation\s*testing|contract\s*testing|visual\s*regression|load\s*testing)\b/i.test(lower)) skills.push("testing-strategies");
  if (/\b(verification\s*evidence|verify\s*before\s*completion|completion\s*gate|verification\s*discipline|fresh\s*verification)\b/i.test(lower)) skills.push("verification-discipline");
  if (/\b(solid|12-factor|feature\s*flag|performance\s*engineering|maintainability|scalability\s*pattern)\b/i.test(lower)) skills.push("advanced-patterns");
  if (/\b(token|context\s*window|prompt\s*efficiency|model\s*selection|cost\s*optimization|latency\s*optimization)\b/i.test(lower)) skills.push("ai-optimization");
  if (/\b(context|handoff|session\s*summary|\.opencode-context\.md|continuity|next\s*session)\b/i.test(lower)) skills.push("context-preservation");
  if (/\b(delegate|delegation|sub-agent|dispatch|parallel\s*agent|review\s*delegated\s*work)\b/i.test(lower)) skills.push("delegation-quality");
  if (/\b(eslint|prettier|lint|formatter|tsconfig|lsp|codegen|language\s*server)\b/i.test(lower)) skills.push("developer-tooling");

  // Advanced orchestration (meta) skills — keyword routed
  if (/\b(multi-?phase|state\s*machine|checkpoint|saga\s*pattern|\bdag\b|orchestration\s*pattern|resume.*workflow)\b/i.test(lower)) skills.push("orchestration-patterns");
  if (/\b(rollback\s*protocol|fix\s*loop|stuck\s*in\s*a\s*loop|failure\s*budget|escalation\s*chain|retry\s*strategy)\b/i.test(lower)) skills.push("failure-recovery");
  if (/\b(consensus|conflicting\s*findings|coordinate\s*(multiple\s*)?sub-?agents|merge\s*evidence|grade.*delegat)\b/i.test(lower)) skills.push("multi-agent-coordination");
  if (/\b(critical\s*path|effort\s*estimat|complexity\s*detection|risk.?adjusted)\b/i.test(lower)) skills.push("estimation-planning");
  if (/\b(legacy\s*code|git\s*blame|code\s*archaeolog|why\s*was\s*this\s*(code\s*)?written|chesterton)\b/i.test(lower)) skills.push("code-archaeology");
  if (/\b(outage|production\s*is\s*down|production\s*down|blast\s*radius|rollback\s*the\s*deploy)\b/i.test(lower)) skills.push("incident-response");

  if (skills.some((skill) => skill.startsWith("android-")) && !skills.includes("android-kotlin")) skills.push("android-kotlin");
  return prioritizeSkills([...new Set(skills)]);
}

function contextReason(skill: string, text: string): string {
  const lower = text.toLowerCase();
  if (skill === "android-gradle" && /build\.gradle|settings\.gradle|libs\.versions\.toml|duplicate class|no matching variant|could not resolve/i.test(lower)) return "Android Gradle/config signal detected";
  if (skill === "android-kotlin" && /android|androidx|jetpack|room|hilt|workmanager|adb|logcat|apk|aab/i.test(lower)) return "Android platform signal detected";
  if (skill === "android-testing" && /testdebugunittest|connecteddebugandroidtest|androidtest|robolectric|instrumented/i.test(lower)) return "Android test signal detected";
  if (skill === "android-release" && /bundlerelease|assemblerelease|r8|proguard|signingconfig|keystore|versioncode|versionname/i.test(lower)) return "Android release signal detected";
  if (skill === "verification-discipline" && /test|verify|release|fix|bug/i.test(lower)) return "verification-sensitive intent";
  if (skill in AUTO_ROUTE_KEYWORD_HINTS) return `${AUTO_ROUTE_KEYWORD_HINTS[skill]![0]} signal detected`;
  if (skill === "software-engineering") return "coding intent baseline";
  return "context/router signal detected";
}

function buildSkillRegistry(): Record<string, SkillRegistryEntry> {
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
  const registry: Record<string, SkillRegistryEntry> = {};
  for (const [skill, file] of Object.entries(SKILL_NAME_TO_FILE)) {
    if (skill in INTENTIONAL_SKILL_ALIASES) continue;
    registry[skill] = {
      routingMode: SKILL_ROUTING_MODE[skill] ?? "auto",
      priority: priorities.get(skill) ?? 99,
      intents: inferIntentsForRegistry(skill),
      signals: AUTO_ROUTE_KEYWORD_HINTS[skill] ?? inferSignalsFromCanonicalPrompt(AUTO_ROUTE_CANONICAL_PROMPTS[skill] ?? skill),
      files: SKILL_FILE_HINTS[skill] ?? [file.replace(/\.md$/, "")],
      preferredAgents: SKILL_PREFERRED_AGENTS[skill] ?? [],
      verification: SKILL_VERIFICATION_HINTS[skill] ?? [],
      samplePrompts: [AUTO_ROUTE_CANONICAL_PROMPTS[skill] ?? `Use ${skill} on matching task`],
    };
  }

  registry["frontend"].conflictsWith = ["react", "nextjs", "vue", "svelte", "angular"];
  registry["react"].preferredOver = ["frontend"];
  registry["nextjs"].preferredOver = ["react", "frontend"];
  registry["auth-identity"].preferredOver = ["security"];
  registry["android-security"].preferredOver = ["security"];
  registry["api-design-patterns"].preferredOver = ["architecture"];
  registry["platform-engineering"].preferredOver = ["devops"];
  registry["reliability-engineering"].preferredOver = ["observability"];
  registry["human-ui-design"].preferredOver = ["api-design-patterns"];

  return registry;
}

export const SKILL_REGISTRY = buildSkillRegistry();

const REAL_SKILLS = Object.keys(SKILL_REGISTRY);

let historyAdjustments: Record<string, number> = {};
let sessionCorrectionBias: Record<string, number> = {};
let subAgentQuality: { usefulSkills?: Array<{ skill: string; score: number }>; noisySkills?: Array<{ skill: string; score: number }> } | undefined;

export function applySubAgentTelemetryQuality(quality?: { usefulSkills?: Array<{ skill: string; score: number }>; noisySkills?: Array<{ skill: string; score: number }> }): void {
  subAgentQuality = quality;
}

export function applySkillHistoryAdjustments(corrections?: Record<string, number>, bias?: Record<string, number>): void {
  historyAdjustments = corrections ?? {};
  sessionCorrectionBias = bias ?? {};
}

export interface SkillBundle {
  id: string;
  skills: string[];
  triggers: RegExp;
}

/** Stable multi-skill bundles for recurring task families (plan.md step 5). */
export const SKILL_BUNDLES: SkillBundle[] = [
  { id: "android-build-bug", skills: ["android-kotlin", "android-gradle", "verification-discipline"], triggers: /\b(android).*(gradle|build\.gradle|duplicate class|aab|apk|r8|proguard|ksp|kapt)\b/i },
  { id: "delegation-review", skills: ["delegation-quality", "verification-discipline", "codebase-intelligence"], triggers: /\b(review delegated|delegation review|sub-?agent (output|review)|verify delegated)\b/i },
  { id: "ui-polish", skills: ["human-ui-design", "visual-qa-rubric", "ui-pattern-library"], triggers: /\b(ui polish|design review|visual qa|dashboard polish|make it look|not look(ing)? (ai|generated))\b/i },
  { id: "api-contract", skills: ["api-design-patterns", "security", "architecture"], triggers: /\b(rest api|graphql|openapi|endpoint contract|api versioning|api pagination)\b/i },
  { id: "release-prep", skills: ["release-engineering", "verification-discipline", "git-guardrails"], triggers: /\b(prepare release|version sync|changelog|tag release|release readiness)\b/i },
  // Advanced orchestration bundles
  { id: "complex-migration", skills: ["orchestration-patterns", "estimation-planning", "code-archaeology"], triggers: /\b(complex migration|large refactor|multi-?phase|migrate across|10\+? files)\b/i },
  { id: "failure-loop", skills: ["failure-recovery", "orchestration-patterns", "verification-discipline"], triggers: /\b(stuck in.*(loop|cycle)|keeps? failing|3 (attempts|tries|fixes)|fix loop|repeated failure)\b/i },
  { id: "multi-agent-task", skills: ["multi-agent-coordination", "orchestration-patterns", "delegation-quality"], triggers: /\b(coordinate.*(agents?|sub-?agents?)|parallel consensus|conflicting (findings|results)|multi-?agent)\b/i },
  { id: "incident-triage", skills: ["incident-response", "failure-recovery", "verification-discipline"], triggers: /\b(production (is )?down|outage|rollback.*(deploy|release)|blast radius|incident triage)\b/i },
  { id: "legacy-understanding", skills: ["code-archaeology", "codebase-intelligence", "estimation-planning"], triggers: /\b(legacy (code|system)|why was this (written|built)|understand.*(old|existing)|chesterton|characterization test)\b/i },
];

export function matchSkillBundles(text: string): SkillBundle[] {
  return SKILL_BUNDLES.filter((bundle) => bundle.triggers.test(text));
}

export interface SubAgentSkillProfile {
  base: string[];
  telemetryBoost: string[];
  telemetryPenalize: string[];
}

/** Build adaptive sub-agent skill profile from telemetry quality data (plan.md step 6). */
export function buildAdaptiveSubAgentProfile(
  agent: string,
  prompt: string,
  quality?: { usefulSkills?: Array<{ skill: string; score: number }>; noisySkills?: Array<{ skill: string; score: number }> },
): SubAgentSkillProfile {
  const weighted = scoreSkillCandidates(prompt, agent).map((item) => item.skill);
  const agentSkillSets: Record<string, string[]> = {
    oracle: ["architecture", "verification-discipline", "advanced-patterns", "developer-tooling"],
    frontend: ["human-ui-design", "visual-qa-rubric", "ui-pattern-library"],
    android: ["android-kotlin", "android-gradle", "android-testing", "android-release", "android-security", "android-compose"],
    "jce-researcher": ["codebase-intelligence", "grill-with-docs", "ai-optimization", "context-preservation", "delegation-quality"],
  };
  const base = agentSkillSets[agent] ?? [];

  if (!quality) return { base, telemetryBoost: [], telemetryPenalize: [] };

  const boosted = (quality.usefulSkills ?? []).filter((item) => base.includes(item.skill) || weighted.includes(item.skill)).slice(0, 3).map((item) => item.skill);
  const penalized = (quality.noisySkills ?? []).filter((item) => base.includes(item.skill) || weighted.includes(item.skill)).slice(0, 2).map((item) => item.skill);

  return { base, telemetryBoost: boosted, telemetryPenalize: penalized };
}

export function parseSkillCorrection(text: string): SkillCorrection | null {
  const lower = text.toLowerCase();
  const forbid = new Set<string>();
  const prefer = new Set<string>();
  let agent: string | undefined;

  for (const skill of REAL_SKILLS) {
    const spaced = skill.replace(/-/g, "[\\s-]?");
    if (new RegExp(`\\b(jangan|dont|don't|do not|must not|no need|skip)\\b[^.\n]{0,40}\\b${spaced}\\b`, "i").test(lower)) forbid.add(skill);
    if (new RegExp(`\\b(pakai|use|prefer|should use|harusnya|should be)\\b[^.\n]{0,40}\\b${spaced}\\b`, "i").test(lower)) prefer.add(skill);
    if (new RegExp(`\\b(salah route|wrong route|wrong skill)\\b[^.\n]{0,40}\\b${spaced}\\b`, "i").test(lower)) forbid.add(skill);
  }

  const agentMatch = lower.match(/\b(should be|harusnya|prefer|pakai|use)\b[^.\n]{0,20}\b(researcher|jce-researcher|oracle|frontend|android|explorer)\b/i);
  if (agentMatch) agent = agentMatch[2] === "researcher" ? "jce-researcher" : agentMatch[2];

  if (forbid.size === 0 && prefer.size === 0 && !agent) return null;
  return { forbid: [...forbid], prefer: [...prefer], agent, reason: text.trim().slice(0, 200) };
}

export function applySkillCorrection(baseSkills: string[], correction?: SkillCorrection | null): string[] {
  if (!correction) return baseSkills;
  const forbid = new Set(correction.forbid);
  const preferred = correction.prefer.filter((skill) => !forbid.has(skill));
  const filtered = baseSkills.filter((skill) => !forbid.has(skill) && !preferred.includes(skill));
  return [...new Set([...preferred, ...filtered])].slice(0, 4);
}

function inferIntentsForRegistry(skill: string): string[] {
  if (skill.startsWith("android-")) return ["bugfix", "config", skill === "android-release" ? "release" : "feature"];
  if (["verification-discipline", "release-engineering", "git-guardrails", "context-preservation", "delegation-quality"].includes(skill)) return ["bugfix", "review", "config"];
  if (["software-engineering", "advanced-patterns", "developer-tooling", "testing-strategies"].includes(skill)) return ["bugfix", "feature", "refactor"];
  if (["architecture", "api-design-patterns", "sql-database", "distributed-systems", "reliability-engineering", "platform-engineering", "observability"].includes(skill)) return ["review", "feature", "config"];
  if (["to-prd", "to-issues", "triage", "prototype", "grill-with-docs"].includes(skill)) return ["review", "feature", "plan"];
  return ["feature", "review"];
}

function inferSignalsFromCanonicalPrompt(prompt: string): string[] {
  return prompt.toLowerCase().split(/[^a-z0-9.#+-]+/).filter((token) => token.length > 3).slice(0, 10);
}

export function scoreSkillCandidates(text: string, agent?: string): SkillScoreBreakdown[] {
  const lower = text.toLowerCase();
  const scored = scoreIntent(text);
  const route = toLegacyRoute(scored);
  const explicitInternalSupport = /\bjce-worker|operating loop|completion discipline|workflow gate\b/i.test(lower);
  const routeSet = new Set(route.skills.filter((skill) => explicitInternalSupport || SKILL_REGISTRY[skill]?.routingMode !== "internal_support"));
  const contextSkills = new Set(detectContextSkills(text));
  const codingIntent = route.intent === "bugfix" || route.intent === "feature" || route.intent === "general";
  const candidates = new Set<string>([...routeSet, ...contextSkills]);
  if (codingIntent) candidates.add("software-engineering");

  const bundles = matchSkillBundles(text);
  const bundleSkills = new Set<string>();
  for (const bundle of bundles) for (const skill of bundle.skills) { candidates.add(skill); bundleSkills.add(skill); }

  const breakdowns: SkillScoreBreakdown[] = [];
  for (const skill of candidates) {
    const meta = SKILL_REGISTRY[skill];
    if (!meta) continue;
    const contributions: SkillScoreBreakdown["contributions"] = [];
    contributions.push({ source: "priority", score: Math.max(0, 25 - meta.priority), reason: `base priority ${meta.priority}` });
    if (routeSet.has(skill)) contributions.push({ source: "intent", score: 35, reason: `${route.intent} route matched` });
    if (meta.intents.includes(route.intent)) contributions.push({ source: "intent", score: 12, reason: `${route.intent} fits registry intent` });
    const matchingSignals = meta.signals.filter((signal) => lower.includes(signal.toLowerCase()));
    if (matchingSignals.length) contributions.push({ source: "regex", score: Math.min(24, matchingSignals.length * 8), reason: `signal match: ${matchingSignals.slice(0, 3).join(", ")}` });
    const matchingFiles = meta.files.filter((file) => lower.includes(file.toLowerCase().replace(/\*/g, "")));
    if (matchingFiles.length) contributions.push({ source: "file", score: Math.min(18, matchingFiles.length * 9), reason: `file/path match: ${matchingFiles.slice(0, 2).join(", ")}` });
    if (agent && meta.preferredAgents.includes(agent)) contributions.push({ source: "agent", score: 10, reason: `${agent} prefers this skill` });
    if (historyAdjustments[skill]) contributions.push({ source: "history", score: Math.max(-25, Math.min(25, historyAdjustments[skill])), reason: `historical outcome adjustment ${historyAdjustments[skill]}` });
    if (sessionCorrectionBias[skill]) contributions.push({ source: "history", score: Math.max(-35, Math.min(35, sessionCorrectionBias[skill])), reason: `session correction bias ${sessionCorrectionBias[skill]}` });
    if (contextSkills.has(skill) && !matchingSignals.length) contributions.push({ source: "regex", score: 8, reason: contextReason(skill, text) });
    if (bundleSkills.has(skill)) contributions.push({ source: "intent", score: 12, reason: `bundle match: ${bundles.find((b) => b.skills.includes(skill))?.id ?? "unknown"}` });
    if (["react", "vue", "svelte", "angular", "nextjs", "astro-remix"].includes(skill) && new RegExp(`\\b${skill === "nextjs" ? "next\\.?js" : skill === "astro-remix" ? "astro|remix" : skill}\\b`, "i").test(lower)) contributions.push({ source: "regex", score: 10, reason: "framework explicitly named in prompt" });
    if (skill === "android-kotlin" && [...candidates].some((candidate) => candidate.startsWith("android-"))) contributions.push({ source: "intent", score: 14, reason: "android task keeps platform base skill loaded" });
    if (skill === "verification-discipline" && [...candidates].some((candidate) => candidate.startsWith("android-"))) contributions.push({ source: "negative", score: -8, reason: "domain skill outranks generic verification helper on Android routing" });

    if (skill === "api-design-patterns" && /\b(ui|ux|figma|dashboard|visual|human-crafted|generated by ai)\b/i.test(lower)) {
      contributions.push({ source: "negative", score: -40, reason: "visual design wording suppresses API design pattern route" });
    }
    if (skill === "frontend" && /\binterface\b/i.test(lower) && /\.go\b|goroutine|go\s+service/i.test(lower)) {
      contributions.push({ source: "negative", score: -35, reason: "Go interface wording is not frontend work" });
    }
    if (skill === "security" && /\b(oauth|oidc|jwt|rbac|login|auth)\b/i.test(lower) && candidates.has("auth-identity")) {
      contributions.push({ source: "negative", score: -30, reason: "auth-heavy prompt should prefer auth-identity" });
    }
    if (skill === "human-ui-design" && /\bbackend|api|endpoint\b/i.test(lower) && !/\b(ui|ux|dashboard|visual|figma|frontend)\b/i.test(lower)) {
      contributions.push({ source: "negative", score: -45, reason: "backend wording alone should not trigger visual design skill" });
    }

    const total = contributions.reduce((sum, item) => sum + item.score, 0);
    breakdowns.push({ skill, total, contributions });
  }

  return breakdowns.sort((a, b) => b.total - a.total || (SKILL_REGISTRY[a.skill]?.priority ?? 99) - (SKILL_REGISTRY[b.skill]?.priority ?? 99) || a.skill.localeCompare(b.skill));
}

function computeRoutingConfidence(ranked: SkillScoreBreakdown[]): number {
  const top = ranked[0]?.total ?? 0;
  const second = ranked[1]?.total ?? 0;
  if (top <= 0) return 0;
  return Math.max(0, Math.min(100, top + Math.max(0, top - second)));
}

const LOW_CONFIDENCE_THRESHOLD = 20;

function shouldUseLowConfidenceFallback(ranked: SkillScoreBreakdown[], confidence = computeRoutingConfidence(ranked)): boolean {
  if (confidence < LOW_CONFIDENCE_THRESHOLD) return true;
  const top = ranked[0];
  if (!top) return false;
  const meaningful = top.contributions.filter((item) => item.source !== "priority" && item.source !== "history");
  return meaningful.length === 0;
}

function applyRegistryConflictRules(ranked: SkillScoreBreakdown[]): SkillSelectionExplanation {
  const selected: SkillSelectionItem[] = [];
  const rejected: SkillSelectionItem[] = [];
  const picked = new Set<string>();
  const confidence = computeRoutingConfidence(ranked);

  // Low-confidence fallback: prefer 1 core + 1 safest domain skill (plan.md step 11)
  if (shouldUseLowConfidenceFallback(ranked, confidence) && ranked.length > 0) {
    const core = ranked.find((item) => item.skill === "software-engineering" || item.skill === "codebase-intelligence");
    const domain = ranked.find((item) => item.skill !== core?.skill);
    if (core) selected.push({ skill: core.skill, reason: `low-confidence fallback (confidence=${confidence})` });
    if (domain) selected.push({ skill: domain.skill, reason: `low-confidence fallback best domain (confidence=${confidence})` });
    for (const item of ranked) {
      if (item.skill !== core?.skill && item.skill !== domain?.skill) {
        rejected.push({ skill: item.skill, reason: `suppressed: low-confidence mode (confidence=${confidence})` });
      }
    }
    return { selected, rejected };
  }

  for (const item of ranked) {
    const meta = SKILL_REGISTRY[item.skill];
    if (!meta) continue;
    const preferredByPicked = ranked.find((other) => picked.has(other.skill) && (SKILL_REGISTRY[other.skill]?.preferredOver ?? []).includes(item.skill));
    if (preferredByPicked) {
      rejected.push({ skill: item.skill, reason: `${preferredByPicked.skill} preferred over ${item.skill}` });
      continue;
    }
    const conflict = (meta.conflictsWith ?? []).find((name) => picked.has(name));
    if (conflict) {
      rejected.push({ skill: item.skill, reason: `${conflict} already selected; conflicting generic route suppressed` });
      continue;
    }
    if (item.total <= 0) {
      rejected.push({ skill: item.skill, reason: `score ${item.total} too low after negative routing` });
      continue;
    }
    if (selected.length >= 4) {
      rejected.push({ skill: item.skill, reason: "lower weighted score; max 4 skills reached" });
      continue;
    }
    picked.add(item.skill);
    selected.push({ skill: item.skill, reason: item.contributions.map((entry) => `${entry.source}:${entry.score}`).join(", ") });
  }

  return { selected, rejected };
}

export function explainSkillsForMessage(text: string): SkillSelectionExplanation {
  return applyRegistryConflictRules(scoreSkillCandidates(text));
}

export function explainSkillRouting(text: string, agent?: string): SkillExplainReport {
  const ranked = scoreSkillCandidates(text, agent);
  const confidence = computeRoutingConfidence(ranked);
  const selected = applyRegistryConflictRules(ranked);
  const fallbackSelected = shouldUseLowConfidenceFallback(ranked, confidence);
  return {
    intent: toLegacyRoute(scoreIntent(text)).intent,
    candidates: ranked,
    selected: selected.selected,
    rejected: selected.rejected,
    confidence: fallbackSelected ? Math.min(confidence, LOW_CONFIDENCE_THRESHOLD) : confidence,
  };
}

export function getSubAgentSkillProfile(agent: string, prompt: string): string[] {
  const weighted = scoreSkillCandidates(prompt, agent).map((item) => item.skill);
  const adaptive = buildAdaptiveSubAgentProfile(agent, prompt, subAgentQuality);
  const boost = (skills: string[]) => {
    const penalize = new Set(adaptive.telemetryPenalize);
    const front = adaptive.telemetryBoost.filter((skill) => skills.includes(skill));
    return [...new Set([...front, ...skills.filter((skill) => !penalize.has(skill)), ...skills.filter((skill) => penalize.has(skill))])];
  };
  if (agent === "oracle") return boost(prioritizeSkills([...new Set(["architecture", "verification-discipline", "advanced-patterns", "developer-tooling", ...weighted.filter((skill) => ["architecture", "verification-discipline", "advanced-patterns", "developer-tooling", "api-design-patterns", "security", "auth-identity", "sql-database", "platform-engineering", "reliability-engineering"].includes(skill))])])).slice(0, MAX_SUBAGENT_SKILLS);
  if (agent === "frontend") return boost(prioritizeSkills([...new Set(["human-ui-design", "visual-qa-rubric", "ui-pattern-library", ...weighted.filter((skill) => ["react", "nextjs", "vue", "svelte", "angular", "frontend", "tailwind"].includes(skill))])])).slice(0, MAX_SUBAGENT_SKILLS + 1);
  if (agent === "android") return boost(prioritizeSkills([...new Set(["android-kotlin", "android-gradle", "android-testing", "android-release", "android-security", "android-compose", ...weighted.filter((skill) => skill.startsWith("android-"))])])).slice(0, MAX_SUBAGENT_SKILLS + 1);
  if (agent === "jce-researcher") return boost(prioritizeSkills([...new Set(["codebase-intelligence", "grill-with-docs", "ai-optimization", "context-preservation", "delegation-quality", ...weighted.filter((skill) => ["codebase-intelligence", "grill-with-docs", "ai-optimization", "context-preservation", "delegation-quality", "auth-identity", "android-kotlin", "android-gradle", "developer-tooling", "observability", "compliance-governance"].includes(skill))])])).slice(0, MAX_RESEARCHER_SKILLS + 2);
  return [];
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
  return explainSkillsForMessage(text).selected.map((item) => item.skill);
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

  const combined = getSubAgentSkillProfile(agent, delegationPrompt);

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
