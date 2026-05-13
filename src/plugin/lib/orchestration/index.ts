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
