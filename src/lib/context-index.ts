import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ContextCaptureInput } from "./context-autocapture.js";

export const CONTEXT_INDEX_ROOT = ".opencode-jce/context";
export const CONTEXT_INDEX_SESSION = `${CONTEXT_INDEX_ROOT}/session.md`;
export const CONTEXT_INDEX_DIR = `${CONTEXT_INDEX_ROOT}/indexes`;
export const CONTEXT_NOTES_DIR = `${CONTEXT_INDEX_ROOT}/notes`;
export const CONTEXT_INDEX_CONFIG = ".opencode-jce/context-config.json";

export type ContextBucket =
  | "agents"
  | "android"
  | "config"
  | "frontend"
  | "release"
  | "security"
  | "testing"
  | "general";

export interface ContextIndexInput extends ContextCaptureInput {
  bucket?: string;
  agent?: string;
}

export interface ContextIndexWriteResult {
  bucket: string;
  sessionPath: string;
  indexPath: string;
  notePath: string | null;
  entry: string;
}

const BUCKET_DESCRIPTIONS: Record<ContextBucket, string> = {
  agents: "agent workflows, prompts, skills, and orchestration behavior",
  android: "Android builds, Gradle, Compose, devices, crashes, and releases",
  config: "installer, config, MCP, update, and project tooling changes",
  frontend: "UI, React, styling, accessibility, and browser verification",
  release: "version bumps, changelogs, tags, pushes, and release notes",
  security: "auth, permissions, secrets, vulnerable surfaces, and compliance",
  testing: "test strategy, verification commands, failures, and coverage",
  general: "project facts and handoff notes that do not fit a narrower bucket",
};

// ─── In-memory cache ──────────────────────────────────────────
interface IndexCache {
  sessionContent: string | null;
  indexContents: Map<string, string>;
  sessionPath: string;
}
let indexCache: IndexCache | null = null;

function getCache(projectRoot: string): IndexCache {
  const sessionPath = join(projectRoot, CONTEXT_INDEX_SESSION);
  if (!indexCache || indexCache.sessionPath !== sessionPath) {
    indexCache = { sessionContent: null, indexContents: new Map(), sessionPath };
  }
  return indexCache;
}

function invalidateCache(projectRoot: string): void {
  const sessionPath = join(projectRoot, CONTEXT_INDEX_SESSION);
  if (indexCache && indexCache.sessionPath === sessionPath) {
    indexCache.sessionContent = null;
    indexCache.indexContents.clear();
  }
}

// ─── Configurable bucket descriptions ─────────────────────────
interface ContextIndexConfig {
  bucketDescriptions?: Partial<Record<ContextBucket, string>>;
  defaultBucket?: ContextBucket;
}

async function loadBucketConfig(projectRoot: string): Promise<Partial<Record<ContextBucket, string>>> {
  try {
    const raw = await readFile(join(projectRoot, CONTEXT_INDEX_CONFIG), "utf8");
    const config: ContextIndexConfig = JSON.parse(raw);
    return config.bucketDescriptions ?? {};
  } catch {
    return {};
  }
}

function getBucketDescription(bucket: string, overrides: Partial<Record<ContextBucket, string>> = {}): string {
  return (overrides as Record<string, string>)[bucket] ?? BUCKET_DESCRIPTIONS[bucket as ContextBucket] ?? "project context bucket";
}

function cleanBucketName(bucket: string | undefined): string {
  const normalized = (bucket ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return normalized || "general";
}

export function inferContextBucket(input: ContextIndexInput): ContextBucket {
  const explicit = cleanBucketName(input.bucket);
  if (explicit !== "general") return explicit as ContextBucket;

  const text = [
    input.summary,
    ...(input.changedFiles ?? []),
    ...(input.verification ?? []),
    ...(input.blockers ?? []),
    ...(input.nextSteps ?? []),
  ].join("\n").toLowerCase();

  const changedFiles = (input.changedFiles ?? []).map((f) => f.toLowerCase());
  const summary = (input.summary ?? "").toLowerCase();

  // Weighted scoring: file-path signals get 3x weight, summary gets 2x, other gets 1x
  const scores: Record<string, number> = {
    android: 0, release: 0, agents: 0, config: 0, testing: 0, security: 0, frontend: 0,
  };

  const rules: [RegExp, keyof typeof scores, "file" | "summary" | "other"][] = [
    [/android|gradle|compose|adb|logcat|apk|aab|\.kt\b/, "android", "other"],
    [/release|changelog|tag|version|push|publish/, "release", "summary"],
    [/install\.ps1|install\.sh/, "release", "file"],
    [/agent|skill|orchestration|jce-worker|prompt|handoff/, "agents", "summary"],
    [/mcp|config|installer|update|opencode\.json|agents\.md/, "config", "summary"],
    [/test|typecheck|verified|coverage|spec/, "testing", "summary"],
    [/security|auth|secret|permission|vulnerab|cve/, "security", "summary"],
    [/react|frontend|ui|css|tailwind|browser|accessibility/, "frontend", "summary"],
  ];

  for (const [pattern, bucket, source] of rules) {
    const weight = source === "file" ? 3 : source === "summary" ? 2 : 1;
    if (source === "file" && changedFiles.some((f) => pattern.test(f))) scores[bucket] += weight;
    else if (source === "summary" && pattern.test(summary)) scores[bucket] += weight;
    else if (source === "other" && pattern.test(text)) scores[bucket] += weight;
  }

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] >= 2) return best[0] as ContextBucket;
  // Fallback: any single match is enough
  if (best && best[1] >= 1) return best[0] as ContextBucket;
  return "general";
}

function nowStamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const millis = String(date.getMilliseconds()).padStart(3, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${millis}`;
}

function today(date = new Date()): string {
  return date.toISOString().split("T")[0];
}

function firstSentence(input: string | undefined, fallback: string): string {
  const cleaned = (input ?? "").replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, 180);
}

function noteFilename(bucket: string, summary: string, date = new Date()): string {
  const slug = summary.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "context-note";
  return `${nowStamp(date)}-${bucket}-${slug}.md`;
}

async function uniqueNoteFilename(projectRoot: string, bucket: string, summary: string): Promise<string> {
  const base = noteFilename(bucket, summary);
  let candidate = base;
  let suffix = 1;
  while (await exists(join(projectRoot, CONTEXT_NOTES_DIR, candidate))) {
    candidate = base.replace(/\.md$/, `-${suffix}.md`);
    suffix += 1;
  }
  return candidate;
}

function renderSession(bucket: string, descriptions: Partial<Record<ContextBucket, string>> = {}, date = new Date()): string {
  const lines = [
    "# JCE Context Index",
    "> Auto-maintained by JCE context-keeper. Read this before opening detailed notes.",
    `> Last updated: ${today(date)}`,
    "",
    "## Buckets",
  ];
  for (const name of Object.keys(BUCKET_DESCRIPTIONS)) {
    const description = getBucketDescription(name, descriptions);
    const marker = name === bucket ? ` Last updated: ${today(date)}` : "";
    lines.push(`- \`${name}\` - ${description}.${marker} -> indexes/${name}.md`);
  }
  return `${lines.join("\n")}\n`;
}

function upsertBucketInSession(content: string, bucket: string, descriptions: Partial<Record<ContextBucket, string>> = {}, date = new Date()): string {
  const description = getBucketDescription(bucket, descriptions);
  const line = `- \`${bucket}\` - ${description}. Last updated: ${today(date)} -> indexes/${bucket}.md`;
  const pattern = new RegExp("^- `" + bucket + "` .*$", "m");
  if (pattern.test(content)) return content.replace(pattern, line);
  const withDate = content.replace(/^> Last updated: .*$/m, `> Last updated: ${today(date)}`);
  return withDate.trimEnd() + `\n${line}\n`;
}

function renderIndex(bucket: string, descriptions: Partial<Record<ContextBucket, string>> = {}): string {
  const description = getBucketDescription(bucket, descriptions);
  return [`# ${bucket} Context Index`, `> Scope: ${description}.`, "", "## Entries", ""].join("\n");
}

function renderNote(input: ContextIndexInput, bucket: string, summary: string): string {
  const lines = [
    `# ${summary}`,
    "",
    `- Date: ${new Date().toISOString()}`,
    `- Bucket: ${bucket}`,
    `- Agent: ${input.agent ?? "JCE-Worker"}`,
    "",
    "## Summary",
    `- ${summary}`,
  ];
  if (input.changedFiles?.length) lines.push("", "## Files", ...input.changedFiles.map((file) => `- ${file}`));
  if (input.verification?.length) lines.push("", "## Verification", ...input.verification.map((item) => `- ${item}`));
  if (input.blockers?.length) lines.push("", "## Blockers", ...input.blockers.map((item) => `- ${item}`));
  if (input.nextSteps?.length) lines.push("", "## Next Steps", ...input.nextSteps.map((item) => `- ${item}`));
  if (input.android) {
    lines.push("", "## Android");
    if (input.android.module) lines.push(`- Module: ${input.android.module}`);
    if (input.android.packageName) lines.push(`- Package: ${input.android.packageName}`);
    if (input.android.commands?.length) lines.push(`- Commands: ${input.android.commands.join(", ")}`);
    if (typeof input.android.logcatAvailable === "boolean") lines.push(`- Logcat available: ${input.android.logcatAvailable}`);
  }
  return `${lines.join("\n")}\n`;
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function writeFileAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}

export async function ensureContextIndex(projectRoot: string, bucket: string = "general"): Promise<void> {
  await mkdir(join(projectRoot, CONTEXT_INDEX_DIR), { recursive: true });
  await mkdir(join(projectRoot, CONTEXT_NOTES_DIR), { recursive: true });
  const descriptions = await loadBucketConfig(projectRoot);
  const sessionPath = join(projectRoot, CONTEXT_INDEX_SESSION);
  if (!(await exists(sessionPath))) await writeFileAtomic(sessionPath, renderSession(bucket, descriptions));
  const indexPath = join(projectRoot, CONTEXT_INDEX_DIR, `${bucket}.md`);
  if (!(await exists(indexPath))) await writeFileAtomic(indexPath, renderIndex(bucket, descriptions));

  // Auto .gitignore: ensure .opencode-jce/context/ is excluded
  await ensureGitignoreEntry(projectRoot);
}

async function ensureGitignoreEntry(projectRoot: string): Promise<void> {
  const gitignorePath = join(projectRoot, ".gitignore");
  const entry = ".opencode-jce/context/";
  try {
    const content = await readFile(gitignorePath, "utf8");
    if (content.includes(entry)) return;
    await writeFileAtomic(gitignorePath, content.trimEnd() + `\n\n# JCE context index runtime state\n${entry}\n`);
  } catch {
    // No .gitignore or can't read — skip silently
  }
}

export async function writeContextIndex(projectRoot: string, input: ContextIndexInput): Promise<ContextIndexWriteResult | null> {
  const summary = firstSentence(input.summary, "Context checkpoint");

  // Noise filter: skip writes without meaningful content
  const hasSummary = (input.summary ?? "").trim().length > 10;
  const hasVerification = (input.verification ?? []).length > 0;
  const hasBlockers = (input.blockers ?? []).length > 0;
  const hasNextSteps = (input.nextSteps ?? []).length > 0;
  const hasFiles = (input.changedFiles ?? []).length > 0;
  const hasAndroid = Boolean(input.android?.module || input.android?.packageName || input.android?.commands?.length);
  if (!hasSummary && !hasVerification && !hasBlockers && !hasNextSteps && !hasFiles && !hasAndroid) return null;

  const bucket = cleanBucketName(input.bucket ?? inferContextBucket(input));
  const descriptions = await loadBucketConfig(projectRoot);
  await ensureContextIndex(projectRoot, bucket);

  const cache = getCache(projectRoot);
  const sessionPath = join(projectRoot, CONTEXT_INDEX_SESSION);
  const indexPath = join(projectRoot, CONTEXT_INDEX_DIR, `${bucket}.md`);
  const noteName = await uniqueNoteFilename(projectRoot, bucket, summary);
  const noteRel = `../notes/${noteName}`;
  const notePath = join(projectRoot, CONTEXT_NOTES_DIR, noteName);
  const entry = `- ${new Date().toISOString()} - ${input.agent ?? "JCE-Worker"}: ${summary} -> ${noteRel}`;

  // Dedup: check if summary already exists in this bucket (ignore timestamp)
  const indexContent = cache.indexContents.get(bucket) ?? await readIfExists(indexPath);
  const baseIndex = indexContent ?? renderIndex(bucket, descriptions);
  const dedupKey = `${summary} -> `;
  const isDuplicate = baseIndex.split("\n").some((line) => line.includes(dedupKey));
  if (isDuplicate) return null;

  const sessionContent = cache.sessionContent ?? await readIfExists(sessionPath);
  await writeFileAtomic(sessionPath, upsertBucketInSession(sessionContent ?? renderSession(bucket, descriptions), bucket, descriptions));

  const updatedIndex = baseIndex.replace("## Entries\n", `## Entries\n${entry}\n`);
  await writeFileAtomic(indexPath, updatedIndex);
  await writeFileAtomic(notePath, renderNote(input, bucket, summary));

  // Invalidate cache after writes
  invalidateCache(projectRoot);

  return { bucket, sessionPath: CONTEXT_INDEX_SESSION, indexPath: `${CONTEXT_INDEX_DIR}/${bucket}.md`, notePath: `${CONTEXT_NOTES_DIR}/${noteName}`, entry };
}

export interface ContextIndexReadOptions {
  bucket?: string;
  since?: string;
  agent?: string;
  keyword?: string;
}

export async function readContextIndex(projectRoot: string, options: ContextIndexReadOptions = {}): Promise<string> {
  const cleanBucket = options.bucket ? cleanBucketName(options.bucket) : undefined;
  const cache = getCache(projectRoot);
  const sessionPath = join(projectRoot, CONTEXT_INDEX_SESSION);
  if (!(await exists(sessionPath))) return `No ${CONTEXT_INDEX_SESSION} found. Call context_index_update or context_checkpoint with summary first.`;

  if (!cleanBucket) {
    const content = cache.sessionContent ?? await readFile(sessionPath, "utf8");
    cache.sessionContent = content;
    return content;
  }

  const indexPath = join(projectRoot, CONTEXT_INDEX_DIR, `${cleanBucket}.md`);
  if (!(await exists(indexPath))) return `No context bucket "${cleanBucket}" found under ${CONTEXT_INDEX_DIR}.`;
  let content = cache.indexContents.get(cleanBucket) ?? await readFile(indexPath, "utf8");
  cache.indexContents.set(cleanBucket, content);

  // Apply filters
  if (options.since || options.agent || options.keyword) {
    const lines = content.split("\n");
    const headerLines: string[] = [];
    const entryLines: string[] = [];
    let inEntries = false;
    for (const line of lines) {
      if (line === "## Entries") { inEntries = true; headerLines.push(line); continue; }
      if (!inEntries) { headerLines.push(line); continue; }
      if (line.startsWith("- ")) entryLines.push(line);
      else headerLines.push(line);
    }

    const filtered = entryLines.filter((line) => {
      if (options.since && !line.includes(options.since)) return false;
      if (options.agent && !line.toLowerCase().includes(options.agent.toLowerCase())) return false;
      if (options.keyword && !line.toLowerCase().includes(options.keyword.toLowerCase())) return false;
      return true;
    });

    return [...headerLines, ...filtered].join("\n") + "\n";
  }

  return content;
}

export async function listContextBuckets(projectRoot: string): Promise<string[]> {
  const indexesDir = join(projectRoot, CONTEXT_INDEX_DIR);
  try {
    const entries = await readdir(indexesDir);
    return entries.filter((entry) => entry.endsWith(".md")).map((entry) => basename(entry, ".md")).sort();
  } catch {
    return [];
  }
}

// ─── Pruning ──────────────────────────────────────────────────

export interface PruneResult {
  deletedNotes: string[];
  prunedEntries: number;
  bucket: string;
}

export async function pruneContextIndexNotes(
  projectRoot: string,
  bucket: string,
  options: { maxAge?: number; maxNotes?: number; dryRun?: boolean } = {},
): Promise<PruneResult> {
  const cleanBucket = cleanBucketName(bucket);
  const notesDir = join(projectRoot, CONTEXT_NOTES_DIR);
  const indexPath = join(projectRoot, CONTEXT_INDEX_DIR, `${cleanBucket}.md`);
  const deletedNotes: string[] = [];
  let prunedEntries = 0;

  const maxAge = options.maxAge ?? 30;
  const maxNotes = options.maxNotes ?? 50;
  const cutoff = new Date(Date.now() - maxAge * 86400000);

  let noteFiles: string[] = [];
  try {
    noteFiles = (await readdir(notesDir))
      .filter((f) => f.includes(`-${cleanBucket}-`))
      .sort();
  } catch {
    return { deletedNotes: [], prunedEntries: 0, bucket: cleanBucket };
  }

  // Delete by age
  for (const file of noteFiles) {
    const match = file.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) continue;
    const fileDate = new Date(`${match[1]}-${match[2]}-${match[3]}`);
    if (fileDate < cutoff) {
      if (!options.dryRun) await unlink(join(notesDir, file));
      deletedNotes.push(file);
    }
  }

  // Delete by count (keep newest)
  const remaining = noteFiles.filter((f) => !deletedNotes.includes(f));
  if (remaining.length > maxNotes) {
    const toDelete = remaining.slice(0, remaining.length - maxNotes);
    for (const file of toDelete) {
      if (!options.dryRun) await unlink(join(notesDir, file));
      deletedNotes.push(file);
    }
  }

  // Prune corresponding entries from index
  if (deletedNotes.length > 0 && !(options.dryRun)) {
    try {
      let indexContent = await readFile(indexPath, "utf8");
      for (const note of deletedNotes) {
        const before = indexContent;
        indexContent = indexContent.split("\n").filter((line) => !line.includes(note)).join("\n");
        if (indexContent !== before) prunedEntries++;
      }
      await writeFileAtomic(indexPath, indexContent);
    } catch {
      // Index doesn't exist — skip
    }
  }

  if (deletedNotes.length > 0) invalidateCache(projectRoot);
  return { deletedNotes, prunedEntries, bucket: cleanBucket };
}

// ─── Stats ────────────────────────────────────────────────────

export interface ContextIndexStats {
  buckets: Array<{ name: string; entryCount: number; noteCount: number; lastUpdated: string | null }>;
  totalNotes: number;
  totalEntries: number;
}

export async function getContextIndexStats(projectRoot: string): Promise<ContextIndexStats> {
  const buckets = await listContextBuckets(projectRoot);
  const notesDir = join(projectRoot, CONTEXT_NOTES_DIR);
  let allNotes: string[] = [];
  try {
    allNotes = await readdir(notesDir);
  } catch {
    // No notes dir
  }

  const stats: ContextIndexStats = { buckets: [], totalNotes: 0, totalEntries: 0 };

  for (const bucket of buckets) {
    const indexPath = join(projectRoot, CONTEXT_INDEX_DIR, `${bucket}.md`);
    let entryCount = 0;
    try {
      const content = await readFile(indexPath, "utf8");
      entryCount = content.split("\n").filter((l) => l.startsWith("- ")).length;
    } catch {
      // skip
    }
    const noteCount = allNotes.filter((f) => f.includes(`-${bucket}-`)).length;
    const lastNote = allNotes.filter((f) => f.includes(`-${bucket}-`)).sort().pop();
    const match = lastNote?.match(/^(\d{4}-\d{2}-\d{2})/);
    stats.buckets.push({ name: bucket, entryCount, noteCount, lastUpdated: match?.[1] ?? null });
    stats.totalNotes += noteCount;
    stats.totalEntries += entryCount;
  }

  return stats;
}
