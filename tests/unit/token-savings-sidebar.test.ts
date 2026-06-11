import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { renderContextBudgetLine } from "../../src/plugin/lib/token-savings-sidebar.ts";
import { getRuntimeStatePath, createEmptyRuntimeState } from "../../src/plugin/lib/runtime-state.ts";

describe("Token Savings sidebar", () => {
  test("clamps invalid huge values to finite token display", () => {
    const root = mkdtempSync(join(tmpdir(), "token-savings-"));
    try {
      const path = getRuntimeStatePath(root);
      mkdirSync(join(root, ".opencode-jce"), { recursive: true });
      const runtime = createEmptyRuntimeState("2026-01-01T00:00:00.000Z");
      runtime.contextBudgetSummary = {
        originalChars: Number.MAX_VALUE,
        compressedChars: 1,
        estimatedTokensSaved: Number.MAX_VALUE,
        estimatedSavingsPercent: 100,
        tasks: Number.MAX_VALUE,
        byTool: {
          bash: {
            originalChars: Number.MAX_VALUE,
            compressedChars: 1,
            estimatedTokensSaved: Number.MAX_VALUE,
            tasks: Number.MAX_VALUE,
          },
        },
      };
      writeFileSync(path, JSON.stringify(runtime), "utf-8");

      const line = renderContextBudgetLine({ state: { path: { directory: root } } });
      expect(line).not.toContain("e+");
      expect(line).toContain("token(s) saved");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
