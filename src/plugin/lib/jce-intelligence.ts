import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { INTENTIONAL_SKILL_ALIASES, SKILL_NAME_TO_FILE, SKILL_REGISTRY, explainSkillRouting } from "./skill-loader.js";
import { scanSkills, type SkillSecurityReport } from "./skill-security.js";

export type SkillTier = "framework" | "language" | "domain" | "workflow" | "generic";

export interface SkillAuditFinding { severity: "info" | "warning" | "error"; message: string }
export interface SkillAuditResult { name: string; path: string; score: number; findings: SkillAuditFinding[]; hasFrontmatter: boolean; description?: string }
export interface SkillAuditReport { total: number; averageScore: number; results: SkillAuditResult[]; errors: number; warnings: number }

export interface SkillTraceItem { skill: string; reason: string; source?: "intent" | "regex" | "file" | "subagent" | "duplicate" | "conflict" | "max_cap" | "manual" }
export interface SkillConflictResolution { selected: string[]; suppressed: { skill: string; reason: string }[]; trace?: { selected: SkillTraceItem[]; rejected: SkillTraceItem[] } }
export interface SkillHardeningReport { checked: number; changed: number; changes: { name: string; description: string }[] }
export interface Capability { id: string; title: string; domains: string[]; agents: string[]; skills: string[]; tools: string[]; verification: string[]; maturity: "baseline" | "advanced" | "stateful"; ownerAgent?: string; knownLimitations?: string[]; nextMaturityStep?: string; lastVerifiedAt?: string }
export interface CapabilityRegistry { capabilities: Capability[] }
export interface SkillCapability { routingMode: "auto" | "manual_or_keyword" | "internal_support"; intents: string[]; signals: string[]; files: string[]; verification: string[]; preferredAgents?: string[]; samplePrompts: string[] }
export interface EvidenceRecord { id: string; taskId: string; type: "command" | "source" | "review" | "manual" | "file"; summary: string; command?: string; status: "pass" | "fail" | "blocked" | "unknown"; timestamp: string; workflowId?: string; files?: string[]; area?: string }
export interface TelemetryEvent {
  kind: "skill_selected" | "task_blocked" | "agent_retry" | "verification_used" | "delegation_accepted" | "delegation_rejected" | "skill_followup" | "skill_final_used" | "skill_blocked" | "user_correction" | "verification_result" | "routing_decision" | "task_outcome" | "context_autocompaction";
  name: string;
  at: string;
  metadata?: Record<string, unknown>;
}
export interface JceDoctorReport { checks: { name: string; status: "pass" | "warning" | "fail"; message: string }[]; summary: { pass: number; warning: number; fail: number } }
export interface AgentAuditFinding { severity: "info" | "warning" | "error"; agent: string; message: string }
export interface AgentAuditReport { total: number; errors: number; warnings: number; findings: AgentAuditFinding[] }
export interface PolicyEnforcementRow { area: string; level: "hard" | "hard+telemetry" | "partial" | "prompt-only" | "warning+gate"; note: string; promptSource?: string; runtimeSource?: string }
export interface PolicyEnforcementReport { rows: PolicyEnforcementRow[] }

export interface SkillTelemetrySummary {
  selectedByIntent: Record<string, number>;
  finalUsed: Record<string, number>;
  followups: Record<string, number>;
  acceptedDelegations: Record<string, number>;
  rejectedDelegations: Record<string, number>;
  verificationPassBySkill: Record<string, number>;
  verificationFailBySkill: Record<string, number>;
  suppressedBySkill: Record<string, number>;
  userCorrectionsBySkill: Record<string, number>;
  usefulBySkill: Record<string, number>;
  noisyBySkill: Record<string, number>;
  outcomeBySkill: Record<string, { success: number; fail: number; followup: number }>;
}

export interface PlannerTelemetrySummary {
  fanOutTriggered: number;
  linearFallback: number;
  recentModes: Array<{ at: string; mode: "fanout" | "linear-fallback"; detectedUnits: number; fallbackReason?: string }>;
}

export interface RoutingQualitySummary {
  usefulSkills: Array<{ skill: string; score: number }>;
  noisySkills: Array<{ skill: string; score: number }>;
  overSelectedSkills: Array<{ skill: string; score: number }>;
  failedTaskSkills: Array<{ skill: string; score: number }>;
}

const FRAMEWORK = new Set(["nextjs", "react", "vue", "svelte", "angular", "laravel", "rails", "spring-boot", "express-nestjs", "django-fastapi", "flutter-dart", "android-kotlin", "react-native"]);
const LANGUAGE = new Set(["typescript", "python", "rust", "go", "java-kotlin", "php", "ruby", "cpp", "csharp", "shell-bash", "swift-ios", "scala", "elixir"]);
const WORKFLOW = new Set(["software-engineering", "jce-worker-operating-system", "verification-discipline", "delegation-quality", "release-engineering", "codebase-intelligence", "context-preservation"]);
const GENERIC = new Set(["frontend", "architecture", "security", "devops"]);

export function classifySkill(name: string): SkillTier {
  if (FRAMEWORK.has(name)) return "framework";
  if (LANGUAGE.has(name)) return "language";
  if (WORKFLOW.has(name)) return "workflow";
  if (GENERIC.has(name)) return "generic";
  return "domain";
}

function parseFrontmatter(text: string): Record<string, string> | undefined {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return undefined;
  const data: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const item = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (item) data[item[1]!] = item[2]!.replace(/^['"]|['"]$/g, "");
  }
  return data;
}

export function auditSkillFile(path: string): SkillAuditResult {
  const text = readFileSync(path, "utf8");
  const folderName = basename(dirname(path));
  const frontmatter = parseFrontmatter(text);
  const findings: SkillAuditFinding[] = [];
  let score = 100;
  if (!frontmatter) { score -= 20; findings.push({ severity: "warning", message: "Missing YAML frontmatter." }); }
  if (frontmatter?.name && frontmatter.name !== folderName) { score -= 15; findings.push({ severity: "error", message: `Frontmatter name '${frontmatter.name}' does not match folder '${folderName}'.` }); }
  const description = frontmatter?.description;
  if (!description || description.length < 40) { score -= 15; findings.push({ severity: "warning", message: "Description is missing or too short for reliable routing." }); }
  if (!/\b(use|gunakan|when|loaded|trigger|untuk)\b/i.test(description ?? text.slice(0, 400))) { score -= 10; findings.push({ severity: "warning", message: "Trigger/use-case language is weak." }); }
  if (!/verify|verification|test|validasi|evidence|bukti/i.test(text)) { score -= 15; findings.push({ severity: "warning", message: "No explicit verification/evidence guidance found." }); }
  if (!/workflow|protocol|checklist|steps?|langkah/i.test(text)) { score -= 10; findings.push({ severity: "warning", message: "No clear workflow/checklist found." }); }
  if (text.length > 12000) { score -= 5; findings.push({ severity: "info", message: "Skill is large; consider splitting or summarizing." }); }
  return { name: frontmatter?.name ?? folderName, path, score: Math.max(0, score), findings, hasFrontmatter: Boolean(frontmatter), description };
}

export function auditSkills(skillsDir: string): SkillAuditReport {
  const paths = existsSync(skillsDir) ? readdirSync(skillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(skillsDir, entry.name, "SKILL.md")).filter(existsSync) : [];
  const results = paths.map(auditSkillFile).sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  const totalScore = results.reduce((sum, result) => sum + result.score, 0);
  return { total: results.length, averageScore: results.length ? Math.round(totalScore / results.length) : 0, results, errors: results.flatMap((r) => r.findings).filter((f) => f.severity === "error").length, warnings: results.flatMap((r) => r.findings).filter((f) => f.severity === "warning").length };
}

/**
 * Security audit over every installed skill file in a directory. Supports both
 * the new (name/SKILL.md) and legacy (name.md) layouts. Reads file content and
 * delegates scoring to the combination-based scanner in skill-security.ts.
 */
export function auditSkillSecurity(skillsDir: string): SkillSecurityReport {
  if (!existsSync(skillsDir)) return { total: 0, flagged: 0, blocked: 0, results: [] };
  const entries: Array<{ name: string; text: string; path?: string }> = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    let path: string | undefined;
    let name = entry.name;
    if (entry.isDirectory()) {
      const candidate = join(skillsDir, entry.name, "SKILL.md");
      if (existsSync(candidate)) path = candidate;
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      path = join(skillsDir, entry.name);
      name = entry.name.replace(/\.md$/, "");
    }
    if (!path) continue;
    try { entries.push({ name, text: readFileSync(path, "utf8"), path }); } catch { /* unreadable; skip */ }
  }
  return scanSkills(entries);
}


export function resolveSkillConflicts(skills: string[], max = 4): SkillConflictResolution {
  const unique = [...new Set(skills)];
  const selected: string[] = [];
  const suppressed: { skill: string; reason: string }[] = [];
  const has = (name: string) => unique.includes(name);
  const suppress = (skill: string, reason: string) => suppressed.push({ skill, reason });
  for (const skill of unique) {
    if (skill === "frontend" && (has("react") || has("nextjs") || has("vue") || has("svelte") || has("angular"))) { suppress(skill, "Specific frontend framework skill covers this task."); continue; }
    if (skill === "react" && has("nextjs")) { suppress(skill, "Next.js skill includes React-specific guidance for this task."); continue; }
    if (skill === "php" && has("laravel")) { suppress(skill, "Laravel skill is more specific than generic PHP."); continue; }
    if (skill === "java-kotlin" && has("android-kotlin")) { suppress(skill, "Android Kotlin skill is more specific than generic JVM guidance."); continue; }
    if (skill === "security" && has("android-security")) { suppress(skill, "Android security skill is more specific for Android surfaces."); continue; }
    if (skill === "security" && has("web-security-audit")) { suppress(skill, "Web security audit skill is more specific for website pentest/audit."); continue; }
    selected.push(skill);
  }
  const rank = (skill: string) => ({ framework: 0, domain: 1, language: 2, workflow: 3, generic: 4 }[classifySkill(skill)] ?? 9);
  const ranked = selected.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const limited = ranked.slice(0, max);
  for (const skill of ranked.slice(max)) suppress(skill, `Limited to top ${max} skills for token discipline.`);
  return { selected: limited, suppressed, trace: { selected: limited.map((skill) => ({ skill, reason: "selected after ranking", source: "intent" })), rejected: suppressed.map((item) => ({ ...item, source: item.reason.includes("Limited to top") ? "max_cap" : "conflict" })) } };
}

function hardenedDescription(name: string, current?: string): string {
  if (current && current.length >= 40 && /\b(use|when|trigger|untuk|gunakan)\b/i.test(current)) return current;
  const base = current && current.length > 0 ? current : name;
  return `${base}. Use when working on ${name} tasks, related files, debugging, implementation, review, or verification workflows.`;
}

export function hardenSkillDescriptions(skillsDir: string, options: { write?: boolean } = {}): SkillHardeningReport {
  const paths = existsSync(skillsDir) ? readdirSync(skillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(skillsDir, entry.name, "SKILL.md")).filter(existsSync) : [];
  const changes: SkillHardeningReport["changes"] = [];
  for (const path of paths) {
    const text = readFileSync(path, "utf8");
    const name = basename(dirname(path));
    const frontmatter = parseFrontmatter(text);
    const nextDescription = hardenedDescription(name, frontmatter?.description);
    if (frontmatter?.description === nextDescription) continue;
    changes.push({ name, description: nextDescription });
    if (options.write) {
      const nextText = frontmatter
        ? text.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (block) => block.includes("description:") ? block.replace(/^description:\s*.*$/m, `description: ${nextDescription}`) : block.replace(/\r?\n---$/, `\ndescription: ${nextDescription}\n---`))
        : `---\nname: ${name}\ndescription: ${nextDescription}\n---\n\n${text}`;
      writeFileSync(path, nextText, "utf8");
    }
  }
  return { checked: paths.length, changed: changes.length, changes };
}

export function resolveSkillConflictsV2(skills: string[], context: { intent?: string; files?: string[]; stack?: string[]; max?: number } = {}): SkillConflictResolution {
  const unique = [...new Set(skills.filter(Boolean))];
  const suppressions: { skill: string; reason: string }[] = [];
  const traceRejected: SkillTraceItem[] = [];
  const has = (name: string) => unique.includes(name);
  const suppress = (skill: string, reason: string, source: SkillTraceItem["source"] = "conflict") => { suppressions.push({ skill, reason }); traceRejected.push({ skill, reason, source }); };
  const fileText = (context.files ?? []).join(" ").toLowerCase();
  const intent = (context.intent ?? "").toLowerCase();
  const score = (skill: string): number => {
    let value = 100 - ({ framework: 0, domain: 15, language: 25, workflow: 35, generic: 45 }[classifySkill(skill)] ?? 60);
    if (fileText.includes(skill.replace("-", "")) || fileText.includes(skill)) value += 20;
    if (skill === "typescript" && /(\.ts|\.tsx|package\.json)/.test(fileText)) value += 12;
    if (skill === "security" && /security|auth|vulnerab|audit/.test(intent)) value += 15;
    if (skill === "web-security-audit" && /security|auth|vulnerab|audit|pentest|owasp|attack surface|bug bounty/.test(intent)) value += 18;
    if (skill === "auth-identity" && /oauth|jwt|rbac|session|login|auth/.test(intent)) value += 20;
    if (skill === "api-design-patterns" && /api|endpoint|route|openapi|graphql/.test(intent)) value += 20;
    if (skill === "verification-discipline" && /test|verify|release|fix|bug/.test(intent)) value += 10;
    return value;
  };
  let candidates = unique.filter((skill) => {
    if (skill === "frontend" && ["react", "nextjs", "vue", "svelte", "angular"].some(has)) { suppress(skill, "Specific frontend framework skill outranks generic frontend.", "conflict"); return false; }
    if (skill === "react" && has("nextjs")) { suppress(skill, "Next.js skill covers React guidance for this route.", "conflict"); return false; }
    if (skill === "security" && has("auth-identity") && /oauth|jwt|rbac|session|login|auth/.test(intent)) { suppress(skill, "Auth identity is more specific for authentication work.", "conflict"); return false; }
    if (skill === "security" && has("web-security-audit") && /pentest|pen test|penetration|bug bounty|attack surface|owasp|web audit|web security/.test(intent)) { suppress(skill, "Web security audit is more specific for website pentest/audit.", "conflict"); return false; }
    if (skill === "architecture" && has("api-design-patterns") && /api|endpoint|openapi|graphql/.test(intent)) { suppress(skill, "API design patterns are more specific than generic architecture for API work.", "conflict"); return false; }
    if (skill === "devops" && has("platform-engineering") && /kubernetes|helm|gitops|terraform|pulumi/.test(intent)) { suppress(skill, "Platform engineering is more specific for platform/IaC work.", "conflict"); return false; }
    if (skill === "observability" && has("reliability-engineering") && /sre|incident|load|chaos|error budget/.test(intent)) { suppress(skill, "Reliability engineering is more specific for SRE/resilience work.", "conflict"); return false; }
    if (skill === "typescript" && ["nextjs", "react", "vue", "svelte", "angular", "express-nestjs"].some(has) && !(context.files ?? []).some((file) => /\.(ts|tsx|js|jsx)$/.test(file))) { suppress(skill, "Framework skill carries TypeScript guidance unless TS files are explicitly in scope.", "file"); return false; }
    return true;
  });
  candidates = candidates.sort((a, b) => score(b) - score(a) || a.localeCompare(b));
  const limit = context.max ?? 4;
  for (const skill of candidates.slice(limit)) suppress(skill, `Limited to top ${limit} context-ranked skills.`, "max_cap");
  return {
    selected: candidates.slice(0, limit),
    suppressed: suppressions,
    trace: {
      selected: candidates.slice(0, limit).map((skill) => ({ skill, reason: `context score ${score(skill)}`, source: fileText.includes(skill) ? "file" : /test|verify|release|fix|bug|api|endpoint|auth/.test(intent) ? "intent" : "regex" })),
      rejected: traceRejected,
    },
  };
}

export function summarizeCommandEvidence(command: string, output: string): Omit<EvidenceRecord, "id" | "timestamp"> | null {
  const normalized = `${command}\n${output}`;
  const isVerification = /\b(test|typecheck|tsc|lint|build|audit|validate|doctor|check|bun\s+test|npm\s+test|pytest|cargo\s+test)\b/i.test(normalized);
  if (!isVerification) return null;
  const failed = /\b(0\s+pass|fail(?:ed)?|error|exit\s+code\s+[1-9]|not ok)\b/i.test(output) && !/\b0\s+fail\b/i.test(output);
  const passed = /\b(pass(?:ed)?|0\s+fail|no\s+errors?|success|ok)\b/i.test(output) && !failed;
  return { taskId: "auto-capture", type: "command", command, status: passed ? "pass" : failed ? "fail" : "unknown", summary: `${command} -> ${passed ? "pass" : failed ? "fail" : "unknown"}`, area: "auto-capture" };
}

export function buildCapabilityRegistry(): CapabilityRegistry {
  return { capabilities: [
    { id: "jce.skill-audit", title: "Skill quality audit and scoring", domains: ["jce", "skills"], agents: ["jce-worker"], skills: ["jce-worker-operating-system", "verification-discipline"], tools: [], verification: ["opencode-jce skills audit"], maturity: "advanced", ownerAgent: "jce-worker", knownLimitations: ["Heuristic frontmatter scoring"], nextMaturityStep: "Enforce no skill below 80 in tests" },
    { id: "jce.skill-conflict-resolution", title: "Skill conflict resolution and ranking", domains: ["jce", "routing"], agents: ["jce-worker"], skills: ["delegation-quality"], tools: [], verification: ["opencode-jce skills resolve"], maturity: "advanced" },
    { id: "jce.capability-registry", title: "Capability registry and explainable discovery", domains: ["jce"], agents: ["jce-worker"], skills: ["codebase-intelligence"], tools: [], verification: ["opencode-jce capabilities list"], maturity: "advanced" },
    { id: "jce.behavior-doctor", title: "JCE-Worker doctor for agents/skills/runtime alignment", domains: ["jce", "config"], agents: ["jce-worker"], skills: ["developer-tooling"], tools: [], verification: ["opencode-jce jce-worker doctor"], maturity: "advanced" },
    { id: "jce.evidence-store", title: "Evidence store and export", domains: ["verification"], agents: ["jce-worker"], skills: ["verification-discipline"], tools: [], verification: ["opencode-jce evidence list"], maturity: "baseline" },
    { id: "jce.docs-generation", title: "Generated documentation from agents, skills, and capabilities", domains: ["docs"], agents: ["technical-writer"], skills: ["codebase-intelligence"], tools: [], verification: ["opencode-jce docs generate --check"], maturity: "baseline" },
    { id: "jce.telemetry", title: "Local non-PII skill and workflow telemetry", domains: ["analytics"], agents: ["jce-worker"], skills: ["observability"], tools: [], verification: ["opencode-jce analytics"], maturity: "baseline" },
    { id: "android.advanced-flow", title: "Android project diagnostics, verification, security, release readiness", domains: ["android"], agents: ["android"], skills: ["android-kotlin", "android-gradle", "android-security"], tools: ["android_logcat"], verification: ["./gradlew test", "./gradlew assembleDebug"], maturity: "advanced" },
    { id: "flutter.advanced-flow", title: "Flutter diagnostics, platform verification, release readiness", domains: ["flutter"], agents: ["mobile-dev"], skills: ["flutter-dart"], tools: [], verification: ["flutter analyze", "flutter test"], maturity: "advanced" },
    { id: "nextjs.advanced-flow", title: "Next.js route/component/env/build diagnostics", domains: ["web", "nextjs"], agents: ["frontend"], skills: ["nextjs", "react", "typescript"], tools: [], verification: ["npm run build", "npm test"], maturity: "baseline" },
    { id: "react.advanced-flow", title: "React component/hooks/accessibility/test diagnostics", domains: ["web", "react"], agents: ["frontend"], skills: ["react", "typescript"], tools: [], verification: ["npm test", "npm run lint"], maturity: "baseline" },
    { id: "node-api.advanced-flow", title: "Node/API endpoint/auth/schema verification planning", domains: ["api", "node"], agents: ["backend"], skills: ["express-nestjs", "api-design-patterns", "security"], tools: [], verification: ["npm test", "npm run typecheck"], maturity: "baseline" },
    { id: "devops-ci.advanced-flow", title: "Docker/CI workflow readiness and risk checks", domains: ["devops", "ci"], agents: ["devops"], skills: ["devops"], tools: [], verification: ["docker build", "actionlint"], maturity: "baseline" },
    { id: "security.advanced-flow", title: "Threat model, secrets, auth boundary, dependency risk baseline", domains: ["security"], agents: ["security"], skills: ["security", "auth-identity"], tools: [], verification: ["security scan", "test suite"], maturity: "baseline", ownerAgent: "security", knownLimitations: ["No built-in scanner invocation yet"], nextMaturityStep: "Add semgrep/npm audit adapter" },
    { id: "jce.stateful-enforcement", title: "Stateful completion gates backed by workflow/orchestration state", domains: ["jce", "workflow"], agents: ["jce-worker"], skills: ["jce-worker-operating-system", "verification-discipline"], tools: [], verification: ["bun test tests/unit/workflow-simulator.test.ts"], maturity: "stateful", ownerAgent: "jce-worker", knownLimitations: ["Gates run on final assistant text (experimental.text.complete) and tool output; the OpenCode SDK exposes no pre-generation cancel hook, so gates flag/append rather than block generation"], nextMaturityStep: "Move to a hard pre-generation block if/when OpenCode adds a cancellable pre-final hook" },
    { id: "jce.evidence-auto-capture", title: "Automatic command evidence persistence from verification tools", domains: ["verification"], agents: ["jce-worker"], skills: ["verification-discipline"], tools: ["Bash"], verification: ["bun test tests/unit/jce-intelligence-hardening.test.ts"], maturity: "stateful", ownerAgent: "jce-worker", knownLimitations: ["Command parsing is heuristic"], nextMaturityStep: "Attach changed-file ownership to evidence records" },
  ] };
}

export function buildSkillCapabilityMatrix(): Record<string, SkillCapability> {
  const matrix: Record<string, SkillCapability> = {};
  for (const [skill] of Object.entries(SKILL_NAME_TO_FILE)) {
    if (skill in INTENTIONAL_SKILL_ALIASES) continue;
    const registry = SKILL_REGISTRY[skill];
    if (!registry) continue;
    matrix[skill] = {
      routingMode: registry.routingMode,
      intents: registry.intents,
      signals: registry.signals,
      files: registry.files,
      verification: registry.verification,
      preferredAgents: registry.preferredAgents,
      samplePrompts: registry.samplePrompts,
    };
    Object.assign(matrix[skill], SKILL_CAPABILITY_OVERRIDES[skill] ?? {});
  }
  return matrix;
}

const SKILL_CAPABILITY_OVERRIDES: Partial<Record<string, Partial<SkillCapability>>> = {
  "android-gradle": {
    intents: ["bugfix", "config"],
    signals: ["build.gradle", "build.gradle.kts", "settings.gradle", "libs.versions.toml", "duplicate class", "no matching variant", "could not resolve"],
    verification: ["./gradlew :app:assembleDebug"],
    preferredAgents: ["android"],
  },
  "android-kotlin": {
    intents: ["bugfix", "feature", "refactor"],
    signals: ["AndroidManifest.xml", "MainActivity.kt", "Jetpack Compose", "Room", "Hilt", "adb", "logcat"],
    verification: ["./gradlew testDebugUnitTest", "./gradlew assembleDebug"],
    preferredAgents: ["android"],
  },
  "android-testing": {
    intents: ["tests", "bugfix"],
    signals: ["testDebugUnitTest", "connectedDebugAndroidTest", "androidTest", "Robolectric", "Compose test"],
    verification: ["./gradlew testDebugUnitTest", "./gradlew connectedDebugAndroidTest"],
    preferredAgents: ["android"],
  },
  "android-release": {
    intents: ["release", "config", "bugfix"],
    signals: ["bundleRelease", "assembleRelease", "R8", "ProGuard", "signingConfig", "versionCode", "versionName"],
    verification: ["./gradlew bundleRelease", "./gradlew lintVitalRelease"],
    preferredAgents: ["android"],
  },
  "verification-discipline": {
    intents: ["bugfix", "release", "review"],
    signals: ["verify", "test", "evidence", "completion"],
    verification: ["targeted test", "wider regression command"],
    preferredAgents: ["oracle"],
  },
  "human-ui-design": {
    intents: ["feature", "review"],
    signals: ["dashboard", "landing page", "visual", "generated by AI", "human-crafted"],
    verification: ["browser visual review", "accessibility check"],
    preferredAgents: ["frontend"],
  },
};

export function auditAgents(root: string): AgentAuditReport {
  const path = join(root, "config", "agents.json");
  const findings: AgentAuditFinding[] = [];
  if (!existsSync(path)) return { total: 0, errors: 1, warnings: 0, findings: [{ severity: "error", agent: "registry", message: "Missing config/agents.json." }] };
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { agents?: Array<Record<string, unknown>> };
  const agents = Array.isArray(parsed.agents) ? parsed.agents : [];
  const required = ["id", "name", "role", "systemPrompt", "workflow", "outputFormat", "verification", "routing"];
  for (const agent of agents) {
    const id = typeof agent.id === "string" ? agent.id : "unknown";
    for (const field of required) if (!(field in agent)) findings.push({ severity: field === "verification" || field === "outputFormat" ? "error" : "warning", agent: id, message: `Missing ${field}.` });
    const output = typeof agent.outputFormat === "string" ? agent.outputFormat : "";
    if (!/verification|evidence|sources|risks/i.test(output)) findings.push({ severity: "warning", agent: id, message: "Output format lacks explicit evidence/verification/sources/risks section." });
  }
  return { total: agents.length, errors: findings.filter((f) => f.severity === "error").length, warnings: findings.filter((f) => f.severity === "warning").length, findings };
}

export function generateAgentsCanonicalMarkdown(): string {
  return ["# JCE-Worker Canonical Protocol", "", "- IntentGate: classify true user intent before action.", "- Plan: convert non-trivial work into acceptance criteria and actionable steps.", "- Execute: keep changes minimal, reversible, and scoped.", "- Delegate: parallelize independent specialist work and require Summary/Files/Verification/Risks.", "- Verify: require fresh evidence matched to task type before completion claims.", "- Enforce: block final answers while todos, background tasks, workflow steps, blockers, or evidence gaps remain.", "- Preserve: update project context for durable decisions and checkpoint before session end.", ""].join("\n");
}

export function buildAnalyticsRecommendations(events: TelemetryEvent[], evidence: EvidenceRecord[] = []): string[] {
  const recommendations: string[] = [];
  const blocked = events.filter((event) => event.kind === "task_blocked").length;
  const verification = events.filter((event) => event.kind === "verification_used").length + evidence.filter((record) => record.type === "command").length;
  const failedEvidence = evidence.filter((record) => record.status === "fail").length;
  if (verification === 0) recommendations.push("Enable/verify evidence auto-capture: no verification evidence has been stored.");
  if (blocked > verification) recommendations.push("Investigate completion gates: blocked tasks exceed verification events.");
  if (failedEvidence > 0) recommendations.push("Review failing evidence records and add regression tests for repeated failures.");
  if (events.length === 0) recommendations.push("Telemetry is empty; run normal JCE workflows to collect local non-PII routing data.");
  const rejectedDelegations = events.filter((event) => event.kind === "delegation_rejected").length;
  if (rejectedDelegations > 0) recommendations.push("Delegation rejection detected; inspect sub-agent contract quality and review acceptance rules.");
  const planner = summarizePlannerTelemetry(events);
  if (planner.linearFallback >= 3 && planner.linearFallback > planner.fanOutTriggered) recommendations.push("Planner linear fallback is frequent; inspect decomposition prompts and fan-out heuristics.");
  return recommendations;
}

export function assessJceDoctor(root: string): JceDoctorReport {
  const checks: JceDoctorReport["checks"] = [];
  const add = (name: string, status: "pass" | "warning" | "fail", message: string) => checks.push({ name, status, message });
  const skillsDir = join(root, "config", "skills");
  const agentsPath = join(root, "config", "agents.json");
  add("agents.json", existsSync(agentsPath) ? "pass" : "fail", existsSync(agentsPath) ? "Agent registry exists." : "Missing config/agents.json.");
  const skillCount = existsSync(skillsDir) ? readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).length : 0;
  add("skills", skillCount >= 50 ? "pass" : "warning", `${skillCount} skill directories detected.`);
  const capabilities = buildCapabilityRegistry().capabilities.length;
  add("capabilities", capabilities >= 10 ? "pass" : "warning", `${capabilities} capabilities registered.`);
  add("context-keeper", existsSync(join(root, "src", "mcp", "context-keeper.ts")) ? "pass" : "warning", "Context keeper source checked.");
  const plannerSummary = summarizePlannerTelemetry(loadTelemetry(root));
  if (plannerSummary.linearFallback >= 3 && plannerSummary.linearFallback > plannerSummary.fanOutTriggered) {
    add("planner-fallback", "warning", `Planner linear fallback ${plannerSummary.linearFallback} exceeds fan-out ${plannerSummary.fanOutTriggered}. Review decomposition prompts or planner heuristics.`);
  } else {
    add("planner-fallback", "pass", `Planner fan-out ${plannerSummary.fanOutTriggered}, linear fallback ${plannerSummary.linearFallback}.`);
  }
  const summary = { pass: checks.filter((c) => c.status === "pass").length, warning: checks.filter((c) => c.status === "warning").length, fail: checks.filter((c) => c.status === "fail").length };
  return { checks, summary };
}

export function getPolicyEnforcementReport(): PolicyEnforcementReport {
  const rows: PolicyEnforcementRow[] = [
    { area: "Intent routing", level: "hard+telemetry", note: "Intent scored, route persisted, telemetry recorded.", promptSource: "src/plugin/agents/jce-worker.ts#IntentGate", runtimeSource: "src/plugin/index.ts chat.message + routing telemetry" },
    { area: "Skill auto-loading", level: "hard", note: "Skills auto-selected and injected into system prompt when routing resolves matches.", promptSource: "src/plugin/agents/jce-worker.ts#Auto-Dispatch", runtimeSource: "src/plugin/index.ts experimental.chat.system.transform + skill-loader.ts" },
    { area: "Skill count 1-2", level: "prompt-only", note: "Runtime may load up to 4 skills; prompt wording is stricter than enforcement.", promptSource: "global AGENTS.md auto-dispatch wording", runtimeSource: "src/plugin/lib/skill-loader.ts max cap = 4" },
    { area: "Parallel delegation", level: "partial", note: "Planner now fans out clearly independent implementation units into sibling nodes; generic cases still fall back to safest linear path.", promptSource: "src/plugin/agents/jce-worker.ts#IntentGate + #Delegation Contract", runtimeSource: "src/plugin/lib/orchestration/planner.ts + scheduler.ts + bridge.ts" },
    { area: "Delegated output contract", level: "hard", note: "Collected sub-agent output is scored/reviewed for contract quality and evidence strength.", promptSource: "src/plugin/agents/jce-worker.ts#Delegation Contract", runtimeSource: "src/plugin/tools/dispatch.ts bg_collect review path" },
    { area: "Main-agent verification", level: "warning+gate", note: "Final text is inspected for completion claims; runtime appends verification/final-gate warnings but cannot pre-block generation.", promptSource: "src/plugin/agents/jce-worker.ts#Verification Evidence", runtimeSource: "src/plugin/index.ts experimental.text.complete + tool.execute.after" },
    { area: "Context preservation", level: "partial", note: "Context file existence enforced; full context-update/checkpoint lifecycle still depends on agent behavior/tool use.", promptSource: "global AGENTS.md context rules", runtimeSource: "src/plugin/index.ts createProjectContextIfMissing + external context-keeper usage" },
  ];
  return { rows };
}

export function buildPolicyEnforcementReport(): string {
  const { rows } = getPolicyEnforcementReport();
  return [
    "Policy vs Enforcement",
    "=====================",
    ...rows.map((row) => `- ${row.area}: ${row.level} — ${row.note}`),
  ].join("\n");
}

export function evidencePath(root: string): string { return join(root, ".opencode-jce", "evidence.json"); }
export function telemetryPath(root: string): string { return join(root, ".opencode-jce", "telemetry.json"); }

export function loadEvidence(root: string): EvidenceRecord[] {
  const path = evidencePath(root);
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(parsed) ? parsed as EvidenceRecord[] : [];
}

export function appendEvidence(root: string, record: Omit<EvidenceRecord, "id" | "timestamp">): EvidenceRecord {
  const records = loadEvidence(root);
  const saved: EvidenceRecord = { ...record, id: `ev-${Date.now()}-${records.length + 1}`, timestamp: new Date().toISOString() };
  const path = evidencePath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify([...records, saved], null, 2) + "\n", "utf8");
  return saved;
}

export function loadTelemetry(root: string): TelemetryEvent[] {
  const path = telemetryPath(root);
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(parsed) ? parsed as TelemetryEvent[] : [];
}

export function summarizeTelemetry(events: TelemetryEvent[]): Record<string, number> {
  return events.reduce<Record<string, number>>((acc, event) => { const key = `${event.kind}:${event.name}`; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {});
}

export function buildSkillDoctorReport(): {
  totalSkills: number;
  missingMetadata: string[];
  weakPrompts: string[];
  manualOnly: string[];
  lowConfidencePrompts: string[];
  samplePromptFailures: string[];
} {
  const missingMetadata: string[] = [];
  const weakPrompts: string[] = [];
  const manualOnly: string[] = [];
  const lowConfidencePrompts: string[] = [];
  const samplePromptFailures: string[] = [];
  for (const [skill, entry] of Object.entries(SKILL_REGISTRY)) {
    if (!entry.intents.length || !entry.signals.length || !entry.files.length || !entry.samplePrompts.length) missingMetadata.push(skill);
    if ((entry.samplePrompts[0] ?? "").length < 20) weakPrompts.push(skill);
    if (entry.routingMode !== "auto") manualOnly.push(skill);
    if (entry.routingMode === "auto") {
      const report = explainSkillRouting(entry.samplePrompts[0] ?? "");
      const selected = report.selected.map((item) => item.skill);
      if (!selected.includes(skill)) samplePromptFailures.push(skill);
      if (report.confidence < 35) lowConfidencePrompts.push(skill);
    }
  }
  return {
    totalSkills: Object.keys(SKILL_REGISTRY).length,
    missingMetadata: missingMetadata.sort(),
    weakPrompts: weakPrompts.sort(),
    manualOnly: manualOnly.sort(),
    lowConfidencePrompts: lowConfidencePrompts.sort(),
    samplePromptFailures: samplePromptFailures.sort(),
  };
}

export function summarizeSkillTelemetry(events: TelemetryEvent[]): SkillTelemetrySummary {
  const init = (): Record<string, number> => ({});
  const outcomeInit = (): Record<string, { success: number; fail: number; followup: number }> => ({});
  const summary: SkillTelemetrySummary = {
    selectedByIntent: init(),
    finalUsed: init(),
    followups: init(),
    acceptedDelegations: init(),
    rejectedDelegations: init(),
    verificationPassBySkill: init(),
    verificationFailBySkill: init(),
    suppressedBySkill: init(),
    userCorrectionsBySkill: init(),
    usefulBySkill: init(),
    noisyBySkill: init(),
    outcomeBySkill: outcomeInit(),
  };
  for (const event of events) {
    const skill = String(event.metadata?.skill ?? event.name ?? "unknown");
    if (event.kind === "skill_selected") summary.selectedByIntent[skill] = (summary.selectedByIntent[skill] ?? 0) + 1;
    if (event.kind === "skill_final_used") summary.finalUsed[skill] = (summary.finalUsed[skill] ?? 0) + 1;
    if (event.kind === "skill_followup") summary.followups[skill] = (summary.followups[skill] ?? 0) + 1;
    if (event.kind === "delegation_accepted") summary.acceptedDelegations[skill] = (summary.acceptedDelegations[skill] ?? 0) + 1;
    if (event.kind === "delegation_rejected") summary.rejectedDelegations[skill] = (summary.rejectedDelegations[skill] ?? 0) + 1;
    if (event.kind === "user_correction") summary.userCorrectionsBySkill[skill] = (summary.userCorrectionsBySkill[skill] ?? 0) + 1;
    if (event.kind === "verification_result") {
      const pass = Boolean(event.metadata?.passed);
      const bucket = pass ? summary.verificationPassBySkill : summary.verificationFailBySkill;
      bucket[skill] = (bucket[skill] ?? 0) + 1;
    }
    if (event.kind === "routing_decision") {
      const selected = Array.isArray(event.metadata?.selectedSkills) ? event.metadata?.selectedSkills : [];
      const suppressed = Array.isArray(event.metadata?.suppressedSkills) ? event.metadata?.suppressedSkills : [];
      for (const item of selected) if (typeof item === "string") summary.selectedByIntent[item] = (summary.selectedByIntent[item] ?? 0) + 1;
      for (const item of suppressed) if (typeof item === "string") summary.suppressedBySkill[item] = (summary.suppressedBySkill[item] ?? 0) + 1;
    }
    if (event.kind === "task_outcome") {
      const skills = Array.isArray(event.metadata?.skills) ? event.metadata?.skills.filter((item): item is string => typeof item === "string") : [skill];
      const outcome = String(event.metadata?.outcome ?? "unknown");
      for (const item of skills) {
        const bucket = summary.outcomeBySkill[item] ?? { success: 0, fail: 0, followup: 0 };
        if (outcome === "success") bucket.success += 1;
        else if (outcome === "fail") bucket.fail += 1;
        else if (outcome === "followup") bucket.followup += 1;
        summary.outcomeBySkill[item] = bucket;
      }
    }
  }
  for (const skill of new Set([...Object.keys(summary.selectedByIntent), ...Object.keys(summary.finalUsed), ...Object.keys(summary.verificationPassBySkill), ...Object.keys(summary.verificationFailBySkill), ...Object.keys(summary.userCorrectionsBySkill), ...Object.keys(summary.suppressedBySkill)])) {
    const useful = (summary.finalUsed[skill] ?? 0) + (summary.verificationPassBySkill[skill] ?? 0) + ((summary.outcomeBySkill[skill]?.success ?? 0) * 2);
    const noisy = (summary.suppressedBySkill[skill] ?? 0) + (summary.verificationFailBySkill[skill] ?? 0) + (summary.userCorrectionsBySkill[skill] ?? 0) + (summary.rejectedDelegations[skill] ?? 0);
    if (useful > 0) summary.usefulBySkill[skill] = useful;
    if (noisy > 0) summary.noisyBySkill[skill] = noisy;
  }
  return summary;
}

export function summarizePlannerTelemetry(events: TelemetryEvent[]): PlannerTelemetrySummary {
  let fanOutTriggered = 0;
  let linearFallback = 0;
  const recentModes: PlannerTelemetrySummary["recentModes"] = [];
  for (const event of events) {
    if (event.kind !== "routing_decision") continue;
    const plannerMode = event.metadata?.plannerMode;
    if (plannerMode === "fanout") fanOutTriggered += 1;
    if (plannerMode === "linear-fallback") linearFallback += 1;
    if (plannerMode === "fanout" || plannerMode === "linear-fallback") {
      recentModes.push({
        at: event.at,
        mode: plannerMode,
        detectedUnits: Array.isArray(event.metadata?.detectedUnits) ? event.metadata?.detectedUnits.length : 0,
        fallbackReason: typeof event.metadata?.fallbackReason === "string" ? event.metadata.fallbackReason : undefined,
      });
    }
  }
  return { fanOutTriggered, linearFallback, recentModes: recentModes.slice(-10).reverse() };
}

export function summarizeRoutingQuality(events: TelemetryEvent[]): RoutingQualitySummary {
  const skillSummary = summarizeSkillTelemetry(events);
  const rank = (values: Record<string, number>) => Object.entries(values).map(([skill, score]) => ({ skill, score })).sort((a, b) => b.score - a.score || a.skill.localeCompare(b.skill)).slice(0, 10);
  const failedScores: Record<string, number> = {};
  for (const [skill, outcome] of Object.entries(skillSummary.outcomeBySkill)) {
    const score = (outcome.fail * 2) + outcome.followup;
    if (score > 0) failedScores[skill] = score;
  }
  const overSelected: Record<string, number> = {};
  for (const skill of Object.keys(skillSummary.selectedByIntent)) {
    const selected = skillSummary.selectedByIntent[skill] ?? 0;
    const useful = skillSummary.usefulBySkill[skill] ?? 0;
    if (selected > useful) overSelected[skill] = selected - useful;
  }
  return {
    usefulSkills: rank(skillSummary.usefulBySkill),
    noisySkills: rank(skillSummary.noisyBySkill),
    overSelectedSkills: rank(overSelected),
    failedTaskSkills: rank(failedScores),
  };
}

export function appendTelemetry(root: string, event: Omit<TelemetryEvent, "at">): TelemetryEvent {
  const events = loadTelemetry(root);
  const saved: TelemetryEvent = { ...event, at: new Date().toISOString() };
  const path = telemetryPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify([...events, saved], null, 2) + "\n", "utf8");
  return saved;
}

export function generateCapabilitiesMarkdown(registry = buildCapabilityRegistry()): string {
  const rows = registry.capabilities.map((cap) => `| ${cap.id} | ${cap.title} | ${cap.agents.join(", ")} | ${cap.skills.join(", ")} | ${cap.maturity} |`);
  return ["# JCE Capability Matrix", "", "| ID | Title | Agents | Skills | Maturity |", "|---|---|---|---|---|", ...rows, ""].join("\n");
}
