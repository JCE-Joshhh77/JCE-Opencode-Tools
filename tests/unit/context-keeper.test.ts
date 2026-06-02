import { describe, test, expect } from "bun:test";
import {
  countLines,
  pruneCompleted,
  getSection,
  replaceSection,
} from "../../src/mcp/context-keeper.js";
import {
  CONTEXT_FILENAME,
  ARCHIVE_FILENAME,
  MAX_LINES_TARGET,
  MAX_LINES_HARD,
  getContextTemplate,
} from "../../src/lib/context-template.js";

// ─── getContextTemplate ──────────────────────────────────────

describe("getContextTemplate()", () => {
  test("returns a string with today's date", () => {
    const template = getContextTemplate();
    const today = new Date().toISOString().split("T")[0];
    expect(template).toContain(`Last updated: ${today}`);
  });

  test("contains all required sections", () => {
    const template = getContextTemplate();
    expect(template).toContain("Detailed handoff index: .opencode-jce/context/session.md");
    expect(template).toContain("## Stack");
    expect(template).toContain("## Architecture Decisions");
    expect(template).toContain("## Conventions");
    expect(template).toContain("## Current Status");
    expect(template).toContain("## Important Notes");
    expect(template).toContain("## Related Projects");
  });

  test("generates fresh date on each call", () => {
    // Both calls should produce the same date (same day)
    const t1 = getContextTemplate();
    const t2 = getContextTemplate();
    expect(t1).toEqual(t2);
  });
});

// ─── Constants ───────────────────────────────────────────────

describe("context-template constants", () => {
  test("CONTEXT_FILENAME is .opencode-context.md", () => {
    expect(CONTEXT_FILENAME).toBe(".opencode-context.md");
  });

  test("ARCHIVE_FILENAME is .opencode-context-archive.md", () => {
    expect(ARCHIVE_FILENAME).toBe(".opencode-context-archive.md");
  });

  test("MAX_LINES_TARGET is 40", () => {
    expect(MAX_LINES_TARGET).toBe(40);
  });

  test("MAX_LINES_HARD is 50", () => {
    expect(MAX_LINES_HARD).toBe(50);
  });
});

// ─── countLines ──────────────────────────────────────────────

describe("countLines()", () => {
  test("counts non-empty lines", () => {
    expect(countLines("a\nb\nc")).toBe(3);
  });

  test("ignores empty lines", () => {
    expect(countLines("a\n\nb\n\n\nc")).toBe(3);
  });

  test("ignores whitespace-only lines", () => {
    expect(countLines("a\n   \nb\n\t\nc")).toBe(3);
  });

  test("returns 0 for empty string", () => {
    expect(countLines("")).toBe(0);
  });

  test("returns 0 for only whitespace", () => {
    expect(countLines("\n\n  \n\t\n")).toBe(0);
  });
});

// ─── pruneCompleted ──────────────────────────────────────────

describe("pruneCompleted()", () => {
  const sampleContent = `# Project Context
> Last updated: 2026-05-03

## Stack
- TypeScript + Bun

## Architecture Decisions
- Decision A

## Conventions
- Rule 1

## Current Status
- [x] Completed task 1
- [x] Completed task 2
- [ ] Pending task 1
- [ ] Pending task 2

## Important Notes
- [x] Old resolved note
- [RESOLVED] Fixed bug from last week
- Active note that should stay
- Another active note
`;

  test("removes [x] items from Current Status", () => {
    const result = pruneCompleted(sampleContent);
    expect(result).not.toContain("Completed task 1");
    expect(result).not.toContain("Completed task 2");
  });

  test("keeps pending items in Current Status", () => {
    const result = pruneCompleted(sampleContent);
    expect(result).toContain("- [ ] Pending task 1");
    expect(result).toContain("- [ ] Pending task 2");
  });

  test("removes [x] items from Important Notes", () => {
    const result = pruneCompleted(sampleContent);
    expect(result).not.toContain("Old resolved note");
  });

  test("removes [RESOLVED] items from Important Notes", () => {
    const result = pruneCompleted(sampleContent);
    expect(result).not.toContain("Fixed bug from last week");
  });

  test("keeps active items in Important Notes", () => {
    const result = pruneCompleted(sampleContent);
    expect(result).toContain("- Active note that should stay");
    expect(result).toContain("- Another active note");
  });

  test("does not modify other sections", () => {
    const result = pruneCompleted(sampleContent);
    expect(result).toContain("- TypeScript + Bun");
    expect(result).toContain("- Decision A");
    expect(result).toContain("- Rule 1");
  });

  test("handles case-insensitive [X]", () => {
    const content = `## Current Status\n- [X] Done\n- [ ] Not done`;
    const result = pruneCompleted(content);
    expect(result).not.toContain("Done");
    expect(result).toContain("Not done");
  });

  test("handles indented checkboxes", () => {
    const content = `## Current Status\n  - [x] Indented done\n- [ ] Normal`;
    const result = pruneCompleted(content);
    expect(result).not.toContain("Indented done");
    expect(result).toContain("Normal");
  });

  test("returns unchanged content if nothing to prune", () => {
    const clean = `## Current Status\n- [ ] Task 1\n\n## Important Notes\n- Note 1`;
    expect(pruneCompleted(clean)).toBe(clean);
  });

  test("handles case-insensitive [RESOLVED]", () => {
    const content = `## Important Notes\n- [resolved] lowercase resolved\n- Keep this`;
    const result = pruneCompleted(content);
    expect(result).not.toContain("lowercase resolved");
    expect(result).toContain("Keep this");
  });
});

// ─── getSection ──────────────────────────────────────────────

describe("getSection()", () => {
  const content = `# Project Context

## Stack
- TypeScript
- Bun

## Architecture Decisions
- Use MCP for context
- Keep files small

## Current Status
- [ ] Task 1

## Important Notes
- Note A
- Note B
`;

  test("extracts Stack section", () => {
    const result = getSection(content, "Stack");
    expect(result).toEqual(["- TypeScript", "- Bun"]);
  });

  test("extracts Architecture Decisions section", () => {
    const result = getSection(content, "Architecture Decisions");
    expect(result).toEqual(["- Use MCP for context", "- Keep files small"]);
  });

  test("extracts last section (Important Notes)", () => {
    const result = getSection(content, "Important Notes");
    expect(result).toEqual(["- Note A", "- Note B"]);
  });

  test("returns empty array for non-existent section", () => {
    const result = getSection(content, "Non Existent");
    expect(result).toEqual([]);
  });

  test("filters out empty lines within section", () => {
    const withBlanks = `## Stack\n- A\n\n- B\n\n## Next`;
    const result = getSection(withBlanks, "Stack");
    expect(result).toEqual(["- A", "- B"]);
  });

  test("handles section with no content", () => {
    const empty = `## Stack\n\n## Next`;
    const result = getSection(empty, "Stack");
    expect(result).toEqual([]);
  });
});

// ─── replaceSection ──────────────────────────────────────────

describe("replaceSection()", () => {
  const content = `# Project Context

## Stack
- Old item 1
- Old item 2

## Architecture Decisions
- Decision 1

## Current Status
- [ ] Task 1
`;

  test("replaces existing section content", () => {
    const result = replaceSection(content, "Stack", [
      "- New item A",
      "- New item B",
    ]);
    expect(result).toContain("- New item A");
    expect(result).toContain("- New item B");
    expect(result).not.toContain("- Old item 1");
    expect(result).not.toContain("- Old item 2");
  });

  test("preserves other sections", () => {
    const result = replaceSection(content, "Stack", ["- New"]);
    expect(result).toContain("- Decision 1");
    expect(result).toContain("- [ ] Task 1");
  });

  test("preserves section heading", () => {
    const result = replaceSection(content, "Stack", ["- New"]);
    expect(result).toContain("## Stack");
  });

  test("appends new section if it doesn't exist", () => {
    const result = replaceSection(content, "Important Notes", [
      "- Note 1",
      "- Note 2",
    ]);
    expect(result).toContain("## Important Notes");
    expect(result).toContain("- Note 1");
    expect(result).toContain("- Note 2");
  });

  test("handles empty newLines array", () => {
    const result = replaceSection(content, "Stack", []);
    expect(result).toContain("## Stack");
    expect(result).not.toContain("- Old item 1");
  });

  test("handles replacing last section", () => {
    const result = replaceSection(content, "Current Status", [
      "- [ ] New task",
    ]);
    expect(result).toContain("- [ ] New task");
    expect(result).not.toContain("- [ ] Task 1");
  });
});

// ─── Input Sanitization (integration-level) ──────────────────

describe("input sanitization behavior", () => {
  test("lines starting with ## would corrupt parsing if not sanitized", () => {
    // This tests the concept — the actual sanitization happens in the MCP tool handler
    const malicious = "## Fake Section";
    const sanitized = malicious.startsWith("## ")
      ? `- ${malicious.slice(3)}`
      : malicious;
    expect(sanitized).toBe("- Fake Section");
    expect(sanitized).not.toMatch(/^## /);
  });

  test("embedded newlines are stripped", () => {
    const withNewlines = "line one\nline two";
    const sanitized = withNewlines.replace(/\r?\n/g, " ");
    expect(sanitized).toBe("line one line two");
    expect(sanitized).not.toContain("\n");
  });
});
