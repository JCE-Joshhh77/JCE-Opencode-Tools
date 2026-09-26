const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rs", ".go", ".java", ".kt", ".c", ".cpp", ".h",
  ".cs", ".rb", ".php", ".swift", ".scala",
]);

const SLASH_COMMENT = /^\s*\/\//;
const BLOCK_COMMENT = /^\s*\/?\*|^\s*\*\//;
const HASH_COMMENT = /^\s*#(?![!\/])/;

export interface CommentAnalysis {
  excessive: boolean;
  ratio: number;
  totalLines: number;
  commentLines: number;
}

/**
 * Strip `cat -p` / diff-style line-number prefixes (e.g. "12\tcode" or
 * "12→code") that the write/edit tool outputs embed. In production the tool
 * output contains NUMBERED lines, so the comment regexes (which anchor at
 * line start) never matched and the density check always returned ratio 0 —
 * the feature only "worked" on raw-code outputs used in tests.
 *
 * Conservative: only strips when at least 3 lines carry a number prefix,
 * so real source files whose lines happen to start with digits+tab are left
 * untouched.
 */
const NUMBERED_LINE = /^\s*\d+(?:\t|→|\|)(.*)$/;

export function stripLineNumberPrefixes(text: string): string {
  const lines = text.split("\n");
  const numbered = lines.filter((line) => NUMBERED_LINE.test(line)).length;
  if (numbered < 3) return text;
  return lines
    .map((line) => {
      const match = line.match(NUMBERED_LINE);
      return match ? match[1]! : line;
    })
    .join("\n");
}

export function analyzeCommentDensity(content: string, filePath: string): CommentAnalysis {
  const ext = filePath.slice(filePath.lastIndexOf("."));
  if (!CODE_EXTENSIONS.has(ext)) {
    return { excessive: false, ratio: 0, totalLines: 0, commentLines: 0 };
  }

  const lines = stripLineNumberPrefixes(content).split("\n");
  const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
  if (nonEmptyLines.length < 5) {
    return { excessive: false, ratio: 0, totalLines: nonEmptyLines.length, commentLines: 0 };
  }

  let commentLines = 0;
  const useHash = ext === ".py" || ext === ".rb";

  for (const line of nonEmptyLines) {
    const trimmed = line.trim();
    if (useHash) {
      if (HASH_COMMENT.test(trimmed)) commentLines++;
    } else {
      if (SLASH_COMMENT.test(trimmed) || BLOCK_COMMENT.test(trimmed)) commentLines++;
    }
  }

  const ratio = commentLines / nonEmptyLines.length;
  const excessive = ratio > 0.4;

  return { excessive, ratio, totalLines: nonEmptyLines.length, commentLines };
}

export const COMMENT_WARNING = `⚠️ COMMENT CHECK: The code you just wrote has excessive comments (>40% comment ratio). Code should be self-documenting. Remove obvious comments and keep only those that explain WHY, not WHAT.`;
