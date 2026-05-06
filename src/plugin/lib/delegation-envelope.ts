import { buildDelegatedResultContractInstructions } from "./contracts.js";

export interface DelegationEnvelopeInput {
  goal: string;
  prompt: string;
  agent: string;
  scope?: string;
  nonGoals?: string[];
  constraints?: string[];
  allowedFiles?: string[];
  expectedVerification?: string[];
  timeoutHint?: string;
}

export interface DelegationEnvelope {
  goal: string;
  scope: string;
  agent: string;
  nonGoals: string[];
  constraints: string[];
  allowedFiles: string[];
  expectedVerification: string[];
  timeoutHint: string;
  outputContract: string;
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function list(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- none";
}

export function buildDelegationEnvelope(input: DelegationEnvelopeInput): DelegationEnvelope {
  return {
    goal: input.goal,
    scope: input.scope ?? input.prompt,
    agent: input.agent,
    nonGoals: unique([...(input.nonGoals ?? []), "Do not modify unrelated files"]),
    constraints: unique([...(input.constraints ?? []), "Preserve existing user changes"]),
    allowedFiles: unique(input.allowedFiles ?? ["unrestricted"]),
    expectedVerification: unique(input.expectedVerification ?? ["report inspected files and confidence"]),
    timeoutHint: input.timeoutHint ?? "Use the smallest verification that proves the result.",
    outputContract: buildDelegatedResultContractInstructions(),
  };
}

export function formatDelegationEnvelope(envelope: DelegationEnvelope): string {
  return [
    "# Delegated Task Envelope",
    "",
    "## Goal",
    envelope.goal,
    "",
    "## Scope",
    envelope.scope,
    "",
    "## Assigned Agent",
    envelope.agent,
    "",
    "## Non-Goals",
    list(envelope.nonGoals),
    "",
    "## Constraints",
    list(envelope.constraints),
    "",
    "## Allowed Files",
    list(envelope.allowedFiles),
    "",
    "## Expected Verification",
    list(envelope.expectedVerification),
    "",
    "## Timeout Hint",
    envelope.timeoutHint,
    "",
    "## Output Contract",
    envelope.outputContract,
  ].join("\n");
}
