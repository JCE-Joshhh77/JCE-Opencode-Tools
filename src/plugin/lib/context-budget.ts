// ─── Advanced Context Budget Compression ─────────────────────
// Multi-pass token savings engine. Complements RTK, Caveman, and DCP
// by targeting sub-agent delegation prompts and results specifically.

export interface ContextBudgetResult {
  text: string;
  originalChars: number;
  compressedChars: number;
  estimatedTokensSaved: number;
  estimatedSavingsPercent: number;
  changed: boolean;
}

export type CompressionLevel = "light" | "standard" | "aggressive";

export interface ContextBudgetOptions {
  maxLinesPerBlock?: number;
  minDuplicateLineLength?: number;
  level?: CompressionLevel;
  /** Max lines to keep in a code block before truncating (aggressive only) */
  maxCodeBlockLines?: number;
  /** Max lines in a stack trace before collapsing */
  maxStackTraceLines?: number;
}

const DEFAULT_MAX_LINES_PER_BLOCK = 40;
const DEFAULT_MIN_DUPLICATE_LINE_LENGTH = 24;
const DEFAULT_MAX_CODE_BLOCK_LINES = 30;
const DEFAULT_MAX_STACK_TRACE_LINES = 8;
const APPROX_CHARS_PER_TOKEN = 4;
const PROTECTED_BLOCK_PLACEHOLDER = "__JCE_CONTEXT_BUDGET_PROTECTED_BLOCK__";

export function estimateTokensFromChars(chars: number): number {
  return Math.max(0, Math.ceil(chars / APPROX_CHARS_PER_TOKEN));
}

// ─── Protection Rules ────────────────────────────────────────

function isProtectedLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^(system|developer|user):/i.test(trimmed)) return true;
  if (/^(?:#{1,6}\s*)?(?:caveman|rtk|dcp|protocol|constraints?|acceptance criteria|verification (?:criteria|policy|requirements?)|final gate)\b/i.test(trimmed)) return true;
  if (/^(error|fatal|failed|exception|traceback|caused by):/i.test(trimmed)) return true;
  if (/\b(exit|returned|exited)\s+[1-9]\d*\b/i.test(trimmed)) return true;
  if (/\b[A-Z]:\\[^\s]+/.test(trimmed) || /(^|\s)(\.\/|\.\.\/|\/)[\w.-]+/.test(trimmed)) return true;
  if (/`[^`]+`/.test(trimmed)) return true;
  if (/^\s*(git|bun|npm|pnpm|yarn|bash|gh|curl|sudo|docker|kubectl)\s+/.test(trimmed)) return true;
  return false;
}

function isProtectedBlockStart(line: string): boolean {
  return /^(?:#{1,6}\s*)?(?:caveman|rtk|dcp|protocol|constraints?|acceptance criteria|verification (?:criteria|policy|requirements?)|final gate)\b/i.test(line.trim());
}

function extractProtectedBlocks(text: string): { text: string; blocks: string[] } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  const blocks: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isProtectedBlockStart(line)) {
      output.push(line);
      continue;
    }

    const block: string[] = [line];
    const markdownHeading = /^#{1,6}\s+/.test(line.trim());
    index += 1;
    while (index < lines.length) {
      const candidate = lines[index];
      const candidateTrimmed = candidate.trim();
      const startsNextProtected = isProtectedBlockStart(candidate);
      const startsNextHeading = markdownHeading && /^#{1,6}\s+/.test(candidateTrimmed);
      const endsBlock = candidateTrimmed === "";
      if (startsNextProtected || startsNextHeading || endsBlock) {
        index -= 1;
        break;
      }
      block.push(candidate);
      index += 1;
    }
    const placeholder = `${PROTECTED_BLOCK_PLACEHOLDER}${blocks.length}__`;
    blocks.push(block.join("\n"));
    output.push(placeholder);
  }
  return { text: output.join("\n"), blocks };
}

function restoreProtectedBlocks(text: string, blocks: string[]): string {
  return blocks.reduce((result, block, index) => result.replace(`${PROTECTED_BLOCK_PLACEHOLDER}${index}__`, block), text);
}

function isPassingLogLine(line: string): boolean {
  return /\b(pass|passes|passed|success|ok)\b/i.test(line) && !/\b(fail|failed|error|exception)\b/i.test(line);
}

// ─── Pass 1: Duplicate Line Removal ─────────────────────────

function compactDuplicateLines(lines: string[], minLength: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  let skipped = 0;

  const flush = () => {
    if (skipped > 0) {
      output.push(`[context-budget: removed ${skipped} duplicate low-value line${skipped === 1 ? "" : "s"}]`);
      skipped = 0;
    }
  };

  for (const line of lines) {
    const normalized = line.trim().replace(/\s+/g, " ");
    const canDedupe = normalized.length >= minLength && !isProtectedLine(line);
    if (canDedupe && seen.has(normalized)) {
      skipped += 1;
      continue;
    }
    flush();
    if (canDedupe) seen.add(normalized);
    output.push(line);
  }
  flush();
  return output;
}

// ─── Pass 2: Passing Log Block Collapse ─────────────────────

function compactLongPassingBlocks(lines: string[], maxLines: number): string[] {
  const output: string[] = [];
  let block: string[] = [];

  const flush = () => {
    if (block.length <= maxLines) {
      output.push(...block);
    } else {
      const keepStart = Math.max(3, Math.floor(maxLines / 2));
      const keepEnd = Math.max(3, maxLines - keepStart);
      output.push(...block.slice(0, keepStart));
      output.push(`[context-budget: collapsed ${block.length - keepStart - keepEnd} passing log line${block.length - keepStart - keepEnd === 1 ? "" : "s"}]`);
      output.push(...block.slice(-keepEnd));
    }
    block = [];
  };

  for (const line of lines) {
    if (isPassingLogLine(line) && !isProtectedLine(line)) {
      block.push(line);
      continue;
    }
    flush();
    output.push(line);
  }
  flush();
  return output;
}

// ─── Pass 3: Repeated Blank Lines ───────────────────────────

function compactRepeatedBlankLines(lines: string[]): string[] {
  const output: string[] = [];
  let blankCount = 0;
  for (const line of lines) {
    if (line.trim().length === 0) {
      blankCount += 1;
      if (blankCount <= 1) output.push(line);
      continue;
    }
    blankCount = 0;
    output.push(line);
  }
  return output;
}

// ─── Pass 4: Empty/Trivial Section Removal ──────────────────
// Removes markdown sections that contain only "none", "- none", "n/a", etc.

function compactEmptySections(text: string): string {
  // Match ## Header followed by exactly one trivial content line, then blank line or end of string.
  // Conservative: only removes single-line trivial sections to avoid eating real content.
  return text.replace(
    /^(#{1,3}\s+[^\n]+)\n([ \t]*[-*]?\s*(?:none|n\/a|no\s*(?:risks?|issues?|changes?|files?)|not\s*(?:applicable|run|available)|—|-)\s*)(?:\n(?=\n|$)|$)/gim,
    "",
  );
}

// ─── Pass 5: Code Block Truncation ──────────────────────────
// Truncates long code blocks, keeping first/last N lines

function compactCodeBlocks(text: string, maxLines: number): string {
  return text.replace(/```[\w]*\n([\s\S]*?)```/g, (match, content: string) => {
    const lines = content.split("\n");
    if (lines.length <= maxLines) return match;
    const keepStart = Math.ceil(maxLines * 0.6);
    const keepEnd = Math.max(3, maxLines - keepStart);
    const removed = lines.length - keepStart - keepEnd;
    const lang = match.match(/```(\w*)/)?.[1] || "";
    return `\`\`\`${lang}\n${lines.slice(0, keepStart).join("\n")}\n[context-budget: truncated ${removed} lines]\n${lines.slice(-keepEnd).join("\n")}\`\`\``;
  });
}

// ─── Pass 6: JSON Minification ──────────────────────────────
// Minifies pretty-printed JSON blocks (>5 lines)

function compactJsonBlocks(text: string): string {
  return text.replace(/```json\n([\s\S]*?)```/g, (match, content: string) => {
    const lines = content.trim().split("\n");
    if (lines.length <= 5) return match;
    try {
      const parsed = JSON.parse(content);
      const minified = JSON.stringify(parsed);
      // Only minify if it saves significant space (>30%)
      if (minified.length < content.length * 0.7) {
        return `\`\`\`json\n${minified}\n\`\`\``;
      }
    } catch {
      // Not valid JSON, skip
    }
    return match;
  });
}

// ─── Pass 7: Stack Trace Collapsing ─────────────────────────
// Collapses long stack traces, keeping top and bottom frames

function isStackFrame(line: string): boolean {
  return /^\s+at\s+/.test(line) || /^\s+\w+\.\w+\(/.test(line) || /^\s+File "/.test(line) || /^\s+in\s+\w+/.test(line);
}

function compactStackTraces(lines: string[], maxFrames: number): string[] {
  const output: string[] = [];
  let stack: string[] = [];

  const flush = () => {
    if (stack.length <= maxFrames) {
      output.push(...stack);
    } else {
      const keepTop = Math.ceil(maxFrames * 0.6);
      const keepBottom = Math.max(2, maxFrames - keepTop);
      const removed = stack.length - keepTop - keepBottom;
      output.push(...stack.slice(0, keepTop));
      output.push(`    [context-budget: collapsed ${removed} stack frame${removed === 1 ? "" : "s"}]`);
      output.push(...stack.slice(-keepBottom));
    }
    stack = [];
  };

  for (const line of lines) {
    if (isStackFrame(line)) {
      stack.push(line);
      continue;
    }
    flush();
    output.push(line);
  }
  flush();
  return output;
}

// ─── Pass 8: Repetitive Pattern Detection ───────────────────
// Detects ANY line pattern repeated 3+ times consecutively (not just passing lines)

function compactRepetitivePatterns(lines: string[]): string[] {
  const output: string[] = [];
  let currentPattern = "";
  let groupLines: string[] = [];

  const flush = () => {
    if (groupLines.length <= 2) {
      output.push(...groupLines);
    } else {
      output.push(groupLines[0]);
      output.push(`[context-budget: repeated ${groupLines.length - 1} more time${groupLines.length - 1 === 1 ? "" : "s"}]`);
    }
    groupLines = [];
    currentPattern = "";
  };

  for (const line of lines) {
    // Skip protected lines and passing log lines (handled by dedicated pass)
    if (isProtectedLine(line) || isPassingLogLine(line)) {
      if (groupLines.length > 0) flush();
      output.push(line);
      continue;
    }

    // Normalize for pattern matching: strip numbers, timestamps, IDs
    const normalized = line.trim()
      .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*/g, "<TS>")
      .replace(/\b[0-9a-f]{8,}\b/gi, "<ID>")
      .replace(/\b\d+(\.\d+)?\s*(ms|s|bytes?|KB|MB|GB)\b/gi, "<NUM>")
      .replace(/\b\d+\b/g, "<N>")
      .replace(/\s+/g, " ");

    if (normalized === currentPattern && normalized.length >= 10) {
      groupLines.push(line);
    } else {
      if (groupLines.length > 0) flush();
      currentPattern = normalized;
      groupLines = [line];
    }
  }
  if (groupLines.length > 0) flush();
  return output;
}

// ─── Pass 9: File Path Shortening ───────────────────────────
// Replaces repeated long absolute paths with shortened references

function compactFilePaths(text: string): string {
  // Find all absolute paths that appear 3+ times
  const pathPattern = /(?:\/[\w.-]+){3,}|(?:[A-Z]:\\(?:[\w.-]+\\){2,}[\w.-]+)/g;
  const pathCounts = new Map<string, number>();
  let match: RegExpExecArray | null;

  while ((match = pathPattern.exec(text)) !== null) {
    const path = match[0];
    // Skip paths that are part of URLs: check if preceded by scheme://host pattern
    const prefixStart = Math.max(0, match.index - 50);
    const prefix = text.slice(prefixStart, match.index);
    if (/https?:\/\S*$/.test(prefix) || /[a-z]+:\/\S*$/.test(prefix)) continue;
    pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);
  }

  let result = text;
  for (const [path, count] of pathCounts) {
    if (count < 3 || path.length < 30) continue;
    // Shorten to last 2 segments
    const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
    if (segments.length <= 2) continue;
    const short = `.../${segments.slice(-2).join("/")}`;
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Only replace paths that are NOT part of a URL
    result = result.replace(new RegExp(escaped, "g"), (substring, offset) => {
      const pStart = Math.max(0, offset - 50);
      const pText = result.slice(pStart, offset);
      if (/https?:\/\S*$/.test(pText) || /[a-z]+:\/\S*$/.test(pText)) return substring;
      return short;
    });
  }
  return result;
}

// ─── Pass 10: Boilerplate/Envelope Stripping ────────────────
// Removes delegation envelope boilerplate from collected results.
// Only targets JCE-specific envelope patterns that are safe to remove.

const BOILERPLATE_PATTERNS: RegExp[] = [
  // Output Contract section (always safe — it's instructions, not content)
  /^## Output Contract\n(?:(?!^## ).+\n)*/gm,
  // Numbered delegation envelope sections (TASK, CONTEXT, CONSTRAINTS, DELEGATION RULES)
  /^## \d+\. (?:TASK|CONTEXT|CONSTRAINTS|DELEGATION RULES)\n(?:(?!^## \d+\. |^## Output Contract|^## Summary|^## Files|^## Verification|^## Risks).+\n)*/gm,
  // GitHub-style admonitions (> [!NOTE], > [!TIP], > [!WARNING])
  /^> \[!(?:NOTE|TIP|WARNING)\][^\n]*\n(?:>[^\n]*\n)*/gm,
  // Horizontal rules (standalone)
  /^---+\s*$/gm,
];

function compactBoilerplate(text: string): string {
  let result = text;
  for (const pattern of BOILERPLATE_PATTERNS) {
    result = result.replace(pattern, "");
  }
  // Clean up resulting multiple blank lines
  return result.replace(/\n{3,}/g, "\n\n");
}

// ─── Pass 11: Whitespace Normalization ──────────────────────
// Reduces excessive indentation (>8 spaces → 2 spaces per level)

function compactWhitespace(lines: string[]): string[] {
  return lines.map((line) => {
    const match = line.match(/^(\s+)/);
    if (!match || match[1].length <= 8) return line;
    // Normalize deep indentation: every 4 spaces → 2 spaces
    const indent = match[1];
    const level = Math.ceil(indent.length / 4);
    return "  ".repeat(level) + line.trimStart();
  });
}

// ─── Main Entry Point ────────────────────────────────────────

export function applyContextBudget(text: string, options: ContextBudgetOptions = {}): ContextBudgetResult {
  const originalChars = text.length;
  const protectedBlocks = extractProtectedBlocks(text);
  const level = options.level ?? "standard";
  const maxLines = options.maxLinesPerBlock ?? DEFAULT_MAX_LINES_PER_BLOCK;
  const minLength = options.minDuplicateLineLength ?? DEFAULT_MIN_DUPLICATE_LINE_LENGTH;
  const maxCodeLines = options.maxCodeBlockLines ?? DEFAULT_MAX_CODE_BLOCK_LINES;
  const maxStackLines = options.maxStackTraceLines ?? DEFAULT_MAX_STACK_TRACE_LINES;

  let lines = protectedBlocks.text.replace(/\r\n/g, "\n").split("\n");
  let processed: string;

  if (level === "light") {
    // Original behavior: only basic passes
    processed = compactRepeatedBlankLines(
      compactLongPassingBlocks(compactDuplicateLines(lines, minLength), maxLines),
    ).join("\n");
  } else {
    // Standard + Aggressive: full pipeline
    // Line-based passes
    lines = compactDuplicateLines(lines, minLength);
    lines = compactLongPassingBlocks(lines, maxLines);
    lines = compactStackTraces(lines, maxStackLines);
    lines = compactRepetitivePatterns(lines);
    lines = compactRepeatedBlankLines(lines);

    if (level === "aggressive") {
      lines = compactWhitespace(lines);
    }

    processed = lines.join("\n");

    // Text-based passes
    processed = compactEmptySections(processed);
    processed = compactJsonBlocks(processed);

    if (level === "aggressive") {
      processed = compactCodeBlocks(processed, maxCodeLines);
      processed = compactFilePaths(processed);
      processed = compactBoilerplate(processed);
    }
  }

  processed = restoreProtectedBlocks(processed, protectedBlocks.blocks);
  const compressedChars = processed.length;
  const estimatedTokensSaved = Math.max(0, estimateTokensFromChars(originalChars) - estimateTokensFromChars(compressedChars));
  const estimatedSavingsPercent = originalChars === 0 ? 0 : Math.max(0, Math.round((1 - compressedChars / originalChars) * 100));

  return {
    text: processed,
    originalChars,
    compressedChars,
    estimatedTokensSaved,
    estimatedSavingsPercent,
    changed: processed !== text,
  };
}
