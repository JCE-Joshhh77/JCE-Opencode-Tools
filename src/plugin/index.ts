import type { Plugin, Hooks } from "@opencode-ai/plugin";
import { BackgroundManager } from "./background/manager.js";
import { extractPromptText } from "./background/spawner.js";
import { buildDispatchTool, buildStatusTool, buildCollectTool } from "./tools/dispatch.js";
import { buildAgentConfigs } from "./config.js";
import { analyzeCommentDensity, COMMENT_WARNING } from "./hooks/comment-checker.js";
import { looksLikeCompletionClaim, shouldWarnForMissingVerification, VERIFICATION_WARNING } from "./hooks/jce-worker-guard.js";
import { loadExecutionMemory, mergeExecutionMemorySnapshot, saveExecutionMemory } from "./lib/execution-memory.js";
import type { ExecutionMemory } from "./lib/execution-memory.js";
import { buildChineseTranslationPrompt, filterChineseOutput, type ChineseTranslator } from "./lib/chinese-output-filter.js";
import { evaluateExecutionPolicy, formatExecutionPolicyDecision } from "./lib/execution-policy.js";
import type { ExecutionPolicyDecision } from "./lib/execution-policy.js";
import { evaluateFinalReviewGate } from "./lib/final-review-gate.js";
import { resolvePolicyProfile } from "./lib/policy-profile.js";
import { routeJceWorkerIntent } from "./lib/skill-router.js";
import type { JceWorkerAgentHint } from "./lib/skill-router.js";
import { applyWorkflowIntentRoute } from "./lib/workflow.js";
import type { WorkflowIntentRouteSource } from "./lib/workflow.js";
import { buildWorkflowTool } from "./tools/workflow.js";
import { createWorkflowRun } from "./lib/workflow.js";
import { isRecord } from "./lib/shared-predicates.js";
import { determineSkillsForMessage, resolveSkills } from "./lib/skill-loader.js";

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

function isJceWorkerAgentHint(value: string): value is JceWorkerAgentHint {
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
  return !["Read", "Grep", "Glob", "LS", "Bash", "TodoWrite"].includes(tool);
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

  const persistCurrentMemory = () => {
    currentMemory = saveExecutionMemory(projectRoot, mergeExecutionMemorySnapshot(currentMemory, manager.toExecutionMemory(), { preserveWorkflowRuntime: true })).memory;
    return currentMemory;
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
    currentMemory = saveExecutionMemory(projectRoot, currentMemory).memory;
  };

  const shouldApplyRoute = (source: WorkflowIntentRouteSource, nextRoute: ReturnType<typeof routeJceWorkerIntent>): boolean => {
    if (!currentMemory.activeWorkflow) return false;
    const policy = evaluateRouteUpdatePolicy(source, nextRoute);
    if (policy.status === "block") return false;
    if (nextRoute.intent !== "general") return true;
    return !currentMemory.activeWorkflow.route && source !== "completion";
  };

  const applyRuntimeRoute = (text: string, source: WorkflowIntentRouteSource) => {
    if (!currentMemory.activeWorkflow || !text.trim()) return;
    const route = routeJceWorkerIntent(text);
    if (!shouldApplyRoute(source, route)) return;
    currentMemory.activeWorkflow = applyWorkflowIntentRoute(currentMemory.activeWorkflow, { ...route, source });
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
          currentMemory = saveExecutionMemory(projectRoot, currentMemory).memory;
        }
        if (policy.status === "warn") return { status: "warn", message: formatExecutionPolicyDecision(policy) };
      }),
      bg_status: buildStatusTool(manager),
      bg_collect: buildCollectTool(manager, client, persistCurrentMemory, chineseTranslator),
      jce_workflow: buildWorkflowTool(),
    },

    "chat.message": async (_input, output) => {
      // Track the latest user message for skill injection
      const msg = output.message;
      const text = typeof msg === "string" ? msg : output.parts?.filter((p: any) => p.type === "text").map((p: any) => p.text).join(" ") || "";
      if (typeof text === "string" && text.trim()) {
        lastUserMessage = text;
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

      let routeUpdatePolicy: ExecutionPolicyDecision | undefined;
      if (typeof output.output === "string" && shouldInspectCompletionOutput(input.tool)) {
        ensureActiveWorkflow(output.output, looksLikeCompletionClaim(output.output) ? "completion" : "message");
        const routeSource = looksLikeCompletionClaim(output.output) ? "completion" : "message";
        routeUpdatePolicy = evaluateRouteUpdatePolicy(routeSource, routeJceWorkerIntent(output.output));
        applyRuntimeRoute(output.output, routeSource);
      }

      if (typeof output.output === "string" && shouldInspectCompletionOutput(input.tool) && looksLikeCompletionClaim(output.output) && currentMemory.activeWorkflow) {
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
