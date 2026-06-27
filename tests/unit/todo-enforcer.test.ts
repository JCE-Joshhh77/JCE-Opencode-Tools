import { describe, expect, test } from "bun:test";
import { shouldEnforceContinuation, detectPrematureStop, CONTINUATION_PROMPT } from "../../src/plugin/hooks/todo-enforcer.ts";
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

describe("detectPrematureStop", () => {
  test("detects English early-stop phrasing", () => {
    expect(detectPrematureStop("All done!")).toBe(true);
    expect(detectPrematureStop("That's it for now.")).toBe(true);
    expect(detectPrematureStop("Let me know if you need anything else.")).toBe(true);
    expect(detectPrematureStop("I'll wait for your confirmation.")).toBe(true);
    expect(detectPrematureStop("Please confirm before I continue.")).toBe(true);
  });

  test("detects Bahasa Indonesia early-stop phrasing", () => {
    expect(detectPrematureStop("Sudah, ada yang lain?")).toBe(true);
    expect(detectPrematureStop("Tinggal segini dulu ya.")).toBe(true);
    expect(detectPrematureStop("Cukup segitu untuk sekarang.")).toBe(true);
    expect(detectPrematureStop("Sisanya nanti aja.")).toBe(true);
    expect(detectPrematureStop("Lanjut nanti setelah review.")).toBe(true);
    expect(detectPrematureStop("Berhenti di sini dulu.")).toBe(true);
    expect(detectPrematureStop("Mohon konfirmasi sebelum lanjut.")).toBe(true);
    expect(detectPrematureStop("Kalau ada yang lain bilang ya.")).toBe(true);
  });

  test("does NOT flag in-progress phrasing", () => {
    expect(detectPrematureStop("Continuing with the next step.")).toBe(false);
    expect(detectPrematureStop("Lanjut ke fix berikutnya.")).toBe(false);
    expect(detectPrematureStop("Sedang menjalankan tes verifikasi.")).toBe(false);
  });
});
