import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getRuntimeStatePath, loadRuntimeState, createEmptyRuntimeState } from "../../src/plugin/lib/runtime-state.ts";

describe("runtime state auto-heal", () => {
  test("heals corrupted context budget summary on load and rewrites disk", () => {
    const root = mkdtempSync(join(tmpdir(), "runtime-heal-"));
    try {
      const path = getRuntimeStatePath(root);
      mkdirSync(join(root, ".opencode-jce"), { recursive: true });
      const runtime = createEmptyRuntimeState("2026-01-01T00:00:00.000Z");
      runtime.contextBudgetSummary = {
        originalChars: Number.MAX_VALUE,
        compressedChars: Number.MAX_VALUE,
        estimatedTokensSaved: Number.MAX_VALUE,
        estimatedSavingsPercent: Number.MAX_VALUE,
        tasks: Number.MAX_VALUE,
        byTool: {
          bash: {
            originalChars: Number.MAX_VALUE,
            compressedChars: Number.MAX_VALUE,
            estimatedTokensSaved: Number.MAX_VALUE,
            tasks: Number.MAX_VALUE,
          },
        },
      };
      writeFileSync(path, JSON.stringify(runtime), "utf-8");

      const loaded = loadRuntimeState(root, "2026-01-01T00:01:00.000Z");
      expect(loaded.healedContextBudget).toBe(true);
      expect(loaded.runtime.contextBudgetSummary?.estimatedTokensSaved).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);

      const saved = JSON.parse(readFileSync(path, "utf-8"));
      expect(saved.contextBudgetSummary.estimatedSavingsPercent).toBeLessThanOrEqual(100);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
