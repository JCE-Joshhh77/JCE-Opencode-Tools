import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Command } from "commander";
import { clearJceWorkerRuntime, createJceWorkerCommand, normalizeTraceLimit, jceWorkerCommand } from "../../src/commands/jce-worker.ts";
import { createEmptyRuntimeState, getRuntimeStatePath } from "../../src/plugin/lib/runtime-state.ts";
import { resolvePolicyProfile } from "../../src/plugin/lib/policy-profile.ts";

function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "opencode-jce-jce-worker-command-"));
}

describe("JCE-Worker CLI command", () => {
  test("registers operator subcommands", () => {
    expect(jceWorkerCommand.name()).toBe("jce-worker");
    expect(jceWorkerCommand.commands.map((command) => command.name()).sort()).toEqual(["brain", "clear", "commit-check", "doctor", "eval", "explain-last", "failure-remember", "learn", "next-action", "planner-explain", "preferences", "profile", "release-check", "release-commander", "report", "status", "task-learn", "trace", "why-asked", "why-blocked"]);
  });

  test("shows operator subcommands in command help", () => {
    const help = createJceWorkerCommand({ exitProcess: false }).helpInformation();

    expect(help).toContain("status");
    expect(help).toContain("trace");
    expect(help).toContain("report");
    expect(help).toContain("clear");
    expect(help).toContain("doctor");
    expect(help).toContain("learn");
    expect(help).toContain("eval");
    expect(help).toContain("profile");
    expect(help).toContain("brain");
    expect(help).toContain("commit-check");
    expect(help).toContain("release-check");
    expect(help).toContain("release-commander");
    expect(help).toContain("explain-last");
    expect(help).toContain("why-blocked");
    expect(help).toContain("why-asked");
    expect(help).toContain("next-action");
    expect(help).toContain("planner-explain");
    expect(help).toContain("failure-remember");
    expect(help).toContain("task-learn");
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
      const path = getRuntimeStatePath(root);
      mkdirSync(join(root, ".opencode-jce"), { recursive: true });
      writeFileSync(path, JSON.stringify({ ...createEmptyRuntimeState(now), activeTasks: [{ id: "task-1" }] }), "utf-8");

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
      const path = getRuntimeStatePath(root);
      mkdirSync(join(root, ".opencode-jce"), { recursive: true });
      writeFileSync(path, JSON.stringify({ ...createEmptyRuntimeState(now), activeTasks: [{ id: "task-1" }] }), "utf-8");

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
      const path = getRuntimeStatePath(root);

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

  test("learn command stores durable wisdom", async () => {
    const root = createTempRoot();
    const output: string[] = [];
    try {
      const command = createJceWorkerCommand({ exitProcess: false, cwd: () => root, success: (text) => output.push(text) });

      await command.parseAsync(["learn", "Version must stay synced before tagging", "--source", "release", "--confidence", "high", "--tag", "release"], { from: "user" });

      const saved = JSON.parse(readFileSync(getRuntimeStatePath(root), "utf-8"));
      expect(output).toContain("JCE-Worker learning saved.");
      expect(saved.wisdom[0]).toMatchObject({ learning: "Version must stay synced before tagging", source: "release", confidence: "high", tags: ["release"] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("doctor reports runtime health and tool discipline warnings", async () => {
    const root = createTempRoot();
    const output: string[] = [];
    try {
      const command = createJceWorkerCommand({ exitProcess: false, cwd: () => root, write: (text) => output.push(text) });

      await command.parseAsync(["doctor", "--path", ".opencode-jce/jce-worker-execution.json", ".env"], { from: "user" });

      const text = output.join("\n");
      expect(text).toContain("JCE-Worker Doctor");
      expect(text).toContain("WARN: .opencode-jce/jce-worker-execution.json");
      expect(text).toContain("BLOCK: .env");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("doctor can print policy-vs-enforcement summary", async () => {
    const root = createTempRoot();
    const output: string[] = [];
    try {
      const command = createJceWorkerCommand({ exitProcess: false, cwd: () => root, write: (text) => output.push(text) });

      await command.parseAsync(["doctor", "--policy"], { from: "user" });

      const text = output.join("\n");
      expect(text).toContain("Policy vs Enforcement");
      expect(text).toContain("Skill count 1-2: prompt-only");
      expect(text).toContain("Main-agent verification: warning+gate");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("doctor can print policy report as JSON", async () => {
    const root = createTempRoot();
    const output: string[] = [];
    try {
      const command = createJceWorkerCommand({ exitProcess: false, cwd: () => root, write: (text) => output.push(text) });

      await command.parseAsync(["doctor", "--policy", "--json"], { from: "user" });

      const parsed = JSON.parse(output.join("\n"));
      expect(Array.isArray(parsed.policy.rows)).toBe(true);
      expect(parsed.policy.rows.some((row: any) => row.area === "Skill count 1-2" && row.level === "prompt-only")).toBe(true);
      expect(parsed.policy.rows.some((row: any) => row.area === "Main-agent verification" && row.level === "warning+gate")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("status and report can print planner-aware JSON", async () => {
    const root = createTempRoot();
    const output: string[] = [];
    const now = new Date().toISOString();
    try {
      const path = getRuntimeStatePath(root);
      mkdirSync(join(root, ".opencode-jce"), { recursive: true });
      writeFileSync(path, JSON.stringify(createEmptyRuntimeState(now)), "utf-8");
      const orchestrationPath = join(root, ".opencode-jce", "orchestration-state.json");
      writeFileSync(orchestrationPath, JSON.stringify({
        version: 2,
        updatedAt: now,
        facts: [], decisions: [], artifacts: [], evidence: [],
        memoryTiers: { session: {}, project: { conventions: [], releaseFiles: [], standardVerification: [], dangerousAreas: [] }, failure: { knownErrors: [], badFixes: [], successfulFixes: [] }, operator: { preferTerseReports: false, preferAutonomousCompletion: false, preferBroadVerification: true } },
        orchestration: { constraints: [], signals: [] },
        graph: {
          id: "graph-1",
          goal: "Implement login flow, settings page, and admin audit log",
          status: "executing",
          nodes: [
            { id: "n1", status: "ready", dependencies: [], evidence: [], createdAt: now, type: "plan", title: "Design", description: "Design", agent: "self", input: { prompt: "", context: [], constraints: [] }, retryPolicy: { maxRetries: 1, strategy: ["same"], currentRetry: 0 }, priority: 1, metadata: { plannerMode: "balanced", plannerReason: "Mixed trade-off profile", parallelization: "explicit-independent-units", parallelUnits: ["login flow", "settings page"] } },
          ],
          edges: [],
          createdAt: now,
          updatedAt: now
        }
      }), "utf-8");

      const command = createJceWorkerCommand({ exitProcess: false, cwd: () => root, write: (text) => output.push(text) });
      await command.parseAsync(["status", "--json"], { from: "user" });
      const statusJson = JSON.parse(output.pop()!);
      expect(statusJson.planner.fanOutTriggered).toBe(true);
      expect(statusJson.planner.detectedUnits).toContain("login flow");

      await command.parseAsync(["report", "--json"], { from: "user" });
      const reportJson = JSON.parse(output.pop()!);
      expect(reportJson.planner.plannerModes).toContain("balanced");
      expect(reportJson.planner.detectedUnits).toContain("settings page");

      await command.parseAsync(["planner-explain", "--json"], { from: "user" });
      const explainJson = JSON.parse(output.pop()!);
      expect(explainJson.fanOutTriggered).toBe(true);
      expect(explainJson.detectedUnits).toContain("login flow");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("eval command reports lightweight behavior checks", async () => {
    const root = createTempRoot();
    const output: string[] = [];
    try {
      const command = createJceWorkerCommand({ exitProcess: false, cwd: () => root, write: (text) => output.push(text) });

      await command.parseAsync(["eval"], { from: "user" });

      const text = output.join("\n");
      expect(text).toContain("JCE-Worker Eval");
      expect(text).toContain("PASS: runtime memory loads");
      expect(text).toContain("Score: 3/3");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("eval command can print formal scenario checklist", async () => {
    const root = createTempRoot();
    const output: string[] = [];
    try {
      const command = createJceWorkerCommand({ exitProcess: false, cwd: () => root, write: (text) => output.push(text) });

      await command.parseAsync(["eval", "--scenarios"], { from: "user" });

      expect(output.join("\n")).toContain("audit-full-plugin");
      expect(output.join("\n")).toContain("release-flow");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("brain command prints project intelligence", async () => {
    const root = createTempRoot();
    const output: string[] = [];
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.2.3", scripts: { test: "bun test" } }), "utf-8");
      const command = createJceWorkerCommand({ exitProcess: false, cwd: () => root, write: (text) => output.push(text) });

      await command.parseAsync(["brain"], { from: "user" });

      const text = output.join("\n");
      expect(text).toContain("JCE-Worker Project Brain");
      expect(text).toContain("Version: 1.2.3");
      expect(text).toContain("Recommended verification");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("commit-check blocks secrets and warns generated state", async () => {
    const root = createTempRoot();
    const output: string[] = [];
    try {
      const command = createJceWorkerCommand({ exitProcess: false, cwd: () => root, write: (text) => output.push(text) });

      await command.parseAsync(["commit-check", ".env", ".opencode-jce/jce-worker-execution.json"], { from: "user" });

      const text = output.join("\n");
      expect(text).toContain("BLOCK: .env");
      expect(text).toContain("WARN: .opencode-jce/jce-worker-execution.json");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("commit-check can print safe commit plan summary", async () => {
    const root = createTempRoot();
    const output: string[] = [];
    try {
      const command = createJceWorkerCommand({ exitProcess: false, cwd: () => root, write: (text) => output.push(text) });

      await command.parseAsync(["commit-check", "src/commands/jce-worker.ts", "README.md", "--plan"], { from: "user" });

      const text = output.join("\n");
      expect(text).toContain("Safe Commit Plan");
      expect(text).toContain("Safe To Stage");
      expect(text).toContain("src/commands/jce-worker.ts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("commit-check can print JSON", async () => {
    const root = createTempRoot();
    const output: string[] = [];
    try {
      const command = createJceWorkerCommand({ exitProcess: false, cwd: () => root, write: (text) => output.push(text) });

      await command.parseAsync(["commit-check", "src/commands/jce-worker.ts", "--json"], { from: "user" });

      const parsed = JSON.parse(output.join("\n"));
      expect(Array.isArray(parsed.issues)).toBe(true);
      expect(typeof parsed.safeCommitPlan).toBe("string");
      expect(parsed.safeCommitPlan).toContain("Safe To Stage");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("task-learn stores structured task recipe", async () => {
    const root = createTempRoot();
    const output: string[] = [];
    try {
      const command = createJceWorkerCommand({ exitProcess: false, cwd: () => root, success: (text) => output.push(text) });

      await command.parseAsync(["task-learn", "release request", "--type", "release", "--recipe", "sync version", "--verify", "bun test", "--area", "installers"], { from: "user" });

      const saved = JSON.parse(readFileSync(getRuntimeStatePath(root), "utf-8"));
      expect(output).toContain("JCE-Worker task learning saved.");
      expect(saved.taskLearnings[0]).toMatchObject({ taskType: "release", trigger: "release request", successfulRecipe: ["sync version"], verificationCommands: ["bun test"], touchedAreas: ["installers"] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("failure-remember stores automatic failure signature", async () => {
    const root = createTempRoot();
    const output: string[] = [];
    try {
      const command = createJceWorkerCommand({ exitProcess: false, cwd: () => root, success: (text) => output.push(text) });

      await command.parseAsync(["failure-remember", "Updater mismatch", "--command", "opencode-jce update", "--class", "IntegrityError", "--file", "src/commands/update.ts", "--root", "annotated tag mismatch", "--fix", "use peeled tag"], { from: "user" });

      const saved = JSON.parse(readFileSync(getRuntimeStatePath(root), "utf-8"));
      expect(output.join("\n")).toContain("failure memory saved");
      expect(saved.failureMemories[0].signature).toContain("opencode.jce.update");
      expect(saved.failureMemories[0].fixNote).toBe("use peeled tag");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("release commander and explain commands print orchestration explainability", async () => {
    const root = createTempRoot();
    const output: string[] = [];
    try {
      const path = getRuntimeStatePath(root);
      mkdirSync(join(root, ".opencode-jce"), { recursive: true });
      writeFileSync(path, JSON.stringify({
        ...createEmptyRuntimeState("2026-05-06T00:00:00.000Z"),
        blockers: [{ failureReason: "Need approval" }],
        traceEvents: [{ type: "task.created", message: "planned release", at: "2026-05-06T00:00:00.000Z" }],
      }), "utf-8");

      const command = createJceWorkerCommand({ exitProcess: false, cwd: () => root, write: (text) => output.push(text) });
      await command.parseAsync(["release-commander"], { from: "user" });
      await command.parseAsync(["explain-last"], { from: "user" });
      await command.parseAsync(["why-blocked"], { from: "user" });
      await command.parseAsync(["why-asked"], { from: "user" });
      await command.parseAsync(["next-action"], { from: "user" });

      const text = output.join("\n");
      expect(text).toContain("JCE-Worker Release Commander");
      expect(text).toContain("JCE-Worker Explain Last");
      expect(text).toContain("Latest failure memory");
      expect(text).toContain("JCE-Worker Why Blocked");
      expect(text).toContain("JCE-Worker Why Asked");
      expect(text).toContain("JCE-Worker Next Action");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
