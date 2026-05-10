import type { BackgroundManager } from "./manager.js";
import type { LaunchInput, OpenCodeClient, ModelHint } from "./types.js";
import { applyContextBudget } from "../lib/context-budget.js";

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
  if (typeof client.session?.prompt === "function") {
    return client.session.prompt(buildPromptRequest(sessionId, input, prompt, model));
  }
  if (typeof client.session?.promptAsync === "function") {
    return client.session.promptAsync(buildPromptRequest(sessionId, input, prompt, model));
  }
  if (typeof client.session?.chat === "function") {
    return client.session.chat({ params: { id: sessionId }, body: { content: prompt, agent: input.agent } });
  }
  return Promise.reject(new Error("No supported session prompt method found: expected session.prompt, session.promptAsync, or session.chat"));
}

export async function launchExistingBackgroundTask(manager: BackgroundManager, client: OpenCodeClient, taskId: string): Promise<boolean> {
  const task = manager.getTask(taskId);
  if (!task) return false;
  if (task.status !== "pending") return true;
  if (!manager.canLaunch()) return false;

  try {
    const session = await client.session.create({
      body: { parentID: task.parentSessionId },
    });

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
