export interface ToolDisciplineIssue {
  severity: "warn" | "block";
  reason: string;
  path?: string;
}

const GENERATED_PATTERNS = [/^\.opencode-jce\//, /^\.playwright-mcp\//, /^\.opencode-context(?:-archive)?\.md$/];
const GENERATED_BUILD_ARTIFACT_PATTERNS = [
  /(^|\/)(dist|build|coverage|out|public\/assets|public\/build|static\/assets)\//,
  /(?:^|\/)[^/]+(?:\.min\.(?:js|css)|-[A-Fa-f0-9]{8,}\.(?:js|css))$/,
];
const SECRET_PATTERNS = [/\.env(?:\.|$)/, /secret/i, /credential/i, /token/i, /api[_-]?key/i];

export function isGeneratedBuildArtifactPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return GENERATED_BUILD_ARTIFACT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function evaluateStagedPath(path: string): ToolDisciplineIssue | undefined {
  const normalized = path.replace(/\\/g, "/");
  if (SECRET_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { severity: "block", reason: "Potential secret or credential path must not be committed without explicit review.", path };
  }
  if (GENERATED_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { severity: "warn", reason: "Generated/runtime context path should usually be excluded from release commits.", path };
  }
  if (isGeneratedBuildArtifactPath(normalized)) {
    return { severity: "warn", reason: "Generated/build artifact path is brittle for line-based edits; prefer editing source files or exact string replacement + rebuild.", path };
  }
  return undefined;
}

export function summarizeToolDiscipline(paths: string[]): ToolDisciplineIssue[] {
  return paths.map(evaluateStagedPath).filter((issue): issue is ToolDisciplineIssue => Boolean(issue));
}
