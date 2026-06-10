import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getSection, replaceSection } from "./context-sections.js";

export const PROJECT_FACTS_FILENAME = ".opencode-jce/project-facts.json";

export type ContextSectionName = "Stack" | "Architecture Decisions" | "Conventions" | "Current Status" | "Important Notes" | "Related Projects";
export type CaptureConfidence = "high" | "medium" | "low";

export interface ContextCaptureInput {
  changedFiles?: string[];
  summary?: string;
  verification?: string[];
  blockers?: string[];
  nextSteps?: string[];
  android?: {
    module?: string;
    packageName?: string;
    commands?: string[];
    logcatAvailable?: boolean;
  };
}

export interface ContextCaptureEntry {
  section: ContextSectionName;
  line: string;
  confidence: CaptureConfidence;
  reason: string;
}

export interface ProjectFacts {
  updatedAt: string;
  projectType?: string;
  changedFiles?: string[];
  android?: ContextCaptureInput["android"];
  verification?: string[];
  blockers?: string[];
  nextSteps?: string[];
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function sanitizeLine(line: string): string {
  const oneLine = line.replace(/\r?\n/g, " ").trim();
  return oneLine.startsWith("-") ? oneLine.slice(0, 200) : `- ${oneLine}`.slice(0, 200);
}

function detectProjectType(files: string[]): string | undefined {
  const joined = files.join("\n").toLowerCase();
  if (/androidmanifest\.xml|build\.gradle|\.kt\b|app\/src\/main/.test(joined)) return "android";
  if (/package\.json|\.ts\b|\.tsx\b/.test(joined)) return "typescript";
  return undefined;
}

function androidEntries(input: ContextCaptureInput, files: string[]): ContextCaptureEntry[] {
  const entries: ContextCaptureEntry[] = [];
  const androidSignal = input.android || detectProjectType(files) === "android";
  if (!androidSignal) return entries;
  const details = [input.android?.module ? `module ${input.android.module}` : undefined, input.android?.packageName ? `package ${input.android.packageName}` : undefined].filter(Boolean).join(", ");
  entries.push({
    section: "Important Notes",
    line: `- Android project context detected${details ? ` (${details})` : ""}.`,
    confidence: input.android ? "high" : "medium",
    reason: input.android ? "Provided Android scanner/tool facts" : "Changed files contain Android signals",
  });
  if (input.android?.commands?.length) {
    entries.push({
      section: "Important Notes",
      line: `- Android verification commands: ${input.android.commands.slice(0, 3).join(", ")}.`,
      confidence: "high",
      reason: "Provided Android verification command facts",
    });
  }
  return entries;
}

export function buildContextCaptureEntries(input: ContextCaptureInput): ContextCaptureEntry[] {
  const files = unique(input.changedFiles ?? []).slice(0, 8);
  const entries: ContextCaptureEntry[] = [];
  const projectType = detectProjectType(files);

  if (input.summary?.trim()) {
    entries.push({ section: "Current Status", line: sanitizeLine(input.summary), confidence: "high", reason: "Explicit session summary" });
  }
  if (files.length) {
    entries.push({ section: "Important Notes", line: `- Last touched files: ${files.join(", ")}.`, confidence: "high", reason: "Changed files from session/git state" });
  }
  if (projectType) {
    entries.push({ section: "Stack", line: `- Detected project type: ${projectType}.`, confidence: "medium", reason: "Inferred from changed files" });
  }
  for (const item of input.verification ?? []) {
    entries.push({ section: "Important Notes", line: `- Last verified: ${item}.`, confidence: "high", reason: "Verification evidence provided" });
  }
  for (const item of input.blockers ?? []) {
    entries.push({ section: "Current Status", line: `- [ ] Blocked: ${item}`, confidence: "high", reason: "Blocker provided" });
  }
  for (const item of input.nextSteps ?? []) {
    entries.push({ section: "Current Status", line: `- [ ] Next: ${item}`, confidence: "high", reason: "Next step provided" });
  }
  entries.push(...androidEntries(input, files));
  return entries.filter((entry) => entry.confidence !== "low");
}

function appendEntries(content: string, entries: ContextCaptureEntry[]): string {
  let updated = content;
  for (const section of unique(entries.map((entry) => entry.section))) {
    const existing = getSection(updated, section);
    const additions = entries
      .filter((entry) => entry.section === section)
      .map((entry) => entry.line)
      .filter((line) => !existing.some((item) => item.trim().toLowerCase() === line.trim().toLowerCase()));
    if (additions.length) updated = replaceSection(updated, section, [...existing, ...additions]);
  }
  return updated;
}

export function applyContextAutocapture(content: string, input: ContextCaptureInput): { content: string; entries: ContextCaptureEntry[] } {
  const entries = buildContextCaptureEntries(input);
  return { content: appendEntries(content, entries), entries };
}

export function buildSessionSummary(input: ContextCaptureInput): string[] {
  const lines: string[] = [];
  if (input.summary) lines.push(sanitizeLine(input.summary));
  if (input.changedFiles?.length) lines.push(`- Last touched: ${unique(input.changedFiles).slice(0, 6).join(", ")}.`);
  for (const item of input.verification ?? []) lines.push(`- Verified: ${item}.`);
  for (const item of input.blockers ?? []) lines.push(`- Blocker: ${item}.`);
  for (const item of input.nextSteps ?? []) lines.push(`- Next: ${item}.`);
  return unique(lines).slice(0, 8);
}

export function compactContextContent(content: string): { content: string; actions: string[] } {
  const actions: string[] = [];
  let updated = content;
  for (const section of ["Current Status", "Important Notes"] as ContextSectionName[]) {
    const existing = getSection(updated, section);
    const normalized = new Map<string, string>();
    for (const line of existing) {
      const key = line.toLowerCase().replace(/[-\[\]x:.,]/g, "").replace(/\s+/g, " ").trim();
      if (!normalized.has(key)) normalized.set(key, line);
    }
    const deduped = [...normalized.values()];
    const compacted = deduped.length > 8 ? [...deduped.slice(-7), `- Compacted ${deduped.length - 7} older ${section.toLowerCase()} entries into archive/context history.`] : deduped;
    if (compacted.length !== existing.length) {
      updated = replaceSection(updated, section, compacted);
      actions.push(`Compacted ## ${section}: ${existing.length} -> ${compacted.length} entries`);
    }
  }
  return { content: updated, actions };
}

export async function readProjectFacts(projectRoot: string): Promise<ProjectFacts | null> {
  try {
    return JSON.parse(await readFile(join(projectRoot, PROJECT_FACTS_FILENAME), "utf8")) as ProjectFacts;
  } catch {
    return null;
  }
}

export async function writeProjectFacts(projectRoot: string, input: ContextCaptureInput): Promise<ProjectFacts> {
  const existing = await readProjectFacts(projectRoot);
  const facts: ProjectFacts = {
    ...(existing ?? { updatedAt: new Date().toISOString() }),
    updatedAt: new Date().toISOString(),
    projectType: detectProjectType(input.changedFiles ?? []) ?? existing?.projectType,
    changedFiles: unique([...(existing?.changedFiles ?? []), ...(input.changedFiles ?? [])]).slice(-20),
    android: input.android ?? existing?.android,
    verification: unique([...(existing?.verification ?? []), ...(input.verification ?? [])]).slice(-20),
    blockers: unique([...(existing?.blockers ?? []), ...(input.blockers ?? [])]).slice(-10),
    nextSteps: unique([...(existing?.nextSteps ?? []), ...(input.nextSteps ?? [])]).slice(-10),
  };
  const path = join(projectRoot, PROJECT_FACTS_FILENAME);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(facts, null, 2) + "\n", "utf8");
  return facts;
}


