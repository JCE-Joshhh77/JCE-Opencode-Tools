import { describe, expect, test } from "bun:test";
import { evaluateStagedPath, isGeneratedBuildArtifactPath, summarizeToolDiscipline } from "../../src/plugin/lib/tool-discipline.ts";

describe("tool discipline", () => {
  test("warns for generated runtime paths", () => {
    expect(evaluateStagedPath(".opencode-jce/jce-worker-execution.json")).toMatchObject({ severity: "warn" });
    expect(evaluateStagedPath(".playwright-mcp/session.json")).toMatchObject({ severity: "warn" });
  });

  test("blocks likely secret paths", () => {
    expect(evaluateStagedPath(".env")).toMatchObject({ severity: "block" });
    expect(evaluateStagedPath("config/api-key.txt")).toMatchObject({ severity: "block" });
  });

  test("summarizes only risky paths", () => {
    const issues = summarizeToolDiscipline(["src/index.ts", ".env", ".opencode-context.md"]);

    expect(issues).toHaveLength(2);
  });

  test("warns for generated build artifacts and detects brittle asset paths", () => {
    expect(isGeneratedBuildArtifactPath("public/assets/admin.js")).toBe(true);
    expect(isGeneratedBuildArtifactPath("dist/app.min.js")).toBe(true);
    expect(evaluateStagedPath("public/assets/admin.js")).toMatchObject({ severity: "warn" });
    expect(evaluateStagedPath("public/assets/admin.js")?.reason).toContain("line-based edits");
  });
});
