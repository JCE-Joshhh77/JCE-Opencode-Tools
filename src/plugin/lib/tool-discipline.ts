export interface ToolDisciplineIssue {
  severity: "warn" | "block";
  reason: string;
  path?: string;
}

const GENERATED_PATTERNS = [/^\.opencode-jce\//, /^\.playwright-mcp\//, /^\.opencode-context(?:-archive)?\.md$/];
const SECRET_PATTERNS = [/\.env(?:\.|$)/, /secret/i, /credential/i, /token/i, /api[_-]?key/i];

export function evaluateStagedPath(path: string): ToolDisciplineIssue | undefined {
  const normalized = path.replace(/\\/g, "/");
  if (SECRET_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { severity: "block", reason: "Potential secret or credential path must not be committed without explicit review.", path };
  }
  if (GENERATED_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { severity: "warn", reason: "Generated/runtime context path should usually be excluded from release commits.", path };
  }
  return undefined;
}

export function summarizeToolDiscipline(paths: string[]): ToolDisciplineIssue[] {
  return paths.map(evaluateStagedPath).filter((issue): issue is ToolDisciplineIssue => Boolean(issue));
}
