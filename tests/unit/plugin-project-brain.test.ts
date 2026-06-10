import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildProjectBrain } from "../../src/plugin/lib/project-brain.ts";
import { createEmptyRuntimeState } from "../../src/plugin/lib/runtime-state.ts";

describe("project brain", () => {
  test("summarizes package scripts and recommended verification", () => {
    const root = mkdtempSync(join(tmpdir(), "opencode-jce-brain-"));
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({ version: "9.9.9", scripts: { test: "bun test", typecheck: "tsc" } }), "utf-8");
      const output = buildProjectBrain(root, createEmptyRuntimeState());

      expect(output).toContain("Version: 9.9.9");
      expect(output).toContain("Scripts: test, typecheck");
      expect(output).toContain("Generated/runtime paths");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
