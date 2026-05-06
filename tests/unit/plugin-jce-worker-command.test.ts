import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Command } from "commander";
import { clearJceWorkerRuntime, createJceWorkerCommand, normalizeTraceLimit, jceWorkerCommand } from "../../src/commands/jce-worker.ts";
import { createEmptyExecutionMemory, getExecutionMemoryPath } from "../../src/plugin/lib/execution-memory.ts";
import { resolvePolicyProfile } from "../../src/plugin/lib/policy-profile.ts";

function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "opencode-jce-jce-worker-command-"));
}

describe("JCE-Worker CLI command", () => {
  test("registers operator subcommands", () => {
    expect(jceWorkerCommand.name()).toBe("jce-worker");
    expect(jceWorkerCommand.commands.map((command) => command.name()).sort()).toEqual(["clear", "profile", "report", "status", "trace"]);
  });

  test("shows operator subcommands in command help", () => {
    const help = createJceWorkerCommand({ exitProcess: false }).helpInformation();

    expect(help).toContain("status");
    expect(help).toContain("trace");
    expect(help).toContain("report");
    expect(help).toContain("clear");
    expect(help).toContain("profile");
  });

  test("can be registered on a root command", () => {
    const root = new Command("opencode-jce").addCommand(createJceWorkerCommand({ exitProcess: false }));

    expect(root.helpInformation()).toContain("jce-worker");
    expect(root.helpInformation()).not.toContain("sisyphus");
  });

  test("refuses clear without confirmation and leaves memory untouched", async () => {
    const root = createTempRoot();
    const now = "2026-05-06T01:02:03.004Z";
    const output: string[] = [];

    try {
      const path = getExecutionMemoryPath(root);
      mkdirSync(join(root, ".opencode-jce"), { recursive: true });
      writeFileSync(path, JSON.stringify({ ...createEmptyExecutionMemory(now), activeTasks: [{ id: "task-1" }] }), "utf-8");

      const command = createJceWorkerCommand({
        exitProcess: false,
        cwd: () => root,
        write: (text) => output.push(text),
        warn: (text) => output.push(text),
        info: (text) => output.push(text),
        success: (text) => output.push(text),
        fail: (text) => output.push(text),
      });

      await command.parseAsync(["clear"], { from: "user" });

      const saved = JSON.parse(readFileSync(path, "utf-8"));
      expect(output).toContain("This will clear JCE-Worker runtime memory for the current project.");
      expect(output).toContain("Run with --confirm to proceed: opencode-jce jce-worker clear --confirm");
      expect(saved.activeTasks).toEqual([{ id: "task-1" }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("clears runtime memory by backing up the existing file and writing empty memory", () => {
    const root = createTempRoot();
    const now = "2026-05-06T01:02:03.004Z";

    try {
      const path = getExecutionMemoryPath(root);
      mkdirSync(join(root, ".opencode-jce"), { recursive: true });
      writeFileSync(path, JSON.stringify({ ...createEmptyExecutionMemory(now), activeTasks: [{ id: "task-1" }] }), "utf-8");

      const result = clearJceWorkerRuntime(root, now);
      const saved = JSON.parse(readFileSync(path, "utf-8"));

      expect(result.path).toBe(path);
      expect(result.backupPath).toBe(`${path}.backup-${Date.parse(now)}`);
      expect(existsSync(result.backupPath!)).toBe(true);
      expect(readFileSync(result.backupPath!, "utf-8")).toContain("task-1");
      expect(saved.activeTasks).toEqual([]);
      expect(saved.updatedAt).toBe(now);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("clears runtime memory without a backup when no file exists", () => {
    const root = createTempRoot();
    const now = "2026-05-06T01:02:03.004Z";

    try {
      const path = getExecutionMemoryPath(root);

      const result = clearJceWorkerRuntime(root, now);
      const saved = JSON.parse(readFileSync(path, "utf-8"));

      expect(result).toEqual({ path });
      expect(saved.activeTasks).toEqual([]);
      expect(saved.updatedAt).toBe(now);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("normalizes invalid trace limits to the default", () => {
    expect(normalizeTraceLimit(undefined)).toBe(20);
    expect(normalizeTraceLimit("not-a-number")).toBe(20);
    expect(normalizeTraceLimit("0")).toBe(20);
    expect(normalizeTraceLimit("-3")).toBe(20);
    expect(normalizeTraceLimit("4.8")).toBe(4);
  });

  test("profile command shows default effective profile", async () => {
    const root = createTempRoot();
    const output: string[] = [];
    try {
      const command = createJceWorkerCommand({ exitProcess: false, cwd: () => root, write: (text) => output.push(text) });

      await command.parseAsync(["profile"], { from: "user" });

      expect(output.join("\n")).toContain("Effective policy profile: balanced (default)");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("profile command sets project default", async () => {
    const root = createTempRoot();
    const output: string[] = [];
    try {
      const command = createJceWorkerCommand({ exitProcess: false, cwd: () => root, success: (text) => output.push(text) });

      await command.parseAsync(["profile", "strict"], { from: "user" });

      expect(resolvePolicyProfile(root)).toEqual({ profile: "strict", source: "project" });
      expect(output).toContain("JCE-Worker project policy profile set to strict.");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("profile command sets and clears session override", async () => {
    const root = createTempRoot();
    const output: string[] = [];
    try {
      const command = createJceWorkerCommand({ exitProcess: false, cwd: () => root, success: (text) => output.push(text) });

      await command.parseAsync(["profile", "fast", "--session"], { from: "user" });
      expect(resolvePolicyProfile(root)).toEqual({ profile: "fast", source: "session" });

      await command.parseAsync(["profile", "--clear-session"], { from: "user" });
      expect(resolvePolicyProfile(root)).toEqual({ profile: "balanced", source: "default" });
      expect(output).toContain("JCE-Worker session policy profile cleared.");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("status command accepts per-command policy override", async () => {
    const root = createTempRoot();
    const output: string[] = [];
    try {
      const command = createJceWorkerCommand({ exitProcess: false, cwd: () => root, write: (text) => output.push(text) });

      await command.parseAsync(["status", "--profile", "fast"], { from: "user" });

      expect(output.join("\n")).toContain("Policy profile: fast (command)");
      expect(resolvePolicyProfile(root)).toEqual({ profile: "balanced", source: "default" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("report command accepts per-command policy override", async () => {
    const root = createTempRoot();
    const output: string[] = [];
    try {
      const command = createJceWorkerCommand({ exitProcess: false, cwd: () => root, write: (text) => output.push(text) });

      await command.parseAsync(["report", "--profile", "strict"], { from: "user" });

      expect(output.join("\n")).toContain("Policy profile: strict (command)");
      expect(resolvePolicyProfile(root)).toEqual({ profile: "balanced", source: "default" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("trace command accepts per-command policy override", async () => {
    const root = createTempRoot();
    const output: string[] = [];
    try {
      const command = createJceWorkerCommand({ exitProcess: false, cwd: () => root, write: (text) => output.push(text) });

      await command.parseAsync(["trace", "--profile", "fast"], { from: "user" });

      expect(output.join("\n")).toContain("Policy profile: fast (command)");
      expect(resolvePolicyProfile(root)).toEqual({ profile: "balanced", source: "default" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
