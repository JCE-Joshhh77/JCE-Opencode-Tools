import { describe, expect, test } from "bun:test";
import { analyzeCommentDensity, COMMENT_WARNING } from "../../src/plugin/hooks/comment-checker.ts";

describe("comment checker", () => {
  test("flags code with excessive comment ratio", () => {
    const code = `// This function adds two numbers
// It takes a and b as parameters
// Returns the sum
function add(a: number, b: number): number {
  // Add a and b together
  return a + b;
}`;
    const result = analyzeCommentDensity(code, "test.ts");
    expect(result.excessive).toBe(true);
    expect(result.ratio).toBeGreaterThan(0.4);
  });

  test("passes code with reasonable comments", () => {
    const code = `// Calculate compound interest with monthly compounding
function compoundInterest(principal: number, rate: number, years: number): number {
  const monthlyRate = rate / 12;
  const months = years * 12;
  return principal * Math.pow(1 + monthlyRate, months);
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}`;
    const result = analyzeCommentDensity(code, "test.ts");
    expect(result.excessive).toBe(false);
  });

  test("ignores non-code files", () => {
    const content = "# Heading\nSome markdown content\n## Another heading";
    const result = analyzeCommentDensity(content, "README.md");
    expect(result.excessive).toBe(false);
  });

  test("handles Python hash comments", () => {
    const code = `# comment 1
# comment 2
# comment 3
# comment 4
x = 1
y = 2`;
    const result = analyzeCommentDensity(code, "test.py");
    expect(result.excessive).toBe(true);
  });

  test("skips files with fewer than 5 non-empty lines", () => {
    const code = `// short\nconst x = 1;`;
    const result = analyzeCommentDensity(code, "test.ts");
    expect(result.excessive).toBe(false);
  });

  test("COMMENT_WARNING mentions self-documenting", () => {
    expect(COMMENT_WARNING).toContain("self-documenting");
  });

  test("REGRESSION (audit 2026-09-26): numbered tool-output lines are analyzed as code", () => {
    // The write/edit tool output embeds `cat -p`/diff-style numbered lines.
    // Without prefix stripping the comment regexes never matched (ratio 0) and
    // the excessive-comment warning could not fire in production.
    const numbered = [
      "1\t// validate input",
      "2\tconst x = 1;",
      "3\t// sanitize",
      "4\tconst y = 2;",
      "5\t// log it",
      "6\tconst z = 3;",
      "7\t// cleanup",
      "8\tconst w = 4;",
      "9\t// finalize",
      "10\tconst v = 5;",
    ].join("\n");
    const result = analyzeCommentDensity(numbered, "test.ts");
    expect(result.commentLines).toBe(5);
    expect(result.ratio).toBeGreaterThan(0.4);
    expect(result.excessive).toBe(true);
  });

  test("REGRESSION: files without number prefixes are left untouched", () => {
    // Fewer than 3 numbered lines => no stripping; raw code still analyzed.
    const raw = "// one\n// two\nconst a = 1;\nconst b = 2;\nconst c = 3;";
    const result = analyzeCommentDensity(raw, "test.ts");
    expect(result.commentLines).toBe(2);
    expect(result.excessive).toBe(false);
  });
});
