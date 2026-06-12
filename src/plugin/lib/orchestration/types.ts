/**
 * Orchestration Core — Type Definitions
 * 
 * The foundation of the Adaptive AI Orchestration system.
 * Replaces the old WorkflowRun with a real DAG-based task graph.
 */

// ─── Node Types ───────────────────────────────────────────────────────────────

export type TaskNodeStatus = "intake" | "pending" | "ready" | "running" | "verifying" | "awaiting_approval" | "done" | "failed" | "blocked" | "cancelled" | "abandoned";
export type TaskNodeType = "code" | "research" | "review" | "shell" | "config" | "verify" | "plan";
export type AgentRole = "self" | "oracle" | "jce-researcher" | "explorer" | "frontend" | "android";
export type BlockerClass = "missing_info" | "permission_boundary" | "verification_failure" | "architecture_uncertainty" | "flaky_environment" | "external_dependency" | "requirements_conflict" | "unknown";
export type RecoveryActionV2 = "retry_same" | "retry_with_more_context" | "switch_agent" | "run_narrower_verification" | "rollback_local_change" | "block_and_handoff";
export type AutonomyLevel = "conservative" | "balanced" | "autonomous" | "release-lock";

export type RetryStrategy = "same" | "different_approach" | "different_agent" | "escalate_user";

export interface RetryPolicy {
  maxRetries: number;
  strategy: RetryStrategy[];
  currentRetry: number;
  backoffMs?: number;
}

export interface Compensation {
  type: "git_revert" | "file_restore" | "manual";
  description: string;
  files?: string[];
  command?: string;
}

export interface TaskNode {
  id: string;
  type: TaskNodeType;
  title: string;
  description: string;
  agent: AgentRole;
  status: TaskNodeStatus;
  dependencies: string[];
  input: TaskNodeInput;
  output?: TaskNodeOutput;
  evidence: Evidence[];
  compensation?: Compensation;
  retryPolicy: RetryPolicy;
  priority: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  failureReason?: string;
  blockerClass?: BlockerClass;
  transitionHistory?: TaskNodeTransition[];
  metadata?: Record<string, unknown>;
}

export interface TaskNodeTransition {
  from: TaskNodeStatus;
  to: TaskNodeStatus;
  reason: string;
  at: string;
}

export interface TaskNodeInput {
  prompt: string;
  context: Fact[];
  constraints: Constraint[];
  expectedOutput?: OutputExpectation;
  maxTokenBudget?: number;
  skills?: string[];
}

export interface TaskNodeOutput {
  summary: string;
  artifacts: Artifact[];
  evidence: Evidence[];
  newFacts: Fact[];
  confidence: number;
  blockers?: string[];
  confidenceByDimension?: ConfidenceVector;
  raw?: string;
}

export interface ConfidenceVector {
  intent: number;
  routing: number;
  implementation: number;
  verification: number;
  completion: number;
}

export interface OutputExpectation {
  sections: string[];
  requireEvidence: boolean;
  minConfidence: number;
}

// ─── Evidence Types ───────────────────────────────────────────────────────────

export type EvidenceType = "command_output" | "test_result" | "type_check" | "lint" | "file_diff" | "build" | "manual" | "review_approval";

export interface Assertion {
  description: string;
  passed: boolean;
  actual?: string;
  expected?: string;
}

export interface Evidence {
  id: string;
  type: EvidenceType;
  source: string;
  command?: string;
  exitCode?: number;
  assertions: Assertion[];
  confidence: number;
  raw?: string;
  timestamp: string;
}

// ─── Shared Memory Types ──────────────────────────────────────────────────────

export type FactSource = "user" | "agent" | "tool" | "inference";
export type ConstraintOrigin = "user" | "system" | "discovered";
export type DecisionStatus = "active" | "superseded" | "reverted";
export type SignalPriority = "low" | "normal" | "high" | "critical";

export interface Fact {
  id: string;
  key: string;
  value: string;
  source: FactSource;
  confidence: number;
  discoveredAt: string;
  expiresAt?: string;
  tags?: string[];
}

export interface Constraint {
  id: string;
  description: string;
  origin: ConstraintOrigin;
  scope?: string;
  active: boolean;
  createdAt: string;
}

export interface Decision {
  id: string;
  description: string;
  reasoning: string;
  alternatives: string[];
  status: DecisionStatus;
  madeAt: string;
  supersededBy?: string;
  nodeId?: string;
}

export interface Artifact {
  id: string;
  path: string;
  type: "created" | "modified" | "deleted";
  description: string;
  nodeId: string;
  timestamp: string;
}

export interface Signal {
  id: string;
  fromNodeId: string;
  toNodeId?: string;
  type: "info" | "warning" | "blocker" | "discovery";
  priority: SignalPriority;
  message: string;
  data?: unknown;
  timestamp: string;
  consumed: boolean;
}

// ─── TaskGraph Types ──────────────────────────────────────────────────────────

export type GraphStatus = "planning" | "executing" | "paused" | "completed" | "failed" | "cancelled";

export interface DependencyEdge {
  from: string;
  to: string;
  type: "blocks" | "informs";
}

export interface TaskGraph {
  id: string;
  goal: string;
  status: GraphStatus;
  nodes: Map<string, TaskNode>;
  edges: DependencyEdge[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskGraphSnapshot {
  id: string;
  goal: string;
  status: GraphStatus;
  nodes: TaskNode[];
  edges: DependencyEdge[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  metadata?: Record<string, unknown>;
}

// ─── Planner Types ────────────────────────────────────────────────────────────

export interface PlanDelta {
  addNodes: Omit<TaskNode, "status" | "createdAt" | "evidence" | "output">[];
  removeNodeIds: string[];
  addEdges: DependencyEdge[];
  removeEdges: DependencyEdge[];
  reason: string;
}

export interface PlanAssessment {
  confidence: number;
  confidenceByDimension?: ConfidenceVector;
  completionEstimate: number;
  risks: string[];
  suggestions: string[];
}

export interface BlockerDecision {
  classification: BlockerClass;
  action: RecoveryActionV2;
  askUser: boolean;
  delegateToOracle: boolean;
  continueWithSafeAssumption: boolean;
  reason: string;
}

// ─── Scheduler Types ──────────────────────────────────────────────────────────

export interface SchedulerConfig {
  maxConcurrency: number;
  maxConcurrencyPerAgent: Record<AgentRole, number>;
  staleAfterMs: number;
  defaultRetryPolicy: RetryPolicy;
}

export interface SchedulerState {
  runningCount: number;
  pendingCount: number;
  completedCount: number;
  failedCount: number;
  blockedCount: number;
}

// ─── Intent Router v2 Types ───────────────────────────────────────────────────

export type IntentType = "bugfix" | "feature" | "refactor" | "review" | "release" | "research" | "config" | "docs" | "general";

export interface IntentSignal {
  source: "keyword" | "file_extension" | "git_context" | "history" | "explicit";
  intent: IntentType;
  weight: number;
  reason: string;
}

export interface ScoredIntent {
  intent: IntentType;
  score: number;
  confidence: number;
  signals: IntentSignal[];
  skills: string[];
  agentHint?: AgentRole;
}

// ─── Execution Memory v2 Types ────────────────────────────────────────────────

export interface ExecutionMemoryV2 {
  version: 2;
  updatedAt: string;
  graph?: TaskGraphSnapshot;
  memoryTiers?: MemoryTierSnapshot;
  facts: Fact[];
  decisions: Decision[];
  artifacts: Artifact[];
  evidence: Evidence[];
  wisdom: WisdomEntryV2[];
  taskLearnings: TaskLearningV2[];
  contextBudget?: ContextBudgetV2;
  sessionHistory: SessionEntry[];
  operatorPreferences?: OperatorPreferences;
  autonomyLevel?: AutonomyLevel;
  /** Structured failure patterns: error signature → root cause → fix category. */
  failurePatterns?: FailurePatternV2[];
  /** Strategy outcome telemetry: which strategy was chosen per intent and its result. */
  strategyTelemetry?: StrategyTelemetryV2[];
  /** Persisted orchestration coordination state (constraints/signals) that must survive reloads. */
  orchestration?: {
    constraints: Constraint[];
    signals: Signal[];
  };
}

export interface FailurePatternV2 {
  signature: string;
  errorClass?: string;
  rootCause?: string;
  fixCategory?: string;
  badFixes: string[];
  successCount: number;
  failCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface StrategyTelemetryV2 {
  intent: IntentType;
  strategy: "direct" | "plan-then-exec" | "multi-phase" | "user-gate";
  outcome: "success" | "partial" | "failed" | "abandoned";
  retries?: number;
  recordedAt: string;
}

export interface MemoryTierSnapshot {
  session: {
    currentTask?: string;
    blockers: string[];
    pendingPlan?: string;
  };
  project: {
    conventions: string[];
    releaseFiles: string[];
    standardVerification: string[];
    dangerousAreas: string[];
  };
  failure: {
    knownErrors: string[];
    badFixes: string[];
    successfulFixes: string[];
  };
  operator: {
    preferTerseReports: boolean;
    preferAutonomousCompletion: boolean;
    preferBroadVerification: boolean;
  };
}

export interface OperatorPreferences {
  preferAutonomousCompletion?: boolean;
  askBeforeArchitectureChange?: boolean;
  preferBroadVerification?: boolean;
  preferTerseReports?: boolean;
  defaultReleaseStrictness?: "low" | "medium" | "high";
}

export interface WisdomEntryV2 {
  id: string;
  learning: string;
  source: "task" | "delegation" | "debug" | "review" | "release" | "tooling";
  confidence: "low" | "medium" | "high";
  tags: string[];
  createdAt: string;
  expiresAt?: string;
  usageCount: number;
}

export interface TaskLearningV2 {
  id: string;
  taskType: IntentType;
  trigger: string;
  successfulRecipe: string[];
  verificationCommands: string[];
  touchedAreas: string[];
  confidence: number;
  createdAt: string;
  lastUsedAt?: string;
}

export interface ContextBudgetV2 {
  totalOriginalChars: number;
  totalCompressedChars: number;
  totalTokensSaved: number;
  savingsPercent: number;
  bySource: Record<string, { chars: number; tokens: number; count: number }>;
}

export interface SessionEntry {
  id: string;
  startedAt: string;
  endedAt?: string;
  nodesCompleted: number;
  nodesFailed: number;
  intent?: IntentType;
}
