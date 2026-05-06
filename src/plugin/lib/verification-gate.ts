import type { WorkflowCompletionGate, WorkflowEvidence, WorkflowRun, WorkflowStep } from "./workflow.js";

export type PolicyProfile = "strict" | "balanced" | "fast";
export interface WorkflowStepGateResult {
  status: "pass" | "needs_verification";
  reasons: string[];
}

function hasPassingEvidence(step: WorkflowStep, predicate: (evidence: WorkflowEvidence) => boolean): boolean {
  return step.evidence.some((evidence) => evidence.passed !== false && predicate(evidence));
}

function hasExplicitPassingEvidence(step: WorkflowStep, predicate: (evidence: WorkflowEvidence) => boolean): boolean {
  return step.evidence.some((evidence) => evidence.passed === true && predicate(evidence));
}

function commandMatchesConfigValidation(command: string): boolean {
  const normalized = command.toLowerCase();
  const mentionsConfig = /\b(config|schema|startup|load)\b|(?:^|[/\\.-])(?:opencode|package|tsconfig|jsconfig|bunfig|vite|vitest|eslint|prettier|biome|tsup|rollup|webpack|babel|jest)\.config\.[cm]?[jt]s\b|(?:^|[/\\.-])(?:package|tsconfig|jsconfig|bunfig)\.(?:json|jsonc|toml)\b|\.(?:ya?ml|toml)\b/.test(normalized);
  const mentionsValidation = /\b(validate|validation|check|parse|schema|startup|load)\b|--check\b/.test(normalized);
  return mentionsConfig && mentionsValidation;
}

function commandMatchesShellSyntax(command: string): boolean {
  const normalized = command.toLowerCase();
  return /\b(bash|sh|zsh|dash|ksh)\s+-n\b/.test(normalized) || /\bshellcheck\b/.test(normalized) || /\[scriptblock\]::create/.test(normalized);
}

function isRelevantCodeCommand(command: string, step: WorkflowStep): boolean {
  const normalized = command.trim().toLowerCase();
  if (!normalized || /^(date|pwd|ls)(\s|$)/.test(normalized)) return false;
  if (step.verification.some((verification) => {
    const expected = verification.trim().toLowerCase();
    return expected && (normalized.includes(expected) || (expected.includes(normalized) && normalized.length >= 8));
  })) return true;
  return /\b(test|typecheck|lint|build|check)\b|tsc\s+--noemit\b/.test(normalized);
}

export function evaluateWorkflowStepGate(step: WorkflowStep, profile: PolicyProfile): WorkflowStepGateResult {
  if (step.taskType === "code") {
    const hasCommandEvidence = hasExplicitPassingEvidence(step, (evidence) => evidence.kind === "command" && !!evidence.command && isRelevantCodeCommand(evidence.command, step));
    if (!hasCommandEvidence) {
      return { status: "needs_verification", reasons: [`Step ${step.id} requires passing relevant command evidence for task type ${step.taskType}.`] };
    }
  }

  if (step.taskType === "config") {
    const hasConfigEvidence = hasExplicitPassingEvidence(step, (evidence) => evidence.kind === "command" && !!evidence.command && commandMatchesConfigValidation(evidence.command));
    if (!hasConfigEvidence) return { status: "needs_verification", reasons: [`Step ${step.id} requires passing config validation command evidence.`] };
  }

  if (step.taskType === "shell") {
    const hasShellEvidence = hasExplicitPassingEvidence(step, (evidence) => evidence.kind === "command" && !!evidence.command && commandMatchesShellSyntax(evidence.command));
    if (!hasShellEvidence) return { status: "needs_verification", reasons: [`Step ${step.id} requires passing shell syntax command evidence.`] };
  }

  if (step.taskType === "docs") {
    const hasDocsEvidence = hasPassingEvidence(step, (evidence) => evidence.kind === "file" || evidence.kind === "review");
    if (!hasDocsEvidence) return { status: "needs_verification", reasons: [`Step ${step.id} requires file or review evidence for docs changes.`] };
  }

  if (step.taskType === "research") {
    const hasResearchEvidence = hasPassingEvidence(step, (evidence) => {
      if (profile === "fast") return evidence.kind === "manual" || evidence.kind === "source" || evidence.kind === "file" || evidence.kind === "review";
      return evidence.kind === "source" || evidence.kind === "file" || evidence.kind === "review";
    });
    if (!hasResearchEvidence && profile !== "fast") return { status: "needs_verification", reasons: [`Step ${step.id} requires source, file, or review evidence for research.`] };
    if (!hasResearchEvidence && profile === "fast") return { status: "needs_verification", reasons: [`Step ${step.id} requires at least lightweight source evidence for research.`] };
  }

  if (step.taskType === "review") {
    const hasReviewEvidence = hasPassingEvidence(step, (evidence) => evidence.kind === "review");
    if (!hasReviewEvidence) return { status: "needs_verification", reasons: [`Step ${step.id} requires review evidence for task type review.`] };
  }

  if (step.taskType === "unknown") {
    const hasAnyEvidence = hasPassingEvidence(step, () => true);
    if (!hasAnyEvidence) return { status: "needs_verification", reasons: [`Step ${step.id} requires at least one evidence item for task type unknown.`] };
  }

  return { status: "pass", reasons: [] };
}

export function evaluateWorkflowCompletionGate(run: WorkflowRun, profile: PolicyProfile): WorkflowCompletionGate {
  const blockedReasons = [
    ...(run.blocker ? [run.blocker.reason] : []),
    ...run.steps.flatMap((step) => {
      if (step.blocker) return [`Step ${step.id} is blocked: ${step.blocker.reason}`];
      if (step.status === "blocked") return [`Step ${step.id} is blocked.`];
      return [];
    }),
  ];
  if (blockedReasons.length > 0) return { status: "blocked", reasons: blockedReasons };

  const reasons = run.steps.flatMap((step) => evaluateWorkflowStepGate(step, profile).reasons);
  if (reasons.length === 0) return { status: "passed", reasons: [] };
  return { status: profile === "strict" ? "blocked" : "needs_verification", reasons };
}
