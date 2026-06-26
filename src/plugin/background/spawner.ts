import type { BackgroundManager } from "./manager.js";
import type { LaunchInput, OpenCodeClient, ModelHint } from "./types.js";
import { applyContextBudget } from "../lib/context-budget.js";

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

function resolvePositiveEnvMs(name: string, fallback: number): number {
  const raw = process.env?.[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/**
 * Race a promise against a timeout. On timeout, the original promise is
 * abandoned (we cannot cancel arbitrary SDK calls) but our caller stops
 * waiting and can mark the task failed so recovery proceeds.
 *
 * We intentionally use a plain Promise.race without a `.finally` derivative
 * on the inner promise: chaining `.finally` would keep a pending microtask
 * reference to the never-resolving SDK promise and prevent the test runner
 * (and in production, the Node event loop in some edge cases) from settling
 * cleanly when the inner promise never resolves at all.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    // Important: do NOT call timer.unref() here. The whole purpose of the
    // timeout is to actively fire and reject after timeoutMs. Unref-ing it
    // would let the runtime exit before the rejection happens whenever the
    // inner SDK promise never resolves, leaving the await hanging in tests
    // and silently swallowing the timeout in production.
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

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
  const timeoutMs = resolvePositiveEnvMs("OPENCODE_JCE_BG_PROMPT_TIMEOUT_MS", DEFAULT_PROMPT_TIMEOUT_MS);
  const label = `Session prompt for agent ${input.agent}`;
  if (typeof client.session?.prompt === "function") {
    return withTimeout(client.session.prompt(buildPromptRequest(sessionId, input, prompt, model)), timeoutMs, label);
  }
  if (typeof client.session?.promptAsync === "function") {
    return withTimeout(client.session.promptAsync(buildPromptRequest(sessionId, input, prompt, model)), timeoutMs, label);
  }
  if (typeof client.session?.chat === "function") {
    return withTimeout(
      client.session.chat({ params: { id: sessionId }, body: { content: prompt, agent: input.agent } }),
      timeoutMs,
      label,
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
    const sessionCreateTimeout = resolvePositiveEnvMs(
      "OPENCODE_JCE_BG_SESSION_CREATE_TIMEOUT_MS",
      DEFAULT_SESSION_CREATE_TIMEOUT_MS,
    );
    const session = await withTimeout(
      client.session.create({ body: { parentID: task.parentSessionId } }),
      sessionCreateTimeout,
      `Session create for agent ${task.agent}`,
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
