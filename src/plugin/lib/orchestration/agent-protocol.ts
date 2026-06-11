/**
 * Agent Protocol — Structured communication between orchestrator and sub-agents
 * 
 * Replaces fire-and-forget text prompts with typed request/result contracts.
 * Enables structured data exchange, fact propagation, and quality assessment.
 */

import type {
  AgentRole,
  Artifact,
  Constraint,
  Evidence,
  EvidenceType,
  Fact,
  TaskNode,
  TaskNodeOutput,
  Assertion,
} from "./types.js";

// ─── Agent Request ────────────────────────────────────────────────────────────

export interface AgentRequest {
  taskId: string;
  nodeId: string;
  agent: AgentRole;
  goal: string;
  prompt: string;
  context: AgentContext;
  expectations: AgentExpectations;
  retryInfo?: AgentRetryInfo;
}

export interface AgentContext {
  facts: Fact[];
  constraints: Constraint[];
  priorArtifacts: Artifact[];
  skills: string[];
  maxTokenBudget?: number;
}

export interface AgentExpectations {
  requiredSections: string[];
  requireEvidence: boolean;
  minConfidence: number;
  expectedArtifacts?: string[];
}

export interface AgentRetryInfo {
  attempt: number;
  maxAttempts: number;
  previousFailure: string;
  strategy: string;
  priorEvidence: string[];
}

// ─── Agent Result ─────────────────────────────────────────────────────────────

export interface AgentResult {
  taskId: string;
  nodeId: string;
  agent: AgentRole;
  status: "success" | "partial" | "failed" | "blocked";
  summary: string;
  artifacts: Artifact[];
  evidence: Evidence[];
  newFacts: Fact[];
  confidence: number;
  blockers: string[];
  raw: string;
  tokenUsage?: { prompt: number; completion: number };
}

// ─── Protocol Builder ─────────────────────────────────────────────────────────

/**
 * Build a structured agent request from a TaskNode.
 */
export function buildAgentRequest(node: TaskNode, context: AgentContext, retryInfo?: AgentRetryInfo): AgentRequest {
  return {
    taskId: `task-${node.id}`,
    nodeId: node.id,
    agent: node.agent,
    goal: node.title,
    prompt: node.input.prompt,
    context: {
      facts: [...context.facts, ...node.input.context],
      constraints: [...context.constraints, ...node.input.constraints],
      priorArtifacts: context.priorArtifacts,
      skills: node.input.skills ?? context.skills,
      maxTokenBudget: node.input.maxTokenBudget ?? context.maxTokenBudget,
    },
    expectations: {
      requiredSections: node.input.expectedOutput?.sections ?? ["Summary", "Files", "Verification", "Risks"],
      requireEvidence: node.input.expectedOutput?.requireEvidence ?? true,
      minConfidence: node.input.expectedOutput?.minConfidence ?? 0.6,
      expectedArtifacts: undefined,
    },
    retryInfo,
  };
}

/**
 * Format an AgentRequest into a prompt string for the sub-agent.
 * This is the bridge between structured protocol and text-based execution.
 */
export function formatAgentRequestAsPrompt(request: AgentRequest): string {
  const sections: string[] = [];

  // Goal section
  sections.push(`## Goal\n${request.goal}`);

  // Main prompt
  sections.push(`## Task\n${request.prompt}`);

  // Context: facts
  if (request.context.facts.length > 0) {
    const factLines = request.context.facts
      .slice(0, 20)
      .map((f) => `- **${f.key}**: ${f.value} (confidence: ${f.confidence})`)
      .join("\n");
    sections.push(`## Known Facts\n${factLines}`);
  }

  // Context: constraints
  if (request.context.constraints.length > 0) {
    const constraintLines = request.context.constraints
      .filter((c) => c.active)
      .map((c) => `- ${c.description}`)
      .join("\n");
    sections.push(`## Constraints\n${constraintLines}`);
  }

  // Retry context
  if (request.retryInfo) {
    sections.push([
      `## Retry Context`,
      `Attempt ${request.retryInfo.attempt} of ${request.retryInfo.maxAttempts}`,
      `Strategy: ${request.retryInfo.strategy}`,
      `Previous failure: ${request.retryInfo.previousFailure}`,
      request.retryInfo.priorEvidence.length > 0
        ? `Prior evidence:\n${request.retryInfo.priorEvidence.map((e) => `- ${e}`).join("\n")}`
        : "",
    ].filter(Boolean).join("\n"));
  }

  // Output contract
  sections.push([
    `## Output Contract`,
    `Return your result with these sections:`,
    ...request.expectations.requiredSections.map((s) => `- ## ${s}`),
    request.expectations.requireEvidence ? `\nVerification MUST include actual command output with exit codes.` : "",
    `\nMinimum confidence threshold: ${request.expectations.minConfidence}`,
  ].filter(Boolean).join("\n"));

  return sections.join("\n\n");
}

// ─── Result Parser ────────────────────────────────────────────────────────────

const EXIT_CODE_REGEX = /exit\s*(?:code|status)?\s*[:=]?\s*(\d+)/gi;
const COMMAND_REGEX = /(?:^|\n)\s*(?:\$|>|#)\s*(.+)/g;
const TEST_RESULT_REGEX = /(\d+)\s*(?:tests?|specs?|cases?)\s*(?:passed|✓|✔)/i;
const TEST_FAIL_REGEX = /(\d+)\s*(?:tests?|specs?|cases?)\s*(?:failed|✗|✘|×)/i;
const FILE_PATH_REGEX = /(?:created?|modified?|deleted?|updated?|wrote|changed)\s+[`"]?([^\s`"]+\.\w+)[`"]?/gi;

/**
 * Parse raw text output from a sub-agent into a structured AgentResult.
 */
export function parseAgentResult(raw: string, request: AgentRequest): AgentResult {
  const sections = extractSections(raw);
  const evidence = extractEvidence(raw, sections.get("Verification") ?? sections.get("Evidence") ?? "");
  const artifacts = extractArtifacts(raw, request.nodeId);
  const newFacts = extractFacts(raw, sections.get("Discoveries") ?? sections.get("Facts") ?? "");
  const blockers = extractBlockers(sections.get("Blockers") ?? sections.get("Risks") ?? "");
  const confidence = computeResultConfidence(sections, evidence, request.expectations);

  const status = determineResultStatus(confidence, blockers, evidence, request.expectations);

  return {
    taskId: request.taskId,
    nodeId: request.nodeId,
    agent: request.agent,
    status,
    summary: sections.get("Summary") ?? extractFirstParagraph(raw),
    artifacts,
    evidence,
    newFacts,
    confidence,
    blockers,
    raw,
  };
}

/**
 * Convert an AgentResult into a TaskNodeOutput for the graph.
 */
export function resultToNodeOutput(result: AgentResult): TaskNodeOutput {
  return {
    summary: result.summary,
    artifacts: result.artifacts,
    evidence: result.evidence,
    newFacts: result.newFacts,
    confidence: result.confidence,
    blockers: result.blockers.length > 0 ? result.blockers : undefined,
    raw: result.raw.length > 5000 ? result.raw.slice(0, 5000) + "\n...[truncated]" : result.raw,
  };
}

// ─── Internal Parsing Helpers ─────────────────────────────────────────────────

function extractSections(text: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = text.split("\n");
  let currentSection = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    const match = line.match(/^## (.+)$/);
    if (match) {
      if (currentSection) {
        sections.set(currentSection, currentContent.join("\n").trim());
      }
      currentSection = match[1].trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  if (currentSection) {
    sections.set(currentSection, currentContent.join("\n").trim());
  }

  return sections;
}

function extractEvidence(fullText: string, verificationSection: string): Evidence[] {
  const evidence: Evidence[] = [];
  const text = verificationSection || fullText;

  // Extract command outputs with exit codes
  const exitCodes = [...text.matchAll(EXIT_CODE_REGEX)];
  const commands = [...text.matchAll(COMMAND_REGEX)];

  for (let i = 0; i < Math.max(exitCodes.length, commands.length); i++) {
    const exitCode = exitCodes[i] ? parseInt(exitCodes[i][1], 10) : undefined;
    const command = commands[i]?.[1]?.trim();

    if (command || exitCode !== undefined) {
      const type = inferEvidenceType(command ?? "");
      evidence.push({
        id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type,
        source: "sub-agent",
        command,
        exitCode,
        assertions: buildAssertionsFromExitCode(exitCode, command),
        confidence: exitCode === 0 ? 0.9 : exitCode !== undefined ? 0.1 : 0.5,
        raw: extractCommandContext(text, command),
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Extract test results
  const testPass = text.match(TEST_RESULT_REGEX);
  const testFail = text.match(TEST_FAIL_REGEX);
  if (testPass || testFail) {
    const passed = testPass ? parseInt(testPass[1], 10) : 0;
    const failed = testFail ? parseInt(testFail[1], 10) : 0;
    const total = passed + failed;
    evidence.push({
      id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: "test_result",
      source: "sub-agent",
      assertions: [
        { description: `${passed}/${total} tests passed`, passed: failed === 0, actual: `${passed} passed, ${failed} failed` },
      ],
      confidence: total > 0 ? passed / total : 0,
      raw: text.slice(0, 500),
      timestamp: new Date().toISOString(),
    });
  }

  // If no structured evidence found, create a weak manual entry
  if (evidence.length === 0 && verificationSection.trim().length > 0) {
    const saysNotRun = /not run|not verified|skipped|unable/i.test(verificationSection);
    evidence.push({
      id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: "manual",
      source: "sub-agent",
      assertions: [],
      confidence: saysNotRun ? 0 : 0.3,
      raw: verificationSection.slice(0, 300),
      timestamp: new Date().toISOString(),
    });
  }

  return evidence;
}

function extractArtifacts(text: string, nodeId: string): Artifact[] {
  const artifacts: Artifact[] = [];
  const matches = [...text.matchAll(FILE_PATH_REGEX)];
  const seen = new Set<string>();

  for (const match of matches) {
    const path = match[1];
    if (seen.has(path)) continue;
    seen.add(path);

    const action = match[0].toLowerCase();
    const type = action.includes("creat") ? "created" as const
      : action.includes("delet") ? "deleted" as const
      : "modified" as const;

    artifacts.push({
      id: `art-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      path,
      type,
      description: `${type} by sub-agent`,
      nodeId,
      timestamp: new Date().toISOString(),
    });
  }

  return artifacts;
}

function extractFacts(_fullText: string, factsSection: string): Fact[] {
  const facts: Fact[] = [];
  const text = factsSection || "";
  const lines = text.split("\n").filter((l) => l.trim().startsWith("-"));

  for (const line of lines.slice(0, 10)) {
    const content = line.replace(/^-\s*/, "").trim();
    if (content.length < 5) continue;

    const colonIdx = content.indexOf(":");
    const key = colonIdx > 0 ? content.slice(0, colonIdx).trim() : `fact-${facts.length}`;
    const value = colonIdx > 0 ? content.slice(colonIdx + 1).trim() : content;

    facts.push({
      id: `fact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      key,
      value,
      source: "agent",
      confidence: 0.7,
      discoveredAt: new Date().toISOString(),
    });
  }

  return facts;
}

function extractBlockers(risksSection: string): string[] {
  if (!risksSection.trim()) return [];
  const lines = risksSection.split("\n").filter((l) => l.trim().startsWith("-"));
  return lines
    .map((l) => l.replace(/^-\s*/, "").trim())
    .filter((l) => l.length > 3 && !/^none\b/i.test(l) && !/^no\s+(risks?|issues?|blockers?|problems?)/i.test(l) && !/\bnone\s+(identified|found|detected)/i.test(l));
}

function extractFirstParagraph(text: string): string {
  const lines = text.split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0 && !l.startsWith("#"));
  return nonEmpty.slice(0, 3).join(" ").slice(0, 200);
}

function inferEvidenceType(command: string): EvidenceType {
  const lower = command.toLowerCase();
  if (/\b(test|spec|jest|vitest|pytest|cargo test|go test)\b/.test(lower)) return "test_result";
  if (/\b(tsc|typecheck|mypy|pyright)\b/.test(lower)) return "type_check";
  if (/\b(eslint|prettier|biome|clippy|golint)\b/.test(lower)) return "lint";
  if (/\b(build|compile|make|cargo build|go build)\b/.test(lower)) return "build";
  return "command_output";
}

function buildAssertionsFromExitCode(exitCode: number | undefined, command?: string): Assertion[] {
  if (exitCode === undefined) return [];
  return [{
    description: command ? `${command} exited successfully` : "Command exited successfully",
    passed: exitCode === 0,
    actual: `exit code ${exitCode}`,
    expected: "exit code 0",
  }];
}

function extractCommandContext(text: string, command?: string): string {
  if (!command) return "";
  const idx = text.indexOf(command);
  if (idx < 0) return "";
  return text.slice(idx, Math.min(idx + 500, text.length));
}

function computeResultConfidence(
  sections: Map<string, string>,
  evidence: Evidence[],
  expectations: AgentExpectations,
): number {
  let score = 0;
  let maxScore = 0;

  // Section completeness (40% weight)
  maxScore += 40;
  const presentSections = expectations.requiredSections.filter((s) => sections.has(s));
  score += (presentSections.length / Math.max(1, expectations.requiredSections.length)) * 40;

  // Evidence quality (40% weight)
  maxScore += 40;
  if (evidence.length > 0) {
    const avgConfidence = evidence.reduce((sum, e) => sum + e.confidence, 0) / evidence.length;
    score += avgConfidence * 40;
  }

  // Evidence presence (20% weight)
  maxScore += 20;
  if (evidence.length > 0) {
    const hasPassingEvidence = evidence.some((e) => e.confidence > 0.7);
    score += hasPassingEvidence ? 20 : 10;
  }

  return Math.round((score / maxScore) * 100) / 100;
}

function determineResultStatus(
  confidence: number,
  blockers: string[],
  evidence: Evidence[],
  expectations: AgentExpectations,
): AgentResult["status"] {
  if (blockers.length > 0) return "blocked";
  if (confidence >= expectations.minConfidence && evidence.some((e) => e.confidence > 0.5)) return "success";
  if (confidence > 0 && evidence.length > 0) return "partial";
  return "failed";
}
