import { existsSync, renameSync } from "fs";
import { Command } from "commander";
import { createEmptyExecutionMemory, getExecutionMemoryPath, loadExecutionMemory, saveExecutionMemory } from "../plugin/lib/execution-memory.js";
import { clearSessionPolicyProfile, isPolicyProfile, resolvePolicyProfile, saveProjectPolicyProfile, saveSessionPolicyProfile } from "../plugin/lib/policy-profile.js";
import type { PolicyProfile } from "../plugin/lib/verification-gate.js";
import { formatJceWorkerReport, formatJceWorkerStatus, formatJceWorkerTrace } from "../plugin/lib/jce-worker-report.js";
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
  const path = getExecutionMemoryPath(projectRoot);
  let backupPath: string | undefined;

  if (existsSync(path)) {
    backupPath = `${path}.backup-${Date.parse(now)}`;
    renameSync(path, backupPath);
  }

  saveExecutionMemory(projectRoot, createEmptyExecutionMemory(now), now);
  return backupPath ? { path, backupPath } : { path };
}

function parsePolicyProfile(value: unknown): PolicyProfile | undefined {
  return isPolicyProfile(value) ? value : undefined;
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
      const loaded = loadExecutionMemory(cwd());
      const policy = resolvePolicyProfile(cwd(), parsePolicyProfile(opts.profile));
      write(formatJceWorkerStatus(loaded.memory, policy));
      exitIfEnabled(options, EXIT_SUCCESS);
    });

  const traceCommand = new Command("trace")
    .description("Show recent JCE-Worker trace events")
    .option("--task <taskId>", "Filter trace events by task id")
    .option("--workflow <workflowId>", "Filter trace events by workflow id")
    .option("--limit <count>", "Maximum events to print", "20")
    .option("--profile <profile>", "Policy profile override for this command: strict, balanced, or fast")
    .action((opts: { task?: string; workflow?: string; limit?: string; profile?: string }) => {
      const loaded = loadExecutionMemory(cwd());
      const policy = resolvePolicyProfile(cwd(), parsePolicyProfile(opts.profile));
      write(formatJceWorkerTrace(loaded.memory, { taskId: opts.task, workflowId: opts.workflow, limit: normalizeTraceLimit(opts.limit) }, policy));
      exitIfEnabled(options, EXIT_SUCCESS);
    });

  const reportCommand = new Command("report")
    .description("Show detailed JCE-Worker operator report")
    .option("--profile <profile>", "Policy profile override for this command: strict, balanced, or fast")
    .action((opts: { profile?: string }) => {
      const loaded = loadExecutionMemory(cwd());
      const policy = resolvePolicyProfile(cwd(), parsePolicyProfile(opts.profile));
      write(formatJceWorkerReport(loaded.memory, policy));
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

  return new Command("jce-worker")
    .description("Inspect and manage JCE-Worker workflow runtime")
    .addCommand(statusCommand)
    .addCommand(traceCommand)
    .addCommand(reportCommand)
    .addCommand(profileCommand)
    .addCommand(clearCommand);
}

export const jceWorkerCommand = createJceWorkerCommand();
