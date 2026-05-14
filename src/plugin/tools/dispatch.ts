import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { BackgroundManager } from "../background/manager.js";
import type { BackgroundTask, OpenCodeClient, TaskCategory } from "../background/types.js";
import { launchExistingBackgroundTask, spawnBackgroundTask } from "../background/spawner.js";
import { resolveModelForCategory, detectTaskCategory } from "../background/types.js";
import { buildDelegatedResultContractInstructions } from "../lib/contracts.js";
import { applyContextBudget, estimateTokensFromChars } from "../lib/context-budget.js";
import { buildDelegationEnvelope, formatDelegationEnvelope } from "../lib/delegation-envelope.js";
import { buildExecutionSummary } from "../lib/execution-summary.js";
import { buildHandoffReport } from "../lib/handoff.js";
import { filterChineseOutput, type ChineseTranslator } from "../lib/chinese-output-filter.js";
import { appendResearchOutputWarning } from "../lib/research-output-guard.js";
import { buildRetryPrompt, decideRecovery } from "../lib/recovery.js";
import { classifyDelegatedReview } from "../lib/review.js";
import { scoreDelegatedEvidence } from "../lib/evidence-scoring.js";
import type { SkillRoute } from "../lib/skill-router.js";
import { scoreIntent, toLegacyRoute } from "../lib/orchestration/intent-router.js";
import { resolveSubAgentSkills } from "../lib/skill-loader.js";
import { createWorkflowRun } from "../lib/workflow.js";

const z = tool.schema;

interface DispatchRoutePolicyResult {
  status: "allow" | "warn" | "block";
  message?: string;
}

function buildDelegatedPrompt(prompt: string, description = "Delegated task", agent = "unknown"): string {
  return formatDelegationEnvelope(buildDelegationEnvelope({
    goal: description,
    prompt,
    agent,
  }));
}

function stripDelegatedResultContract(prompt: string): string {
  const normalized = prompt.replace(/\r\n/g, "\n");
  const contract = buildDelegatedResultContractInstructions().trim();
  const marker = "## Output Contract\n";
  const matches = [...normalized.matchAll(/## Output Contract\n/g)];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    if (match.index === undefined) continue;
    const contentStart = match.index + marker.length;
    if (normalized.slice(contentStart).trim() === contract) return normalized.slice(0, match.index).trimEnd();
  }
  return prompt.replace(`\n\n${buildDelegatedResultContractInstructions()}`, "");
}

function evidenceForTask(task: BackgroundTask): string[] {
  return [task.failureReason, task.error, task.verificationSummary, ...(task.reviewNotes ?? [])].filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

function recoveryWorkflowForTask(task: BackgroundTask) {
  return createWorkflowRun({ id: task.rootTaskId ?? task.id, goal: task.description, maxRetries: task.maxRetries, now: task.createdAt });
}

function fallbackHandoff(task: BackgroundTask, blocker: string, evidence: string[]) {
  return {
    status: "blocked" as const,
    completed: [],
    blocker,
    evidence: evidence.length ? evidence : [task.failureReason || task.error || "Task failed"],
    nextOptions: ["Inspect failure and decide next action."],
  };
}

function formatTaskResult(task: BackgroundTask): string {
  const result = task.result ?? "";
  if (task.agent !== "jce-researcher") return result;
  return appendResearchOutputWarning(result);
}

/**
 * Apply context budget compression to the collected result and accumulate savings.
 * This is where real token savings happen — sub-agent results often contain verbose
 * test output, file contents, and logs that can be compressed.
 *
 * Additionally, estimates delegation savings: the sub-agent's internal work (tool calls,
 * file reads, reasoning) stays in a separate context window. The prompt size represents
 * work offloaded from the main context — conservatively, the sub-agent consumed at least
 * the prompt tokens internally that never enter the main agent's context.
 */
function compressAndRecordResultBudget(manager: BackgroundManager, task: BackgroundTask, resultText: string): string {
  const budgeted = applyContextBudget(resultText, { level: "aggressive" });

  // Delegation savings: the prompt was offloaded to a separate context.
  // The sub-agent processed the prompt + generated internal context (tool calls, reads, etc.)
  // that never enters the main agent. Conservative estimate: prompt chars represent
  // offloaded work that would have consumed equivalent context in the main agent.
  const promptChars = task.prompt.length;
  // The main agent only receives the compressed result instead of doing all the work inline.
  // Savings = (prompt sent to sub-agent + full result) - compressed result returned
  const delegationOriginalChars = promptChars + budgeted.originalChars;
  const delegationCompressedChars = budgeted.compressedChars;
  const delegationTokensSaved = Math.max(0, estimateTokensFromChars(delegationOriginalChars) - estimateTokensFromChars(delegationCompressedChars));
  const delegationSavingsPercent = delegationOriginalChars === 0 ? 0 : Math.max(0, Math.round((1 - delegationCompressedChars / delegationOriginalChars) * 100));

  manager.recordContextBudget(task.id, {
    originalChars: delegationOriginalChars,
    compressedChars: delegationCompressedChars,
    estimatedTokensSaved: delegationTokensSaved,
    estimatedSavingsPercent: delegationSavingsPercent,
    changed: budgeted.changed || delegationTokensSaved > 0,
    source: "bg_collect",
  });

  return budgeted.text;
}

async function handleRecovery(manager: BackgroundManager, client: OpenCodeClient | undefined, task: BackgroundTask, errorText: string): Promise<string> {
  const evidence = evidenceForTask(task);
  if (task.retryTaskId) {
    const existingRetry = manager.getTask(task.retryTaskId);
    if (existingRetry) {
      return `Recovery: retry already scheduled (${task.recoveryCategory ?? "unknown"})\nRetry task: ${existingRetry.id}\nCollect or monitor this retry task before collecting the original task again.`;
    }
  }

  const decision = decideRecovery({
    errorText,
    retryCount: task.retryCount,
    maxRetries: task.maxRetries,
    workflow: recoveryWorkflowForTask(task),
    priorEvidence: evidence,
  });

  if (decision.action === "retry") {
    const retryPrompt = buildRetryPrompt({
      originalPrompt: stripDelegatedResultContract(task.prompt),
      category: decision.category,
      failureReason: errorText,
      priorEvidence: evidence,
      retryCount: task.retryCount + 1,
      maxRetries: task.maxRetries,
    });
    const result = manager.createRetryTaskResult(task.id, {
      prompt: buildDelegatedPrompt(retryPrompt, `${task.description} retry`, task.agent),
      failureReason: errorText,
      category: decision.category,
    });
    switch (result.status) {
    case "created":
      if (client) {
        const launched = await launchExistingBackgroundTask(manager, client, result.task.id);
        const retryTask = manager.getTask(result.task.id);
        if (retryTask?.status === "error") {
          return `Recovery: retry failed to launch (${decision.category})\nRetry task: ${retryTask.id}\nReason: ${retryTask.error ?? retryTask.failureReason ?? "unknown launch failure"}`;
        }
        if (!launched && retryTask?.status === "pending") {
          return `Recovery: retry pending (${decision.category})\nRetry task: ${result.task.id}\nReason: ${decision.reason}\nRetry was created but not launched because concurrency is saturated; collect or monitor the retry task after capacity frees.`;
        }
      }
      return `Recovery: retry scheduled (${decision.category})\nRetry task: ${result.task.id}\nReason: ${decision.reason}`;
    case "existing":
      return `Recovery: retry already scheduled (${decision.category})\nRetry task: ${result.task.id}\nCollect or monitor this retry task before collecting the original task again.\nReason: ${decision.reason}`;
    case "exhausted":
    case "already_scheduled_missing":
    case "not_found": {
      const handoff = fallbackHandoff(task, result.reason, evidence);
      manager.blockTaskForRecovery(task.id, decision.category, result.reason, handoff);
      return `Recovery: blocked (${decision.category})\n\n${buildHandoffReport(handoff)}`;
    }
    }
  }

  const handoff = decision.handoff ?? fallbackHandoff(task, decision.reason, evidence);
  manager.blockTaskForRecovery(task.id, decision.category, handoff.blocker, handoff);
  return `Recovery: ${decision.action === "needs_followup" ? "needs follow-up" : "blocked"} (${decision.category})\n\n${buildHandoffReport(handoff)}`;
}

function formatRetryStatus(task: BackgroundTask): string {
  const availableBudget = task.reviewStatus === "retryable_failure" && task.retryCount < task.maxRetries
    ? `, retry budget available: ${task.maxRetries - task.retryCount}`
    : "";
  return `retries: ${task.retryCount}/${task.maxRetries}${availableBudget}`;
}

function formatContextBudget(task: BackgroundTask): string {
  const budget = task.contextBudget;
  if (!budget) return "budget: pending";
  return `budget: ~${budget.estimatedTokensSaved} token(s) saved`;
}

export function buildDispatchTool(
  manager: BackgroundManager,
  client: OpenCodeClient,
  afterRoute?: (text: string, route: SkillRoute, agent: string) => DispatchRoutePolicyResult | void,
): ToolDefinition {
  return tool({
    description:
      "Launch a background agent task. The task runs in parallel and results can be collected later with bg_collect.",
    args: {
      description: z
        .string()
        .describe("Brief description of what this background task should accomplish"),
      prompt: z
        .string()
        .describe("The full prompt/instructions for the background agent"),
      agent: z
        .enum(["oracle", "jce-researcher", "explorer", "frontend"])
        .describe("Which agent to use"),
      category: z
        .enum(["architecture", "frontend", "research", "exploration", "quick", "deep", "default"])
        .optional()
        .describe("Task category for model routing. Determines which model handles the task. Defaults to 'default'."),
    },
    async execute(args, context) {
      const routeText = `${args.description}\n${args.prompt}`;
      const route = toLegacyRoute(scoreIntent(routeText)) as unknown as SkillRoute;
      const policy = afterRoute?.(routeText, route, args.agent as string);
      if (policy?.status === "block") return policy.message ?? "EXECUTION POLICY: blocked";

      // Resolve skills for eligible sub-agents (oracle, frontend)
      const skillContent = await resolveSubAgentSkills(args.agent as string, args.prompt as string);
      const enrichedPrompt = skillContent
        ? `${args.prompt as string}${skillContent}`
        : args.prompt as string;

      // Resolve model hint from category (auto-detect if not provided)
      const category = (args.category as TaskCategory | undefined) ?? detectTaskCategory(args.agent as string, args.prompt as string);
      const modelHint = resolveModelForCategory(args.agent as string, category);

      const taskId = await spawnBackgroundTask(manager, client, {
        description: args.description as string,
        prompt: buildDelegatedPrompt(enrichedPrompt, args.description as string, args.agent as string),
        agent: args.agent as string,
        parentSessionId: context.sessionID,
        parentMessageId: context.messageID,
        modelHint,
      });
      const warning = policy?.status === "warn" && policy.message ? `\n\n${policy.message}` : "";
      const modelInfo = modelHint ? `\nModel: ${modelHint.providerID}/${modelHint.modelID}` : "";
      return `Background task launched: ${taskId}\nAgent: ${args.agent}\nCategory: ${category}${modelInfo}\nDescription: ${args.description}\n\nUse bg_status to check progress or bg_collect to retrieve results.${warning}`;
    },
  });
}

export function buildStatusTool(manager: BackgroundManager, getOrchestrationStatus?: () => string): ToolDefinition {
  return tool({
    description: "Check the status of all background tasks launched in this session.",
    args: {},
    async execute() {
      const tasks = manager.listTasks();
      const orchestrationStatus = getOrchestrationStatus?.() ?? "";
      if (tasks.length === 0 && !orchestrationStatus) return "No background tasks.";
      const taskLines = tasks
        .map(
          (t) =>
            `[${t.status.toUpperCase()}] ${t.id} — ${t.description} (agent: ${t.agent}, state: ${t.logicalState}, review: ${t.reviewStatus}, stale: ${t.stale}, ${formatRetryStatus(t)}, ${formatContextBudget(t)}${t.failureReason ? `, failure: ${t.failureReason}` : ""}${t.reviewNotes.length ? `, notes: ${t.reviewNotes.join(", ")}` : ""})`,
        )
        .join("\n");
      return orchestrationStatus ? `${taskLines}${taskLines ? "\n" : ""}${orchestrationStatus}` : taskLines;
    },
  });
}

export function buildCollectTool(
  manager: BackgroundManager,
  client?: OpenCodeClient,
  afterMutation?: () => void,
  chineseTranslator?: ChineseTranslator,
): ToolDefinition {
  return tool({
    description: "Collect the result of a completed background task by its ID.",
    args: {
      taskId: z.string().describe("The task ID returned by dispatch"),
    },
    async execute(args) {
      const filterOutput = (text: string) => filterChineseOutput(text, chineseTranslator);
      const taskId = args.taskId as string;
      const task = manager.getTask(taskId);
      if (!task) return filterOutput(`Task not found: ${taskId}`);
      if (task.status === "pending") return filterOutput(`Task ${taskId} is still pending.`);
      if (task.status === "running") return filterOutput(`Task ${taskId} is still running.`);
      if (task.status === "cancelled") return filterOutput(`Task ${taskId} was cancelled.`);
      if (task.status === "error") {
        const errorText = task.error || task.failureReason || "Task failed";
        const result = `Task ${taskId} failed: ${errorText}\n${await handleRecovery(manager, client, task, errorText)}`;
        afterMutation?.();
        return filterOutput(result);
      }

      const review = task.result
        ? classifyDelegatedReview(task.result, { agent: task.agent })
        : { status: "needs_followup" as const, missing: ["Summary", "Files", "Verification", "Risks"], notes: ["Missing delegated result"], retryable: false };
      const evidenceScore = task.result ? scoreDelegatedEvidence(task.result, { agent: task.agent }) : undefined;
      const evidenceNotes = evidenceScore ? [`evidence: ${evidenceScore.evidenceStrength}`] : [];
      const reviewStatus = evidenceScore?.needsFollowUp && review.status === "accepted" ? "needs_followup" as const : review.status;
      const reviewMissing = evidenceScore?.needsFollowUp && review.missing.length === 0 ? ["strong Verification evidence"] : review.missing;
      const reviewNotes = [...(review.notes.length ? review.notes : reviewMissing), ...evidenceNotes];

      manager.markReview(
        task.id,
        reviewStatus,
        reviewNotes,
        reviewStatus === "accepted" ? `delegated output accepted with ${evidenceScore?.evidenceStrength ?? "unknown"} evidence` : undefined,
      );

      // Compress the task result to save tokens in the main agent's context
      const compressedResult = compressAndRecordResultBudget(manager, task, formatTaskResult(task));

      if (reviewStatus === "retryable_failure") {
        const reason = review.notes.join(", ") || "Delegated result did not satisfy the required contract";
        manager.recordRetryableFailure(task.id, reason);
        const result = `${await handleRecovery(manager, client, task, reason)}\n\nOriginal task output:\n${compressedResult}`;
        afterMutation?.();
        return filterOutput(result);
      }

      if (reviewStatus === "needs_followup" && reviewMissing.length) {
        const reason = review.notes.join(", ") || "Delegated result did not satisfy the required contract";
        const result = `${await handleRecovery(manager, client, task, reason)}\n\nOriginal task output:\n${compressedResult}`;
        afterMutation?.();
        return filterOutput(result);
      }

      if (reviewStatus === "blocked") {
        const handoff = {
          status: "blocked" as const,
          completed: [task.description],
          blocker: review.notes.join(", ") || task.failureReason || "Delegated task is blocked",
          evidence: [compressedResult || "No delegated output"],
          nextOptions: ["Resolve blocker and rerun delegated task", "Accept documented risk and continue manually"],
        };
        manager.blockTaskForRecovery(task.id, "delegated_contract_failure", handoff.blocker, handoff);
        const summary = buildExecutionSummary({
          status: "blocked",
          files: [],
          verification: task.verificationSummary ? [task.verificationSummary] : [],
          risks: review.notes,
          blockers: review.notes,
          retries: task.retryCount > 0 ? [`${task.id} retries: ${task.retryCount}/${task.maxRetries}`] : [],
          traceHighlights: (task.traceEvents ?? []).map((event) => event.type).slice(-5),
        });
        const result = `Task ${taskId} blocked:\nReview: ${review.status}\n\n${summary}\n\n${buildHandoffReport(handoff)}\n\n${compressedResult}`;
        afterMutation?.();
        return filterOutput(result);
      }

      const summary = buildExecutionSummary({
        status: "completed",
        files: [],
        verification: task.verificationSummary ? [task.verificationSummary] : [],
          risks: reviewStatus === "accepted" ? ["none"] : reviewNotes,
        blockers: [],
        retries: task.retryCount > 0 ? [`${task.id} retries: ${task.retryCount}/${task.maxRetries}`] : [],
        traceHighlights: (task.traceEvents ?? []).map((event) => event.type).slice(-5),
      });

      if (reviewStatus === "accepted" && evidenceScore) manager.recordAcceptedDelegationLearning(task, evidenceScore.evidenceStrength);
      afterMutation?.();
      return filterOutput(`Task ${taskId} completed:\nReview: ${reviewStatus}${reviewMissing.length ? ` (${reviewMissing.join(", ")})` : ""}${evidenceScore ? `\nEvidence score: ${evidenceScore.evidenceStrength}` : ""}\n\n${summary}\n\n${compressedResult}`);
    },
  });
}
