import type { Plugin, Hooks } from "@opencode-ai/plugin";
import { existsSync, writeFileSync, appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { BackgroundManager } from "./background/manager.js";
import { extractPromptText } from "./background/spawner.js";
import { buildDispatchTool, buildStatusTool, buildCollectTool } from "./tools/dispatch.js";
import { buildAgentConfigs } from "./config.js";
import { analyzeCommentDensity, COMMENT_WARNING } from "./hooks/comment-checker.js";
import { looksLikeCompletionClaim, looksLikeStopEarlyOrConfirmation, shouldWarnForMissingVerification, VERIFICATION_WARNING } from "./hooks/jce-worker-guard.js";
import { shouldEnforceContinuation, detectPrematureStop, CONTINUATION_PROMPT } from "./hooks/todo-enforcer.js";
import { evaluateSelfCritique } from "./lib/self-critique.js";
import { evaluateOpenWork, extractTodoState, type TodoState } from "./hooks/open-work-enforcer.js";
import { loadSessionState, mergeRuntimeStateSnapshot, saveSessionState } from "./lib/session-store.js";
import type { RuntimeState } from "./lib/session-store.js";
import { buildChineseTranslationPrompt, filterChineseOutput, type ChineseTranslator } from "./lib/chinese-output-filter.js";
import { CONTEXT_FILENAME, getContextTemplate } from "../lib/context-template.js";
import { evaluateExecutionPolicy, formatExecutionPolicyDecision } from "./lib/execution-policy.js";
import type { ExecutionPolicyDecision } from "./lib/execution-policy.js";
import { evaluateFinalReviewGate } from "./lib/final-review-gate.js";
import { resolvePolicyProfile } from "./lib/policy-profile.js";
import { applyWorkflowIntentRoute } from "./lib/workflow.js";
import type { WorkflowIntentRouteSource } from "./lib/workflow.js";
import { buildWorkflowTool } from "./tools/workflow.js";
import { buildAndroidLogcatTool } from "./tools/android-logcat.js";
import { createWorkflowRun } from "./lib/workflow.js";
import { isRecord } from "./lib/shared-predicates.js";
import { determineSkillsForMessage, explainSkillRouting, parseSkillCorrection, applySkillCorrection, applySkillHistoryAdjustments, applySubAgentTelemetryQuality, resolveSkills, type SkillCorrection } from "./lib/skill-loader.js";
import { applyContextBudget } from "./lib/context-budget.js";
import { POST_COMPACTION_NO_TASK_GUARD, shouldSuppressCompactionAutocontinue } from "./lib/compaction-loop-guard.js";
import { resolveContextLimit, extractTokensUsed, computeUsage, crossedThreshold, buildCompactionPreservation, formatUsage, DEFAULT_COMPACTION_THRESHOLD } from "./lib/context-window-monitor.js";
import { scoreIntent, toLegacyRoute } from "./lib/orchestration/intent-router.js";
import { OrchestrationController } from "./lib/orchestration/controller.js";
import { OrchestrationBridge } from "./lib/orchestration/bridge.js";
import { shouldDropPersistedWorkflow } from "./lib/orchestration/staleness.js";
import { extractProjectFacts } from "./lib/orchestration/fact-extraction.js";
import { detectWorkstreams } from "./lib/orchestration/workstream-detector.js";
import { decideAutoActivation } from "./lib/auto-activation.js";
import { extractChangedFilesFromTool } from "./lib/changed-files.js";
import { buildPreFinalGuard } from "./lib/pre-final-guard.js";
import { appendEvidence, appendTelemetry, loadTelemetry, summarizeCommandEvidence, summarizeRoutingQuality } from "./lib/jce-intelligence.js";
import {
  withErrorBoundary,
  withAsyncErrorBoundary,
  cancelPlan,
  createRateLimiter,
  detectTimedOutNodes,
  evaluateApprovalGate,
  formatApprovalGate,
  detectFileConflicts,
  formatConflictWarnings,
  createTokenBudgetTracker,
  createOrchestrationLogger,
  runHealthCheck,
  formatHealthCheck,
} from "./lib/orchestration/reliability.js";

function delegatedReviewStrings(memory: RuntimeState): string[] {
  return [...memory.completedSummaries, ...memory.verificationEvidence]
    .filter(isRecord)
    .map((entry) => {
      const status = typeof entry.reviewStatus === "string" ? entry.reviewStatus : "unknown";
      const notes = Array.isArray(entry.reviewNotes) ? entry.reviewNotes.filter((note): note is string => typeof note === "string").join("; ") : "";
      const summary = typeof entry.verificationSummary === "string" ? entry.verificationSummary : "";
      return `status=${status}${notes ? `; ${notes}` : ""}${summary ? `; ${summary}` : ""}`;
    });
}

function hasDelegatedWork(memory: RuntimeState): boolean {
  return [...memory.completedSummaries, ...memory.verificationEvidence].some((entry) => isRecord(entry) && typeof entry.reviewStatus === "string" && entry.reviewStatus !== "not_applicable");
}

function isJceWorkerAgentHint(value: string): value is "oracle" | "jce-researcher" | "explorer" | "frontend" | "android" {
  return value === "oracle" || value === "jce-researcher" || value === "explorer" || value === "frontend" || value === "android";
}

function extractTranslationText(result: unknown): string | undefined {
  const text = extractPromptText(result);
  return text === "Task completed" ? undefined : text;
}

function buildChineseTranslator(client: any): ChineseTranslator | undefined {
  if (!client?.session?.create) return undefined;
  return async (text: string) => {
    const session = await client.session.create({});
    if (!session?.id) throw new Error("Translation session returned no id");
    const prompt = text.includes("<<<CHINESE_OUTPUT_TO_TRANSLATE>>>") ? text : buildChineseTranslationPrompt(text);
    const promptRequest = { path: { id: session.id }, body: { agent: "jce-worker", parts: [{ type: "text" as const, text: prompt }] } };
    const result = typeof client.session.prompt === "function"
      ? await client.session.prompt(promptRequest)
      : typeof client.session.promptAsync === "function"
        ? await client.session.promptAsync(promptRequest)
        : typeof client.session.chat === "function"
          ? await client.session.chat({ params: { id: session.id }, body: { content: prompt, agent: "jce-worker" } })
          : await Promise.reject(new Error("No supported session prompt method found: expected session.prompt, session.promptAsync, or session.chat"));
    const translated = extractTranslationText(result);
    if (!translated) throw new Error("Translation returned no text");
    return translated;
  };
}

// NOTE: the `tool` argument to these helpers MUST already be normalized to
// lowercase via normalizeToolName(). Normalization happens once at the hook
// boundary (tool.execute.after) so tool-name casing can never drift again (L1).
function shouldTranslateToolOutput(tool: string): boolean {
  return tool === "task" || tool === "bg_collect" || tool === "jce_workflow";
}

const COMPLETION_INSPECTION_TOOLS = new Set(["task", "jce_workflow"]);

function shouldInspectCompletionOutput(tool: string): boolean {
  return COMPLETION_INSPECTION_TOOLS.has(tool);
}

function shouldApplyDirectContextBudget(tool: string): boolean {
  return ["read", "grep", "glob", "ls", "bash"].includes(tool);
}

/** Single source of truth for tool-name normalization. */
function normalizeToolName(tool: unknown): string {
  return typeof tool === "string" ? tool.toLowerCase() : "";
}

function ensureProjectContextFile(projectRoot: string): boolean {
  const contextPath = join(projectRoot, CONTEXT_FILENAME);
  if (existsSync(contextPath)) return false;
  writeFileSync(contextPath, getContextTemplate(), "utf-8");
  return true;
}

/**
 * Extract facts from tool outputs into orchestration shared memory.
 * Delegates to the precision-tuned extractor (execution-output only) to avoid
 * false positives from file contents that merely mention tool names.
 */
function extractFactsFromToolOutput(orchestrator: OrchestrationController, tool: string, output: string): void {
  for (const fact of extractProjectFacts(tool, output)) {
    orchestrator.addFact(fact.key, fact.value, fact.source, fact.confidence);
  }
}

const jcePlugin: Plugin = async (input) => {
  const { client } = input;
  const chineseTranslator = buildChineseTranslator(client);
  const manager = new BackgroundManager({ maxConcurrency: 5 });
  const agents = buildAgentConfigs();
  const projectRoot = input.directory || input.worktree || process.cwd();
  let projectContextEnsured = false;
  const loadedMemory = loadSessionState(projectRoot);
  let currentMemory = loadedMemory.state.runtime;
  // Drop a stale/terminal persisted activeWorkflow at load using the SAME
  // staleness authority the v2 graph uses (C1/C2 root cause: month-old workflow
  // with no active tasks resurrecting and forcing bogus gates). The active-task
  // gate preserves genuinely in-progress runtime sessions.
  if (currentMemory.activeWorkflow && shouldDropPersistedWorkflow(
    {
      status: currentMemory.activeWorkflow.status,
      updatedAt: currentMemory.activeWorkflow.updatedAt,
      hasActiveTasks: currentMemory.activeTasks.length > 0,
    },
    Date.now(),
  )) {
    currentMemory = { ...currentMemory, activeWorkflow: undefined };
  }
  let lastUserMessage = "";
  let workflowRuntimeActive = currentMemory.activeTasks.length > 0;
  let lastTodoState: TodoState | undefined;
  // Auto-compaction context tracking. cachedContextLimit is captured from the
  // model in chat.params/system.transform (the `event` hook has no model).
  let cachedContextLimit = 0;
  let lastUsagePercent = 0;
  let sessionSkillCorrection: SkillCorrection | null = currentMemory.skillCorrectionSession
    ? {
        forbid: currentMemory.skillCorrectionSession.forbidSkills,
        prefer: currentMemory.skillCorrectionSession.preferSkills,
        agent: currentMemory.skillCorrectionSession.agentOverride,
        reason: "restored from session memory",
      }
    : null;
  const CONTINUE_UNTIL_DONE_PATTERN = /\b(kerjakan sampai selesai|jangan berhenti sebelum selesai|lanjut(?:kan)? sampai selesai|finish (?:it )?(?:fully|completely)?|continue until done|handle everything|do not stop until done|work until complete)\b/i;
  const isContinueUntilDoneMode = () => currentMemory.autonomousExecutionSession?.continueUntilDone === true;

  // Initialize orchestration controller (v2 system — runs alongside BackgroundManager)
  const orchestrator = new OrchestrationController({ projectRoot });
  const orchestrationLogger = createOrchestrationLogger();
  const rateLimiter = createRateLimiter();
  const tokenBudget = createTokenBudgetTracker();
  const bridge = new OrchestrationBridge({
    manager,
    client,
    orchestrator,
    chineseTranslator,
    onPersist: () => persistCurrentMemory(),
  });

  if (currentMemory.activeTasks.length === 0 && currentMemory.blockers.length > 0) {
    currentMemory = saveSessionState(projectRoot, {
      runtime: {
        ...currentMemory,
        blockers: [],
      },
      orchestration: loadedMemory.state.orchestration,
    }, undefined, { runtime: { preserveWorkflowRuntime: false }, saveOrchestration: false }).runtime;
  }

  const refreshSkillRoutingBias = () => {
    withErrorBoundary(() => {
      const events = loadTelemetry(projectRoot);
      const quality = summarizeRoutingQuality(events);
      const history: Record<string, number> = {};
      for (const item of quality.usefulSkills) history[item.skill] = Math.min(15, Math.round(item.score / 2));
      for (const item of quality.noisySkills) history[item.skill] = (history[item.skill] ?? 0) - Math.min(20, item.score * 2);
      const bias: Record<string, number> = {};
      if (sessionSkillCorrection) {
        for (const skill of sessionSkillCorrection.prefer) bias[skill] = 30;
        for (const skill of sessionSkillCorrection.forbid) bias[skill] = -60;
      }
      applySkillHistoryAdjustments(history, bias);
      applySubAgentTelemetryQuality(quality);
    }, undefined, orchestrationLogger);
  };
  refreshSkillRoutingBias();

  const saveRuntimeOnly = (runtime: RuntimeState, preserveWorkflowRuntime = true) => {
    currentMemory = saveSessionState(projectRoot, {
      runtime,
      orchestration: loadedMemory.state.orchestration,
    }, undefined, {
      runtime: { preserveWorkflowRuntime },
      saveOrchestration: false,
    }).runtime;
    return currentMemory;
  };

  const persistCurrentMemory = () => {
    withErrorBoundary(() => {
      saveRuntimeOnly(mergeRuntimeStateSnapshot(currentMemory, manager.toRuntimeState(), { preserveWorkflowRuntime: true }));
    }, undefined, orchestrationLogger);
    withErrorBoundary(() => orchestrator.persist(), undefined, orchestrationLogger);
    return currentMemory;
  };

  const recordDirectContextBudget = (tool: string, originalText: string, compressedText: string, budget: ReturnType<typeof applyContextBudget>) => {
    if (!budget.changed && budget.estimatedTokensSaved === 0) return;
    const safe = (value: number) => !Number.isFinite(value) || value <= 0 ? 0 : Math.min(Math.trunc(value), Number.MAX_SAFE_INTEGER);
    const previous = currentMemory.contextBudgetSummary;
    const originalChars = safe((previous?.originalChars ?? 0) + safe(budget.originalChars));
    const compressedChars = safe((previous?.compressedChars ?? 0) + safe(budget.compressedChars));
    currentMemory.contextBudgetSummary = {
      originalChars,
      compressedChars,
      estimatedTokensSaved: safe((previous?.estimatedTokensSaved ?? 0) + safe(budget.estimatedTokensSaved)),
      estimatedSavingsPercent: originalChars === 0 ? 0 : Math.max(0, Math.round((1 - compressedChars / originalChars) * 100)),
      tasks: safe((previous?.tasks ?? 0) + 1),
      byTool: {
        ...(previous?.byTool ?? {}),
        [tool]: {
          originalChars: safe((previous?.byTool?.[tool]?.originalChars ?? 0) + safe(budget.originalChars)),
          compressedChars: safe((previous?.byTool?.[tool]?.compressedChars ?? 0) + safe(budget.compressedChars)),
          estimatedTokensSaved: safe((previous?.byTool?.[tool]?.estimatedTokensSaved ?? 0) + safe(budget.estimatedTokensSaved)),
          tasks: safe((previous?.byTool?.[tool]?.tasks ?? 0) + 1),
        },
      },
    };
    currentMemory.traceEvents = [
      ...(currentMemory.traceEvents ?? []),
      {
        type: "verification.recorded",
        message: `Context budget applied to ${tool} output`,
        at: new Date().toISOString(),
        metadata: {
          tool,
          originalChars: originalText.length,
          compressedChars: compressedText.length,
          estimatedTokensSaved: budget.estimatedTokensSaved,
        },
      },
    ];
    withErrorBoundary(() => {
      saveRuntimeOnly(currentMemory, false);
    }, undefined, orchestrationLogger);
  };

  const routeJceWorkerIntent = (text: string) => {
    const scored = scoreIntent(text);
    const legacy = toLegacyRoute(scored);
    return legacy as unknown as { intent: any; skills: string[]; reason: string; agentHint?: any };
  };

  const currentPolicyProfile = () => resolvePolicyProfile(projectRoot).profile;

  const evaluateRouteUpdatePolicy = (source: WorkflowIntentRouteSource, nextRoute: ReturnType<typeof routeJceWorkerIntent>): ExecutionPolicyDecision => {
    const routeWithSource = { ...nextRoute, source };
    return evaluateExecutionPolicy({
      action: "route_update",
      profile: currentPolicyProfile(),
      route: currentMemory.activeWorkflow?.route,
      nextRoute: routeWithSource,
      workflow: currentMemory.activeWorkflow,
      delegatedReviews: delegatedReviewStrings(currentMemory),
    });
  };

  const ensureActiveWorkflow = (text: string, source: WorkflowIntentRouteSource, goalSeed?: string) => {
    if (currentMemory.activeWorkflow || !text.trim()) return;
    // Seed the workflow goal AND route from the real user message when
    // available, never from tool output / injected skill content / gate text (C2).
    const seed = (goalSeed ?? lastUserMessage ?? "").trim();
    const route = routeJceWorkerIntent(seed || text);
    const goal = (seed || "JCE worker session").slice(0, 240);
    currentMemory.activeWorkflow = applyWorkflowIntentRoute(
      createWorkflowRun({ id: `workflow-${Date.now()}`, goal }),
      { ...route, source },
    );
    workflowRuntimeActive = true;
    withErrorBoundary(() => {
      saveRuntimeOnly(currentMemory);
    }, undefined, orchestrationLogger);
  };

  const shouldApplyRoute = (source: WorkflowIntentRouteSource, nextRoute: ReturnType<typeof routeJceWorkerIntent>): boolean => {
    if (!currentMemory.activeWorkflow) return false;
    const policy = evaluateRouteUpdatePolicy(source, nextRoute);
    if (policy.status === "block") return false;
    if (nextRoute.intent !== "general") return true;
    // Completion claims always apply route (even if intent is general)
    if (source === "completion") return true;
    return !currentMemory.activeWorkflow.route;
  };

  const applyRuntimeRoute = (text: string, source: WorkflowIntentRouteSource) => {
    if (!currentMemory.activeWorkflow || !text.trim()) return;
    const route = routeJceWorkerIntent(text);
    if (!shouldApplyRoute(source, route)) return;
    currentMemory.activeWorkflow = applyWorkflowIntentRoute(currentMemory.activeWorkflow, { ...route, source });
    workflowRuntimeActive = true;
    withErrorBoundary(() => {
      saveRuntimeOnly(currentMemory);
    }, undefined, orchestrationLogger);
  };

  const hooks: Hooks = {
    config: async (config) => {
      if (!config.agent) (config as any).agent = {};
      for (const [id, agentConfig] of Object.entries(agents)) {
        if (!(config as any).agent[id]) {
          (config as any).agent[id] = agentConfig;
        }
      }
    },

    event: async ({ event }) => {
      if (event?.type === "session.idle" || event?.type === "message.updated") {
        manager.markStaleTasks(30 * 60 * 1000);
        persistCurrentMemory();
        // Periodic timeout detection and health check
        withErrorBoundary(() => {
          const graph = orchestrator.getGraph();
          if (graph) {
            const timedOut = detectTimedOutNodes(graph);
            for (const node of timedOut) {
              orchestrator.handleFailure(node.id, `Node timed out`);
              orchestrationLogger.log("warn", "node.timeout.periodic", `Periodic check: node ${node.id} timed out`);
            }
          }
        }, undefined, orchestrationLogger);
      }

      // Auto-compaction monitor: on each assistant message update, compute how
      // full the context window is. When usage first crosses the threshold
      // (default 83%), write a durable checkpoint so workflow state survives the
      // upcoming native compaction. Fires once per upward crossing.
      if (event?.type === "message.updated") {
        // Smoke-test diagnostic (opt-in via OPENCODE_JCE_DEBUG_CONTEXT=1).
        // Captures EVERY assistant message.updated token observation — including
        // empty/early fires — to a JSONL file so a real session can definitively
        // answer: does info.tokens.input populate in the live event, and when?
        if (process.env.OPENCODE_JCE_DEBUG_CONTEXT === "1") {
          withErrorBoundary(() => {
            const info = (event as any)?.properties?.info;
            if (!info || info.role !== "assistant") return;
            const t = info.tokens ?? {};
            const record = {
              at: new Date().toISOString(),
              role: info.role,
              completed: typeof info.time?.completed === "number",
              input: typeof t.input === "number" ? t.input : null,
              output: typeof t.output === "number" ? t.output : null,
              cacheRead: typeof t.cache?.read === "number" ? t.cache.read : null,
              tokensUsed: extractTokensUsed(info),
              cachedContextLimit,
            };
            const dir = join(projectRoot, ".opencode-jce");
            mkdirSync(dir, { recursive: true });
            appendFileSync(join(dir, "context-debug.jsonl"), JSON.stringify(record) + "\n", "utf-8");
          }, undefined, orchestrationLogger);
        }

        withErrorBoundary(() => {
          const info = (event as any)?.properties?.info;
          if (!info || info.role !== "assistant") return;
          const tokensUsed = extractTokensUsed(info);
          if (tokensUsed <= 0) return;
          const usage = computeUsage(tokensUsed, cachedContextLimit || undefined);
          const crossed = crossedThreshold(lastUsagePercent, usage.usagePercent, DEFAULT_COMPACTION_THRESHOLD);
          lastUsagePercent = usage.usagePercent;
          if (!crossed) return;
          // Durable checkpoint: persist runtime + orchestration so a compaction
          // (native or otherwise) cannot lose goal/files/blockers/verification.
          persistCurrentMemory();
          orchestrationLogger.log("warn", "context.autocompaction.checkpoint",
            `${formatUsage(usage)} — crossed ${Math.round(DEFAULT_COMPACTION_THRESHOLD * 100)}% threshold; durable checkpoint written.`);
          // Visible signal: surface a TUI toast so the user can SEE that
          // auto-compaction fired (otherwise the feature works invisibly).
          // Fire-and-forget + guarded — must never break the event hook.
          withErrorBoundary(() => {
            const pct = Math.round(usage.usagePercent * 100);
            void (client as any)?.tui?.showToast?.({
              body: {
                title: "JCE Auto-Compaction",
                message: `Context ${pct}% full — durable checkpoint written; state will be preserved across compaction.`,
                variant: "warning",
                duration: 6000,
              },
            }).catch?.(() => {});
          }, undefined, orchestrationLogger);
          withErrorBoundary(() => {
            appendTelemetry(projectRoot, { kind: "context_autocompaction", name: "checkpoint", metadata: { usagePercent: usage.usagePercent, tokensUsed: usage.tokensUsed, contextLimit: usage.contextLimit, knownLimit: usage.knownLimit } });
          }, undefined, orchestrationLogger);
        }, undefined, orchestrationLogger);
      }
    },

    tool: {
      dispatch: buildDispatchTool(manager, client, (text, route, agent) => {
        if (!currentMemory.activeWorkflow || !text.trim()) return;
        const routeWithSource = { ...route, source: "task" as const };
        const policy = evaluateExecutionPolicy({
          action: "dispatch",
          profile: currentPolicyProfile(),
          route: currentMemory.activeWorkflow.route,
          nextRoute: routeWithSource,
          workflow: currentMemory.activeWorkflow,
          dispatchAgent: isJceWorkerAgentHint(agent) ? agent : undefined,
        });
        if (policy.status === "block") return { status: "block", message: formatExecutionPolicyDecision(policy) };
        if (shouldApplyRoute("task", route)) {
          currentMemory.activeWorkflow = applyWorkflowIntentRoute(currentMemory.activeWorkflow, routeWithSource);
          workflowRuntimeActive = true;
          withErrorBoundary(() => {
            saveRuntimeOnly(currentMemory);
          }, undefined, orchestrationLogger);
        }
        if (policy.status === "warn") return { status: "warn", message: formatExecutionPolicyDecision(policy) };
      }, (agent, _text) => {
        const correction = sessionSkillCorrection ?? undefined;
        if (!correction?.agent) return undefined;
        if (!isJceWorkerAgentHint(correction.agent)) return undefined;
        if (correction.agent === agent) return undefined;
        return { agent: correction.agent, reason: correction.reason ?? "user correction" };
      }),
      bg_status: buildStatusTool(manager, () => {
        const statusReport = withErrorBoundary(() => orchestrator.formatStatusReport(), "", orchestrationLogger);
        const health = withErrorBoundary(() => {
          const result = runHealthCheck(orchestrator.getGraph(), orchestrationLogger, rateLimiter, tokenBudget);
          return result.healthy ? "" : `\n${formatHealthCheck(result)}`;
        }, "", orchestrationLogger);
        return `${statusReport}${health}`;
      }),
      bg_collect: buildCollectTool(manager, client, () => {
        persistCurrentMemory();
        // After collecting, check if orchestration loop should continue
        if (bridge.hasActivePlan()) {
          const tasks = manager.listTasks();
          const lastCompleted = tasks.filter((t) => t.status === "completed").pop();
          if (lastCompleted?.result) {
              // Feed result through orchestration bridge; failures persist as blockers for closed-loop gating.
              bridge.collectAndContinue(lastCompleted.id, lastCompleted.result, lastCompleted.parentSessionId ?? "", lastCompleted.parentMessageId ?? "").catch((err) => {
                withErrorBoundary(() => {
                  currentMemory.blockers = [...currentMemory.blockers, { id: `orchestration-${Date.now()}`, failureReason: err instanceof Error ? err.message : String(err) }];
                  saveRuntimeOnly(currentMemory);
                }, undefined, orchestrationLogger);
              });
          }
        }
      }, chineseTranslator),
      jce_workflow: buildWorkflowTool(),
      android_logcat: buildAndroidLogcatTool(),
    },

    "chat.message": async (_input, output) => {
      if (!projectContextEnsured) {
        withErrorBoundary(() => ensureProjectContextFile(projectRoot), false, orchestrationLogger);
        projectContextEnsured = true;
      }

      // Track the latest user message for skill injection
      const msg = output.message;
      const text = typeof msg === "string" ? msg : output.parts?.filter((p: any) => p.type === "text").map((p: any) => p.text).join(" ") || "";
      if (typeof text === "string" && text.trim()) {
        lastUserMessage = text;
        const correction = parseSkillCorrection(text);
        if (correction) {
          sessionSkillCorrection = correction;
          currentMemory.skillCorrectionSession = {
            forbidSkills: correction.forbid,
            preferSkills: correction.prefer,
            agentOverride: correction.agent,
            updatedAt: new Date().toISOString(),
          };
          withErrorBoundary(() => {
            currentMemory = saveSessionState(projectRoot, {
              runtime: currentMemory,
              orchestration: loadedMemory.state.orchestration,
            }, undefined, { runtime: { preserveWorkflowRuntime: true }, saveOrchestration: false }).runtime;
          }, undefined, orchestrationLogger);
          refreshSkillRoutingBias();
          withErrorBoundary(() => {
            for (const skill of correction.forbid) appendTelemetry(projectRoot, { kind: "user_correction", name: skill, metadata: { skill, action: "forbid", reason: correction.reason, agent: correction.agent } });
            for (const skill of correction.prefer) appendTelemetry(projectRoot, { kind: "user_correction", name: skill, metadata: { skill, action: "prefer", reason: correction.reason, agent: correction.agent } });
            if (correction.agent) appendTelemetry(projectRoot, { kind: "user_correction", name: correction.agent, metadata: { agent: correction.agent, action: "agent_override", reason: correction.reason } });
          }, undefined, orchestrationLogger);
        }
        if (CONTINUE_UNTIL_DONE_PATTERN.test(text)) {
          currentMemory.autonomousExecutionSession = {
            continueUntilDone: true,
            reason: text.trim().slice(0, 200),
            updatedAt: new Date().toISOString(),
          };
          withErrorBoundary(() => {
            currentMemory = saveSessionState(projectRoot, {
              runtime: currentMemory,
              orchestration: loadedMemory.state.orchestration,
            }, undefined, { runtime: { preserveWorkflowRuntime: true }, saveOrchestration: false }).runtime;
          }, undefined, orchestrationLogger);
        }
        withErrorBoundary(() => {
          const routing = explainSkillRouting(text);
          appendTelemetry(projectRoot, {
            kind: "routing_decision",
            name: routing.intent,
            metadata: {
              intent: routing.intent,
              selectedSkills: routing.selected.map((item) => item.skill),
              suppressedSkills: routing.rejected.map((item) => item.skill),
              confidence: routing.confidence,
            },
          });
          for (const skill of routing.selected.map((item) => item.skill)) {
            appendTelemetry(projectRoot, { kind: "skill_selected", name: skill, metadata: { skill, intent: routing.intent } });
          }
        }, undefined, orchestrationLogger);

        const appendPlannerTelemetry = (mode: "fanout" | "linear-fallback", detectedUnits: string[], fallbackReason?: string) => {
          withErrorBoundary(() => appendTelemetry(projectRoot, {
            kind: "routing_decision",
            name: "planner",
            metadata: {
              plannerMode: mode,
              detectedUnits,
              fallbackReason,
            },
          }), undefined, orchestrationLogger);
        };

        // Route intent through orchestration controller (v2) — with error boundary
        withErrorBoundary(() => orchestrator.routeIntent(text), undefined, orchestrationLogger);

        // Extract user constraints
        const constraintMatch = text.match(/\b(don'?t|must not|never|do not|cannot)\s+(.{5,80})/i);
        if (constraintMatch) {
          withErrorBoundary(() => orchestrator.addConstraint(constraintMatch[0].trim(), "user"), undefined, orchestrationLogger);
        }

        // Plan cancellation: detect "cancel", "stop", "abort" commands
        if (/\b(cancel|stop|abort)\s*(the\s*)?(plan|orchestration|execution)\b/i.test(text) && bridge.hasActivePlan()) {
          const graph = orchestrator.getGraph();
          if (graph) {
            const { result } = cancelPlan(graph, "User requested cancellation");
            orchestrationLogger.log("info", "plan.cancelled", `Plan cancelled: ${result.nodesAffected} nodes affected`);
          }
        }

        const isNoTaskTurn = shouldSuppressCompactionAutocontinue({ lastUserMessage: text });
        const autoActivation = decideAutoActivation(text);
        withErrorBoundary(() => appendTelemetry(projectRoot, {
          kind: "routing_decision",
          name: "auto_activation",
          metadata: { activate: autoActivation.activate, confidence: autoActivation.confidence, reason: autoActivation.reason, signals: autoActivation.signals },
        }), undefined, orchestrationLogger);

        // Auto-activation with rate limiting, approval gate, and error boundary.
        // Greetings/no-op turns must not create plans; they can otherwise become
        // self-perpetuating Build/Compaction loops when OpenCode compacts a full context.
        if (!isNoTaskTurn
          && autoActivation.activate
          && withErrorBoundary(() => orchestrator.shouldAutoActivate(text), false, orchestrationLogger)
          && rateLimiter.canActivate()) {

          const goal = text.trim().slice(0, 300);
          const graph = withErrorBoundary(() => orchestrator.createPlan(goal), null, orchestrationLogger);

          if (graph) {
            const plannerNode = Array.from(graph.nodes.values()).find((node) => node.metadata?.parallelization === "explicit-independent-units" || node.metadata?.parallelization === "linear-fallback");
            const plannerMode = plannerNode?.metadata?.parallelization === "explicit-independent-units" ? "fanout" : "linear-fallback";
            const detectedUnits = Array.isArray(plannerNode?.metadata?.parallelUnits) ? plannerNode.metadata.parallelUnits : [];
            const fallbackReason = typeof plannerNode?.metadata?.parallelFallbackReason === "string" ? plannerNode.metadata.parallelFallbackReason : undefined;
            currentMemory.traceEvents = [...(currentMemory.traceEvents ?? []), {
              type: "planner.explain" as const,
              message: plannerMode === "fanout"
                ? `Planner fan-out created ${detectedUnits.length} explicit unit(s).`
                : `Planner kept linear plan.${fallbackReason ? ` ${fallbackReason}` : ""}`,
              at: new Date().toISOString(),
              metadata: {
                workflowId: graph.id,
                plannerMode,
                detectedUnits,
                fallbackReason,
              },
            }].slice(-200);
            appendPlannerTelemetry(plannerMode, detectedUnits, fallbackReason);
            currentMemory = saveSessionState(projectRoot, {
              runtime: currentMemory,
              orchestration: loadedMemory.state.orchestration,
            }, undefined, { runtime: { preserveWorkflowRuntime: true }, saveOrchestration: false }).runtime;
            // Check approval gate
            const complexity = orchestrator.assessComplexity(text);
            const approval = evaluateApprovalGate(graph, complexity.score);

            if (approval.requiresApproval) {
              // Don't auto-dispatch — inject approval request into next output
              orchestrationLogger.log("info", "plan.approval_required", `Plan requires approval: ${approval.reason}`);
            } else {
              // Safe to auto-dispatch
              rateLimiter.recordActivation();
              // Multi-workstream: if the message explicitly describes several
              // independent workstreams, drive them as concurrent graphs under
              // one shared budget. Otherwise use the single-graph loop.
              const workstreams = withErrorBoundary(() => detectWorkstreams(text), { isMulti: false, workstreams: [], reason: "detector error" }, orchestrationLogger);
              if (workstreams.isMulti && workstreams.workstreams.length >= 2) {
                orchestrationLogger.log("info", "plan.auto_activated.concurrent", `Auto-activated ${workstreams.workstreams.length} concurrent workstream(s): ${workstreams.reason}`);
                withErrorBoundary(() => appendTelemetry(projectRoot, { kind: "routing_decision", name: "concurrent_workstreams", metadata: { count: workstreams.workstreams.length, reason: workstreams.reason } }), undefined, orchestrationLogger);
                await withAsyncErrorBoundary(() => bridge.planAndDispatchConcurrent(workstreams.workstreams, "", ""), { dispatched: [], graphStatus: "failed", message: "Concurrent auto-dispatch failed" }, orchestrationLogger);
              } else {
                orchestrationLogger.log("info", "plan.auto_activated", `Auto-activated plan: ${goal.slice(0, 80)}`);
                await withAsyncErrorBoundary(() => bridge.planAndDispatch(goal, "", ""), { dispatched: [], graphStatus: "failed", message: "Auto-dispatch failed" }, orchestrationLogger);
              }
            }
          }
        }
      }
    },

    "experimental.chat.system.transform": async (_input, output) => {
      // Capture the model's context limit here (the `event` hook has no model).
      // Used by the auto-compaction monitor to compute usage %.
      withErrorBoundary(() => {
        const modelLimit = (_input as any)?.model?.limit?.context;
        const resolved = resolveContextLimit(modelLimit);
        if (resolved.known) cachedContextLimit = resolved.limit;
      }, undefined, orchestrationLogger);
      output.system.push(POST_COMPACTION_NO_TASK_GUARD);
      const preFinalGuard = buildPreFinalGuard(currentMemory);
      if (preFinalGuard) output.system.push(preFinalGuard);
      if (!lastUserMessage) return;
      const skillNames = applySkillCorrection(determineSkillsForMessage(lastUserMessage), sessionSkillCorrection);
      if (skillNames.length === 0) return;
      const skillContents = await resolveSkills(skillNames);
      if (skillContents.length > 0) {
        withErrorBoundary(() => {
          for (const skill of skillNames) appendTelemetry(projectRoot, { kind: "skill_final_used", name: skill, metadata: { skill, source: "system_injection" } });
        }, undefined, orchestrationLogger);
        output.system.push("\n\n<!-- JCE Skills (auto-injected based on task context) -->\n" + skillContents.join("\n\n"));
      }
    },

    "experimental.compaction.autocontinue": async (input: any, output: any) => {
      const summary = typeof input?.summary === "string" ? input.summary : typeof output?.summary === "string" ? output.summary : "";
      const message = typeof input?.message === "string" ? input.message : typeof output?.message === "string" ? output.message : "";
      if (!shouldSuppressCompactionAutocontinue({ lastUserMessage, summary, message })) return;

      if (typeof output === "object" && output !== null) {
        output.enabled = false;
        output.autocontinue = false;
        output.continue = false;
        output.reason = "JCE no-task compaction guard: idle greeting/awaiting-task summary must not auto-continue.";
      }
    },

    // Enrich the native compaction prompt so the summary never drops critical
    // JCE-Worker state (goal, touched files, open blockers, verification status).
    // We append to output.context rather than replacing output.prompt — we ride
    // OpenCode's tested compaction, only ensuring durable facts survive it.
    "experimental.session.compacting": async (_input: any, output: any) => {
      withErrorBoundary(() => {
        if (!output || typeof output !== "object" || !Array.isArray(output.context)) return;
        const toStrings = (items: unknown[] | undefined): string[] =>
          (items ?? []).map((i) => typeof i === "string" ? i : (i as any)?.message ?? (i as any)?.description ?? "").filter((s: string) => s && s.trim());
        const preservation = buildCompactionPreservation({
          goal: currentMemory.activeWorkflow?.goal,
          changedFiles: currentMemory.changedFiles,
          blockers: toStrings(currentMemory.blockers),
          verification: toStrings(currentMemory.verificationEvidence),
        });
        if (preservation) {
          output.context.push(preservation);
          orchestrationLogger.log("info", "context.autocompaction.enrich", "Injected JCE state preservation into compaction prompt.");
        }
      }, undefined, orchestrationLogger);
    },

    // #3: Gate the FINAL assistant text — the real surface where a "done" claim
    // is asserted (tool-output gating in tool.execute.after misses plain final
    // answers). The OpenCode SDK exposes no pre-generation cancel hook, so this
    // post-text hook is the earliest correct point to flag an unverified
    // completion claim. It only appends a warning (cannot block generation).
    "experimental.text.complete": async (_input, output) => {
      if (!output || typeof output.text !== "string" || !output.text.trim()) return;
      const text = output.text;
      if (text.includes("VERIFICATION CHECK") || text.includes("FINAL REVIEW GATE")) return;
      withErrorBoundary(() => {
        const activeWorkflow = currentMemory.activeWorkflow;
        if (!activeWorkflow || !workflowRuntimeActive) return;

        const missingVerification = shouldWarnForMissingVerification(text);
        const executionPolicy = looksLikeCompletionClaim(text)
          ? evaluateExecutionPolicy({
            action: "completion_claim",
            profile: currentPolicyProfile(),
            route: activeWorkflow.route,
            workflow: activeWorkflow,
            activeBlockers: currentMemory.blockers,
            retryHistory: currentMemory.retryHistory,
          })
          : undefined;

        const finalGate = looksLikeCompletionClaim(text)
          ? evaluateFinalReviewGate(activeWorkflow, {
            profile: currentPolicyProfile(),
            changedFiles: currentMemory.changedFiles,
            delegatedReviews: delegatedReviewStrings(currentMemory),
            residualRisks: [],
            activeBlockers: currentMemory.blockers,
            retryHistory: currentMemory.retryHistory,
            delegatedWorkRequired: hasDelegatedWork(currentMemory),
            policyReasons: executionPolicy?.status === "block" ? executionPolicy.reasons : [],
          })
          : undefined;

        const reasons = finalGate?.status === "block" ? finalGate.reasons : [];
        if (reasons.length > 0) {
          const policyText = executionPolicy?.status === "block" ? `${formatExecutionPolicyDecision(executionPolicy)}\n\n` : "";
          output.text = `${text}\n\n${policyText}FINAL REVIEW GATE: Completion is blocked.\n${Array.from(new Set(reasons)).map((reason) => `- ${reason}`).join("\n")}`;
          return;
        }

        if (missingVerification) {
          output.text = `${text}${VERIFICATION_WARNING}`;
        }
      }, undefined, orchestrationLogger);
    },


    "tool.execute.after": async (input, output) => {
      // Normalize tool name ONCE here; all downstream checks use `toolName`.
      // Runtime passes lowercase names (e.g. "read", "bash"); never compare
      // against capitalized literals downstream (root cause of L1).
      const toolName = normalizeToolName(input.tool);
      const hadActiveWorkflow = Boolean(currentMemory.activeWorkflow);
      const hadWorkflowRuntimeActive = workflowRuntimeActive;

      // Extract facts from tool outputs into orchestration memory (with error boundary)
      if (typeof output.output === "string" && output.output.length > 0) {
        withErrorBoundary(() => extractFactsFromToolOutput(orchestrator, toolName, output.output as string), undefined, orchestrationLogger);
      }

      // Record direct tool evidence in orchestration graph (e.g., bun test run directly)
      if (typeof output.output === "string" && toolName === "bash") {
        withErrorBoundary(() => orchestrator.recordDirectToolEvidence(toolName, output.output as string), undefined, orchestrationLogger);
        const command = typeof input.args?.command === "string" ? input.args.command : typeof input.args?.cmd === "string" ? input.args.cmd : "Bash";
        const evidence = summarizeCommandEvidence(command, output.output as string);
        if (evidence) {
          withErrorBoundary(() => {
            appendEvidence(projectRoot, { ...evidence, workflowId: currentMemory.activeWorkflow?.id });
            const primarySkill = applySkillCorrection(determineSkillsForMessage(lastUserMessage), sessionSkillCorrection)[0] ?? "unknown";
            appendTelemetry(projectRoot, { kind: "verification_used", name: evidence.command ?? command, metadata: { command: evidence.command ?? command, status: evidence.status } });
            appendTelemetry(projectRoot, { kind: "verification_result", name: evidence.command ?? command, metadata: { skill: primarySkill, passed: evidence.status === "pass", command: evidence.command ?? command } });
            currentMemory.verificationEvidence = [...currentMemory.verificationEvidence, { ...evidence, captured: "auto", workflowId: currentMemory.activeWorkflow?.id }].slice(-100);
            currentMemory.traceEvents = [...(currentMemory.traceEvents ?? []), { type: "verification.recorded", message: evidence.summary, at: new Date().toISOString(), metadata: { command } }];
            currentMemory = saveSessionState(projectRoot, {
              runtime: currentMemory,
              orchestration: loadedMemory.state.orchestration,
            }, undefined, { runtime: { preserveWorkflowRuntime: true }, saveOrchestration: false }).runtime;

          }, undefined, orchestrationLogger);
        }
      }

      // Per-node timeout detection (check on every tool output)
      if (bridge.hasActivePlan()) {
        withErrorBoundary(() => {
          const graph = orchestrator.getGraph();
          if (graph) {
            const timedOut = detectTimedOutNodes(graph);
            for (const node of timedOut) {
              orchestrator.handleFailure(node.id, `Node timed out after ${node.startedAt ? Math.round((Date.now() - Date.parse(node.startedAt)) / 1000) : "?"}s`);
              orchestrationLogger.log("warn", "node.timeout", `Node ${node.id} timed out`, { nodeId: node.id, title: node.title });
            }
            // Conflict detection
            const conflicts = detectFileConflicts(graph);
            if (conflicts.length > 0 && typeof output.output === "string") {
              output.output = `${output.output}${formatConflictWarnings(conflicts)}`;
              orchestrationLogger.log("warn", "file.conflict", `${conflicts.length} file conflict(s) detected`);
            }
          }
        }, undefined, orchestrationLogger);
      }

      const changedFilesFromTool = extractChangedFilesFromTool(toolName, input.args, output.output);
      if (changedFilesFromTool.length > 0) {
        withErrorBoundary(() => {
          const next = Array.from(new Set([...(currentMemory.changedFiles ?? []), ...changedFilesFromTool]));
          if (next.length !== (currentMemory.changedFiles ?? []).length) {
            currentMemory.changedFiles = next;
            saveRuntimeOnly(currentMemory);
          }
        }, undefined, orchestrationLogger);
      }

      if (toolName === "write" || toolName === "edit") {
        const filePath = input.args?.filePath || input.args?.path || "";
        const content = output.output || "";
        if (filePath && content && typeof content === "string") {
          const analysis = analyzeCommentDensity(content, filePath);
          if (analysis.excessive) {
            output.output = `${output.output}\n\n${COMMENT_WARNING}`;
          }
        }
      }

      if (typeof output.output === "string" && shouldApplyDirectContextBudget(toolName)) {
        const originalOutput = output.output;
        const budget = applyContextBudget(originalOutput, { level: "aggressive" });
        if (budget.changed || budget.estimatedTokensSaved > 0) {
          output.output = budget.text;
          recordDirectContextBudget(toolName, originalOutput, budget.text, budget);
        }
      }

      if (typeof output.output === "string" && toolName === "todowrite") {
        lastTodoState = extractTodoState(output.output);
      }

      let routeUpdatePolicy: ExecutionPolicyDecision | undefined;
      if (typeof output.output === "string" && shouldInspectCompletionOutput(toolName)) {
        ensureActiveWorkflow(output.output, looksLikeCompletionClaim(output.output) ? "completion" : "message");
        const routeSource = looksLikeCompletionClaim(output.output) ? "completion" : "message";
        routeUpdatePolicy = evaluateRouteUpdatePolicy(routeSource, routeJceWorkerIntent(output.output));
        applyRuntimeRoute(output.output, routeSource);
      }

      const shouldEnforceWorkflowGates = workflowRuntimeActive && (!hadActiveWorkflow || hadWorkflowRuntimeActive);
      const openWork = typeof output.output === "string" && shouldInspectCompletionOutput(toolName) && looksLikeStopEarlyOrConfirmation(output.output)
        ? evaluateOpenWork(currentMemory, currentPolicyProfile(), lastTodoState, { includeWorkflowGate: hadActiveWorkflow || hadWorkflowRuntimeActive })
        : undefined;

      if (typeof output.output === "string" && shouldInspectCompletionOutput(toolName) && looksLikeCompletionClaim(output.output) && currentMemory.activeWorkflow && (shouldEnforceWorkflowGates || currentMemory.activeWorkflow.route?.intent === "review")) {
        const executionPolicy = evaluateExecutionPolicy({
          action: "completion_claim",
          profile: currentPolicyProfile(),
          route: currentMemory.activeWorkflow.route,
          workflow: currentMemory.activeWorkflow,
          activeBlockers: currentMemory.blockers,
          retryHistory: currentMemory.retryHistory,
        });
        const result = evaluateFinalReviewGate(currentMemory.activeWorkflow, {
          profile: currentPolicyProfile(),
          changedFiles: currentMemory.changedFiles,
          delegatedReviews: delegatedReviewStrings(currentMemory),
          residualRisks: [],
          activeBlockers: currentMemory.blockers,
          retryHistory: currentMemory.retryHistory,
          delegatedWorkRequired: hasDelegatedWork(currentMemory),
          policyReasons: executionPolicy.status === "block" ? executionPolicy.reasons : [],
        });
        const reasons = result.status === "block" ? result.reasons : [];
        const blockedPolicy = routeUpdatePolicy?.status === "block" ? routeUpdatePolicy : executionPolicy.status === "block" ? executionPolicy : undefined;
        const policyText = blockedPolicy ? `${formatExecutionPolicyDecision(blockedPolicy)}\n\n` : "";
        if (reasons.length > 0) {
          withErrorBoundary(() => appendTelemetry(projectRoot, { kind: "task_blocked", name: "completion_gate", metadata: { reasons, skills: applySkillCorrection(determineSkillsForMessage(lastUserMessage), sessionSkillCorrection) } }), undefined, orchestrationLogger);
          output.output = `${output.output}\n\n${policyText}FINAL REVIEW GATE: Completion is blocked.\n${Array.from(new Set(reasons)).map((reason) => `- ${reason}`).join("\n")}`;
        } else {
          withErrorBoundary(() => appendTelemetry(projectRoot, { kind: "task_outcome", name: "completion", metadata: { outcome: "success", skills: applySkillCorrection(determineSkillsForMessage(lastUserMessage), sessionSkillCorrection), verificationPassed: currentMemory.verificationEvidence.length > 0 } }), undefined, orchestrationLogger);
        }
      }

      if (typeof output.output === "string" && openWork?.blocked && !output.output.includes("BOULDER CONTINUATION")) {
        withErrorBoundary(() => appendTelemetry(projectRoot, { kind: "task_outcome", name: "followup_needed", metadata: { outcome: "followup", skills: applySkillCorrection(determineSkillsForMessage(lastUserMessage), sessionSkillCorrection), blockers: openWork.reasons } }), undefined, orchestrationLogger);
        output.output = `${output.output}\n\n${openWork.prompt}`;
      }

      if (typeof output.output === "string" && shouldInspectCompletionOutput(toolName) && isContinueUntilDoneMode() && looksLikeStopEarlyOrConfirmation(output.output) && !output.output.includes("AUTONOMY GUARD:")) {
        output.output = `${output.output}\n\nAUTONOMY GUARD: User explicitly requested continue-until-done mode. Do not stop after partial progress. Continue remaining in-scope work unless blocked by missing external input, safety risk, or irreversible approval boundary.`;
      }

      if (typeof output.output === "string" && shouldInspectCompletionOutput(toolName) && shouldWarnForMissingVerification(output.output)) {
        output.output = `${output.output}${VERIFICATION_WARNING}`;
      }

      // Todo enforcer: warn when completion is claimed but todos remain incomplete
      if (typeof output.output === "string" && shouldInspectCompletionOutput(toolName) && looksLikeCompletionClaim(output.output) && detectPrematureStop(output.output)) {
        const messages = [{ role: "assistant", content: output.output }];
        if (shouldEnforceContinuation(messages)) {
          output.output = `${output.output}\n\n${CONTINUATION_PROMPT}`;
        }
      }

      if (typeof output.output === "string" && shouldInspectCompletionOutput(toolName) && looksLikeCompletionClaim(output.output)) {
        const critique = evaluateSelfCritique(currentMemory);
        if (!critique.canStop) {
          output.output = `${output.output}\n\nSELF-CRITIQUE STOP CHECK: Do not stop yet.\n${critique.reasons.map((reason) => `- ${reason}`).join("\n")}`;
        }
      }

      // Evidence-based completion gating (v2 orchestration system)
      if (typeof output.output === "string" && shouldInspectCompletionOutput(toolName) && looksLikeCompletionClaim(output.output) && bridge.hasActivePlan()) {
        const gateResult = withErrorBoundary(() => orchestrator.formatCompletionGate(), "", orchestrationLogger);
        if (gateResult) {
          output.output = `${output.output}\n\n${gateResult}`;
        }
        const status = withErrorBoundary(() => orchestrator.getStatus(), null, orchestrationLogger);
        if (status?.stats && ((status.stats.pending + status.stats.ready + status.stats.running + status.stats.verifying + status.stats.blocked) > 0)) {
          output.output = `${output.output}\n\nCLOSED-LOOP ORCHESTRATION: Active graph still has open work (${status.stats.pending} pending, ${status.stats.ready} ready, ${status.stats.running} running, ${status.stats.verifying} verifying, ${status.stats.blocked} blocked). Continue dispatch/collect before final completion.`;
        }
      }

      // Human escalation: detect when orchestration is stuck and needs user input
      if (typeof output.output === "string" && shouldInspectCompletionOutput(toolName) && bridge.hasActivePlan()) {
        const escalation = withErrorBoundary(() => orchestrator.formatEscalation(), "", orchestrationLogger);
        if (escalation) {
          output.output = `${output.output}${escalation}`;
        }
      }

      // Plan approval gate: inject approval request if pending
      if (typeof output.output === "string" && bridge.hasActivePlan()) {
        withErrorBoundary(() => {
          const graph = orchestrator.getGraph();
          if (graph && graph.status === "planning") {
            const complexity = orchestrator.assessComplexity(lastUserMessage);
            const approval = evaluateApprovalGate(graph, complexity.score);
            if (approval.requiresApproval) {
              output.output = `${output.output}${formatApprovalGate(approval)}`;
            }
          }
        }, undefined, orchestrationLogger);
      }

      if (typeof output.output === "string" && shouldTranslateToolOutput(toolName)) {
        output.output = await filterChineseOutput(output.output, chineseTranslator);
      }
    },
  };

  return hooks;
};

const pluginModule = {
  id: "opencode-jce",
  server: jcePlugin,
};

export default pluginModule;
