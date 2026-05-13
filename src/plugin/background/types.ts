import type { JceWorkerState } from "../lib/state.js";
import type { JceWorkerErrorCategory } from "../lib/error-taxonomy.js";
import type { HandoffReportInput } from "../lib/handoff.js";
import type { TraceEvent } from "../lib/trace.js";

export type TaskStatus = "pending" | "running" | "completed" | "error" | "cancelled";
export type ReviewStatus = "pending_review" | "accepted" | "needs_followup" | "blocked" | "retryable_failure" | "not_applicable";

export interface BackgroundTask {
  id: string;
  description: string;
  prompt: string;
  agent: string;
  parentSessionId: string;
  parentMessageId: string;
  sessionId?: string;
  status: TaskStatus;
  logicalState: JceWorkerState;
  reviewStatus: ReviewStatus;
  reviewNotes: string[];
  verificationSummary?: string;
  retryCount: number;
  maxRetries: number;
  retryOfTaskId?: string;
  rootTaskId?: string;
  retryTaskId?: string;
  recoveryCategory?: JceWorkerErrorCategory;
  lastActivityAt: string;
  stale: boolean;
  failureReason?: string;
  handoffReason?: string;
  handoff?: HandoffReportInput;
  traceEvents?: TraceEvent[];
  result?: string;
  error?: string;
  modelHint?: ModelHint;
  contextBudget?: {
    originalChars: number;
    compressedChars: number;
    estimatedTokensSaved: number;
    estimatedSavingsPercent: number;
    changed: boolean;
    source?: string;
  };
  createdAt: string;
  completedAt?: string;
}

export interface LaunchInput {
  description: string;
  prompt: string;
  agent: string;
  parentSessionId: string;
  parentMessageId: string;
  maxRetries?: number;
  retryCount?: number;
  retryOfTaskId?: string;
  rootTaskId?: string;
  recoveryCategory?: JceWorkerErrorCategory;
  failureReason?: string;
  modelHint?: ModelHint;
}

export interface BackgroundManagerOptions {
  maxConcurrency: number;
  staleAfterMs?: number;
  now?: () => string;
}

// ─── OpenCode SDK Client Interface ───────────────────────────

export interface ModelHint {
  providerID: string;
  modelID: string;
}

export interface SessionPromptRequest {
  path: { id: string };
  body: { agent: string; model?: ModelHint; parts: Array<{ type: "text"; text: string }> };
}

export interface SessionChatRequest {
  params: { id: string };
  body: { content: string; agent: string };
}

/**
 * Minimal interface for the OpenCode SDK client.
 * Accepts the real SDK client shape without requiring exact type alignment.
 */
export interface OpenCodeClient {
  session: {
    create(opts: Record<string, unknown>): Promise<{ id?: string; data?: { id?: string } } & Record<string, unknown>>;
    prompt?: (request: SessionPromptRequest) => Promise<unknown>;
    promptAsync?: (request: SessionPromptRequest) => Promise<unknown>;
    chat?: (request: SessionChatRequest) => Promise<unknown>;
  };
}

// ─── Multi-Model Category Routing ────────────────────────────

export type TaskCategory = "architecture" | "frontend" | "research" | "exploration" | "quick" | "deep" | "default";

/**
 * Category-to-model mapping. Users can override via JCE plugin settings.
 * Models are hints — if the provider/model is unavailable, OpenCode falls back gracefully.
 */
export const CATEGORY_MODEL_MAP: Record<TaskCategory, ModelHint | undefined> = {
  architecture: { providerID: "anthropic", modelID: "claude-sonnet-4" },
  frontend: { providerID: "anthropic", modelID: "claude-sonnet-4" },
  research: { providerID: "anthropic", modelID: "claude-sonnet-4" },
  exploration: undefined, // use default (fast/cheap)
  quick: undefined, // use default
  deep: { providerID: "anthropic", modelID: "claude-sonnet-4" },
  default: undefined, // use session default
};

/**
 * Resolve a model hint for a given agent + category combination.
 */
export function resolveModelForCategory(agent: string, category?: TaskCategory): ModelHint | undefined {
  if (!category || category === "default") return undefined;
  // Explorer and researcher are intentionally cheap/fast — no model override
  if (agent === "explorer" || agent === "jce-researcher") return undefined;
  return CATEGORY_MODEL_MAP[category];
}

/**
 * Auto-detect task category from prompt content and agent type.
 * Returns the most appropriate category based on keywords in the prompt.
 */
export function detectTaskCategory(agent: string, prompt: string): TaskCategory {
  // Agent-based defaults
  if (agent === "explorer") return "exploration";
  if (agent === "jce-researcher") return "research";
  if (agent === "frontend") return "frontend";

  const lower = prompt.toLowerCase();

  // Architecture patterns
  if (/\b(architect|design\s*decision|trade.?off|system\s*design|scaling|migration\s*strategy|database\s*choice|service\s*boundary)\b/i.test(lower)) return "architecture";

  // Frontend patterns
  if (/\b(component|ui|ux|css|styling|responsive|accessibility|a11y|layout|animation|visual)\b/i.test(lower)) return "frontend";

  // Research patterns
  if (/\b(research|investigate|find\s*(out|docs|examples)|compare|evaluate|what\s*is|how\s*does|best\s*practice|library\s*for)\b/i.test(lower)) return "research";

  // Deep work patterns (complex implementation, debugging, refactoring)
  if (/\b(refactor|rewrite|implement\s*(from|the|a|full)|complex|multi.?file|debug.*root\s*cause|performance\s*optim)\b/i.test(lower)) return "deep";

  // Quick patterns (simple, small, typo, rename)
  if (/\b(typo|rename|simple|one.?liner|quick\s*fix|small\s*change|update\s*version|bump)\b/i.test(lower)) return "quick";

  // Default for oracle is architecture (that's its specialty)
  if (agent === "oracle") return "architecture";

  return "default";
}
