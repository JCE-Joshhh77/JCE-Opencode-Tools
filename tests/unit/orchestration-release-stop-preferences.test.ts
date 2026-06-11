import { describe, expect, test } from "bun:test";
import { OrchestrationController } from "../../src/plugin/lib/orchestration/controller.js";
import { evaluateSelfCritique } from "../../src/plugin/lib/self-critique.js";
import { createEmptyRuntimeState } from "../../src/plugin/lib/runtime-state.ts";
import { createJceWorkerCommand } from "../../src/commands/jce-worker.ts";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const NOW = "2026-01-01T00:00:00.000Z";

describe("release commander, self-critique, preferences", () => {
  test("controller can create release commander graph", () => {
    const root = mkdtempSync(join(tmpdir(), "orch-release-"));
    try {
      const controller = new OrchestrationController({ projectRoot: root, now: () => NOW });
      const graph = controller.createReleaseCommanderPlan("Ship v3.8.0", "3.8.0");
      expect(graph.metadata?.mode).toBe("release-commander");
      expect(graph.nodes.size).toBeGreaterThanOrEqual(5);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("release commander summary reflects autonomy and strictness", () => {
    const root = mkdtempSync(join(tmpdir(), "orch-release-summary-"));
    try {
      const controller = new OrchestrationController({ projectRoot: root, now: () => NOW });
      controller.setAutonomyLevel("release-lock");
      controller.setOperatorPreferences({ defaultReleaseStrictness: "high" });
      controller.createReleaseCommanderPlan("Ship v3.8.0", "3.8.0");
      const text = controller.getReleaseCommanderSummary();
      expect(text).toContain("Release Commander");
      expect(text).toContain("Autonomy: release-lock");
      expect(text).toContain("Release strictness: high");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("release commander lifecycle can advance ready nodes into execution", () => {
    const root = mkdtempSync(join(tmpdir(), "orch-release-advance-"));
    try {
      const controller = new OrchestrationController({ projectRoot: root, now: () => NOW });
      controller.createReleaseCommanderPlan("Ship v3.8.0", "3.8.0");
      const graph = controller.advanceReleaseCommanderLifecycle()!;
      const running = Array.from(graph.nodes.values()).filter((node) => node.status === "running" || node.status === "verifying");
      expect(running.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("self-critique blocks stop when work remains", () => {
    const memory = createEmptyRuntimeState(NOW);
    memory.activeTasks = [{ id: "t1" }];
    memory.autonomousExecutionSession = { continueUntilDone: true, reason: "user asked", updatedAt: NOW };
    const result = evaluateSelfCritique(memory);
    expect(result.canStop).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  test("preferences command can update autonomous preference", async () => {
    const root = mkdtempSync(join(tmpdir(), "orch-pref-"));
    const output: string[] = [];
    try {
      const command = createJceWorkerCommand({ exitProcess: false, cwd: () => root, success: (text) => output.push(text), write: (text) => output.push(text) });
      await command.parseAsync(["preferences", "--autonomous", "true"], { from: "user" });
      expect(output.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("preferences command can persist richer operator preference flags", async () => {
    const root = mkdtempSync(join(tmpdir(), "orch-pref-rich-"));
    const output: string[] = [];
    try {
      const command = createJceWorkerCommand({ exitProcess: false, cwd: () => root, success: (text) => output.push(text), write: (text) => output.push(text) });
      await command.parseAsync(["preferences", "--ask-architecture", "false", "--broad-verify", "false", "--terse", "true"], { from: "user" });
      await command.parseAsync(["preferences"], { from: "user" });
      const text = output.join("\n");
      expect(text.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
