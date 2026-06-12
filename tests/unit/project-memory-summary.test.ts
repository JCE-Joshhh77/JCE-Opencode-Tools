import { describe, expect, test } from "bun:test";
import { buildProjectMemorySummary, hasRestorableMemory } from "../../src/plugin/lib/project-memory-summary.js";

const ROOT = process.cwd(); // has a real package.json with scripts

describe("project-memory-summary: hasRestorableMemory", () => {
  test("false for empty memory (brand-new project)", () => {
    expect(hasRestorableMemory({ projectRoot: ROOT })).toBe(false);
    expect(hasRestorableMemory({ projectRoot: ROOT, changedFiles: [], wisdom: [], taskLearnings: [], sessionHistory: [] })).toBe(false);
  });

  test("true when any durable signal exists", () => {
    expect(hasRestorableMemory({ projectRoot: ROOT, changedFiles: ["a.ts"] })).toBe(true);
    expect(hasRestorableMemory({ projectRoot: ROOT, activeWorkflow: { goal: "ship feature" } })).toBe(true);
    expect(hasRestorableMemory({ projectRoot: ROOT, memoryTiers: { project: { conventions: ["use bun"] } } })).toBe(true);
  });
});

describe("project-memory-summary: buildProjectMemorySummary", () => {
  test("returns empty string when nothing durable to restore", () => {
    expect(buildProjectMemorySummary({ projectRoot: ROOT })).toBe("");
  });

  test("renders a compact block with key durable facts", () => {
    const out = buildProjectMemorySummary({
      projectRoot: ROOT,
      activeWorkflow: { goal: "fix auth bug", status: "in_progress" },
      changedFiles: ["src/login.ts", "src/session.ts"],
      wisdom: [{ learning: "Hilt errors need @InstallIn scope", confidence: "high", usageCount: 4 }],
      taskLearnings: [{ trigger: "auth", successfulRecipe: ["a", "b"], verificationCommands: ["bun test"] }],
      sessionHistory: [{ intent: "bugfix", nodesCompleted: 3, nodesFailed: 1, startedAt: "2026-01-01" }],
      memoryTiers: {
        session: { blockers: ["waiting on API key"] },
        project: { conventions: ["use bun, not npm"], dangerousAreas: ["src/legacy.ts"], standardVerification: ["bun run typecheck"] },
      },
    });
    expect(out).toContain("Restored Project Memory");
    expect(out).toContain("fix auth bug");
    expect(out).toContain("src/login.ts");
    expect(out).toContain("waiting on API key");
    expect(out).toContain("Hilt errors need @InstallIn");
    expect(out).toContain("src/legacy.ts");
    expect(out).toContain("bun run typecheck");
    expect(out).toContain("code wins"); // stale-memory guard line
  });

  test("respects the line cap to protect token budget", () => {
    const out = buildProjectMemorySummary({
      projectRoot: ROOT,
      activeWorkflow: { goal: "g" },
      changedFiles: Array.from({ length: 50 }, (_, i) => `f${i}.ts`),
      wisdom: Array.from({ length: 20 }, (_, i) => ({ learning: `lesson ${i}`, confidence: "high", usageCount: i })),
      memoryTiers: { project: { conventions: ["c"], dangerousAreas: ["d"] } },
    }, { maxLines: 8 });
    const bodyLines = out.split("\n").filter((l) => l.startsWith("- "));
    expect(bodyLines.length).toBeLessThanOrEqual(8);
  });

  test("prioritizes high-confidence, frequently-used learnings", () => {
    const out = buildProjectMemorySummary({
      projectRoot: ROOT,
      changedFiles: ["x.ts"],
      wisdom: [
        { learning: "low conf rare", confidence: "low", usageCount: 0 },
        { learning: "HIGH CONF USED", confidence: "high", usageCount: 10 },
        { learning: "medium one", confidence: "medium", usageCount: 1 },
      ],
    });
    // High-confidence learning must appear; only top 3 kept and high ranks first.
    expect(out).toContain("HIGH CONF USED");
  });

  test("caps recently-touched files to keep the line short", () => {
    const out = buildProjectMemorySummary({
      projectRoot: ROOT,
      changedFiles: Array.from({ length: 30 }, (_, i) => `file${i}.ts`),
    });
    expect(out).toContain("file0.ts");
    expect(out).not.toContain("file20.ts"); // capped at 8
  });
});
