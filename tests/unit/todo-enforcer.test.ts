import { describe, expect, test } from "bun:test";
import { shouldEnforceContinuation, CONTINUATION_PROMPT } from "../../src/plugin/hooks/todo-enforcer.ts";
import { evaluateOpenWork, extractTodoState } from "../../src/plugin/hooks/open-work-enforcer.ts";
import { createEmptyRuntimeState } from "../../src/plugin/lib/runtime-state.ts";

describe("todo enforcer", () => {
  test("returns true when incomplete todos exist", () => {
    const messages = [
      { role: "assistant", content: "- [ ] Fix bug\n- [x] Write test\n- [ ] Deploy" },
    ];
    expect(shouldEnforceContinuation(messages)).toBe(true);
  });

  test("returns false when all todos are complete", () => {
    const messages = [
      { role: "assistant", content: "- [x] Fix bug\n- [x] Write test\n- [x] Deploy" },
    ];
    expect(shouldEnforceContinuation(messages)).toBe(false);
  });

  test("returns false when no todos exist", () => {
    const messages = [
      { role: "assistant", content: "Done with the task." },
    ];
    expect(shouldEnforceContinuation(messages)).toBe(false);
  });

  test("only checks assistant messages", () => {
    const messages = [
      { role: "user", content: "- [ ] This is user's todo" },
      { role: "assistant", content: "All done!" },
    ];
    expect(shouldEnforceContinuation(messages)).toBe(false);
  });

  test("CONTINUATION_PROMPT contains boulder reference", () => {
    expect(CONTINUATION_PROMPT).toContain("BOULDER");
    expect(CONTINUATION_PROMPT).toContain("bouldering");
  });

  test("extracts pending TodoWrite state from tool output", () => {
    const state = extractTodoState(JSON.stringify([{ content: "Finish verification", status: "pending" }]));
    expect(state.hasOpenTodos).toBe(true);
    expect(state.openItems).toContain("Finish verification");
  });

  test("open work blocks confirmation stop when todos remain", () => {
    const memory = createEmptyRuntimeState();
    const result = evaluateOpenWork(memory, "balanced", { hasOpenTodos: true, openItems: ["Run tests"] });
    expect(result.blocked).toBe(true);
    expect(result.prompt).toContain("BOULDER CONTINUATION");
    expect(result.prompt).toContain("Run tests");
  });
});
