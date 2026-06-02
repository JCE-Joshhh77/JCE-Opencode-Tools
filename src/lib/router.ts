import type { Profile } from "../types.js";

// ─── Types ───────────────────────────────────────────────────

export interface RoutingDecision {
  profile: string;
  reason: string;
  complexity: "simple" | "moderate" | "complex";
}

// ─── Keyword Sets ────────────────────────────────────────────

const COMPLEX_KEYWORDS = [
  "architecture",
  "security",
  "debug",
  "refactor",
  "optimize",
  "design pattern",
  "migration",
  "performance",
  "concurrency",
  "distributed",
  "scalability",
  "vulnerability",
  "authentication",
  "authorization",
  "cryptography",
  "algorithm",
  "system design",
  "trade-off",
  "tradeoff",
];

const SIMPLE_KEYWORDS = [
  "explain",
  "list",
  "format",
  "what is",
  "define",
  "summarize",
  "translate",
  "convert",
  "rename",
  "typo",
  "spelling",
  "hello",
  "hi",
  "thanks",
];

// ─── Analysis Functions ──────────────────────────────────────

/**
 * Detect if the prompt contains code blocks (``` or indented code).
 */
function hasCodeBlocks(prompt: string): boolean {
  return /```[\s\S]*?```/.test(prompt) || /^    \S/m.test(prompt);
}

/**
 * Detect if the prompt asks a "how" question (more complex than "what").
 */
function isHowQuestion(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return /\bhow (do|can|should|would|to)\b/.test(lower);
}

/**
 * Count how many complex keywords appear in the prompt.
 */
function countComplexKeywords(prompt: string): number {
  const lower = prompt.toLowerCase();
  return COMPLEX_KEYWORDS.filter((kw) => new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower)).length;
}

/**
 * Count how many simple keywords appear in the prompt.
 */
function countSimpleKeywords(prompt: string): number {
  const lower = prompt.toLowerCase();
  return SIMPLE_KEYWORDS.filter((kw) => new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower)).length;
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Analyze prompt complexity based on length, keywords, code presence, and question type.
 */
export function analyzeComplexity(prompt: string): "simple" | "moderate" | "complex" {
  let score = 0;

  // Length scoring
  const length = prompt.length;
  if (length < 50) score -= 2;
  else if (length < 150) score -= 1;
  else if (length > 500) score += 2;
  else if (length > 300) score += 1;

  // Keyword scoring
  const complexCount = countComplexKeywords(prompt);
  const simpleCount = countSimpleKeywords(prompt);
  score += complexCount * 2;
  score -= simpleCount * 1;

  // Code presence
  if (hasCodeBlocks(prompt)) score += 2;

  // Question type
  if (isHowQuestion(prompt)) score += 1;

  // Map score to complexity
  if (score >= 3) return "complex";
  if (score >= 1) return "moderate";
  return "simple";
}

/**
 * Route a prompt to the best available profile based on complexity analysis.
 */
export function routeToProfile(prompt: string, availableProfiles: Profile[]): RoutingDecision {
  const complexity = analyzeComplexity(prompt);

  // Rank profiles by maxTokens as capability proxy (low = fast/cheap, high = powerful)
  const sorted = [...availableProfiles].sort((a, b) => a.maxTokens - b.maxTokens);
  const profileIds = sorted.map((p) => p.id);

  // Select profile based on complexity and relative ranking
  let selectedId: string | null = null;
  if (complexity === "simple") {
    selectedId = profileIds[0] ?? null;
  } else if (complexity === "moderate") {
    const mid = Math.floor(profileIds.length / 2);
    selectedId = profileIds[mid] ?? profileIds[profileIds.length - 1] ?? null;
  } else {
    selectedId = profileIds[profileIds.length - 1] ?? null;
  }

  if (!selectedId) {
    return {
      profile: "none",
      reason: "No profiles available",
      complexity,
    };
  }

  const reasons: Record<string, string> = {
    simple: "Short/simple prompt — routed to fast model for quick response",
    moderate: "Moderate complexity — routed to balanced model (quality + speed)",
    complex: "High complexity detected — routed to best available model",
  };

  return {
    profile: selectedId,
    reason: reasons[complexity],
    complexity,
  };
}
