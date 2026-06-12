/**
 * Workflow Templates — pre-built multi-phase node configurations
 *
 * Instead of planning every complex task from scratch, the planner can
 * instantiate a known-good template for common patterns (release, migration,
 * security audit, large refactor). Each template produces a set of
 * CreateNodeInput plus dependency edges, ready to add to a TaskGraph.
 *
 * Templates are intentionally conservative: they encode phase structure and
 * verification gates, not project-specific commands. The AI fills in concrete
 * details per node at execution time.
 */

import type { AgentRole, TaskNodeType } from "./types.js";
import type { CreateNodeInput } from "./task-graph.js";

export type WorkflowTemplateId =
  | "release"
  | "migration"
  | "security-audit"
  | "large-refactor"
  | "incident-response";

export interface WorkflowTemplate {
  id: WorkflowTemplateId;
  title: string;
  description: string;
  /** Regex that suggests this template based on the user's goal. */
  triggers: RegExp;
  /** Minimum complexity score before this template is worth instantiating. */
  minComplexity: number;
}

interface TemplateStep {
  key: string;
  type: TaskNodeType;
  title: string;
  agent: AgentRole;
  /** Keys of prior steps this step depends on. */
  dependsOn: string[];
  promptHint: string;
  skills: string[];
}

interface TemplateBlueprint extends WorkflowTemplate {
  steps: TemplateStep[];
}

export interface InstantiatedTemplate {
  templateId: WorkflowTemplateId;
  nodes: CreateNodeInput[];
  edges: Array<{ from: string; to: string }>;
}

// ─── Template Blueprints ──────────────────────────────────────────────────────

const TEMPLATES: TemplateBlueprint[] = [
  {
    id: "release",
    title: "Release workflow",
    description: "Version sync → verify → stage → release with safety gates.",
    triggers: /\b(prepare|cut|do|ship)\s+(a\s+)?release|version\s+bump|release\s+readiness|tag\s+(a\s+)?release|publish\s+(the\s+)?package\b/i,
    minComplexity: 3,
    steps: [
      { key: "scan", type: "research", title: "Scan release surface", agent: "explorer", dependsOn: [], skills: ["release-engineering", "codebase-intelligence"], promptHint: "Identify all version files (package metadata, installers, constants, README badge, version tests) and current values that must stay in sync." },
      { key: "sync", type: "code", title: "Synchronize version values", agent: "self", dependsOn: ["scan"], skills: ["release-engineering"], promptHint: "Update every version location to the target version. Do not touch unrelated files." },
      { key: "verify", type: "verify", title: "Full verification", agent: "self", dependsOn: ["sync"], skills: ["verification-discipline"], promptHint: "Run typecheck and full test suite. Capture exact pass/fail counts. Block on any failure." },
      { key: "stage", type: "review", title: "Stage clean changes", agent: "self", dependsOn: ["verify"], skills: ["git-guardrails"], promptHint: "Review diff scope. Stage only intended files. Exclude scratch, context, and secrets. Confirm with user before commit/push." },
    ],
  },
  {
    id: "migration",
    title: "Migration workflow",
    description: "Phased migration with characterization safety net and per-batch verification.",
    triggers: /\b(migrate\s+(?:to|from|all|the|every|our|this)|migration\s+(?:plan|workflow|strategy|of|to|from)|port\s+(?:the\s+)?\w+\s+to|upgrade\s+(?:the\s+)?framework|move\s+from\s+\w+\s+to|convert\s+all\s+\w+\s+to)\b/i,
    minComplexity: 4,
    steps: [
      { key: "map", type: "research", title: "Map migration scope", agent: "explorer", dependsOn: [], skills: ["code-archaeology", "codebase-intelligence"], promptHint: "Enumerate all affected files/modules. Identify call sites, shared contracts, and migration order by dependency." },
      { key: "safety", type: "code", title: "Add characterization tests", agent: "self", dependsOn: ["map"], skills: ["testing-strategies"], promptHint: "Capture current behavior as tests before changing anything, so regressions are caught during migration." },
      { key: "plan", type: "plan", title: "Plan migration batches", agent: "self", dependsOn: ["map", "safety"], skills: ["estimation-planning", "orchestration-patterns"], promptHint: "Split into independently verifiable batches ordered by dependency. Define a rollback point per batch." },
      { key: "execute", type: "code", title: "Execute migration batches", agent: "self", dependsOn: ["plan"], skills: ["software-engineering", "orchestration-patterns"], promptHint: "Migrate one batch at a time. Checkpoint before each. Verify after each before advancing." },
      { key: "verify", type: "verify", title: "Verify full migration", agent: "self", dependsOn: ["execute"], skills: ["verification-discipline"], promptHint: "Run characterization tests and full suite. Confirm no behavior changed unintentionally." },
    ],
  },
  {
    id: "security-audit",
    title: "Security audit workflow",
    description: "Surface mapping → findings by severity → remediation → re-verify.",
    triggers: /\b(security\s+(audit|review)|audit\s+(the\s+)?(security|auth|api)|pen\s*test|vulnerabilit(y|ies)\s+scan|threat\s+model)\b/i,
    minComplexity: 3,
    steps: [
      { key: "surface", type: "research", title: "Map attack surface", agent: "explorer", dependsOn: [], skills: ["security", "codebase-intelligence"], promptHint: "Identify entry points, auth boundaries, input handling, secrets, and trust boundaries." },
      { key: "findings", type: "review", title: "Catalog findings by severity", agent: "oracle", dependsOn: ["surface"], skills: ["security"], promptHint: "List findings ordered by severity with file/line refs. Separate confirmed from suspected." },
      { key: "remediate", type: "code", title: "Remediate high-severity findings", agent: "self", dependsOn: ["findings"], skills: ["security", "software-engineering"], promptHint: "Fix highest-severity issues first with secure patterns. Do not introduce regressions." },
      { key: "verify", type: "verify", title: "Re-verify after fixes", agent: "self", dependsOn: ["remediate"], skills: ["verification-discipline", "security"], promptHint: "Confirm fixes hold, add regression tests, and re-check the surface for the patched class of issue." },
    ],
  },
  {
    id: "large-refactor",
    title: "Large refactor workflow",
    description: "Preserve behavior; refactor in tight, verified increments.",
    triggers: /\b(large\s+refactor|big\s+refactor|refactor\s+(the\s+)?(whole|entire|all)|restructure|untangle|decompose\s+(the\s+)?monolith)\b/i,
    minComplexity: 4,
    steps: [
      { key: "understand", type: "research", title: "Understand current design", agent: "explorer", dependsOn: [], skills: ["code-archaeology", "codebase-intelligence"], promptHint: "Map current structure, responsibilities, and why it is shaped this way before changing it." },
      { key: "baseline", type: "code", title: "Establish test baseline", agent: "self", dependsOn: ["understand"], skills: ["testing-strategies"], promptHint: "Ensure behavior is covered by tests so the refactor can preserve behavior provably." },
      { key: "refactor", type: "code", title: "Refactor in increments", agent: "self", dependsOn: ["baseline"], skills: ["software-engineering", "orchestration-patterns"], promptHint: "Refactor in small steps. Keep public contracts stable. No behavior changes mixed in. Verify after each step." },
      { key: "verify", type: "verify", title: "Verify behavior preserved", agent: "self", dependsOn: ["refactor"], skills: ["verification-discipline"], promptHint: "Run the baseline suite. Confirm identical behavior and no regressions." },
    ],
  },
  {
    id: "incident-response",
    title: "Incident response workflow",
    description: "Stabilize first, root-cause after. Mitigate with smallest blast radius.",
    triggers: /\b(production\s+(is\s+)?down|outage|incident|hotfix|rollback\s+(the\s+)?(deploy|release)|users?\s+(are\s+)?(impacted|affected))\b/i,
    minComplexity: 2,
    steps: [
      { key: "triage", type: "research", title: "Triage and scope", agent: "explorer", dependsOn: [], skills: ["incident-response"], promptHint: "Confirm the issue is real, determine scope/severity, and identify the likely trigger (recent deploy?)." },
      { key: "mitigate", type: "code", title: "Mitigate (stabilize)", agent: "self", dependsOn: ["triage"], skills: ["incident-response", "failure-recovery"], promptHint: "Restore service with the smallest safe action (flag off / rollback). Verify rollback safety first. User-gate if irreversible." },
      { key: "stabilize-verify", type: "verify", title: "Confirm recovery", agent: "self", dependsOn: ["mitigate"], skills: ["verification-discipline"], promptHint: "Confirm symptom gone via real signal, no new errors, sustained stability — not a momentary blip." },
      { key: "rootcause", type: "code", title: "Root-cause fix", agent: "self", dependsOn: ["stabilize-verify"], skills: ["failure-recovery", "software-engineering"], promptHint: "After stabilization, fix the underlying cause, add a regression test, and add detection if it was missed." },
    ],
  },
];

// ─── Public API ────────────────────────────────────────────────────────────────

export function listWorkflowTemplates(): WorkflowTemplate[] {
  return TEMPLATES.map(({ steps: _steps, ...meta }) => meta);
}

export function getWorkflowTemplate(id: WorkflowTemplateId): WorkflowTemplate | undefined {
  const found = TEMPLATES.find((t) => t.id === id);
  if (!found) return undefined;
  const { steps: _steps, ...meta } = found;
  return meta;
}

/**
 * Match a user goal to the best workflow template, if any.
 * Returns the highest-priority match (templates are checked in declared order).
 */
export function matchWorkflowTemplate(goal: string, complexityScore = Infinity): WorkflowTemplate | null {
  for (const t of TEMPLATES) {
    if (t.triggers.test(goal) && complexityScore >= t.minComplexity) {
      const { steps: _steps, ...meta } = t;
      return meta;
    }
  }
  return null;
}

/**
 * Instantiate a template into concrete TaskGraph node inputs and edges.
 * Node ids are namespaced with a short random suffix to avoid collisions.
 */
export function instantiateWorkflowTemplate(id: WorkflowTemplateId, goal: string): InstantiatedTemplate | null {
  const blueprint = TEMPLATES.find((t) => t.id === id);
  if (!blueprint) return null;

  const suffix = Math.random().toString(36).slice(2, 6);
  const nodeId = (key: string) => `tmpl-${id}-${key}-${suffix}`;

  const nodes: CreateNodeInput[] = blueprint.steps.map((step, index) => ({
    id: nodeId(step.key),
    type: step.type,
    title: step.title,
    description: `${step.title} for: ${goal}`,
    agent: step.agent,
    dependencies: step.dependsOn.map(nodeId),
    prompt: `${step.promptHint}\n\nGoal: ${goal}`,
    skills: step.skills,
    priority: blueprint.steps.length - index,
    metadata: { workflowTemplate: id, templatePhase: step.key },
  }));

  const edges: Array<{ from: string; to: string }> = [];
  for (const step of blueprint.steps) {
    for (const dep of step.dependsOn) {
      edges.push({ from: nodeId(dep), to: nodeId(step.key) });
    }
  }

  return { templateId: id, nodes, edges };
}
