import { describe, expect, test } from "bun:test";
import { buildChineseTranslator, extractSessionId } from "../../src/plugin/lib/chinese-translator.ts";

describe("OpenCode SDK contract helpers", () => {
  test("extracts session id from legacy and SDK wrapped session.create responses", () => {
    expect(extractSessionId({ id: "legacy-session" })).toBe("legacy-session");
    expect(extractSessionId({ data: { id: "sdk-session" }, error: undefined, request: {}, response: {} })).toBe("sdk-session");
    expect(extractSessionId({ data: undefined, error: { name: "BadRequestError" } })).toBeUndefined();
  });

  test("translator sends prompt using SDK wrapped session id", async () => {
    const requests: unknown[] = [];
    const translator = buildChineseTranslator({
      session: {
        create: async () => ({ data: { id: "sdk-session" }, error: undefined }),
        prompt: async (request: unknown) => {
          requests.push(request);
          return { parts: [{ type: "text", text: "Please fix this error." }] };
        },
      },
    });

    await expect(translator?.("请修复这个错误")).resolves.toBe("Please fix this error.");
    expect(requests[0]).toMatchObject({ path: { id: "sdk-session" }, body: { agent: "jce-worker" } });
  });
});
