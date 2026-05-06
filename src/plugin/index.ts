import type { PluginModule, Plugin, Hooks } from "@opencode-ai/plugin";
import { BackgroundManager } from "./background/manager.js";
import { buildDispatchTool, buildStatusTool, buildCollectTool } from "./tools/dispatch.js";
import { buildAgentConfigs } from "./config.js";
import { analyzeCommentDensity, COMMENT_WARNING } from "./hooks/comment-checker.js";
import { looksLikeCompletionClaim, shouldWarnForMissingVerification, VERIFICATION_WARNING } from "./hooks/jce-worker-guard.js";
import { loadExecutionMemory, mergeExecutionMemorySnapshot, saveExecutionMemory } from "./lib/execution-memory.js";
import type { ExecutionMemory } from "./lib/execution-memory.js";
import { evaluateExecutionPolicy, formatExecutionPolicyDecision } from "./lib/execution-policy.js";
import type { ExecutionPolicyDecision } from "./lib/execution-policy.js";
import { evaluateFinalReviewGate } from "./lib/final-review-gate.js";
import { resolvePolicyProfile } from "./lib/policy-profile.js";
import { routeJceWorkerIntent } from "./lib/skill-router.js";
import type { JceWorkerAgentHint } from "./lib/skill-router.js";
import { applyWorkflowIntentRoute } from "./lib/workflow.js";
import type { WorkflowIntentRouteSource } from "./lib/workflow.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

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

const jcePlugin: Plugin = async (input) => {
  const { client } = input;
  const manager = new BackgroundManager({ maxConcurrency: 5 });
  const agents = buildAgentConfigs();
  const projectRoot = input.directory || input.worktree || process.cwd();
  const loadedMemory = loadExecutionMemory(projectRoot);
  let currentMemory = loadedMemory.memory;

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
      bg_collect: buildCollectTool(manager, client, persistCurrentMemory),
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
      if (typeof output.output === "string") {
        const routeSource = looksLikeCompletionClaim(output.output) ? "completion" : "message";
        routeUpdatePolicy = evaluateRouteUpdatePolicy(routeSource, routeJceWorkerIntent(output.output));
        applyRuntimeRoute(output.output, routeSource);
      }

      if (typeof output.output === "string" && looksLikeCompletionClaim(output.output) && currentMemory.activeWorkflow) {
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
          return;
        }
      }

      if (typeof output.output === "string" && shouldWarnForMissingVerification(output.output)) {
        output.output = `${output.output}${VERIFICATION_WARNING}`;
      }
    },
  };

  return hooks;
};

const pluginModule: PluginModule = {
  id: "opencode-jce",
  server: jcePlugin,
};

export default pluginModule;
