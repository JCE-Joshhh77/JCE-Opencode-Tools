/**
 * Orchestration Core — Public API
 * 
 * Re-exports all orchestration modules from a single entry point.
 * This is the main import for consumers of the orchestration system.
 */

// Types
export type {
  TaskNodeStatus,
  TaskNodeType,
  AgentRole,
  RetryStrategy,
  RetryPolicy,
  Compensation,
  TaskNode,
  TaskNodeInput,
  TaskNodeOutput,
  OutputExpectation,
  EvidenceType,
  Assertion,
  Evidence,
  FactSource,
  ConstraintOrigin,
  DecisionStatus,
  SignalPriority,
  Fact,
  Constraint,
  Decision,
  Artifact,
  Signal,
  GraphStatus,
  DependencyEdge,
  TaskGraph,
  TaskGraphSnapshot,
  PlanDelta,
  PlanAssessment,
  SchedulerConfig,
  SchedulerState,
  IntentType,
  IntentSignal,
  ScoredIntent,
  ExecutionMemoryV2,
  WisdomEntryV2,
  TaskLearningV2,
  ContextBudgetV2,
  SessionEntry,
} from "./types.js";

// TaskGraph
export {
  createTaskGraph,
  createTaskNode,
  addNode,
  removeNode,
  addEdge,
  transitionNode,
  failNode,
  completeNode,
  blockNode,
  attachEvidence,
  getReadyNodes,
  getDispatchableNodes,
  getRunningNodes,
  detectCycle,
  deriveGraphStatus,
  updateGraphStatus,
  promoteReadyNodes,
  snapshotGraph,
  restoreGraph,
  getNodesByStatus,
  getNodesByAgent,
  getDependentsOf,
  getDependenciesOf,
  getGraphStats,
} from "./task-graph.js";
export type { CreateGraphInput, CreateNodeInput } from "./task-graph.js";

// Scheduler
export { Scheduler, DEFAULT_SCHEDULER_CONFIG } from "./scheduler.js";
export type { SchedulerEvent, SchedulerEventType, SchedulerEventHandler } from "./scheduler.js";

// Agent Protocol
export {
  buildAgentRequest,
  formatAgentRequestAsPrompt,
  parseAgentResult,
  resultToNodeOutput,
} from "./agent-protocol.js";
export type { AgentRequest, AgentContext, AgentExpectations, AgentRetryInfo, AgentResult } from "./agent-protocol.js";

// Shared Memory
export {
  createOrchestrationMemory,
  addFact,
  addFacts,
  getFactsByScope,
  getTopFacts,
  addDecision,
  supersedeDecision,
  getActiveDecisions,
  addConstraint,
  deactivateConstraint,
  getActiveConstraints,
  addArtifact,
  addArtifacts,
  getArtifactsByNode,
  sendSignal,
  consumeSignals,
  getUnconsumedSignals,
  pruneMemory,
  snapshotMemory,
  restoreMemory,
} from "./shared-memory.js";
export type { OrchestrationMemory, OrchestrationMemorySnapshot, AddFactInput, AddDecisionInput, AddConstraintInput, SendSignalInput, PruneOptions } from "./shared-memory.js";

// Adaptive Planner
export { AdaptivePlanner } from "./planner.js";
export type { PlanTemplate } from "./planner.js";

// Evidence System
export {
  createEvidence,
  computeEvidenceConfidence,
  parseTestResults,
  aggregateEvidence,
  isEvidenceSufficient,
} from "./evidence-system.js";
export type { CreateEvidenceInput, AggregateEvidenceScore } from "./evidence-system.js";

// Intent Router v2
export { scoreIntent, toLegacyRoute } from "./intent-router.js";
export type { RouterContext, LegacySkillRoute } from "./intent-router.js";

// Execution Memory v2
export {
  createEmptyMemoryV2,
  loadMemoryV2,
  saveMemoryV2,
  pruneMemoryV2,
  getMemoryPath,
  mergeOrchestrationIntoMemory,
  restoreOrchestrationFromMemory,
  loadSkillCache,
  saveSkillCache,
  getCachedSkill,
  setCachedSkill,
  startSession,
  endSession,
} from "./execution-memory-v2.js";
export type { LoadMemoryResult } from "./execution-memory-v2.js";

// Orchestration Controller
export { OrchestrationController } from "./controller.js";
export type { OrchestrationControllerConfig, DispatchResult, CollectResult, OrchestrationStatus } from "./controller.js";

// Orchestration Bridge
export { OrchestrationBridge } from "./bridge.js";
export type { OrchestrationBridgeConfig, DispatchLoopResult, CollectLoopResult } from "./bridge.js";

// Intelligence Layer
export {
  assessTaskComplexity,
  shouldAutoActivate,
  buildCrossNodeContext,
  formatCrossNodeContext,
  identifyParallelGroups,
  evaluateCompletionGate,
  formatCompletionGateResult,
  shouldEscalateToUser,
  formatEscalation,
  shouldRecordToolEvidence,
  extractToolEvidence,
  findRelevantWisdom,
  findRelevantLearnings,
  formatWisdomContext,
  buildOrchestrationStatusReport,
  formatOrchestrationStatus,
  nodePhase,
  evaluatePhaseGates,
  formatPhaseGateReport,
  assessAdaptiveComplexity,
  formatAdaptiveComplexity,
} from "./intelligence.js";
export type { ComplexityAssessment, CompletionGateResult, EscalationDecision, OrchestrationStatusReport, ToolEvidenceInput, WorkflowPhase, PhaseGateStatus, PhaseGateReport, ExecutionStrategy, ComplexitySignals, AdaptiveComplexityResult } from "./intelligence.js";

// Workflow Templates
export {
  listWorkflowTemplates,
  getWorkflowTemplate,
  matchWorkflowTemplate,
  instantiateWorkflowTemplate,
} from "./workflow-templates.js";
export type { WorkflowTemplate, WorkflowTemplateId, InstantiatedTemplate } from "./workflow-templates.js";

// Failure Pattern Store
export {
  recordFailurePattern,
  queryFailurePattern,
  formatFailureWarning,
  pruneFailurePatterns,
} from "./failure-pattern-store.js";
export type { FailurePattern, RecordFailureInput } from "./failure-pattern-store.js";

// Strategy Telemetry
export {
  recordStrategyOutcome,
  computeStrategyStats,
  recommendStrategy,
  selectStrategyWithTelemetry,
  formatStrategyStats,
} from "./strategy-telemetry.js";
export type { StrategyOutcome, StrategyTelemetryEntry, StrategyStats, StrategyRecommendation } from "./strategy-telemetry.js";

// Risk Heatmap
export {
  buildRiskHeatmap,
  getFileRisk,
  formatRiskWarning,
} from "./risk-heatmap.js";
export type { RiskLevel, FileRisk, RiskHeatmap } from "./risk-heatmap.js";

// Speculative Pre-fetch
export {
  planSpeculativePrefetch,
  formatSpeculativePlan,
} from "./speculative-prefetch.js";
export type { SpeculativeTask, SpeculativePlan } from "./speculative-prefetch.js";

// Delegation Scenario Presets
export {
  listDelegationScenarios,
  getDelegationScenario,
  buildScenarioEnvelopeInput,
  matchDelegationScenario,
} from "./delegation-scenarios.js";
export type { DelegationScenario, ScenarioPreset } from "./delegation-scenarios.js";

// Reliability Layer
export {
  withErrorBoundary,
  withAsyncErrorBoundary,
  cancelPlan,
  createRateLimiter,
  detectTimedOutNodes,
  evaluateApprovalGate,
  formatApprovalGate,
  detectFileConflicts,
  formatConflictWarnings,
  createTokenBudgetTracker,
  estimateNodeTokenCost,
  createOrchestrationLogger,
  runHealthCheck,
  formatHealthCheck,
  generateRollbackPlan,
  formatRollbackPlan,
} from "./reliability.js";
export type { CancellationResult, RateLimiter, RateLimiterState, RateLimiterConfig, NodeTimeoutConfig, ApprovalGateResult, FileConflict, TokenBudget, TokenBudgetTracker, RollbackPlan, RollbackStep, LogLevel, LogEntry, OrchestrationLogger, HealthCheckResult, HealthCheck } from "./reliability.js";

