import { createSignal, onCleanup } from "solid-js";
import { loadSessionState } from "./session-store.js";

export const TOKEN_SAVINGS_REFRESH_INTERVAL_MS = 2_000;

function formatCompactInteger(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  const safe = Math.min(Math.trunc(value), Number.MAX_SAFE_INTEGER);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(safe);
}

export interface TokenSavingsStateApi {
  state: {
    path: {
      directory?: string;
      worktree?: string;
    };
  };
}

export function renderContextBudgetLine(api: TokenSavingsStateApi): string {
  const projectRoot = api.state.path.directory || api.state.path.worktree;
  if (!projectRoot) return "~0 token(s) saved · no project root";

  const summary = loadSessionState(projectRoot).state.runtime.contextBudgetSummary;
  if (!summary || summary.tasks === 0) return "~0 token(s) saved · awaiting budget events";

  const topTool = Object.entries(summary.byTool ?? {})
    .sort((left, right) => (right[1]?.estimatedTokensSaved ?? 0) - (left[1]?.estimatedTokensSaved ?? 0))[0];
  const source = topTool ? ` · top: ${topTool[0]}` : "";
  return `~${formatCompactInteger(summary.estimatedTokensSaved ?? 0)} token(s) saved · ${formatCompactInteger(summary.tasks)} event(s)${source}`;
}

export function createContextBudgetLineSignal(api: TokenSavingsStateApi, refreshIntervalMs = TOKEN_SAVINGS_REFRESH_INTERVAL_MS) {
  const [line, setLine] = createSignal(renderContextBudgetLine(api));
  const refresh = () => setLine(renderContextBudgetLine(api));
  const timer = setInterval(refresh, refreshIntervalMs);
  onCleanup(() => clearInterval(timer));
  return line;
}
