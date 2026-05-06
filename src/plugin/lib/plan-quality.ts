import type { WorkflowRun, WorkflowTaskType } from "./workflow.js";

export interface PlanQualityOptions {
  complex: boolean;
}

export interface PlanQualityResult {
  valid: boolean;
  issues: string[];
}

const VERIFICATION_REQUIRED_TYPES: WorkflowTaskType[] = ["code", "config", "shell"];
const BROAD_SEQUENCING_MARKERS = [" and then ", " then ", ", then "];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function criterionCovered(criterion: string, stepText: string): boolean {
  const criterionTerms = tokens(criterion).filter((term) => term !== "exists");
  const stepTokens = new Set(tokens(stepText));
  return criterionTerms.length > 0 && criterionTerms.every((term) => stepTokens.has(term));
}

function tokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter(Boolean);
}

function hasMultipleSemicolonActions(text: string): boolean {
  return text
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean).length > 2;
}

function stepTooBroad(title: string, expectedOutput?: string): boolean {
  const text = `${title} ${expectedOutput ?? ""}`.toLowerCase();
  return BROAD_SEQUENCING_MARKERS.some((marker) => text.includes(marker)) || hasMultipleSemicolonActions(title) || hasMultipleSemicolonActions(expectedOutput ?? "");
}

export function validateWorkflowPlan(run: WorkflowRun, options: PlanQualityOptions): PlanQualityResult {
  const issues: string[] = [];

  if (options.complex && run.steps.length === 0) {
    issues.push("Complex workflows must include at least one step.");
  }

  for (const criterion of run.acceptanceCriteria) {
    const covered = run.steps.some((step) => criterionCovered(criterion, `${step.title} ${step.expectedOutput ?? ""}`));
    if (!covered) issues.push(`Acceptance criterion is not covered by any step: ${criterion}`);
  }

  const seen = new Set<string>();
  const allStepIds = new Set(run.steps.map((step) => step.id));
  for (const step of run.steps) {
    if (stepTooBroad(step.title, step.expectedOutput)) {
      issues.push(`Step ${step.id} is too broad for one execution unit.`);
    }

    if (step.taskType !== "research" && !(step.expectedOutput && step.expectedOutput.trim())) {
      issues.push(`Step ${step.id} must define expected output.`);
    }

    if (VERIFICATION_REQUIRED_TYPES.includes(step.taskType) && step.verification.length === 0) {
      issues.push(`Step ${step.id} with task type ${step.taskType} must define verification.`);
    }

    for (const dependency of step.dependsOn) {
      if (!allStepIds.has(dependency)) {
        issues.push(`Step ${step.id} depends on unknown step: ${dependency}`);
      } else if (!seen.has(dependency)) {
        issues.push(`Step ${step.id} depends on step ${dependency} that does not appear earlier in the plan.`);
      }
    }

    seen.add(step.id);
  }

  return { valid: issues.length === 0, issues };
}
