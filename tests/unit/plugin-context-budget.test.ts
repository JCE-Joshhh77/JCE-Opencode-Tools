import { describe, expect, test } from "bun:test";
import { applyContextBudget, estimateTokensFromChars } from "../../src/plugin/lib/context-budget.ts";

describe("context budget pipeline", () => {
  test("deduplicates repeated low-value lines", () => {
    const repeated = "same low value context line repeated";
    const result = applyContextBudget([repeated, repeated, repeated].join("\n"));

    expect(result.changed).toBe(true);
    expect(result.text.match(/same low value context line repeated/g)).toHaveLength(1);
    expect(result.text).toContain("removed 2 duplicate low-value lines");
    expect(result.estimatedSavingsPercent).toBeGreaterThan(0);
    expect(result.estimatedTokensSaved).toBeGreaterThan(0);
  });

  test("preserves latest user, caveman, RTK, commands, paths, and errors", () => {
    const prompt = [
      "developer: Respond like terse caveman.",
      "RTK route: review task, final gate required",
      "user: perbaiki crash ini",
      "bun test tests/unit/plugin-context-budget.test.ts",
      "C:\\Users\\Joshhh\\source\\repos\\plugin\\src\\plugin\\background\\spawner.ts",
      "Error: failed to launch child session",
      "same low value context line repeated",
      "same low value context line repeated",
    ].join("\n");

    const result = applyContextBudget(prompt);

    expect(result.text).toContain("developer: Respond like terse caveman.");
    expect(result.text).toContain("RTK route: review task, final gate required");
    expect(result.text).toContain("user: perbaiki crash ini");
    expect(result.text).toContain("bun test tests/unit/plugin-context-budget.test.ts");
    expect(result.text).toContain("C:\\Users\\Joshhh\\source\\repos\\plugin\\src\\plugin\\background\\spawner.ts");
    expect(result.text).toContain("Error: failed to launch child session");
  });

  test("collapses long passing logs but keeps boundaries", () => {
    const lines = Array.from({ length: 20 }, (_, index) => `test ${index} pass`);
    const result = applyContextBudget(lines.join("\n"), { maxLinesPerBlock: 8 });

    expect(result.text).toContain("test 0 pass");
    expect(result.text).toContain("test 19 pass");
    expect(result.text).toContain("collapsed 12 passing log lines");
    expect(result.text).not.toContain("test 10 pass");
  });

  test("does not dedupe protected repeated error lines", () => {
    const prompt = ["Error: failed to connect", "Error: failed to connect"].join("\n");
    const result = applyContextBudget(prompt);

    expect(result.text.match(/Error: failed to connect/g)).toHaveLength(2);
  });

  test("preserves Caveman RTK and DCP protocol blocks exactly", () => {
    const caveman = "CAVEMAN:\nRespond terse. No verbose prose. Keep user intent.";
    const rtk = "RTK:\nroute=review\nfinal_gate=required\nverification=bun test";
    const dcp = "DCP:\nDo not mutate protected instructions. Preserve constraints.";
    const noisy = "low value repeated context line for compression";
    const text = [caveman, "", rtk, "", dcp, "", noisy, noisy, noisy].join("\n");

    const result = applyContextBudget(text, { level: "aggressive" });

    expect(result.text).toContain(caveman);
    expect(result.text).toContain(rtk);
    expect(result.text).toContain(dcp);
    expect(result.text).toContain("removed 2 duplicate low-value lines");
  });

  test("preserves markdown verification and final gate sections", () => {
    const verification = "## Verification Criteria\n- bun test must pass\n- bun run typecheck must pass";
    const finalGate = "## Final Gate\n- no completion without accepted evidence\n- blockers must be resolved";
    const repeated = "generated low-value summary line";

    const result = applyContextBudget([verification, finalGate, "", repeated, repeated, repeated].join("\n"), { level: "aggressive" });

    expect(result.text).toContain(verification);
    expect(result.text).toContain(finalGate);
    expect(result.text).toContain("removed 2 duplicate low-value lines");
  });
});

describe("context budget — empty section removal", () => {
  test("removes sections with trivial content (none, n/a)", () => {
    const text = [
      "## Summary",
      "Auth uses JWT tokens.",
      "",
      "## Risks",
      "- none",
      "",
      "## Files",
      "- src/auth.ts",
    ].join("\n");

    const result = applyContextBudget(text);
    expect(result.text).not.toContain("## Risks");
    expect(result.text).not.toContain("- none");
    expect(result.text).toContain("## Summary");
    expect(result.text).toContain("## Files");
  });

  test("removes 'not applicable' and 'not run' sections", () => {
    const text = [
      "## Summary",
      "Done.",
      "",
      "## Verification",
      "- not run",
      "",
      "## Risks",
      "- not applicable",
    ].join("\n");

    const result = applyContextBudget(text);
    expect(result.text).not.toContain("## Verification");
    expect(result.text).not.toContain("## Risks");
    expect(result.text).toContain("## Summary");
  });

  test("keeps sections with real content", () => {
    const text = [
      "## Risks",
      "- SQL injection possible in user input handler",
      "",
      "## Files",
      "- src/db.ts",
    ].join("\n");

    const result = applyContextBudget(text);
    expect(result.text).toContain("## Risks");
    expect(result.text).toContain("SQL injection");
  });
});

describe("context budget — stack trace collapsing", () => {
  test("collapses long stack traces keeping top and bottom", () => {
    const lines = [
      "Error: Connection refused",
      "    at connect (src/db.ts:42)",
      "    at retry (src/retry.ts:10)",
      "    at handler (src/handler.ts:55)",
      "    at middleware (src/middleware.ts:20)",
      "    at router (src/router.ts:88)",
      "    at dispatch (src/dispatch.ts:12)",
      "    at server (src/server.ts:100)",
      "    at listen (src/listen.ts:5)",
      "    at bootstrap (src/bootstrap.ts:30)",
      "    at main (src/main.ts:1)",
      "    at Module._compile (node:internal/modules/cjs/loader:1234)",
      "    at Object.Module._extensions (node:internal/modules/cjs/loader:1290)",
      "Some other output",
    ].join("\n");

    const result = applyContextBudget(lines, { maxStackTraceLines: 6 });
    expect(result.text).toContain("at connect (src/db.ts:42)");
    expect(result.text).toContain("collapsed");
    expect(result.text).toContain("stack frame");
    expect(result.text).toContain("Some other output");
    expect(result.changed).toBe(true);
  });

  test("preserves short stack traces", () => {
    const lines = [
      "Error: Not found",
      "    at handler (src/handler.ts:55)",
      "    at router (src/router.ts:88)",
      "Done.",
    ].join("\n");

    const result = applyContextBudget(lines, { maxStackTraceLines: 6 });
    expect(result.text).toContain("at handler");
    expect(result.text).toContain("at router");
    expect(result.text).not.toContain("collapsed");
  });
});

describe("context budget — repetitive pattern detection", () => {
  test("collapses repeated non-log patterns (timestamps, IDs differ)", () => {
    const lines = [
      "Processing request 1a2b3c4d5e6f7890 at 2026-05-11T10:00:00.000Z took 45ms",
      "Processing request 2b3c4d5e6f789012 at 2026-05-11T10:00:01.000Z took 52ms",
      "Processing request 3c4d5e6f78901234 at 2026-05-11T10:00:02.000Z took 38ms",
      "Processing request 4d5e6f7890123456 at 2026-05-11T10:00:03.000Z took 41ms",
      "Processing request 5e6f789012345678 at 2026-05-11T10:00:04.000Z took 47ms",
      "Final result: done",
    ].join("\n");

    const result = applyContextBudget(lines);
    expect(result.text).toContain("Processing request");
    expect(result.text).toContain("repeated 4 more time");
    expect(result.text).toContain("Final result: done");
    expect(result.changed).toBe(true);
  });

  test("does not collapse lines with different structure", () => {
    const lines = [
      "Starting server on port 3000",
      "Connected to database",
      "Loading configuration",
      "Ready to accept connections",
    ].join("\n");

    const result = applyContextBudget(lines);
    expect(result.text).toContain("Starting server");
    expect(result.text).toContain("Connected to database");
    expect(result.text).toContain("Loading configuration");
    expect(result.text).toContain("Ready to accept connections");
    expect(result.text).not.toContain("repeated");
  });
});

describe("context budget — JSON minification", () => {
  test("minifies large pretty-printed JSON blocks", () => {
    const json = JSON.stringify({ name: "test", version: "1.0.0", dependencies: { a: "1.0", b: "2.0", c: "3.0" } }, null, 2);
    const text = `Some text\n\`\`\`json\n${json}\n\`\`\`\nMore text`;

    const result = applyContextBudget(text);
    expect(result.text).toContain("Some text");
    expect(result.text).toContain("More text");
    // Should be minified (no indentation)
    expect(result.text).toContain('"name":"test"');
    expect(result.changed).toBe(true);
  });

  test("preserves small JSON blocks", () => {
    const text = '```json\n{"key": "value"}\n```';
    const result = applyContextBudget(text);
    expect(result.text).toContain('{"key": "value"}');
  });
});

describe("context budget — code block truncation (aggressive)", () => {
  test("truncates long code blocks in aggressive mode", () => {
    const codeLines = Array.from({ length: 50 }, (_, i) => `  const x${i} = ${i};`);
    const text = `\`\`\`typescript\n${codeLines.join("\n")}\n\`\`\``;

    const result = applyContextBudget(text, { level: "aggressive", maxCodeBlockLines: 10 });
    expect(result.text).toContain("const x0 = 0");
    expect(result.text).toContain("truncated");
    expect(result.text).toContain("const x49 = 49");
    expect(result.changed).toBe(true);
  });

  test("does not truncate code blocks in standard mode", () => {
    const codeLines = Array.from({ length: 50 }, (_, i) => `  const x${i} = ${i};`);
    const text = `\`\`\`typescript\n${codeLines.join("\n")}\n\`\`\``;

    const result = applyContextBudget(text, { level: "standard" });
    expect(result.text).not.toContain("truncated");
  });
});

describe("context budget — file path shortening (aggressive)", () => {
  test("shortens repeated long absolute paths", () => {
    const longPath = "/home/user/projects/my-app/src/components/auth/LoginForm.tsx";
    const text = [
      `Error in ${longPath}`,
      `Warning in ${longPath}`,
      `Fixed ${longPath}`,
      "Done.",
    ].join("\n");

    const result = applyContextBudget(text, { level: "aggressive" });
    expect(result.text).toContain(".../auth/LoginForm.tsx");
    expect(result.text).not.toContain(longPath);
    expect(result.changed).toBe(true);
  });

  test("does not shorten paths that appear less than 3 times", () => {
    const longPath = "/home/user/projects/my-app/src/components/auth/LoginForm.tsx";
    const text = `Error in ${longPath}\nDone.`;

    const result = applyContextBudget(text, { level: "aggressive" });
    expect(result.text).toContain(longPath);
  });
});

describe("context budget — compression levels", () => {
  test("light mode only applies basic passes", () => {
    const text = [
      "## Risks",
      "- none",
      "",
      "## Summary",
      "Done.",
    ].join("\n");

    const result = applyContextBudget(text, { level: "light" });
    // Light mode does NOT remove empty sections
    expect(result.text).toContain("## Risks");
    expect(result.text).toContain("- none");
  });

  test("standard mode removes empty sections", () => {
    const text = [
      "## Risks",
      "- none",
      "",
      "## Summary",
      "Done.",
    ].join("\n");

    const result = applyContextBudget(text, { level: "standard" });
    expect(result.text).not.toContain("## Risks");
  });

  test("aggressive mode applies all passes including code truncation", () => {
    const codeLines = Array.from({ length: 50 }, (_, i) => `  line${i}`);
    const longPath = "/very/long/absolute/path/to/some/deeply/nested/file.ts";
    const text = [
      `\`\`\`typescript\n${codeLines.join("\n")}\n\`\`\``,
      `Found in ${longPath}`,
      `Also in ${longPath}`,
      `Fixed ${longPath}`,
    ].join("\n");

    const result = applyContextBudget(text, { level: "aggressive", maxCodeBlockLines: 10 });
    expect(result.text).toContain("truncated");
    expect(result.text).toContain(".../nested/file.ts");
    expect(result.changed).toBe(true);
  });

  test("estimateTokensFromChars calculates correctly", () => {
    expect(estimateTokensFromChars(0)).toBe(0);
    expect(estimateTokensFromChars(4)).toBe(1);
    expect(estimateTokensFromChars(100)).toBe(25);
    expect(estimateTokensFromChars(7)).toBe(2); // ceil(7/4) = 2
  });
});

describe("context budget — boilerplate stripping (aggressive)", () => {
  test("removes delegation envelope sections from results", () => {
    const text = [
      "## 1. TASK",
      "Investigate the auth flow.",
      "",
      "## 2. CONTEXT",
      "This is background context for the sub-agent.",
      "",
      "## Output Contract",
      "Return your findings in the following format:",
      "## Summary",
      "## Files",
      "## Verification",
      "## Risks",
      "",
      "## Summary",
      "Auth uses JWT with refresh tokens.",
      "",
      "## Files",
      "- src/auth.ts",
    ].join("\n");

    const result = applyContextBudget(text, { level: "aggressive" });
    expect(result.text).not.toContain("## Output Contract");
    expect(result.text).toContain("Auth uses JWT");
    expect(result.text).toContain("src/auth.ts");
    expect(result.changed).toBe(true);
  });
});

// ─── Edge Case Tests (Bug Prevention) ───────────────────────

describe("context budget — edge cases and safety", () => {
  test("empty input returns unchanged", () => {
    const result = applyContextBudget("");
    expect(result.text).toBe("");
    expect(result.changed).toBe(false);
    expect(result.estimatedTokensSaved).toBe(0);
  });

  test("single line input returns unchanged", () => {
    const result = applyContextBudget("hello world");
    expect(result.text).toBe("hello world");
    expect(result.changed).toBe(false);
  });

  test("empty section removal does NOT eat content after trivial section", () => {
    const text = [
      "## Risks",
      "- none",
      "This is important content that must be preserved.",
      "",
      "## Summary",
      "Done.",
    ].join("\n");

    const result = applyContextBudget(text);
    // The "Risks" section has content after "- none" on the next line, so it should NOT be removed
    expect(result.text).toContain("This is important content that must be preserved.");
  });

  test("empty section removal does NOT eat multi-line sections", () => {
    const text = [
      "## Risks",
      "- none",
      "- but also this risk exists",
      "",
      "## Summary",
      "Done.",
    ].join("\n");

    const result = applyContextBudget(text);
    expect(result.text).toContain("but also this risk exists");
  });

  test("file path shortening does NOT corrupt URLs", () => {
    const url = "https://github.com/user/repo/blob/main/src/file.ts";
    const text = [
      `See ${url}`,
      `Also ${url}`,
      `And ${url}`,
      "Done.",
    ].join("\n");

    const result = applyContextBudget(text, { level: "aggressive" });
    // URL should remain intact
    expect(result.text).toContain("https://github.com");
  });

  test("file path shortening does NOT corrupt short paths", () => {
    const shortPath = "/src/file.ts";
    const text = [
      `Error in ${shortPath}`,
      `Warning in ${shortPath}`,
      `Fixed ${shortPath}`,
    ].join("\n");

    const result = applyContextBudget(text, { level: "aggressive" });
    // Short paths (< 30 chars) should not be shortened
    expect(result.text).toContain(shortPath);
  });

  test("code block truncation handles unclosed code blocks safely", () => {
    const text = "```typescript\nconst x = 1;\nconst y = 2;\n// no closing backticks";
    const result = applyContextBudget(text, { level: "aggressive", maxCodeBlockLines: 2 });
    // Should not crash or corrupt — unclosed block is not matched by regex
    expect(result.text).toContain("const x = 1");
    expect(result.text).toContain("no closing backticks");
  });

  test("code block truncation handles empty code blocks", () => {
    const text = "```\n```\nSome text after.";
    const result = applyContextBudget(text, { level: "aggressive", maxCodeBlockLines: 5 });
    expect(result.text).toContain("Some text after.");
  });

  test("repetitive pattern preserves original lines when count <= 2", () => {
    const text = [
      "Request 1a2b3c4d5e6f7890 processed in 45ms",
      "Request 2b3c4d5e6f789012 processed in 52ms",
      "Final output",
    ].join("\n");

    const result = applyContextBudget(text);
    // Only 2 similar lines — both should be preserved with original content
    expect(result.text).toContain("1a2b3c4d5e6f7890");
    expect(result.text).toContain("2b3c4d5e6f789012");
    expect(result.text).not.toContain("repeated");
  });

  test("boilerplate stripping does NOT remove user Summary/Files sections", () => {
    const text = [
      "## Summary",
      "The authentication system uses JWT with refresh tokens.",
      "Sessions expire after 24 hours.",
      "",
      "## Files",
      "- src/auth/jwt.ts",
      "- src/auth/refresh.ts",
      "",
      "## Verification",
      "- Confirmed via unit tests: all 15 pass",
    ].join("\n");

    const result = applyContextBudget(text, { level: "aggressive" });
    expect(result.text).toContain("## Summary");
    expect(result.text).toContain("authentication system uses JWT");
    expect(result.text).toContain("## Files");
    expect(result.text).toContain("src/auth/jwt.ts");
    expect(result.text).toContain("## Verification");
    expect(result.text).toContain("all 15 pass");
  });

  test("JSON minification does NOT corrupt invalid JSON", () => {
    const text = '```json\n{ invalid json "missing": colon }\nmore lines\nand more\nand more\nand more\nand more\n```';
    const result = applyContextBudget(text);
    // Invalid JSON should be left as-is
    expect(result.text).toContain("invalid json");
  });

  test("stack trace collapsing preserves error message", () => {
    const text = [
      "TypeError: Cannot read property 'id' of undefined",
      "    at getUser (src/users.ts:42)",
      "    at handler (src/api.ts:100)",
      "    at router (src/router.ts:55)",
    ].join("\n");

    const result = applyContextBudget(text, { maxStackTraceLines: 6 });
    // Error message is protected, stack is short enough to keep
    expect(result.text).toContain("TypeError: Cannot read property");
    expect(result.text).toContain("at getUser");
  });

  test("whitespace normalization only applies in aggressive mode", () => {
    const text = "            deeply indented line";
    const standard = applyContextBudget(text, { level: "standard" });
    const aggressive = applyContextBudget(text, { level: "aggressive" });

    expect(standard.text).toContain("            deeply indented line");
    expect(aggressive.text).not.toContain("            deeply indented line");
    expect(aggressive.text).toContain("deeply indented line");
  });

  test("handles Windows line endings (CRLF) correctly", () => {
    const text = "line1\r\nline1\r\nline1\r\nline2";
    const result = applyContextBudget(text);
    // Should normalize CRLF and still work
    expect(result.text).toContain("line2");
    expect(result.text).not.toContain("\r");
  });

  test("does not crash on very large input", () => {
    const lines = Array.from({ length: 10000 }, (_, i) => `log line ${i}: some data`);
    const result = applyContextBudget(lines.join("\n"));
    expect(result.compressedChars).toBeLessThan(result.originalChars);
    expect(result.estimatedTokensSaved).toBeGreaterThan(0);
  });
});

