export interface ContextBudgetResult {
  text: string;
  originalChars: number;
  compressedChars: number;
  estimatedSavingsPercent: number;
  changed: boolean;
}

export interface ContextBudgetOptions {
  maxLinesPerBlock?: number;
  minDuplicateLineLength?: number;
}

const DEFAULT_MAX_LINES_PER_BLOCK = 40;
const DEFAULT_MIN_DUPLICATE_LINE_LENGTH = 24;

function isProtectedLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^(system|developer|user):/i.test(trimmed)) return true;
  if (/^(error|fatal|failed|exception|traceback|caused by):/i.test(trimmed)) return true;
  if (/\b(exit|returned|exited)\s+[1-9]\d*\b/i.test(trimmed)) return true;
  if (/\b[A-Z]:\\[^\s]+/.test(trimmed) || /(^|\s)(\.\/|\.\.\/|\/)[\w.-]+/.test(trimmed)) return true;
  if (/`[^`]+`/.test(trimmed)) return true;
  if (/^\s*(git|bun|npm|pnpm|yarn|bash|gh|curl|sudo|docker|kubectl)\s+/.test(trimmed)) return true;
  return false;
}

function isPassingLogLine(line: string): boolean {
  return /\b(pass|passes|passed|success|ok)\b/i.test(line) && !/\b(fail|failed|error|exception)\b/i.test(line);
}

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

function compactRepeatedBlankLines(lines: string[]): string[] {
  const output: string[] = [];
  let blankCount = 0;
  for (const line of lines) {
    if (line.trim().length === 0) {
      blankCount += 1;
      if (blankCount <= 2) output.push(line);
      continue;
    }
    blankCount = 0;
    output.push(line);
  }
  return output;
}

export function applyContextBudget(text: string, options: ContextBudgetOptions = {}): ContextBudgetResult {
  const originalChars = text.length;
  const maxLines = options.maxLinesPerBlock ?? DEFAULT_MAX_LINES_PER_BLOCK;
  const minLength = options.minDuplicateLineLength ?? DEFAULT_MIN_DUPLICATE_LINE_LENGTH;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const compacted = compactRepeatedBlankLines(compactLongPassingBlocks(compactDuplicateLines(lines, minLength), maxLines)).join("\n");
  const compressedChars = compacted.length;
  const estimatedSavingsPercent = originalChars === 0 ? 0 : Math.max(0, Math.round((1 - compressedChars / originalChars) * 100));

  return {
    text: compacted,
    originalChars,
    compressedChars,
    estimatedSavingsPercent,
    changed: compacted !== text,
  };
}
