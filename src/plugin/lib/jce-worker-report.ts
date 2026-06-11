import type { RuntimeState } from "./runtime-state.js";
import { formatDecisionRecommendation, recommendNextDecision } from "./decision-intelligence.js";
import { getActiveBlockers, getAttemptedCommands, getLatestVerificationEvidence, getRetryHistoryFor, getStaleActiveTasks } from "./memory-query.js";
import type { PolicyProfileSource } from "./policy-profile.js";
import type { WorkflowEvidence, WorkflowStep } from "./workflow.js";
import { detectEnvironmentCapabilities, summarizeCapabilities } from "./environment-capabilities.js";
import type { LoadMemoryResult } from "./orchestration/execution-memory-v2.js";

interface TraceFilter {
  taskId?: string;
  workflowId?: string;
  limit?: number;
}

type RecordLike = Record<string, unknown>;

interface PolicyProfileDisplay {
  profile: string;
  source: PolicyProfileSource;
}

type OrchestrationMemoryState = LoadMemoryResult["memory"];

function isRecord(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null;
}

function asArray<T>(value: T[] | unknown): T[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = "none"): string {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function lineList(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- none";
}

function summarizeUnknown(value: unknown): string {
  if (!isRecord(value)) return text(value, "unknown");
  return text(value.summary ?? value.reason ?? value.message ?? value.failureReason ?? value.handoffReason ?? value.verificationSummary ?? value.id, JSON.stringify(value));
}

function timestampValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function activeStepTitle(memory: RuntimeState): string {
  const workflow = memory.activeWorkflow;
  if (!workflow?.activeStepId) return "none";
  return asArray<WorkflowStep>(workflow.steps).find((step) => step.id === workflow.activeStepId)?.title ?? workflow.activeStepId;
}

export function getJceWorkerNextAction(memory: RuntimeState): string {
  const recommendation = recommendNextDecision(memory);
  if (recommendation.risk === "high" && recommendation.recommendedAction) return recommendation.recommendedAction;
  const workflow = memory.activeWorkflow;
  const caps = detectEnvironmentCapabilities();
  if (!caps.bun) return "Install or restore Bun before continuing verification-heavy work.";
  if (!workflow) return "Start a workflow or dispatch a task.";
  if (workflow.status === "blocked" || workflow.blocker) return "Resolve blocker before continuing.";
  if (workflow.status === "awaiting_user") return "Wait for user input before continuing.";
  if (workflow.status === "verifying" || workflow.completionGate?.status === "needs_verification") return "Run or attach required verification evidence.";
  if (workflow.status === "completed") return "Review completion certificate or clear runtime memory.";
  if (workflow.activeStepId || workflow.status === "executing" || workflow.status === "delegating") return "Continue active workflow step.";
  return "Review plan and start the next pending step.";
}

function policyLine(policy?: PolicyProfileDisplay): string[] {
  return policy ? [`Policy profile: ${policy.profile} (${policy.source})`] : [];
}

function routeStatusLines(workflow: RuntimeState["activeWorkflow"]): string[] {
  if (!workflow?.route) return [];
  return [
    `Intent: ${workflow.route.intent}`,
    `Suggested skills: ${workflow.route.skills.length ? workflow.route.skills.join(", ") : "none"}`,
    ...(workflow.route.agentHint ? [`Agent hint: ${workflow.route.agentHint}`] : []),
  ];
}

function routeReportLines(workflow: RuntimeState["activeWorkflow"]): string[] {
  if (!workflow?.route) return ["Routing", "- none"];
  return [
    "Routing",
    `Intent: ${workflow.route.intent}`,
    `Source: ${workflow.route.source}`,
    `Suggested skills: ${workflow.route.skills.length ? workflow.route.skills.join(", ") : "none"}`,
    ...(workflow.route.agentHint ? [`Agent hint: ${workflow.route.agentHint}`] : []),
    `Reason: ${workflow.route.reason}`,
  ];
}

function failureMemoryLines(memory: RuntimeState): string[] {
  const entries = asArray(memory.failureMemories)
    .slice()
    .sort((left, right) => timestampValue(text((right as any).createdAt, "")) - timestampValue(text((left as any).createdAt, "")))
    .slice(0, 5)
    .map((entry) => {
      const summary = text((entry as any).summary, "unknown failure");
      const rootCause = text((entry as any).rootCause, "unknown root cause");
      const fixNote = text((entry as any).fixNote, "no fix note");
      const command = asArray<string>((entry as any).failedCommands)[0] ?? "no failed command";
      return `${summary} | root cause: ${rootCause} | fix: ${fixNote} | command: ${command}`;
    });
  return ["Failure Memory", lineList(entries)];
}

function plannerRationaleLines(orchestration?: OrchestrationMemoryState): string[] {
  const graph = orchestration?.graph;
  if (!graph) return ["Planner Rationale", "- none"];
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const parallelUnits = Array.from(new Set(nodes.flatMap((node: any) => Array.isArray(node?.metadata?.parallelUnits) ? node.metadata.parallelUnits.filter((item: unknown): item is string => typeof item === "string") : [])));
  const plannerModes = Array.from(new Set(nodes.map((node: any) => typeof node?.metadata?.plannerMode === "string" ? node.metadata.plannerMode : undefined).filter((value): value is string => Boolean(value))));
  const plannerReasons = Array.from(new Set(nodes.map((node: any) => typeof node?.metadata?.plannerReason === "string" ? node.metadata.plannerReason : undefined).filter((value): value is string => Boolean(value))));
  const fanOutTriggered = nodes.some((node: any) => node?.metadata?.parallelization === "explicit-independent-units");
  const fallbackReasons = Array.from(new Set(nodes.map((node: any) => typeof node?.metadata?.parallelFallbackReason === "string" ? node.metadata.parallelFallbackReason : undefined).filter((value): value is string => Boolean(value))));
  return [
    "Planner Rationale",
    `- Graph status: ${text(graph.status, "unknown")}`,
    `- Planner mode: ${plannerModes.length ? plannerModes.join(", ") : "none"}`,
    `- Planner reason: ${plannerReasons.length ? plannerReasons.join(" | ") : "none"}`,
    `- Parallel fan-out: ${fanOutTriggered ? "yes" : "no"}`,
    `- Detected units: ${parallelUnits.length ? parallelUnits.join(", ") : "none"}`,
    `- Linear fallback reason: ${fallbackReasons.length ? fallbackReasons.join(" | ") : "none"}`,
  ];
}

export function getPlannerRationaleSummary(orchestration?: OrchestrationMemoryState): { graphStatus: string; plannerModes: string[]; plannerReasons: string[]; fanOutTriggered: boolean; detectedUnits: string[]; linearFallbackReasons: string[] } {
  const graph = orchestration?.graph;
  if (!graph) {
    return { graphStatus: "no_graph", plannerModes: [], plannerReasons: [], fanOutTriggered: false, detectedUnits: [], linearFallbackReasons: [] };
  }
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  return {
    graphStatus: text(graph.status, "unknown"),
    plannerModes: Array.from(new Set(nodes.map((node: any) => typeof node?.metadata?.plannerMode === "string" ? node.metadata.plannerMode : undefined).filter((value): value is string => Boolean(value)))),
    plannerReasons: Array.from(new Set(nodes.map((node: any) => typeof node?.metadata?.plannerReason === "string" ? node.metadata.plannerReason : undefined).filter((value): value is string => Boolean(value)))),
    fanOutTriggered: nodes.some((node: any) => node?.metadata?.parallelization === "explicit-independent-units"),
    detectedUnits: Array.from(new Set(nodes.flatMap((node: any) => Array.isArray(node?.metadata?.parallelUnits) ? node.metadata.parallelUnits.filter((item: unknown): item is string => typeof item === "string") : []))),
    linearFallbackReasons: Array.from(new Set(nodes.map((node: any) => typeof node?.metadata?.parallelFallbackReason === "string" ? node.metadata.parallelFallbackReason : undefined).filter((value): value is string => Boolean(value)))),
  };
}

export function formatPlannerExplain(orchestration?: OrchestrationMemoryState): string {
  const summary = getPlannerRationaleSummary(orchestration);
  return [
    "JCE-Worker Planner Explain",
    `Graph status: ${summary.graphStatus}`,
    `Planner modes: ${summary.plannerModes.length ? summary.plannerModes.join(", ") : "none"}`,
    `Planner reasons: ${summary.plannerReasons.length ? summary.plannerReasons.join(" | ") : "none"}`,
    `Parallel fan-out: ${summary.fanOutTriggered ? "yes" : "no"}`,
    `Detected units: ${summary.detectedUnits.length ? summary.detectedUnits.join(", ") : "none"}`,
    `Linear fallback reasons: ${summary.linearFallbackReasons.length ? summary.linearFallbackReasons.join(" | ") : "none"}`,
  ].join("\n");
}

export function formatJceWorkerStatus(memory: RuntimeState, policy?: PolicyProfileDisplay, orchestration?: OrchestrationMemoryState): string {
  const workflow = memory.activeWorkflow;
  const latestEvidence = summarizeUnknown(getLatestVerificationEvidence(memory));
  const staleCount = getStaleActiveTasks(memory).length;
  const blockers = getActiveBlockers(memory);
  const recommendation = recommendNextDecision(memory);

  return [
    "JCE-Worker Status",
    `Goal: ${workflow?.goal ?? "none"}`,
    `State: ${workflow?.status ?? "idle"}`,
    ...routeStatusLines(workflow),
    `Active step: ${activeStepTitle(memory)}`,
    `Active tasks: ${asArray(memory.activeTasks).length}`,
    `Blockers: ${blockers.length}`,
    `Stale tasks: ${staleCount}`,
    `Latest verification: ${latestEvidence}`,
    `Decision risk: ${recommendation.risk}`,
    `Decision recommendation: ${recommendation.recommendedAction}`,
    ...(recommendation.recommendedAgent ? [`Recommended agent: ${recommendation.recommendedAgent}`] : []),
    ...policyLine(policy),
    ...plannerRationaleLines(orchestration).slice(1),
    `Next action: ${getJceWorkerNextAction(memory)}`,
  ].join("\n");
}

export function formatJceWorkerTrace(memory: RuntimeState, filter: TraceFilter = {}, policy?: PolicyProfileDisplay): string {
  const limit = Math.max(1, Math.trunc(filter.limit ?? 20));
  const events = asArray<RuntimeState["traceEvents"][number]>(memory.traceEvents)
    .filter((event) => !filter.taskId || event.taskId === filter.taskId)
    .filter((event) => !filter.workflowId || (isRecord(event.metadata) && event.metadata.workflowId === filter.workflowId))
    .sort((left, right) => timestampValue(right.at) - timestampValue(left.at))
    .slice(0, limit);

  return [
    "JCE-Worker Trace",
    ...policyLine(policy),
    ...events.map((event) => `${event.at} ${event.type} ${event.taskId ?? "-"} ${event.message}`),
    ...(events.length ? [] : ["No trace events found."]),
  ].join("\n");
}

export function formatJceWorkerReport(memory: RuntimeState, policy?: PolicyProfileDisplay, orchestration?: OrchestrationMemoryState): string {
  const workflow = memory.activeWorkflow;
  const blockers = getActiveBlockers(memory).map(summarizeUnknown);
  const evidence = [
    ...asArray<WorkflowEvidence>(workflow?.evidence).map((item) => item.summary),
    ...asArray(memory.verificationEvidence).map(summarizeUnknown),
  ];
  const commands = getAttemptedCommands(memory);
  const retryId = workflow?.id ?? "";
  const retries = retryId ? getRetryHistoryFor(memory, retryId).map(summarizeUnknown) : [];
  const staleTasks = getStaleActiveTasks(memory).map(summarizeUnknown);
  const decisionLines = formatDecisionRecommendation(recommendNextDecision(memory));
  const capabilities = summarizeCapabilities(detectEnvironmentCapabilities());

  return [
    "JCE-Worker Operator Report",
    `Goal: ${workflow?.goal ?? "none"}`,
    `State: ${workflow?.status ?? "idle"}`,
    ...policyLine(policy),
    `Updated: ${memory.updatedAt}`,
    `Next action: ${getJceWorkerNextAction(memory)}`,
    "",
    ...routeReportLines(workflow),
    "",
    ...plannerRationaleLines(orchestration),
    "",
    ...decisionLines,
    "",
    "Active Step",
    `- ${activeStepTitle(memory)}`,
    "",
    "Blockers",
    lineList(blockers),
    "",
    "Evidence",
    lineList(evidence),
    "",
    "Attempted Commands",
    lineList(commands),
    "",
    "Retry History",
    lineList(retries),
    "",
    "Environment Capabilities",
    lineList(capabilities),
    "",
    ...failureMemoryLines(memory),
    "",
    "Stale Tasks",
    lineList(staleTasks),
  ].join("\n");
}
