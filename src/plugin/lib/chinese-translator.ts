import { buildChineseTranslationPrompt, type ChineseTranslator } from "./chinese-output-filter.js";
import { isRecord } from "./shared-predicates.js";

function extractPromptText(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  if (!isRecord(result)) return undefined;
  if (typeof result.content === "string") return result.content;
  if (typeof result.text === "string") return result.text;

  const parts = Array.isArray(result.parts) ? result.parts : undefined;
  if (!parts) return undefined;
  const texts = parts
    .map((part) => isRecord(part) && typeof part.text === "string" ? part.text : undefined)
    .filter((text): text is string => Boolean(text));
  return texts.length ? texts.join("\n") : undefined;
}

export function extractSessionId(session: unknown): string | undefined {
  if (!isRecord(session)) return undefined;
  if (typeof session.id === "string") return session.id;
  const data = session.data;
  return isRecord(data) && typeof data.id === "string" ? data.id : undefined;
}

export function buildChineseTranslator(client: unknown): ChineseTranslator | undefined {
  const sessionApi = isRecord(client) && isRecord(client.session) ? client.session : undefined;
  if (!sessionApi) return undefined;
  const create = sessionApi.create;
  if (typeof create !== "function") return undefined;
  const api: Record<string, unknown> = sessionApi;

  return async (text: string) => {
    const sessionId = extractSessionId(await create({}));
    if (!sessionId) throw new Error("Translation session returned no id");

    const prompt = text.includes("<<<CHINESE_OUTPUT_TO_TRANSLATE>>>") ? text : buildChineseTranslationPrompt(text);
    const promptRequest = { path: { id: sessionId }, body: { agent: "jce-worker", parts: [{ type: "text" as const, text: prompt }] } };
    const result = typeof api.prompt === "function"
      ? await api.prompt(promptRequest)
      : typeof api.promptAsync === "function"
        ? await api.promptAsync(promptRequest)
        : typeof api.chat === "function"
          ? await api.chat({ params: { id: sessionId }, body: { content: prompt, agent: "jce-worker" } })
          : await Promise.reject(new Error("No supported session prompt method found: expected session.prompt, session.promptAsync, or session.chat"));

    const translated = extractPromptText(result);
    if (!translated || translated === "Task completed") throw new Error("Translation returned no text");
    return translated;
  };
}
