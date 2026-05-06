export type JceWorkerIntent = "bugfix" | "feature" | "completion_claim" | "review" | "branch_completion" | "parallel_work" | "general";
export type JceWorkerAgentHint = "oracle" | "jce-researcher" | "explorer" | "frontend";

export interface SkillRoute {
  intent: JceWorkerIntent;
  skills: string[];
  reason: string;
  agentHint?: JceWorkerAgentHint;
}

function includesAny(text: string, markers: string[]): boolean {
  const tokens = new Set(text.split(/[^a-z0-9]+/).filter(Boolean));

  return markers.some((marker) => (marker.includes(" ") ? text.includes(marker) : tokens.has(marker)));
}

export function routeJceWorkerIntent(input: string): SkillRoute {
  const text = input.toLowerCase();

  if (includesAny(text, ["finish this branch", "prepare merge", "wrap up branch", "branch completion", "branch", "merge"])) {
    return { intent: "branch_completion", skills: ["finishing-a-development-branch"], reason: "Branch wrap-up should use the development-branch completion workflow." };
  }

  if (includesAny(text, ["review", "audit", "check this implementation"])) {
    return { intent: "review", skills: ["requesting-code-review"], reason: "Review requests require a code-review workflow." };
  }

  if (includesAny(text, ["complete", "completed", "done", "finished", "ready"])) {
    return { intent: "completion_claim", skills: ["verification-before-completion"], reason: "Completion claims require fresh verification evidence." };
  }

  if (includesAny(text, ["parallel", "independent", "concurrent"])) {
    return { intent: "parallel_work", skills: ["dispatching-parallel-agents"], reason: "Independent work can be delegated in parallel.", agentHint: "explorer" };
  }

  if (includesAny(text, ["bug", "fix", "error", "crash", "failing test", "failed test", "debug"])) {
    return { intent: "bugfix", skills: ["systematic-debugging", "test-driven-development"], reason: "Detected bug or failing test intent." };
  }

  if (includesAny(text, ["add", "implement", "feature", "behavior", "build", "create"])) {
    return { intent: "feature", skills: ["brainstorming", "writing-plans", "test-driven-development"], reason: "Feature or behavior changes require design, planning, and TDD." };
  }

  return { intent: "general", skills: [], reason: "No specialized workflow required for this request." };
}
