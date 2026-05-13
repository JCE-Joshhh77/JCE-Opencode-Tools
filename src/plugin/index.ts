import type { Plugin, Hooks } from "@opencode-ai/plugin";
import { BackgroundManager } from "./background/manager.js";
import { extractPromptText } from "./background/spawner.js";
import type { OpenCodeClient } from "./background/types.js";
import { buildDispatchTool, buildStatusTool, buildCollectTool } from "./tools/dispatch.js";
import { buildAgentConfigs } from "./config.js";
import { analyzeCommentDensity, COMMENT_WARNING } from "./hooks/comment-checker.js";
import { looksLikeCompletionClaim, shouldWarnForMissingVerification, VERIFICATION_WARNING } from "./hooks/jce-worker-guard.js";
import { shouldEnforceContinuation, detectPrematureStop, CONTINUATION_PROMPT } from "./hooks/todo-enforcer.js";
import { loadExecutionMemory, mergeExecutionMemorySnapshot, saveExecutionMemory } from "./lib/execution-memory.js";
import type { ExecutionMemory } from "./lib/execution-memory.js";
import { buildChineseTranslationPrompt, filterChineseOutput, type ChineseTranslator } from "./lib/chinese-output-filter.js";
import { evaluateExecutionPolicy, formatExecutionPolicyDecision } from "./lib/execution-policy.js";
import type { ExecutionPolicyDecision } from "./lib/execution-policy.js";
import { evaluateFinalReviewGate } from "./lib/final-review-gate.js";
import { resolvePolicyProfile } from "./lib/policy-profile.js";
import { applyWorkflowIntentRoute } from "./lib/workflow.js";
import type { WorkflowIntentRouteSource } from "./lib/workflow.js";
import { buildWorkflowTool } from "./tools/workflow.js";
import { createWorkflowRun } from "./lib/workflow.js";
import { isRecord } from "./lib/shared-predicates.js";
import { determineSkillsForMessage, resolveSkills } from "./lib/skill-loader.js";
import { applyContextBudget } from "./lib/context-budget.js";
import { scoreIntent, toLegacyRoute } from "./lib/orchestration/intent-router.js";
import type { ScoredIntent } from "./lib/orchestration/types.js";
import type { AgentRole } from "./lib/orchestration/types.js";
import { OrchestrationController } from "./lib/orchestration/controller.js";
import { OrchestrationBridge } from "./lib/orchestration/bridge.js";

function delegatedReviewStrings(memory: ExecutionMemory): string[] {
  return [...memory.completedSummaries, ...memory.verificationEvidence]
    .filter(isRecord)
    .map((entry) => {
      const status = typeof entry.reviewStatus === "string" ? entry.reviewStatus : "unknown";
      const notes = Array.isArray(entry.reviewNotes) ? entry.reviewNotes.filter((note): note is string => typeof note === "string").join("; ") : "";
      const summary = typeof entry.verificationSummary === "string" ? entry.verificationSummary : "";
      return `status=${status}${notes ? `; ${notes}` : ""}${summary ? `; ${summary}` : ""}`;
    });
}

function hasDelegatedWork(memory: ExecutionMemory): boolean {
  return [...memory.completedSummaries, ...memory.verificationEvidence].some((entry) => isRecord(entry) && typeof entry.reviewStatus === "string" && entry.reviewStatus !== "not_applicable");
}

function isJceWorkerAgentHint(value: string): value is "oracle" | "jce-researcher" | "explorer" | "frontend" {
  return value === "oracle" || value === "jce-researcher" || value === "explorer" || value === "frontend";
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

function shouldTranslateToolOutput(tool: string): boolean {
  return tool === "Task" || tool === "bg_collect" || tool === "jce_workflow";
}

function shouldInspectCompletionOutput(tool: string): boolean {
  return !["Read", "Grep", "Glob", "LS", "Bash", "TodoWrite", "dispatch", "bg_status", "bg_collect"].includes(tool);
}

function shouldApplyDirectContextBudget(tool: string): boolean {
  return ["Read", "Grep", "Glob", "LS", "Bash"].includes(tool);
}

/**
 * Extract facts from tool outputs into orchestration shared memory.
 * Lightweight heuristic extraction — not exhaustive, just high-value signals.
 */
function extractFactsFromToolOutput(orchestrator: OrchestrationController, tool: string, output: string): void {
  // Only extract from informational tools
  if (!["Bash", "Read", "Grep", "Task", "bg_collect"].includes(tool)) return;
  if (output.length < 20 || output.length > 10000) return;

  // Detect test framework from output
  if (/\bbun test\b/i.test(output)) orchestrator.addFact("test.runner", "bun test", "tool", 0.9);
  else if (/\bjest\b/i.test(output) && /\bpass/i.test(output)) orchestrator.addFact("test.runner", "jest", "tool", 0.8);
  else if (/\bpytest\b/i.test(output)) orchestrator.addFact("test.runner", "pytest", "tool", 0.8);
  else if (/\bcargo test\b/i.test(output)) orchestrator.addFact("test.runner", "cargo test", "tool", 0.8);

  // Detect build tool
  if (/\btsc\b.*\b(error|no\s*emit)\b/i.test(output)) orchestrator.addFact("build.typecheck", "tsc", "tool", 0.9);
  if (/\bvite\b/i.test(output)) orchestrator.addFact("build.bundler", "vite", "tool", 0.7);
  if (/\bwebpack\b/i.test(output)) orchestrator.addFact("build.bundler", "webpack", "tool", 0.7);

  // Detect package manager
  if (/\bbun\s+(install|add|remove)\b/i.test(output)) orchestrator.addFact("package.manager", "bun", "tool", 0.9);
  else if (/\bnpm\s+(install|ci)\b/i.test(output)) orchestrator.addFact("package.manager", "npm", "tool", 0.8);
  else if (/\bpnpm\s+(install|add)\b/i.test(output)) orchestrator.addFact("package.manager", "pnpm", "tool", 0.8);

  // Detect errors/failures (useful for re-planning)
  if (/error TS\d+/i.test(output)) orchestrator.addFact("last.error.type", "typescript", "tool", 0.9);
  else if (/\bSyntaxError\b/i.test(output)) orchestrator.addFact("last.error.type", "syntax", "tool", 0.9);
  else if (/\bReferenceError\b/i.test(output)) orchestrator.addFact("last.error.type", "reference", "tool", 0.9);
}

const jcePlugin: Plugin = async (input) => {
  const { client } = input;
  const chineseTranslator = buildChineseTranslator(client);
  const manager = new BackgroundManager({ maxConcurrency: 5 });
  const agents = buildAgentConfigs();
  const projectRoot = input.directory || input.worktree || process.cwd();
  const loadedMemory = loadExecutionMemory(projectRoot);
  let currentMemory = loadedMemory.memory;
  let lastUserMessage = "";
  let workflowRuntimeActive = currentMemory.activeTasks.length > 0;

  // Initialize orchestration controller (v2 system — runs alongside BackgroundManager)
  const orchestrator = new OrchestrationController({ projectRoot });
  const bridge = new OrchestrationBridge({
    manager,
    client,
    orchestrator,
    chineseTranslator,
    onPersist: () => persistCurrentMemory(),
  });

  if (currentMemory.activeTasks.length === 0 && currentMemory.blockers.length > 0) {
    currentMemory = saveExecutionMemory(projectRoot, {
      ...currentMemory,
      blockers: [],
      activeWorkflow: undefined,
    }, undefined, { preserveWorkflowRuntime: false }).memory;
  }

  const persistCurrentMemory = () => {
    currentMemory = saveExecutionMemory(projectRoot, mergeExecutionMemorySnapshot(currentMemory, manager.toExecutionMemory(), { preserveWorkflowRuntime: true })).memory;
    return currentMemory;
  };

  const recordDirectContextBudget = (tool: string, originalText: string, compressedText: string, budget: ReturnType<typeof applyContextBudget>) => {
    if (!budget.changed && budget.estimatedTokensSaved === 0) return;
    const previous = currentMemory.contextBudgetSummary;
    const originalChars = (previous?.originalChars ?? 0) + budget.originalChars;
    const compressedChars = (previous?.compressedChars ?? 0) + budget.compressedChars;
    currentMemory.contextBudgetSummary = {
      originalChars,
      compressedChars,
      estimatedTokensSaved: (previous?.estimatedTokensSaved ?? 0) + budget.estimatedTokensSaved,
      estimatedSavingsPercent: originalChars === 0 ? 0 : Math.max(0, Math.round((1 - compressedChars / originalChars) * 100)),
      tasks: (previous?.tasks ?? 0) + 1,
      byTool: {
        ...(previous?.byTool ?? {}),
        [tool]: {
          originalChars: (previous?.byTool?.[tool]?.originalChars ?? 0) + budget.originalChars,
          compressedChars: (previous?.byTool?.[tool]?.compressedChars ?? 0) + budget.compressedChars,
          estimatedTokensSaved: (previous?.byTool?.[tool]?.estimatedTokensSaved ?? 0) + budget.estimatedTokensSaved,
          tasks: (previous?.byTool?.[tool]?.tasks ?? 0) + 1,
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
    currentMemory = saveExecutionMemory(projectRoot, currentMemory, undefined, { preserveWorkflowRuntime: false }).memory;
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

  const ensureActiveWorkflow = (text: string, source: WorkflowIntentRouteSource) => {
    if (currentMemory.activeWorkflow || !text.trim()) return;
    const route = routeJceWorkerIntent(text);
    currentMemory.activeWorkflow = applyWorkflowIntentRoute(
      createWorkflowRun({ id: `workflow-${Date.now()}`, goal: text.trim().slice(0, 240) || "JCE worker session" }),
      { ...route, source },
    );
    workflowRuntimeActive = true;
    currentMemory = saveExecutionMemory(projectRoot, currentMemory).memory;
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
    currentMemory = saveExecutionMemory(projectRoot, currentMemory).memory;
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
          currentMemory = saveExecutionMemory(projectRoot, currentMemory).memory;
        }
        if (policy.status === "warn") return { status: "warn", message: formatExecutionPolicyDecision(policy) };
      }),
      bg_status: buildStatusTool(manager),
      bg_collect: buildCollectTool(manager, client, () => {
        persistCurrentMemory();
        // After collecting, check if orchestration loop should continue
        if (bridge.hasActivePlan()) {
          const tasks = manager.listTasks();
          const lastCompleted = tasks.filter((t) => t.status === "completed").pop();
          if (lastCompleted?.result) {
            const context = { sessionID: "", messageID: "" };
            // Feed result through orchestration bridge (async, fire-and-forget for loop continuation)
            bridge.collectAndContinue(lastCompleted.id, lastCompleted.result, lastCompleted.parentSessionId ?? "", lastCompleted.parentMessageId ?? "").catch(() => {});
          }
        }
      }, chineseTranslator),
      jce_workflow: buildWorkflowTool(),
    },

    "chat.message": async (_input, output) => {
      // Track the latest user message for skill injection
      const msg = output.message;
      const text = typeof msg === "string" ? msg : output.parts?.filter((p: any) => p.type === "text").map((p: any) => p.text).join(" ") || "";
      if (typeof text === "string" && text.trim()) {
        lastUserMessage = text;
        // Route intent through orchestration controller (v2)
        orchestrator.routeIntent(text);
        // Extract user constraints (simple heuristic: "don't", "must not", "never")
        const constraintMatch = text.match(/\b(don'?t|must not|never|do not|cannot)\s+(.{5,80})/i);
        if (constraintMatch) {
          orchestrator.addConstraint(constraintMatch[0].trim(), "user");
        }
      }
    },

    "experimental.chat.system.transform": async (_input, output) => {
      if (!lastUserMessage) return;
      const skillNames = determineSkillsForMessage(lastUserMessage);
      if (skillNames.length === 0) return;
      const skillContents = await resolveSkills(skillNames);
      if (skillContents.length > 0) {
        output.system.push("\n\n<!-- JCE Skills (auto-injected based on task context) -->\n" + skillContents.join("\n\n"));
      }
    },

    "tool.execute.after": async (input, output) => {
      const hadActiveWorkflow = Boolean(currentMemory.activeWorkflow);
      const hadWorkflowRuntimeActive = workflowRuntimeActive;

      // Extract facts from tool outputs into orchestration memory
      if (typeof output.output === "string" && output.output.length > 0) {
        extractFactsFromToolOutput(orchestrator, input.tool, output.output);
      }

      if (input.tool === "Write" || input.tool === "Edit") {
        const filePath = input.args?.filePath || input.args?.path || "";
        const content = output.output || "";
        if (filePath && content && typeof content === "string") {
          const analysis = analyzeCommentDensity(content, filePath);
          if (analysis.excessive) {
            output.output = `${output.output}\n\n${COMMENT_WARNING}`;
          }
        }
      }

      if (typeof output.output === "string" && shouldApplyDirectContextBudget(input.tool)) {
        const originalOutput = output.output;
        const budget = applyContextBudget(originalOutput, { level: "aggressive" });
        if (budget.changed || budget.estimatedTokensSaved > 0) {
          output.output = budget.text;
          recordDirectContextBudget(input.tool, originalOutput, budget.text, budget);
        }
      }

      let routeUpdatePolicy: ExecutionPolicyDecision | undefined;
      if (typeof output.output === "string" && shouldInspectCompletionOutput(input.tool)) {
        ensureActiveWorkflow(output.output, looksLikeCompletionClaim(output.output) ? "completion" : "message");
        const routeSource = looksLikeCompletionClaim(output.output) ? "completion" : "message";
        routeUpdatePolicy = evaluateRouteUpdatePolicy(routeSource, routeJceWorkerIntent(output.output));
        applyRuntimeRoute(output.output, routeSource);
      }

      const shouldEnforceWorkflowGates = workflowRuntimeActive && (!hadActiveWorkflow || hadWorkflowRuntimeActive);

      if (typeof output.output === "string" && shouldInspectCompletionOutput(input.tool) && looksLikeCompletionClaim(output.output) && currentMemory.activeWorkflow && shouldEnforceWorkflowGates) {
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
          changedFiles: [],
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
          output.output = `${output.output}\n\n${policyText}FINAL REVIEW GATE: Completion is blocked.\n${Array.from(new Set(reasons)).map((reason) => `- ${reason}`).join("\n")}`;
        }
      }

      if (typeof output.output === "string" && shouldInspectCompletionOutput(input.tool) && shouldWarnForMissingVerification(output.output)) {
        output.output = `${output.output}${VERIFICATION_WARNING}`;
      }

      // Todo enforcer: warn when completion is claimed but todos remain incomplete
      if (typeof output.output === "string" && shouldInspectCompletionOutput(input.tool) && looksLikeCompletionClaim(output.output) && detectPrematureStop(output.output)) {
        const messages = [{ role: "assistant", content: output.output }];
        if (shouldEnforceContinuation(messages)) {
          output.output = `${output.output}\n\n${CONTINUATION_PROMPT}`;
        }
      }

      if (typeof output.output === "string" && shouldTranslateToolOutput(input.tool)) {
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
