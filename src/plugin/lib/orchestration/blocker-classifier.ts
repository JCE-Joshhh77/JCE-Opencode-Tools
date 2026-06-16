import type { BlockerClass, BlockerDecision, RecoveryActionV2 } from "./types.js";

function classify(reason: string): BlockerClass {
  const lower = reason.toLowerCase();
  if (/architecture|design uncertainty|trade-?off|rethink/.test(lower)) return "architecture_uncertainty";
  if (/missing|required|need .*info|unclear|ambiguous/.test(lower)) return "missing_info";
  if (/permission|approval|access denied|explicit approval/.test(lower)) return "permission_boundary";
  if (/test failed|verification failed|typecheck|lint|build failed/.test(lower)) return "verification_failure";
  if (/timeout|flaky|intermittent|stale|transient/.test(lower)) return "flaky_environment";
  if (/network|service unavailable|external|dependency|github|api limit/.test(lower)) return "external_dependency";
  if (/conflict|contradict|requirements/.test(lower)) return "requirements_conflict";
  return "unknown";
}

function mapping(kind: BlockerClass): Omit<BlockerDecision, "classification" | "reason"> {
  const map: Record<BlockerClass, Omit<BlockerDecision, "classification" | "reason">> = {
    missing_info: { action: "retry_with_more_context", askUser: false, delegateToOracle: false, continueWithSafeAssumption: true },
    permission_boundary: { action: "block_and_handoff", askUser: true, delegateToOracle: false, continueWithSafeAssumption: false },
    verification_failure: { action: "run_narrower_verification", askUser: false, delegateToOracle: false, continueWithSafeAssumption: false },
    architecture_uncertainty: { action: "switch_agent", askUser: false, delegateToOracle: true, continueWithSafeAssumption: false },
    flaky_environment: { action: "retry_with_more_context", askUser: false, delegateToOracle: false, continueWithSafeAssumption: true },
    external_dependency: { action: "retry_same", askUser: false, delegateToOracle: false, continueWithSafeAssumption: true },
    requirements_conflict: { action: "block_and_handoff", askUser: true, delegateToOracle: false, continueWithSafeAssumption: false },
    unknown: { action: "switch_agent", askUser: false, delegateToOracle: true, continueWithSafeAssumption: false },
  };
  return map[kind];
}

export function classifyBlocker(reason: string): BlockerDecision {
  const classification = classify(reason);
  return {
    classification,
    reason,
    ...mapping(classification),
  };
}

export function recoveryActionToRetryStrategy(action: RecoveryActionV2): "same" | "different_approach" | "different_agent" | "escalate_user" {
  switch (action) {
    case "retry_same": return "same";
    case "retry_with_more_context": return "different_approach";
    case "switch_agent": return "different_agent";
    case "run_narrower_verification": return "different_approach";
    case "rollback_local_change": return "different_approach";
    case "block_and_handoff": return "escalate_user";
  }
}
