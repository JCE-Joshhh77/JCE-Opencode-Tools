import type { BackgroundManager } from "./manager.js";
import type { LaunchInput, OpenCodeClient, ModelHint } from "./types.js";
import { applyContextBudget } from "../lib/context-budget.js";
import { withTimeout } from "../../lib/timeout.js";

/**
 * Default per-prompt inflight timeout for delegated sub-agent sessions.
 *
 * Why this exists:
 *  - `runSessionPrompt` returns a floating promise. If OpenCode's session API
 *    never resolves (slow provider, dropped websocket, stalled model), the
 *    task would sit in `running` state forever until `staleAfterMs`
 *    (default 30 min) finally fires.
 *  - With a per-prompt timeout the task fails predictably and recovery /
 *    retry logic can kick in within minutes instead of half an hour.
 *
 * Override via env `OPENCODE_JCE_BG_PROMPT_TIMEOUT_MS` for slow-network setups.
 * Default 12 minutes covers slow research/deep-reasoning models while still
 * being well below the staleAfterMs safety net.
 */
const DEFAULT_PROMPT_TIMEOUT_MS = 12 * 60 * 1000;

/**
 * Smaller timeout for the lightweight `session.create` handshake. If OpenCode
 * cannot allocate a child session within this window, something is wrong
 * (server restarting, auth expired) and we want to surface the failure fast
 * rather than block the dispatch tool indefinitely.
 */
const DEFAULT_SESSION_CREATE_TIMEOUT_MS = 60_000;

export function extractPromptText(result: unknown): string {
  if (typeof result === "string" && result.trim().length > 0) return result;
  if (!result || typeof result !== "object") return "Task completed";

  for (const field of ["content", "text", "message", "output"] as const) {
    const value = (result as Record<string, unknown>)[field];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }

  const parts = (result as Record<string, unknown>).parts;
  if (Array.isArray(parts)) {
    const text = parts
      .map((part) => (part && typeof part === "object" ? (part as Record<string, unknown>).text : undefined))
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join("\n");
    if (text.trim().length > 0) return text;
  }

  return "Task completed";
}

function buildPromptRequest(sessionId: string, input: LaunchInput, prompt: string, model?: ModelHint) {
  return {
    path: { id: sessionId },
    body: { agent: input.agent, ...(model ? { model } : {}), parts: [{ type: "text" as const, text: prompt }] },
  };
}

function runSessionPrompt(client: OpenCodeClient, sessionId: string, input: LaunchInput, prompt: string, model?: ModelHint): Promise<unknown> {
  const envOverride = "OPENCODE_JCE_BG_PROMPT_TIMEOUT_MS";
  const label = `Session prompt for agent ${input.agent}`;
  if (typeof client.session?.prompt === "function") {
    return withTimeout(client.session.prompt(buildPromptRequest(sessionId, input, prompt, model)), DEFAULT_PROMPT_TIMEOUT_MS, label, { envOverride });
  }
  if (typeof client.session?.promptAsync === "function") {
    return withTimeout(client.session.promptAsync(buildPromptRequest(sessionId, input, prompt, model)), DEFAULT_PROMPT_TIMEOUT_MS, label, { envOverride });
  }
  if (typeof client.session?.chat === "function") {
    return withTimeout(
      client.session.chat({ params: { id: sessionId }, body: { content: prompt, agent: input.agent } }),
      DEFAULT_PROMPT_TIMEOUT_MS,
      label,
      { envOverride },
    );
  }
  return Promise.reject(new Error("No supported session prompt method found: expected session.prompt, session.promptAsync, or session.chat"));
}

export async function launchExistingBackgroundTask(manager: BackgroundManager, client: OpenCodeClient, taskId: string): Promise<boolean> {
  const task = manager.getTask(taskId);
  if (!task) return false;
  if (task.status !== "pending") return true;
  if (!manager.canLaunch()) return false;

  try {
    const session = await withTimeout(
      client.session.create({ body: { parentID: task.parentSessionId } }),
      DEFAULT_SESSION_CREATE_TIMEOUT_MS,
      `Session create for agent ${task.agent}`,
      { envOverride: "OPENCODE_JCE_BG_SESSION_CREATE_TIMEOUT_MS" },
    );

    const sessionId = session?.id ?? session?.data?.id;
    if (!sessionId) {
      manager.failTask(task.id, "Failed to create child session");
      return false;
    }

    manager.markRunning(task.id, sessionId);
    const budgeted = applyContextBudget(task.prompt);
    manager.recordContextBudget(task.id, {
      originalChars: budgeted.originalChars,
      compressedChars: budgeted.compressedChars,
      estimatedTokensSaved: budgeted.estimatedTokensSaved,
      estimatedSavingsPercent: budgeted.estimatedSavingsPercent,
      changed: budgeted.changed,
      source: "dispatch",
    });

    runSessionPrompt(client, sessionId, task, budgeted.text, task.modelHint)
      .then((result: unknown) => {
        manager.completeTask(task.id, extractPromptText(result));
      })
      .catch((err: Error) => {
        manager.failTask(task.id, err.message);
      });
    return true;
  } catch (err) {
    manager.failTask(task.id, err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * Spawns a background agent session via the OpenCode SDK client.
 * The client is injected from the plugin entry point at runtime.
 */
export async function spawnBackgroundTask(
  manager: BackgroundManager,
  client: OpenCodeClient,
  input: LaunchInput,
): Promise<string> {
  manager.setPendingLauncher((taskId) => {
    void launchExistingBackgroundTask(manager, client, taskId);
  });
  const task = manager.createTask(input);
  await launchExistingBackgroundTask(manager, client, task.id);
  return task.id;
}
