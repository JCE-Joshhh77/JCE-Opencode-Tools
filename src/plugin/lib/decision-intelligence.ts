import type { ExecutionMemory, TaskLearning } from "./execution-memory.js";
import { getActiveBlockers, getAttemptedCommands, getLatestFailure, getLatestVerificationEvidence, getRetryHistoryFor, getStaleActiveTasks } from "./memory-query.js";
import type { JceWorkerAgentHint, JceWorkerIntent } from "./skill-router.js";

export type DecisionRisk = "low" | "medium" | "high";

export interface DecisionIntelligenceRecommendation {
  intent: JceWorkerIntent | "none";
  risk: DecisionRisk;
  recommendedAction: string;
  recommendedAgent?: JceWorkerAgentHint;
  reasons: string[];
  avoidRepeatingCommands: string[];
  relevantLearnings: TaskLearning[];
}

function riskRank(risk: DecisionRisk): number {
  return risk === "high" ? 3 : risk === "medium" ? 2 : 1;
}

function maxRisk(...risks: DecisionRisk[]): DecisionRisk {
  return risks.reduce((highest, risk) => (riskRank(risk) > riskRank(highest) ? risk : highest), "low" as DecisionRisk);
}

function includesText(value: string, needle: string): boolean {
  return value.toLowerCase().includes(needle.toLowerCase());
}

function routeBaseline(intent: JceWorkerIntent | "none"): { risk: DecisionRisk; action: string; agent?: JceWorkerAgentHint } {
  switch (intent) {
  case "bugfix":
    return { risk: "high", action: "Reproduce the failure, add or identify regression evidence, then fix root cause.", agent: "oracle" };
  case "review":
    return { risk: "medium", action: "Map changed areas, require accepted review evidence, and preserve the review route until accepted." };
  case "branch_completion":
    return { risk: "high", action: "Run release-safe checks: status, diff, version sync, tests/typecheck, commit, push, then tag only after push." };
  case "completion_claim":
    return { risk: "high", action: "Do not report completion until fresh task-appropriate verification evidence exists." };
  case "parallel_work":
    return { risk: "medium", action: "Delegate independent work with an evidence contract and review collected output before trusting it.", agent: "explorer" };
  case "feature":
    return { risk: "medium", action: "Confirm acceptance criteria, implement incrementally, and attach feature verification evidence." };
  case "general":
    return { risk: "low", action: "Continue with lightweight planning and keep evidence proportional to risk." };
  case "none":
    return { risk: "low", action: "Start by routing the user intent before choosing execution mode." };
  }
}

function summarizeEvidence(evidence: unknown): string | undefined {
  if (!evidence || typeof evidence !== "object") return undefined;
  const record = evidence as Record<string, unknown>;
  const summary = record.summary ?? record.verificationSummary ?? record.message;
  return typeof summary === "string" && summary.trim() ? summary : undefined;
}

function findRelevantLearnings(memory: ExecutionMemory, intent: JceWorkerIntent | "none"): TaskLearning[] {
  const learnings = Array.isArray(memory.taskLearnings) ? memory.taskLearnings : [];
  if (intent === "none" || intent === "general" || intent === "parallel_work" || intent === "completion_claim" || intent === "branch_completion") return learnings.slice(-3);
  const mappedType = intent === "bugfix" ? "bugfix" : intent === "feature" ? "feature" : intent === "review" ? "review" : "unknown";
  return learnings.filter((learning) => learning.taskType === mappedType || learning.taskType === "unknown").slice(-3);
}

export function recommendNextDecision(memory: ExecutionMemory): DecisionIntelligenceRecommendation {
  const route = memory.activeWorkflow?.route;
  const intent = route?.intent ?? "none";
  const baseline = routeBaseline(intent);
  const blockers = getActiveBlockers(memory);
  const staleTasks = getStaleActiveTasks(memory);
  const latestFailure = getLatestFailure(memory);
  const latestEvidence = summarizeEvidence(getLatestVerificationEvidence(memory));
  const retryHistory = memory.activeWorkflow ? getRetryHistoryFor(memory, memory.activeWorkflow.id) : [];
  const attemptedCommands = getAttemptedCommands(memory);

  const reasons = [route?.reason ?? "No active intent route is recorded yet."];
  let risk = baseline.risk;
  let recommendedAction = baseline.action;
  let recommendedAgent = route?.agentHint ?? baseline.agent;

  if (blockers.length > 0) {
    risk = maxRisk(risk, "high");
    recommendedAction = "Resolve active blockers before dispatching, retrying, or claiming completion.";
    reasons.push(`${blockers.length} active blocker(s) are present.`);
    recommendedAgent = undefined;
  } else if (staleTasks.length > 0) {
    risk = maxRisk(risk, "medium");
    recommendedAction = "Collect, retry, or cancel stale delegated work before starting new work.";
    reasons.push(`${staleTasks.length} stale active task(s) need operator attention.`);
  } else if (latestFailure) {
    risk = maxRisk(risk, "high");
    recommendedAction = "Classify the latest failure, avoid repeating failed commands blindly, then retry with corrected context or block with handoff.";
    reasons.push(`Latest failure: ${latestFailure.message}`);
    recommendedAgent = "oracle";
  } else if (intent === "completion_claim" && !latestEvidence) {
    risk = maxRisk(risk, "high");
    recommendedAction = "Run or attach fresh verification evidence before completion.";
    reasons.push("No latest verification evidence is recorded.");
  } else if (memory.activeWorkflow?.status === "verifying" && !latestEvidence) {
    risk = maxRisk(risk, "high");
    recommendedAction = "Run or attach required verification evidence.";
    reasons.push("No latest verification evidence is recorded.");
  } else if (retryHistory.length > 0) {
    risk = maxRisk(risk, "medium");
    reasons.push(`${retryHistory.length} retry record(s) exist for the active workflow.`);
  }

  const avoidRepeatingCommands = latestFailure
    ? attemptedCommands.filter((command) => includesText(latestFailure.message, command) || includesText(command, latestFailure.message)).slice(-5)
    : [];

  return {
    intent,
    risk,
    recommendedAction,
    recommendedAgent,
    reasons,
    avoidRepeatingCommands,
    relevantLearnings: findRelevantLearnings(memory, intent),
  };
}

export function formatDecisionRecommendation(recommendation: DecisionIntelligenceRecommendation): string[] {
  return [
    "Decision Intelligence",
    `Intent: ${recommendation.intent}`,
    `Risk: ${recommendation.risk}`,
    `Recommended action: ${recommendation.recommendedAction}`,
    `Recommended agent: ${recommendation.recommendedAgent ?? "none"}`,
    `Reasons: ${recommendation.reasons.length ? recommendation.reasons.join("; ") : "none"}`,
    `Avoid repeating commands: ${recommendation.avoidRepeatingCommands.length ? recommendation.avoidRepeatingCommands.join(", ") : "none"}`,
    `Relevant learnings: ${recommendation.relevantLearnings.length ? recommendation.relevantLearnings.map((learning) => learning.trigger).join(", ") : "none"}`,
  ];
}
