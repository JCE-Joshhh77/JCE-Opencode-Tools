import { existsSync, renameSync } from "fs";
import { Command } from "commander";
import {
  addFailureMemory,
  addRuntimeTaskLearning,
  addRuntimeWisdom,
  createFailureMemoryEntry,
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
import { formatJceWorkerReport, formatJceWorkerStatus, formatJceWorkerTrace, formatPlannerExplain, getPlannerRationaleSummary } from "../plugin/lib/jce-worker-report.js";
import { summarizeToolDiscipline } from "../plugin/lib/tool-discipline.js";
import { buildProjectBrain } from "../plugin/lib/project-brain.js";
import { formatEvalScenarios } from "../plugin/lib/phase3-eval.js";
import { checkSkillSync, formatSkillSync } from "../plugin/lib/skill-sync.js";
import { assessJceDoctor, buildPolicyEnforcementReport, getPolicyEnforcementReport } from "../plugin/lib/jce-intelligence.js";
import { buildFailureSignature } from "../plugin/lib/failure-signature.js";
import { error, info, success, warn } from "../lib/ui.js";
import { EXIT_ERROR, EXIT_SUCCESS } from "../types.js";
import { buildSafeCommitPlan } from "../plugin/lib/workflow-assistant.js";

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

function explainLast(memory: RuntimeState): string {
  const trace = memory.traceEvents.at(-1);
  const blocker = memory.blockers.at(-1) as any;
  return [
    "JCE-Worker Explain Last",
    `Last trace: ${trace ? `${trace.type} — ${trace.message}` : "none"}`,
    `Last blocker: ${blocker ? (blocker.failureReason ?? blocker.reason ?? blocker.id ?? "unknown") : "none"}`,
    `Latest verification: ${memory.verificationEvidence.at(-1) ? JSON.stringify(memory.verificationEvidence.at(-1)) : "none"}`,
    `Latest failure memory: ${memory.failureMemories.at(-1)?.summary ?? "none"}`,
  ].join("\n");
}

function whyBlocked(memory: RuntimeState): string {
  const blocker = memory.blockers.at(-1) as any;
  return [
    "JCE-Worker Why Blocked",
    blocker ? `Reason: ${blocker.failureReason ?? blocker.reason ?? blocker.id}` : "Reason: none",
  ].join("\n");
}

function whyAsked(memory: RuntimeState): string {
  const blocker = memory.blockers.at(-1) as any;
  return [
    "JCE-Worker Why Asked",
    blocker ? `Asked user because blocker remains: ${blocker.failureReason ?? blocker.reason ?? blocker.id}` : "Asked user reason: none recorded",
  ].join("\n");
}

function nextAction(memory: RuntimeState): string {
  const blocker = memory.blockers.at(-1) as any;
  if (blocker) return `JCE-Worker Next Action\nResolve blocker: ${blocker.failureReason ?? blocker.reason ?? blocker.id}`;
   if (memory.failureMemories.length > 0) return `JCE-Worker Next Action\nCheck known failure memory before retrying: ${memory.failureMemories.at(-1)?.summary ?? "unknown failure"}`;
  if (memory.activeTasks.length > 0) return "JCE-Worker Next Action\nContinue active task execution.";
  return "JCE-Worker Next Action\nRun verification or start next planned task.";
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
    .option("--json", "Print JSON")
    .action((opts: { profile?: string; json?: boolean }) => {
      const loaded = loadSessionState(cwd());
      const policy = resolvePolicyProfile(cwd(), parsePolicyProfile(opts.profile));
      if (opts.json) {
        write(JSON.stringify({
          runtime: loaded.state.runtime,
          policy,
          planner: getPlannerRationaleSummary(loaded.state.orchestration),
        }, null, 2));
        exitIfEnabled(options, EXIT_SUCCESS);
        return;
      }
      write(formatJceWorkerStatus(loaded.state.runtime, policy, loaded.state.orchestration));
      exitIfEnabled(options, EXIT_SUCCESS);
    });

  const traceCommand = new Command("trace")
    .description("Show recent JCE-Worker trace events")
    .option("--task <taskId>", "Filter trace events by task id")
    .option("--workflow <workflowId>", "Filter trace events by workflow id")
    .option("--limit <count>", "Maximum events to print", "20")
    .option("--profile <profile>", "Policy profile override for this command: strict, balanced, or fast")
    .option("--json", "Print JSON")
    .action((opts: { task?: string; workflow?: string; limit?: string; profile?: string; json?: boolean }) => {
      const loaded = loadSessionState(cwd());
      const policy = resolvePolicyProfile(cwd(), parsePolicyProfile(opts.profile));
      if (opts.json) {
        const events = (loaded.state.runtime.traceEvents ?? [])
          .filter((event) => !opts.task || event.taskId === opts.task)
          .filter((event) => !opts.workflow || ((event as any).metadata?.workflowId === opts.workflow))
          .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
          .slice(0, normalizeTraceLimit(opts.limit));
        write(JSON.stringify({ policy, planner: getPlannerRationaleSummary(loaded.state.orchestration), events }, null, 2));
        exitIfEnabled(options, EXIT_SUCCESS);
        return;
      }
      write(formatJceWorkerTrace(loaded.state.runtime, { taskId: opts.task, workflowId: opts.workflow, limit: normalizeTraceLimit(opts.limit) }, policy));
      exitIfEnabled(options, EXIT_SUCCESS);
    });

  const reportCommand = new Command("report")
    .description("Show detailed JCE-Worker operator report")
    .option("--profile <profile>", "Policy profile override for this command: strict, balanced, or fast")
    .option("--json", "Print JSON")
    .action((opts: { profile?: string; json?: boolean }) => {
      const loaded = loadSessionState(cwd());
      const policy = resolvePolicyProfile(cwd(), parsePolicyProfile(opts.profile));
      if (opts.json) {
        write(JSON.stringify({
          runtime: loaded.state.runtime,
          policy,
          planner: getPlannerRationaleSummary(loaded.state.orchestration),
          orchestration: loaded.state.orchestration,
        }, null, 2));
        exitIfEnabled(options, EXIT_SUCCESS);
        return;
      }
      write(formatJceWorkerReport(loaded.state.runtime, policy, loaded.state.orchestration));
      exitIfEnabled(options, EXIT_SUCCESS);
    });

  const plannerExplainCommand = new Command("planner-explain")
    .description("Explain planner fan-out vs linear fallback rationale")
    .option("--json", "Print JSON")
    .action((opts: { json?: boolean }) => {
      const loaded = loadSessionState(cwd());
      const planner = getPlannerRationaleSummary(loaded.state.orchestration);
      if (opts.json) {
        write(JSON.stringify(planner, null, 2));
        exitIfEnabled(options, EXIT_SUCCESS);
        return;
      }
      write(formatPlannerExplain(loaded.state.orchestration));
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
    .option("--policy", "Show policy-vs-enforcement audit summary")
    .option("--json", "Print JSON")
    .action((opts: { path?: string[]; skills?: boolean; policy?: boolean; json?: boolean }) => {
      const loaded = loadSessionState(cwd());
      const issues = summarizeToolDiscipline(opts.path ?? []);
      const jceDoctor = assessJceDoctor(cwd());
      const skillReport = opts.skills ? checkSkillSync(cwd()) : undefined;
      const policyReport = opts.policy ? getPolicyEnforcementReport() : undefined;
      if (opts.json) {
        write(JSON.stringify({
          runtime: {
            activeTasks: loaded.state.runtime.activeTasks.length,
            blockers: loaded.state.runtime.blockers.length,
            verificationEvidence: loaded.state.runtime.verificationEvidence.length,
            learnings: loaded.state.runtime.wisdom.length,
          },
          doctor: jceDoctor,
          toolDiscipline: issues,
          skills: skillReport,
          policy: policyReport,
        }, null, 2));
        exitIfEnabled(options, issues.some((issue) => issue.severity === "block") || jceDoctor.summary.fail > 0 ? EXIT_ERROR : EXIT_SUCCESS);
        return;
      }

      const skillOutput = skillReport ? `\n\n${formatSkillSync(skillReport)}` : "";
      const intelligenceOutput = ["", "JCE Intelligence Checks", ...jceDoctor.checks.map((check) => `- ${check.status.toUpperCase()}: ${check.name}: ${check.message}`)].join("\n");
      const policyOutput = policyReport ? `\n\n${buildPolicyEnforcementReport()}\n${policyReport.rows.map((row) => `  prompt: ${row.promptSource ?? "n/a"}\n  runtime: ${row.runtimeSource ?? "n/a"}`).join("\n")}` : "";
      write([formatDoctor(loaded.state.runtime), intelligenceOutput, issues.length ? "\nTool discipline issues:" : "\nTool discipline issues: none", ...issues.map((issue) => `- ${issue.severity.toUpperCase()}: ${issue.path}: ${issue.reason}`)].join("\n") + skillOutput + policyOutput);
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
    .option("--plan", "Print safe commit plan summary")
    .option("--json", "Print JSON")
    .action((paths: string[], opts: { plan?: boolean; json?: boolean }) => {
      const issues = summarizeToolDiscipline(paths);
      const safePlan = buildSafeCommitPlan(paths.map((path) => ({ path, status: "M" as const })), { includeDocs: false, release: false });
      if (opts.json) {
        write(JSON.stringify({ issues, safeCommitPlan: safePlan }, null, 2));
        exitIfEnabled(options, issues.some((issue) => issue.severity === "block") ? EXIT_ERROR : EXIT_SUCCESS);
        return;
      }
      const maybePlan = opts.plan ? `\n\nSafe Commit Plan\n${safePlan}` : "";
      write(["JCE-Worker Commit Check", ...issues.map((issue) => `${issue.severity.toUpperCase()}: ${issue.path}: ${issue.reason}`), issues.length ? "" : "No path issues detected."].join("\n") + maybePlan);
      exitIfEnabled(options, issues.some((issue) => issue.severity === "block") ? EXIT_ERROR : EXIT_SUCCESS);
    });

  const releaseCheckCommand = new Command("release-check")
    .description("Print release guard checklist")
    .action(() => {
      write(["JCE-Worker Release Check", "- version sync files reviewed", "- typecheck/test/audit evidence required", "- commit before push", "- tag after push", "- generated/context files excluded"].join("\n"));
      exitIfEnabled(options, EXIT_SUCCESS);
    });

  const preferencesCommand = new Command("preferences")
    .description("Show or set JCE-Worker operator preferences")
    .option("--autonomous <bool>", "prefer autonomous completion: true/false")
    .option("--ask-architecture <bool>", "ask before architecture changes: true/false")
    .option("--broad-verify <bool>", "prefer broad verification: true/false")
    .option("--terse <bool>", "prefer terse reports: true/false")
    .action((opts: { autonomous?: string; askArchitecture?: string; broadVerify?: string; terse?: string }) => {
      const loaded = loadSessionState(cwd());
      const current = loaded.state.runtime.autonomousExecutionSession;
      const currentPrefs = (loaded.state.orchestration as any).operatorPreferences ?? {};
      if (!opts.autonomous && !opts.askArchitecture && !opts.broadVerify && !opts.terse) {
        write(JSON.stringify({ autonomousExecutionSession: current ?? null, operatorPreferences: currentPrefs }, null, 2));
        exitIfEnabled(options, EXIT_SUCCESS);
        return;
      }
      loaded.state.runtime.autonomousExecutionSession = {
        continueUntilDone: opts.autonomous === "true" ? true : opts.autonomous === "false" ? false : current?.continueUntilDone ?? false,
        reason: "updated via preferences command",
        updatedAt: new Date().toISOString(),
      };
      (loaded.state.orchestration as any).operatorPreferences = {
        ...currentPrefs,
        askBeforeArchitectureChange: opts.askArchitecture === undefined ? currentPrefs.askBeforeArchitectureChange : opts.askArchitecture === "true",
        preferBroadVerification: opts.broadVerify === undefined ? currentPrefs.preferBroadVerification : opts.broadVerify === "true",
        preferTerseReports: opts.terse === undefined ? currentPrefs.preferTerseReports : opts.terse === "true",
      };
      saveSessionState(cwd(), loaded.state, undefined, { saveOrchestration: true });
      successOutput("JCE-Worker preferences updated.");
      exitIfEnabled(options, EXIT_SUCCESS);
    });

  const releaseCommanderCommand = new Command("release-commander")
    .description("Show release commander checklist and compatibility summary")
    .action(() => {
      write([
        "JCE-Worker Release Commander",
        "- version sync audit",
        "- changelog truth-check",
        "- previous tag delta",
        "- safe staging plan",
        "- verification strength",
        "- tag sanity",
        "- updater compatibility check",
        "- release notes generation",
      ].join("\n"));
      exitIfEnabled(options, EXIT_SUCCESS);
    });

  const explainLastCommand = new Command("explain-last")
    .description("Explain the latest JCE-Worker decision trail")
    .action(() => {
      write(explainLast(loadSessionState(cwd()).state.runtime));
      exitIfEnabled(options, EXIT_SUCCESS);
    });

  const whyBlockedCommand = new Command("why-blocked")
    .description("Show why JCE-Worker is blocked")
    .action(() => {
      write(whyBlocked(loadSessionState(cwd()).state.runtime));
      exitIfEnabled(options, EXIT_SUCCESS);
    });

  const whyAskedCommand = new Command("why-asked")
    .description("Show why JCE-Worker asked for user input")
    .action(() => {
      write(whyAsked(loadSessionState(cwd()).state.runtime));
      exitIfEnabled(options, EXIT_SUCCESS);
    });

  const nextActionCommand = new Command("next-action")
    .description("Show the best next JCE-Worker action")
    .action(() => {
      write(nextAction(loadSessionState(cwd()).state.runtime));
      exitIfEnabled(options, EXIT_SUCCESS);
    });

  const failureRememberCommand = new Command("failure-remember")
    .description("Store failure memory with automatic signature generation")
    .argument("<summary>", "Failure summary")
    .option("--command <command>", "Failing command")
    .option("--class <errorClass>", "Error class")
    .option("--file <file>", "Related file")
    .option("--root <phrase>", "Root phrase")
    .option("--stack <marker>", "Stack marker")
    .option("--cause <cause>", "Root cause note")
    .option("--fix <fix>", "Fix note")
    .action((summary: string, opts: { command?: string; class?: string; file?: string; root?: string; stack?: string; cause?: string; fix?: string }) => {
      const loaded = loadSessionState(cwd());
      const signature = buildFailureSignature({ command: opts.command, errorClass: opts.class, file: opts.file, rootPhrase: opts.root, stackMarker: opts.stack });
      const nextRuntime = addFailureMemory(loaded.state.runtime, createFailureMemoryEntry({
        signature,
        summary,
        rootCause: opts.cause,
        fixNote: opts.fix,
        failedCommands: opts.command ? [opts.command] : [],
      }));
      saveSessionState(cwd(), { runtime: nextRuntime, orchestration: loaded.state.orchestration }, undefined, { saveOrchestration: false });
      successOutput(`JCE-Worker failure memory saved: ${signature}`);
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
    .addCommand(plannerExplainCommand)
    .addCommand(profileCommand)
    .addCommand(preferencesCommand)
    .addCommand(clearCommand)
    .addCommand(doctorCommand)
    .addCommand(learnCommand)
    .addCommand(evalCommand)
    .addCommand(brainCommand)
    .addCommand(commitCheckCommand)
    .addCommand(releaseCheckCommand)
    .addCommand(releaseCommanderCommand)
    .addCommand(explainLastCommand)
    .addCommand(whyBlockedCommand)
    .addCommand(whyAskedCommand)
    .addCommand(nextActionCommand)
    .addCommand(failureRememberCommand)
    .addCommand(taskLearnCommand);
}

export const jceWorkerCommand = createJceWorkerCommand();
