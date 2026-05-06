import type { JceWorkerAgentHint, JceWorkerIntent } from "./skill-router.js";

export type WorkflowStatus = "intake" | "planning" | "ready" | "executing" | "delegating" | "verifying" | "blocked" | "awaiting_user" | "completed";
export type WorkflowStepStatus = "pending" | "running" | "completed" | "blocked" | "skipped";
export type WorkflowTaskType = "code" | "docs" | "config" | "shell" | "research" | "review" | "unknown";
export type EvidenceKind = "command" | "file" | "review" | "source" | "manual";

export type WorkflowIntentRouteSource = "message" | "task" | "manual" | "completion";

export interface WorkflowIntentRoute {
  intent: JceWorkerIntent;
  skills: string[];
  reason: string;
  agentHint?: JceWorkerAgentHint;
  source: WorkflowIntentRouteSource;
}

export interface WorkflowEvidence {
  kind: EvidenceKind;
  summary: string;
  command?: string;
  file?: string;
  passed?: boolean;
  at?: string;
}

export interface WorkflowBlocker {
  reason: string;
  category: string;
  evidence: string[];
  nextOptions: string[];
}

export interface WorkflowRetryPolicy {
  maxRetries: number;
}

export interface WorkflowCompletionGate {
  status: "pending" | "passed" | "needs_verification" | "blocked";
  reasons: string[];
}

export interface WorkflowStep {
  id: string;
  title: string;
  taskType: WorkflowTaskType;
  status: WorkflowStepStatus;
  dependsOn: string[];
  assignedAgent?: string;
  expectedOutput?: string;
  verification: string[];
  evidence: WorkflowEvidence[];
  result?: string;
  retryCount: number;
  blocker?: WorkflowBlocker;
}

export interface WorkflowRun {
  id: string;
  goal: string;
  status: WorkflowStatus;
  createdAt: string;
  updatedAt: string;
  steps: WorkflowStep[];
  activeStepId?: string;
  acceptanceCriteria: string[];
  evidence: WorkflowEvidence[];
  retryPolicy: WorkflowRetryPolicy;
  blocker?: WorkflowBlocker;
  completionGate: WorkflowCompletionGate;
  certificate?: string;
  route?: WorkflowIntentRoute;
}

export interface CreateWorkflowRunInput {
  id: string;
  goal: string;
  acceptanceCriteria?: string[];
  maxRetries?: number;
  now?: string;
}

export interface AddWorkflowStepInput {
  id: string;
  title: string;
  taskType: WorkflowTaskType;
  dependsOn?: string[];
  assignedAgent?: string;
  expectedOutput?: string;
  verification?: string[];
}

function timestamp(now?: string): string {
  return now ?? new Date().toISOString();
}

function cloneEvidence(evidence: WorkflowEvidence): WorkflowEvidence {
  return { ...evidence };
}

function cloneBlocker(blocker: WorkflowBlocker): WorkflowBlocker {
  return { ...blocker, evidence: [...blocker.evidence], nextOptions: [...blocker.nextOptions] };
}

function cloneRun(run: WorkflowRun, now?: string): WorkflowRun {
  return {
    ...run,
    updatedAt: timestamp(now),
    steps: run.steps.map((step) => ({
      ...step,
      dependsOn: [...step.dependsOn],
      verification: [...step.verification],
      evidence: step.evidence.map(cloneEvidence),
      blocker: step.blocker ? cloneBlocker(step.blocker) : undefined,
    })),
    evidence: run.evidence.map(cloneEvidence),
    blocker: run.blocker ? cloneBlocker(run.blocker) : undefined,
    route: run.route ? { ...run.route, skills: [...run.route.skills] } : undefined,
  };
}

export function createWorkflowRun(input: CreateWorkflowRunInput): WorkflowRun {
  const now = timestamp(input.now);
  return {
    id: input.id,
    goal: input.goal,
    status: "planning",
    createdAt: now,
    updatedAt: now,
    steps: [],
    activeStepId: undefined,
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    evidence: [],
    retryPolicy: { maxRetries: input.maxRetries ?? 1 },
    completionGate: { status: "pending", reasons: [] },
  };
}

export function deriveWorkflowStatus(run: WorkflowRun): WorkflowStatus {
  if (run.blocker) return "blocked";
  if (run.steps.some((step) => step.status === "blocked" || step.blocker)) return "blocked";
  if (run.steps.some((step) => step.status === "running")) return "executing";
  if (run.steps.length > 0 && run.steps.every((step) => step.status === "completed" || step.status === "skipped")) return "verifying";
  if (run.steps.length > 0) return "ready";
  return run.status;
}

export function addWorkflowStep(run: WorkflowRun, input: AddWorkflowStepInput, now?: string): WorkflowRun {
  const next = cloneRun(run, now);
  if (next.steps.some((step) => step.id === input.id)) throw new Error(`Workflow step already exists: ${input.id}`);
  next.steps.push({
    id: input.id,
    title: input.title,
    taskType: input.taskType,
    status: "pending",
    dependsOn: input.dependsOn ?? [],
    assignedAgent: input.assignedAgent,
    expectedOutput: input.expectedOutput,
    verification: input.verification ?? [],
    evidence: [],
    retryCount: 0,
  });
  next.status = deriveWorkflowStatus(next);
  return next;
}

export function applyWorkflowIntentRoute(run: WorkflowRun, route: WorkflowIntentRoute, now?: string): WorkflowRun {
  const next = cloneRun(run, now);
  next.route = { ...route, skills: [...route.skills] };
  return next;
}

export function updateWorkflowStepStatus(run: WorkflowRun, stepId: string, status: WorkflowStepStatus, now?: string): WorkflowRun {
  const next = cloneRun(run, now);
  const step = next.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new Error(`Workflow step not found: ${stepId}`);
  step.status = status;
  next.activeStepId = status === "running" ? stepId : next.activeStepId === stepId ? undefined : next.activeStepId;
  next.status = deriveWorkflowStatus(next);
  return next;
}

export function attachStepEvidence(run: WorkflowRun, stepId: string, evidence: WorkflowEvidence, now?: string): WorkflowRun {
  const next = cloneRun(run, now);
  const step = next.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new Error(`Workflow step not found: ${stepId}`);
  const recorded = { ...evidence, at: evidence.at ?? timestamp(now) };
  step.evidence.push(recorded);
  next.evidence.push(recorded);
  return next;
}

export function blockWorkflow(run: WorkflowRun, blocker: WorkflowBlocker, now?: string): WorkflowRun {
  const next = cloneRun(run, now);
  next.status = "blocked";
  next.blocker = { ...blocker, evidence: [...blocker.evidence], nextOptions: [...blocker.nextOptions] };
  next.completionGate = { status: "blocked", reasons: [blocker.reason] };
  return next;
}
