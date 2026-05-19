import { describe, expect, test } from "bun:test";
import {
  POST_COMPACTION_NO_TASK_GUARD,
  isNoTaskGreeting,
  looksLikeCompactedNoTaskSummary,
  shouldSuppressCompactionAutocontinue,
} from "../../src/plugin/lib/compaction-loop-guard.ts";

describe("compaction loop guard", () => {
  test("detects greeting-only no-task turns", () => {
    expect(isNoTaskGreeting("halow")).toBe(true);
    expect(isNoTaskGreeting("Halo! ")).toBe(true);
    expect(isNoTaskGreeting("fix the login bug")).toBe(false);
  });

  test("detects compacted summaries that only await user input", () => {
    const summary = `
Goal
- Initial greeting exchange; no task specified yet
Progress
Done
- (none)
In Progress
- (none)
Blocked
- (none)
Next Steps
- Awaiting user's task or question
Critical Context
- Conversation just started with greeting
Relevant Files
- (none)
`;

    expect(looksLikeCompactedNoTaskSummary(summary)).toBe(true);
    expect(shouldSuppressCompactionAutocontinue({ summary })).toBe(true);
  });

  test("does not suppress substantive task summaries", () => {
    const summary = `
Goal
- Fix compaction loop bug
Progress
Done
- Reproduced failing behavior
In Progress
- Implementing guard
Next Steps
- Run bun test
Relevant Files
- src/plugin/index.ts
`;

    expect(looksLikeCompactedNoTaskSummary(summary)).toBe(false);
    expect(shouldSuppressCompactionAutocontinue({ lastUserMessage: "fix compaction loop bug", summary })).toBe(false);
  });

  test("guard instruction forbids workflow sections for no-op conversations", () => {
    expect(POST_COMPACTION_NO_TASK_GUARD).toContain("current turn is only a greeting");
    expect(POST_COMPACTION_NO_TASK_GUARD).toContain("Do not emit Goal");
  });
});
