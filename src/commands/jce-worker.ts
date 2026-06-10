import { existsSync, renameSync } from "fs";
import { Command } from "commander";
import {
  addRuntimeTaskLearning,
  addRuntimeWisdom,
  createEmptyRuntimeState,
  createRuntimeTaskLearning,
  createRuntimeWisdomEntry,
  getRuntimeStatePath,
  loadSessionState,
  saveSessionState,
  type RuntimeState,
} from "../plugin/lib/session-store.js";
import { clearSessionPolicyProfile, isPolicyProfile, resolvePolicyProfile, saveProjectPolicyProfile, saveSessionPolicyProfile } from "../plugin/lib/policy-profile.js";
import type { PolicyProfile } from "../plugin/lib/verification-gate.js";
import { formatJceWorkerReport, formatJceWorkerStatus, formatJceWorkerTrace } from "../plugin/lib/jce-worker-report.js";
import { summarizeToolDiscipline } from "../plugin/lib/tool-discipline.js";
import { buildProjectBrain } from "../plugin/lib/project-brain.js";
import { formatEvalScenarios } from "../plugin/lib/phase3-eval.js";
import { checkSkillSync, formatSkillSync } from "../plugin/lib/skill-sync.js";
import { assessJceDoctor } from "../plugin/lib/jce-intelligence.js";
import { error, info, success, warn } from "../lib/ui.js";
import { EXIT_ERROR, EXIT_SUCCESS } from "../types.js";

interface CreateJceWorkerCommandOptions {
  exitProcess?: boolean;
  cwd?: () => string;
  write?: (text: string) => void;
  warn?: (text: string) => void;
  info?: (text: string) => void;
  success?: (text: string) => void;
  fail?: (text: string) => void;
}

function exitIfEnabled(options: CreateJceWorkerCommandOptions, code: number): void {
  if (options.exitProcess !== false) process.exit(code);
}

export function normalizeTraceLimit(value: string | undefined): number {
  if (value === undefined) return 20;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 20;
  return Math.trunc(parsed);
}

export function clearJceWorkerRuntime(projectRoot: string, now = new Date().toISOString()): { path: string; backupPath?: string } {
  const path = getRuntimeStatePath(projectRoot);
  let backupPath: string | undefined;

  if (existsSync(path)) {
    backupPath = `${path}.backup-${Date.parse(now)}`;
    renameSync(path, backupPath);
  }

  saveSessionState(projectRoot, {
    runtime: createEmptyRuntimeState(now),
    orchestration: loadSessionState(projectRoot, now).state.orchestration,
  }, now, { saveOrchestration: false });
  return backupPath ? { path, backupPath } : { path };
}

function parsePolicyProfile(value: unknown): PolicyProfile | undefined {
  return isPolicyProfile(value) ? value : undefined;
}

function formatDoctor(memory: RuntimeState): string {
  const lines = ["JCE-Worker Doctor", "================="];
  lines.push(`Active tasks: ${memory.activeTasks.length}`);
  lines.push(`Blockers: ${memory.blockers.length}`);
  lines.push(`Verification evidence: ${memory.verificationEvidence.length}`);
  lines.push(`Learnings: ${memory.wisdom.length}`);
  if (memory.blockers.length > 0 && memory.activeTasks.length === 0) lines.push("Warning: stale blockers exist without active tasks; consider clear --confirm.");
  if (memory.wisdom.length === 0) lines.push("Suggestion: add durable learnings with jce-worker learn.");
  return lines.join("\n");
}

function formatEval(memory: RuntimeState): string {
  const checks = [
    { name: "runtime memory loads", passed: memory.version === 1 },
    { name: "wisdom store available", passed: Array.isArray(memory.wisdom) },
    { name: "no stale blocker-only state", passed: !(memory.blockers.length > 0 && memory.activeTasks.length === 0) },
  ];
  const passed = checks.filter((check) => check.passed).length;
  return ["JCE-Worker Eval", "===============", ...checks.map((check) => `${check.passed ? "PASS" : "FAIL"}: ${check.name}`), `Score: ${passed}/${checks.length}`].join("\n");
}

export function createJceWorkerCommand(options: CreateJceWorkerCommandOptions = {}): Command {
  const cwd = options.cwd ?? (() => process.cwd());
  const write = options.write ?? ((text: string) => console.log(text));
  const warnOutput = options.warn ?? warn;
  const infoOutput = options.info ?? info;
  const successOutput = options.success ?? success;
  const failOutput = options.fail ?? error;

  const statusCommand = new Command("status")
    .description("Show current JCE-Worker workflow status")
    .option("--profile <profile>", "Policy profile override for this command: strict, balanced, or fast")
    .action((opts: { profile?: string }) => {
      const loaded = loadSessionState(cwd());
      const policy = resolvePolicyProfile(cwd(), parsePolicyProfile(opts.profile));
      write(formatJceWorkerStatus(loaded.state.runtime, policy));
      exitIfEnabled(options, EXIT_SUCCESS);
    });

  const traceCommand = new Command("trace")
    .description("Show recent JCE-Worker trace events")
    .option("--task <taskId>", "Filter trace events by task id")
    .option("--workflow <workflowId>", "Filter trace events by workflow id")
    .option("--limit <count>", "Maximum events to print", "20")
    .option("--profile <profile>", "Policy profile override for this command: strict, balanced, or fast")
    .action((opts: { task?: string; workflow?: string; limit?: string; profile?: string }) => {
      const loaded = loadSessionState(cwd());
      const policy = resolvePolicyProfile(cwd(), parsePolicyProfile(opts.profile));
      write(formatJceWorkerTrace(loaded.state.runtime, { taskId: opts.task, workflowId: opts.workflow, limit: normalizeTraceLimit(opts.limit) }, policy));
      exitIfEnabled(options, EXIT_SUCCESS);
    });

  const reportCommand = new Command("report")
    .description("Show detailed JCE-Worker operator report")
    .option("--profile <profile>", "Policy profile override for this command: strict, balanced, or fast")
    .action((opts: { profile?: string }) => {
      const loaded = loadSessionState(cwd());
      const policy = resolvePolicyProfile(cwd(), parsePolicyProfile(opts.profile));
      write(formatJceWorkerReport(loaded.state.runtime, policy));
      exitIfEnabled(options, EXIT_SUCCESS);
    });

  const profileCommand = new Command("profile")
    .description("Show or set JCE-Worker policy profile")
    .argument("[profile]", "Policy profile: strict, balanced, or fast")
    .option("--session", "Set session override instead of project default")
    .option("--clear-session", "Clear the session policy override")
    .action((profile: string | undefined, opts: { session?: boolean; clearSession?: boolean }) => {
      if (opts.clearSession) {
        clearSessionPolicyProfile(cwd());
        successOutput("JCE-Worker session policy profile cleared.");
        exitIfEnabled(options, EXIT_SUCCESS);
        return;
      }

      if (!profile) {
        const resolved = resolvePolicyProfile(cwd());
        write(`Effective policy profile: ${resolved.profile} (${resolved.source})`);
        exitIfEnabled(options, EXIT_SUCCESS);
        return;
      }

      if (!isPolicyProfile(profile)) {
        failOutput(`Invalid JCE-Worker policy profile: ${profile}. Expected strict, balanced, or fast.`);
        exitIfEnabled(options, EXIT_ERROR);
        return;
      }

      if (opts.session) {
        saveSessionPolicyProfile(cwd(), profile);
        successOutput(`JCE-Worker session policy profile set to ${profile}.`);
      } else {
        saveProjectPolicyProfile(cwd(), profile);
        successOutput(`JCE-Worker project policy profile set to ${profile}.`);
      }
      exitIfEnabled(options, EXIT_SUCCESS);
    });

  const clearCommand = new Command("clear")
    .description("Back up and clear JCE-Worker runtime memory")
    .option("--confirm", "Skip confirmation")
    .action((opts: { confirm?: boolean }) => {
      if (!opts.confirm) {
        warnOutput("This will clear JCE-Worker runtime memory for the current project.");
        warnOutput("Run with --confirm to proceed: opencode-jce jce-worker clear --confirm");
        exitIfEnabled(options, EXIT_ERROR);
        return;
      }

      try {
        const { backupPath } = clearJceWorkerRuntime(cwd());
        successOutput("JCE-Worker runtime memory cleared.");
        if (backupPath) infoOutput(`Backup saved: ${backupPath}`);
        exitIfEnabled(options, EXIT_SUCCESS);
      } catch (err) {
        failOutput(`Failed to clear JCE-Worker runtime memory: ${err instanceof Error ? err.message : String(err)}`);
        exitIfEnabled(options, EXIT_ERROR);
      }
    });

  const doctorCommand = new Command("doctor")
    .description("Diagnose JCE-Worker runtime health and tool discipline")
    .option("--path <path...>", "Check paths for commit/tool-discipline issues")
    .option("--skills", "Check repo skills against user config skills")
    .action((opts: { path?: string[]; skills?: boolean }) => {
      const loaded = loadSessionState(cwd());
      const issues = summarizeToolDiscipline(opts.path ?? []);
      const skillOutput = opts.skills ? `\n\n${formatSkillSync(checkSkillSync(cwd()))}` : "";
      const jceDoctor = assessJceDoctor(cwd());
      const intelligenceOutput = ["", "JCE Intelligence Checks", ...jceDoctor.checks.map((check) => `- ${check.status.toUpperCase()}: ${check.name}: ${check.message}`)].join("\n");
      write([formatDoctor(loaded.state.runtime), intelligenceOutput, issues.length ? "\nTool discipline issues:" : "\nTool discipline issues: none", ...issues.map((issue) => `- ${issue.severity.toUpperCase()}: ${issue.path}: ${issue.reason}`)].join("\n") + skillOutput);
      exitIfEnabled(options, issues.some((issue) => issue.severity === "block") || jceDoctor.summary.fail > 0 ? EXIT_ERROR : EXIT_SUCCESS);
    });

  const learnCommand = new Command("learn")
    .description("Add a durable JCE-Worker learning to runtime memory")
    .argument("<learning>", "One-line learning or fix recipe")
    .option("--source <source>", "Source: task, delegation, debug, review, release, tooling", "task")
    .option("--confidence <confidence>", "Confidence: low, medium, high", "medium")
    .option("--tag <tag...>", "Learning tag")
    .action((learning: string, opts: { source?: string; confidence?: string; tag?: string[] }) => {
      const source = ["task", "delegation", "debug", "review", "release", "tooling"].includes(opts.source ?? "") ? opts.source as Parameters<typeof createRuntimeWisdomEntry>[0]["source"] : "task";
      const confidence = ["low", "medium", "high"].includes(opts.confidence ?? "") ? opts.confidence as Parameters<typeof createRuntimeWisdomEntry>[0]["confidence"] : "medium";
      const loaded = loadSessionState(cwd());
      const nextRuntime = addRuntimeWisdom(loaded.state.runtime, createRuntimeWisdomEntry({ learning, source, confidence, tags: opts.tag ?? [] }));
      saveSessionState(cwd(), { runtime: nextRuntime, orchestration: loaded.state.orchestration }, undefined, { saveOrchestration: false });
      successOutput("JCE-Worker learning saved.");
      exitIfEnabled(options, EXIT_SUCCESS);
    });

  const evalCommand = new Command("eval")
    .description("Run lightweight JCE-Worker behavioral health checks")
    .option("--scenarios", "Run formal scenario checklist evals")
    .action((opts: { scenarios?: boolean }) => {
      if (opts.scenarios) {
        write(formatEvalScenarios());
        exitIfEnabled(options, EXIT_SUCCESS);
        return;
      }
      const loaded = loadSessionState(cwd());
      const output = formatEval(loaded.state.runtime);
      write(output);
      exitIfEnabled(options, output.includes("FAIL") ? EXIT_ERROR : EXIT_SUCCESS);
    });

  const brainCommand = new Command("brain")
    .description("Show project intelligence summary for JCE-Worker")
    .action(() => {
      write(buildProjectBrain(cwd(), loadSessionState(cwd()).state.runtime));
      exitIfEnabled(options, EXIT_SUCCESS);
    });

  const commitCheckCommand = new Command("commit-check")
    .description("Check paths for safe commit discipline")
    .argument("[paths...]", "Paths intended for staging/commit")
    .action((paths: string[]) => {
      const issues = summarizeToolDiscipline(paths);
      write(["JCE-Worker Commit Check", ...issues.map((issue) => `${issue.severity.toUpperCase()}: ${issue.path}: ${issue.reason}`), issues.length ? "" : "No path issues detected."].join("\n"));
      exitIfEnabled(options, issues.some((issue) => issue.severity === "block") ? EXIT_ERROR : EXIT_SUCCESS);
    });

  const releaseCheckCommand = new Command("release-check")
    .description("Print release guard checklist")
    .action(() => {
      write(["JCE-Worker Release Check", "- version sync files reviewed", "- typecheck/test/audit evidence required", "- commit before push", "- tag after push", "- generated/context files excluded"].join("\n"));
      exitIfEnabled(options, EXIT_SUCCESS);
    });

  const taskLearnCommand = new Command("task-learn")
    .description("Store a structured task recipe")
    .argument("<trigger>", "Trigger phrase")
    .option("--type <type>", "audit, bugfix, feature, release, review, unknown", "unknown")
    .option("--recipe <step...>", "Successful recipe step")
    .option("--verify <command...>", "Verification command")
    .option("--area <area...>", "Touched area")
    .action((trigger: string, opts: { type?: string; recipe?: string[]; verify?: string[]; area?: string[] }) => {
      const taskType = ["audit", "bugfix", "feature", "release", "review", "unknown"].includes(opts.type ?? "") ? opts.type as Parameters<typeof createRuntimeTaskLearning>[0]["taskType"] : "unknown";
      const loaded = loadSessionState(cwd());
      const nextRuntime = addRuntimeTaskLearning(loaded.state.runtime, createRuntimeTaskLearning({ taskType, trigger, successfulRecipe: opts.recipe ?? [], verificationCommands: opts.verify ?? [], touchedAreas: opts.area ?? [] }));
      saveSessionState(cwd(), { runtime: nextRuntime, orchestration: loaded.state.orchestration }, undefined, { saveOrchestration: false });
      successOutput("JCE-Worker task learning saved.");
      exitIfEnabled(options, EXIT_SUCCESS);
    });

  return new Command("jce-worker")
    .description("Inspect and manage JCE-Worker workflow runtime")
    .addCommand(statusCommand)
    .addCommand(traceCommand)
    .addCommand(reportCommand)
    .addCommand(profileCommand)
    .addCommand(clearCommand)
    .addCommand(doctorCommand)
    .addCommand(learnCommand)
    .addCommand(evalCommand)
    .addCommand(brainCommand)
    .addCommand(commitCheckCommand)
    .addCommand(releaseCheckCommand)
    .addCommand(taskLearnCommand);
}

export const jceWorkerCommand = createJceWorkerCommand();
