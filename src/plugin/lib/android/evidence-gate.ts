import type { PlannedAndroidCommand } from "./command-planner.js";

export interface AndroidCommandEvidence { command: string; exitCode: number; stdout?: string; stderr?: string; skipped?: boolean; skipReason?: string }
export interface AndroidEvidenceGateResult { status: "pass" | "fail" | "blocked" | "insufficient"; missingCommands: string[]; failedCommands: string[]; blockers: string[]; summary: string }

export function evaluateAndroidEvidence(commands: PlannedAndroidCommand[], evidence: AndroidCommandEvidence[]): AndroidEvidenceGateResult {
  const required = commands.filter((command) => command.priority === "required" && !command.optional);
  const evidenceByCommand = new Map(evidence.map((item) => [item.command, item]));
  const blockers = [...new Set(commands.flatMap((command) => command.blockedBy))];
  const missingCommands = required.filter((command) => !evidenceByCommand.has(command.command)).map((command) => command.command);
  const failedCommands = evidence.filter((item) => !item.skipped && item.exitCode !== 0).map((item) => item.command);
  const skippedRequired = required.filter((command) => evidenceByCommand.get(command.command)?.skipped).map((command) => command.command);
  if (blockers.length && missingCommands.length) return { status: "blocked", missingCommands, failedCommands, blockers, summary: "Android verification is blocked by environment/tooling prerequisites." };
  if (failedCommands.length) return { status: "fail", missingCommands, failedCommands, blockers, summary: "Android verification failed; inspect failed command output before claiming completion." };
  if (missingCommands.length || skippedRequired.length) return { status: "insufficient", missingCommands: [...new Set([...missingCommands, ...skippedRequired])], failedCommands, blockers, summary: "Required Android verification evidence is missing or skipped." };
  return { status: "pass", missingCommands: [], failedCommands: [], blockers, summary: "Required Android verification evidence passed." };
}
