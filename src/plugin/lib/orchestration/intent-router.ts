/**
 * Intent Router v2 — Multi-signal scoring with confidence thresholds
 * 
 * Replaces the brittle keyword-first-match router with a scoring system
 * that considers multiple signals: keywords, file extensions, git context,
 * history, and explicit user intent.
 */

import type { IntentType, IntentSignal, ScoredIntent, AgentRole } from "./types.js";

// ─── Signal Definitions ───────────────────────────────────────────────────────

interface KeywordRule {
  intent: IntentType;
  keywords: string[];
  weight: number;
  multiWord?: string[];
}

const KEYWORD_RULES: KeywordRule[] = [
  { intent: "bugfix", keywords: ["bug", "fix", "error", "crash", "debug", "broken", "failing", "regression", "issue", "problem"], multiWord: ["failing test", "failed test", "stack trace", "not working", "doesn't work"], weight: 1.0 },
  { intent: "feature", keywords: ["add", "implement", "feature", "build", "create", "new", "introduce", "support"], multiWord: ["add support", "new feature", "implement the"], weight: 0.9 },
  { intent: "refactor", keywords: ["refactor", "restructure", "reorganize", "clean", "simplify", "extract", "inline", "rename"], multiWord: ["clean up", "code smell", "technical debt"], weight: 1.0 },
  { intent: "review", keywords: ["review", "audit", "check", "inspect", "evaluate", "assess"], multiWord: ["code review", "check this", "look at this"], weight: 0.9 },
  { intent: "release", keywords: ["release", "version", "tag", "publish", "deploy", "changelog"], multiWord: ["bump version", "prepare release", "cut release"], weight: 1.0 },
  { intent: "research", keywords: ["research", "investigate", "explore", "understand", "learn", "compare", "evaluate"], multiWord: ["how does", "what is", "best practice", "pros and cons"], weight: 0.8 },
  { intent: "config", keywords: ["config", "configure", "setup", "settings", "environment", "env"], multiWord: ["set up", "configuration file"], weight: 0.9 },
  { intent: "docs", keywords: ["document", "documentation", "readme", "explain", "describe", "comment"], multiWord: ["write docs", "add documentation", "update readme"], weight: 0.9 },
];

interface FileExtensionRule {
  extensions: string[];
  skills: string[];
  agentHint?: AgentRole;
}

const FILE_EXTENSION_RULES: FileExtensionRule[] = [
  { extensions: [".ts", ".tsx", ".js", ".jsx"], skills: ["typescript"] },
  { extensions: [".py"], skills: ["python"] },
  { extensions: [".rs"], skills: ["rust"] },
  { extensions: [".go"], skills: ["go"] },
  { extensions: [".cs"], skills: ["csharp"] },
  { extensions: [".java", ".kt"], skills: ["java-kotlin"] },
  { extensions: [".rb"], skills: ["ruby"] },
  { extensions: [".php"], skills: ["php"] },
  { extensions: [".vue"], skills: ["vue"] },
  { extensions: [".svelte"], skills: ["svelte"] },
  { extensions: [".swift"], skills: ["swift-ios"] },
  { extensions: [".dart"], skills: ["flutter-dart"] },
  { extensions: [".ex", ".exs"], skills: ["elixir"] },
  { extensions: [".scala"], skills: ["scala"] },
  { extensions: [".sh", ".bash"], skills: ["shell-bash"] },
  { extensions: [".sql"], skills: ["sql-database"] },
  { extensions: [".css", ".scss"], skills: ["tailwind", "frontend"] },
  { extensions: [".html"], skills: ["frontend"] },
  { extensions: [".dockerfile", ".yaml", ".yml"], skills: ["devops"] },
  { extensions: [".tf", ".hcl"], skills: ["platform-engineering"] },
  { extensions: [".sol"], skills: ["blockchain-web3"] },
  { extensions: [".wasm", ".wat"], skills: ["wasm"] },
];

interface FrameworkRule {
  patterns: RegExp[];
  skills: string[];
  agentHint?: AgentRole;
}

const FRAMEWORK_RULES: FrameworkRule[] = [
  { patterns: [/\bnext\.?js\b/i, /\bapp\s*router\b/i, /\bserver\s*action/i], skills: ["nextjs", "react"] },
  { patterns: [/\breact\b/i, /\bjsx\b/i, /\bhook/i, /\buseState\b/, /\buseEffect\b/], skills: ["react"] },
  { patterns: [/\bvue\b/i, /\bnuxt\b/i, /\bpinia\b/i], skills: ["vue"] },
  { patterns: [/\bangular\b/i, /\brxjs\b/i, /\bsignal/i], skills: ["angular"] },
  { patterns: [/\bsvelte\b/i, /\bsveltekit\b/i], skills: ["svelte"] },
  { patterns: [/\blaravel\b/i, /\beloquent\b/i, /\bblade\b/i], skills: ["laravel"] },
  { patterns: [/\bdjango\b/i, /\bfastapi\b/i, /\bpydantic\b/i], skills: ["django-fastapi"] },
  { patterns: [/\bexpress\b/i, /\bnestjs\b/i, /\bnest\.?js\b/i], skills: ["express-nestjs"] },
  { patterns: [/\bspring\s*boot\b/i, /\bjpa\b/i], skills: ["spring-boot"] },
  { patterns: [/\brails\b/i, /\bruby on rails\b/i, /\bactive\s*record\b/i], skills: ["rails"] },
  { patterns: [/\btailwind\b/i, /\butility.first\b/i], skills: ["tailwind"] },
  { patterns: [/\bdocker\b/i, /\bci\/cd\b/i, /\bkubernetes\b/i, /\bhelm\b/i], skills: ["devops"] },
  { patterns: [/\bflutter\b/i, /\briverpod\b/i, /\bwidget/i], skills: ["flutter-dart"] },
  { patterns: [/\breact\s*native\b/i, /\bexpo\b/i], skills: ["react-native"] },
  { patterns: [/\bswiftui\b/i, /\buikit\b/i], skills: ["swift-ios"] },
  { patterns: [/\btauri\b/i], skills: ["tauri"] },
  { patterns: [/\bastro\b/i, /\bremix\b/i], skills: ["astro-remix"] },
  { patterns: [/\bwebsocket\b/i, /\bsse\b/i, /\bcrdt\b/i, /\brealtime\b/i], skills: ["realtime-systems"] },
  { patterns: [/\bsolidity\b/i, /\bweb3\b/i, /\bsmart\s*contract\b/i], skills: ["blockchain-web3"] },
  { patterns: [/\brag\b/i, /\bembedding/i, /\bvector\s*db\b/i, /\bllm\b/i], skills: ["ai-llm-engineering"] },
];

// ─── Intent Scoring ───────────────────────────────────────────────────────────

export interface RouterContext {
  fileExtensions?: string[];
  gitBranch?: string;
  recentIntents?: IntentType[];
  explicitIntent?: IntentType;
}

/**
 * Score all possible intents for a given message, returning the best match.
 */
export function scoreIntent(message: string, context: RouterContext = {}): ScoredIntent {
  const signals: IntentSignal[] = [];
  const text = message.toLowerCase();
  const tokens = new Set(text.split(/[^a-z0-9]+/).filter(Boolean));

  // 1. Keyword signals
  for (const rule of KEYWORD_RULES) {
    let matchCount = 0;
    const matchedKeywords: string[] = [];

    for (const kw of rule.keywords) {
      if (tokens.has(kw)) {
        matchCount++;
        matchedKeywords.push(kw);
      }
    }
    for (const phrase of rule.multiWord ?? []) {
      if (text.includes(phrase)) {
        matchCount += 2; // Multi-word matches are stronger
        matchedKeywords.push(phrase);
      }
    }

    if (matchCount > 0) {
      signals.push({
        source: "keyword",
        intent: rule.intent,
        weight: rule.weight * Math.min(matchCount, 3) / 3, // Cap at 3 matches
        reason: `Matched keywords: ${matchedKeywords.join(", ")}`,
      });
    }
  }

  // 2. File extension signals
  if (context.fileExtensions && context.fileExtensions.length > 0) {
    for (const rule of FILE_EXTENSION_RULES) {
      if (context.fileExtensions.some((ext) => rule.extensions.includes(ext))) {
        // File extensions don't determine intent, but they inform skill selection
        // We add a weak signal for the most likely intent based on context
        signals.push({
          source: "file_extension",
          intent: "general", // File extensions inform skills, not intent
          weight: 0.1,
          reason: `File extensions: ${context.fileExtensions.join(", ")}`,
        });
        break;
      }
    }
  }

  // 3. Git context signals
  if (context.gitBranch) {
    const branch = context.gitBranch.toLowerCase();
    if (branch.startsWith("fix/") || branch.startsWith("bugfix/") || branch.startsWith("hotfix/")) {
      signals.push({ source: "git_context", intent: "bugfix", weight: 0.6, reason: `Branch name: ${context.gitBranch}` });
    } else if (branch.startsWith("feat/") || branch.startsWith("feature/")) {
      signals.push({ source: "git_context", intent: "feature", weight: 0.6, reason: `Branch name: ${context.gitBranch}` });
    } else if (branch.startsWith("refactor/")) {
      signals.push({ source: "git_context", intent: "refactor", weight: 0.6, reason: `Branch name: ${context.gitBranch}` });
    } else if (branch.startsWith("release/") || branch.startsWith("v")) {
      signals.push({ source: "git_context", intent: "release", weight: 0.6, reason: `Branch name: ${context.gitBranch}` });
    } else if (branch.startsWith("docs/")) {
      signals.push({ source: "git_context", intent: "docs", weight: 0.6, reason: `Branch name: ${context.gitBranch}` });
    }
  }

  // 4. History signals (recent intents bias toward continuation)
  if (context.recentIntents && context.recentIntents.length > 0) {
    const lastIntent = context.recentIntents[context.recentIntents.length - 1];
    signals.push({
      source: "history",
      intent: lastIntent,
      weight: 0.3,
      reason: `Continuing from recent ${lastIntent} intent`,
    });
  }

  // 5. Explicit intent (user said "this is a bug fix")
  if (context.explicitIntent) {
    signals.push({
      source: "explicit",
      intent: context.explicitIntent,
      weight: 2.0, // Explicit always wins
      reason: "User explicitly stated intent",
    });
  }

  // Aggregate scores per intent
  const scores = new Map<IntentType, { score: number; signals: IntentSignal[] }>();
  for (const signal of signals) {
    const existing = scores.get(signal.intent) ?? { score: 0, signals: [] };
    existing.score += signal.weight;
    existing.signals.push(signal);
    scores.set(signal.intent, existing);
  }

  // Find the winner
  let bestIntent: IntentType = "general";
  let bestScore = 0;
  let bestSignals: IntentSignal[] = [];

  for (const [intent, data] of scores.entries()) {
    if (data.score > bestScore) {
      bestIntent = intent;
      bestScore = data.score;
      bestSignals = data.signals;
    }
  }

  // Compute confidence (how much better is the winner vs second place?)
  const sortedScores = Array.from(scores.values()).map((d) => d.score).sort((a, b) => b - a);
  const confidence = sortedScores.length <= 1
    ? (bestScore > 0 ? Math.min(bestScore, 1.0) : 0.3)
    : Math.min((sortedScores[0] - sortedScores[1]) / Math.max(sortedScores[0], 0.01) + 0.5, 1.0);

  // Resolve skills
  const skills = resolveSkills(bestIntent, message, context);

  // Resolve agent hint
  const agentHint = resolveAgentHint(bestIntent, message);

  return {
    intent: bestIntent,
    score: Math.round(bestScore * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    signals: bestSignals,
    skills,
    agentHint,
  };
}

// ─── Skill Resolution ─────────────────────────────────────────────────────────

function resolveSkills(intent: IntentType, message: string, context: RouterContext): string[] {
  const skills = new Set<string>();

  // Always include core skill for code tasks
  if (["bugfix", "feature", "refactor", "review"].includes(intent)) {
    skills.add("software-engineering");
  }

  // Intent-specific skills
  const intentSkillMap: Record<IntentType, string[]> = {
    bugfix: ["software-engineering", "verification-discipline"],
    feature: ["software-engineering", "codebase-intelligence"],
    refactor: ["software-engineering"],
    review: ["software-engineering", "codebase-intelligence"],
    release: ["release-engineering", "verification-discipline"],
    research: [],
    config: [],
    docs: [],
    general: ["jce-worker-operating-system"],
  };
  for (const skill of intentSkillMap[intent] ?? []) {
    skills.add(skill);
  }

  // Framework-based skills
  for (const rule of FRAMEWORK_RULES) {
    if (rule.patterns.some((p) => p.test(message))) {
      for (const skill of rule.skills) {
        skills.add(skill);
      }
      break; // Only match first framework
    }
  }

  // File extension-based skills
  if (context.fileExtensions) {
    for (const rule of FILE_EXTENSION_RULES) {
      if (context.fileExtensions.some((ext) => rule.extensions.includes(ext))) {
        for (const skill of rule.skills) {
          skills.add(skill);
        }
      }
    }
  }

  // Cap at 4 skills
  return Array.from(skills).slice(0, 4);
}

function resolveAgentHint(intent: IntentType, message: string): AgentRole | undefined {
  const lower = message.toLowerCase();

  // Research tasks → researcher
  if (intent === "research" || /\bdocumentation\b|\blibrary\b|\bcompare\b/.test(lower)) {
    return "jce-researcher";
  }

  // Architecture decisions → oracle
  if (/\barchitecture\b|\bdesign\s*decision\b|\btrade.?off\b/.test(lower)) {
    return "oracle";
  }

  // UI/frontend → frontend
  if (/\bcomponent\b|\bui\b|\bcss\b|\bstyle\b|\bresponsive\b|\baccessib/i.test(lower)) {
    return "frontend";
  }

  // Codebase exploration → explorer
  if (/\bfind\b|\bwhere\b|\bexplore\b|\bmap\b|\bstructure\b/.test(lower)) {
    return "explorer";
  }

  return undefined;
}

// ─── Backward Compatibility ───────────────────────────────────────────────────

/**
 * Bridge to the old SkillRoute interface for gradual migration.
 */
export interface LegacySkillRoute {
  intent: string;
  skills: string[];
  reason: string;
  agentHint?: string;
}

export function toLegacyRoute(scored: ScoredIntent): LegacySkillRoute {
  return {
    intent: scored.intent,
    skills: scored.skills,
    reason: scored.signals.map((s) => s.reason).join("; "),
    agentHint: scored.agentHint,
  };
}
