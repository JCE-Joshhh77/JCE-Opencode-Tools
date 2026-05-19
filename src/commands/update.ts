import { Command } from "commander";
import { existsSync, readdirSync } from "fs";
import { dirname, join, sep } from "path";
import { cp, mkdir, writeFile, readFile, chmod, rename, rm } from "fs/promises";
import { platform } from "os";
import chalk from "chalk";
import { getConfigDir } from "../lib/config.js";
import { ensureOpenCodeJsonEntries, ensureTuiJsonEntries } from "../lib/opencode-config-merge.js";
import { banner, heading, info, success, warn, error } from "../lib/ui.js";
import { logCommandStart, logCommandSuccess, logCommandError } from "../lib/logger.js";
import {
  CURRENT_CONFIG_VERSION,
  initVersionFile,
  runMigrations,
  compareVersions,
} from "../lib/version.js";
import { EXIT_SUCCESS, EXIT_ERROR } from "../types.js";
import { GITHUB_RAW_BASE, GITHUB_REPO, VERSION } from "../lib/constants.js";

const REQUIRED_CLI_PAYLOAD_FILES = [
  "src/index.ts",
  "src/plugin/index.ts",
  "src/plugin/hooks/jce-worker-guard.ts",
  "src/plugin/hooks/open-work-enforcer.ts",
  "src/plugin/hooks/todo-enforcer.ts",
  "src/plugin/lib/compaction-loop-guard.ts",
  "src/commands/analytics.ts",
  "src/commands/capabilities.ts",
  "src/commands/docs.ts",
  "src/commands/evidence.ts",
  "src/commands/flow.ts",
  "src/commands/skills.ts",
  "src/plugin/lib/jce-intelligence.ts",
  "src/plugin/lib/api/index.ts",
  "src/plugin/lib/devops/index.ts",
  "src/plugin/lib/security-flow/index.ts",
  "src/plugin/lib/web/index.ts",
  "src/plugin/lib/android/advanced-flow.ts",
  "src/plugin/lib/android/environment-probe.ts",
  "src/plugin/lib/android/command-planner.ts",
  "src/plugin/lib/android/evidence-gate.ts",
  "src/plugin/lib/android/compatibility-matrix.ts",
  "src/plugin/lib/android/security-auditor.ts",
  "src/plugin/lib/android/release-readiness.ts",
  "src/plugin/lib/android/build-optimizer.ts",
  "src/plugin/lib/android/orchestration-plan.ts",
  "src/plugin/lib/android/device-flow.ts",
  "src/plugin/lib/flutter/project-scanner.ts",
  "src/plugin/lib/flutter/verification-recipe.ts",
  "src/plugin/lib/flutter/failure-classifier.ts",
  "src/plugin/lib/flutter/environment-probe.ts",
  "src/plugin/lib/flutter/advanced-flow.ts",
  "src/plugin/lib/flutter/command-planner.ts",
  "src/plugin/lib/flutter/evidence-gate.ts",
  "src/plugin/lib/flutter/release-readiness.ts",
];

function assertCliPayloadComplete(dir: string): void {
  const missing = REQUIRED_CLI_PAYLOAD_FILES.filter((file) => !existsSync(join(dir, file)));
  if (missing.length > 0) throw new Error(`Downloaded CLI source is incomplete; missing: ${missing.join(", ")}`);
}

export interface ProcessSnapshot {
  pid: number;
  ppid: number;
  command: string;
}

function isUpdateProcessCommand(command: string): boolean {
  return /\bopencode-jce(?:\.cmd|\.ps1|\.exe)?\b[\s\S]*\bupdate\b/i.test(command) || /src[\\/]index\.ts[\s\S]*\bupdate\b/i.test(command);
}

function isStaleOpenCodeCommand(command: string): boolean {
  const normalized = command.replace(/\\/g, "/");
  if (isUpdateProcessCommand(normalized)) return false;
  return /(^|[\s/])opencode(\s|$)/i.test(normalized)
    || /\.config\/opencode\/cli\/src\/(plugin\/index|mcp\/context-keeper)\.ts/i.test(normalized)
    || /src\/(plugin\/index|mcp\/context-keeper)\.ts/i.test(normalized);
}

export function planStaleOpenCodeProcessKills(processes: ProcessSnapshot[], currentPid = process.pid): ProcessSnapshot[] {
  return processes
    .filter((entry) => entry.pid > 0 && entry.pid !== currentPid)
    .filter((entry) => isStaleOpenCodeCommand(entry.command));
}

function parseUnixProcessList(output: string): ProcessSnapshot[] {
  return output.split(/\r?\n/).map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) return undefined;
    return { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? "" };
  }).filter((entry): entry is ProcessSnapshot => Boolean(entry));
}

async function listUnixProcesses(): Promise<ProcessSnapshot[]> {
  const proc = Bun.spawn(["ps", "-axo", "pid=,ppid=,command="], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
  if (exitCode !== 0) return [];
  return parseUnixProcessList(stdout);
}

async function terminateStaleOpenCodeProcesses(): Promise<ProcessSnapshot[]> {
  if (process.env.OPENCODE_JCE_SKIP_PROCESS_CLEANUP === "1") return [];
  if (process.platform === "win32") return [];
  const targets = planStaleOpenCodeProcessKills(await listUnixProcesses());
  for (const target of targets) {
    try { process.kill(target.pid, "SIGTERM"); } catch { /* Process may already have exited. */ }
  }
  return targets;
}

// ─── Types ───────────────────────────────────────────────────

interface RemotePackageJson {
  version: string;
}

interface GitHubContentEntry {
  name: string;
  type: string;
  path: string;
}

interface MergeStats {
  opencodeJsonChanged: boolean;
  tuiJsonChanged: boolean;
  agents: number;
  mcpServers: number;
  lspEntries: number;
  profiles: number;
  prompts: number;
  skills: number;
  agentsMdUpdated: boolean;
  fallbackSkipped: boolean;
  fallbackFetchFailed: boolean;
  fetchFailed: number;
  fetchAttempted: number;
}

type FallbackStatus = "written" | "skipped" | "fetch-failed";

interface DirectoryMergeResult {
  added: number;
  failed: number;
  listingFailed: boolean;
}

// ─── GitHub Fetch Helpers ────────────────────────────────────

/**
 * Fetch the latest version from GitHub.
 */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch(`${GITHUB_RAW_BASE}/package.json`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as RemotePackageJson;
    return data.version || null;
  } catch {
    return null;
  }
}

/**
 * Fetch a raw file from the config directory on GitHub.
 */
async function fetchRemoteFile(relativePath: string): Promise<string | null> {
  try {
    const url = `${GITHUB_RAW_BASE}/config/${relativePath}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Fetch the list of files in a directory from the GitHub repository.
 * Returns an array of filenames.
 */
async function fetchDirectoryListing(dir: string): Promise<string[]> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/config/${dir}`,
      {
        headers: { Accept: "application/vnd.github.v3+json" },
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!response.ok) {
      return [];
    }
    const files = (await response.json()) as GitHubContentEntry[];
    return files
      .filter((f) => f.type === "file")
      .map((f) => f.name);
  } catch {
    return [];
  }
}

/**
 * Fetch the list of subdirectories in a directory from the GitHub repository.
 */
async function fetchSubdirectoryListing(dir: string): Promise<string[]> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/config/${dir}`,
      {
        headers: { Accept: "application/vnd.github.v3+json" },
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!response.ok) {
      return [];
    }
    const entries = (await response.json()) as GitHubContentEntry[];
    return entries
      .filter((f) => f.type === "dir")
      .map((f) => f.name);
  } catch {
    return [];
  }
}

// ─── Self-Update CLI ─────────────────────────────────────────

/**
 * Update the opencode-jce CLI itself to the latest version.
 * 1. Clones the latest source from GitHub into ~/.config/opencode/cli/
 * 2. Ensures the .cmd shim points to the updated local CLI folder
 * 3. Removes any .exe that bun may have created (which would take precedence over .cmd)
 * Returns true if the CLI was updated successfully.
 */
async function selfUpdateCli(latestVersion: string): Promise<boolean> {
  if (VERSION === latestVersion) {
    info("Syncing CLI to latest build...");
  } else {
    info(`Updating CLI: ${VERSION} → ${latestVersion}...`);
  }

  try {
    await updateLocalCliFolder(latestVersion);
    await ensureCliShim();
    success(`CLI updated to v${latestVersion}.`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warn(`CLI self-update failed: ${msg}`);
    warn("Try running the installer again to fix.");
    return false;
  }
}

async function handoffToUpdatedCli(): Promise<never> {
  info("Restarting update with the freshly updated CLI...");
  const proc = Bun.spawn(resolveHandoffCommand(), {
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      OPENCODE_JCE_UPDATED_CLI_HANDOFF: "1",
    },
  });
  const exitCode = await proc.exited;
  process.exit(exitCode);
}

function resolveHandoffCommand(): string[] {
  const resolvedShim = Bun.which("opencode-jce");
  if (resolvedShim) return [resolvedShim, "update"];
  return ["bun", "run", join(getConfigDir(), "cli", "src", "index.ts"), "--", "update"];
}

/**
 * Update the local cli/ folder in the config directory.
 * Clones the latest source from GitHub, copies src/, schemas/, package.json,
 * tsconfig.json, and installs dependencies.
 * Throws on failure so selfUpdateCli can report it.
 */
async function updateLocalCliFolder(latestVersion: string): Promise<void> {
  const configDir = getConfigDir();
  const cliDir = join(configDir, "cli");

  info("Downloading latest CLI source...");

  // Clone to temp, copy relevant files
  const tempDir = join(configDir, ".cli-update-tmp");

  const stagingDir = join(configDir, ".cli-update-new");
  const backupDir = join(configDir, ".cli-update-backup");
  try {
    // Clean up any previous temp
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }

    // Clone latest — try tag first, fallback to main branch
    const releaseRef = `v${latestVersion}`;
    let cloneRef = releaseRef;
    let cloneProc = Bun.spawn(
      ["git", "clone", "--depth", "1", "--branch", cloneRef, `https://github.com/${GITHUB_REPO}.git`, tempDir],
      { stdout: "pipe", stderr: "pipe" }
    );
    let cloneExit = await cloneProc.exited;

    // If tag clone fails, try main branch (tag might not be updated yet)
    if (cloneExit !== 0) {
      if (existsSync(tempDir)) await rm(tempDir, { recursive: true, force: true });
      cloneRef = "main";
      cloneProc = Bun.spawn(
        ["git", "clone", "--depth", "1", "--branch", cloneRef, `https://github.com/${GITHUB_REPO}.git`, tempDir],
        { stdout: "pipe", stderr: "pipe" }
      );
      cloneExit = await cloneProc.exited;
    }

    if (cloneExit !== 0) {
      const stderr = await new Response(cloneProc.stderr).text();
      throw new Error(`Could not clone release ${releaseRef} or main from GitHub.${stderr ? ` ${stderr}` : ""}`);
    }

    for (const dir of [stagingDir, backupDir]) {
      if (existsSync(dir)) {
        await rm(dir, { recursive: true, force: true });
      }
    }
    await mkdir(stagingDir, { recursive: true });

    // Copy new files into staging first. The active CLI is not touched until
    // dependencies are installed and all required source files are present.
    await cp(join(tempDir, "src"), join(stagingDir, "src"), { recursive: true });
    await cp(join(tempDir, "schemas"), join(stagingDir, "schemas"), { recursive: true });
    if (existsSync(join(tempDir, "scripts"))) {
      await cp(join(tempDir, "scripts"), join(stagingDir, "scripts"), { recursive: true });
    }
    if (existsSync(join(tempDir, "config"))) {
      await cp(join(tempDir, "config"), join(stagingDir, "config"), { recursive: true });
    }

    for (const file of ["package.json", "tsconfig.json", "bun.lock"]) {
      const src = join(tempDir, file);
      if (existsSync(src)) {
        const content = await readFile(src, "utf-8");
        await writeTextFile(join(stagingDir, file), content);
      }
    }

    assertCliPayloadComplete(stagingDir);

    // Install dependencies
    const installProc = Bun.spawn(
      ["bun", "install", "--ignore-scripts"],
      { stdout: "pipe", stderr: "pipe", cwd: stagingDir }
    );
    const installExit = await installProc.exited;
    if (installExit !== 0) {
      const stderr = await new Response(installProc.stderr).text();
      throw new Error(`bun install --ignore-scripts failed while updating CLI dependencies.${stderr ? ` ${stderr}` : ""}`);
    }

    try {
      if (existsSync(cliDir)) {
        await rename(cliDir, backupDir);
      }
      try {
        await rename(stagingDir, cliDir);
      } catch (err) {
        if (!existsSync(cliDir) && existsSync(backupDir)) {
          await rename(backupDir, cliDir);
        }
        throw err;
      }
      if (existsSync(backupDir)) {
        await rm(backupDir, { recursive: true, force: true });
      }
    } catch (err) {
      if (!existsSync(cliDir) && existsSync(backupDir)) {
        await rename(backupDir, cliDir);
      }
      throw err;
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    await rm(stagingDir, { recursive: true, force: true });
  }

  success("CLI source updated.");
}

/**
 * Ensure the CLI shim (.cmd) is correct and remove any .exe that would
 * take precedence on Windows. The .exe is created by `bun install -g` but
 * points to stale code in bun's global cache instead of our local cli/ folder.
 */
export async function ensureCliShim(): Promise<void> {
  const configDir = getConfigDir();
  const cliDir = join(configDir, "cli");
  const bunBinDir = join(process.env.USERPROFILE || process.env.HOME || "", ".bun", "bin");

  if (!existsSync(bunBinDir)) {
    await mkdir(bunBinDir, { recursive: true });
  }

  const isWindows = platform() === "win32";
  let npmBinDir: string | null = null;
  if (!isWindows) {
    try {
      const npmBinProc = Bun.spawn(["npm", "bin", "-g"], { stdout: "pipe", stderr: "pipe" });
      if (await npmBinProc.exited === 0) {
        npmBinDir = (await new Response(npmBinProc.stdout).text()).trim() || null;
      }
    } catch {
      npmBinDir = null;
    }
  }
  const staleFiles = isWindows
    ? ["opencode-jce", "opencode-jce.cmd", "opencode-jce.ps1", "opencode-jce.exe", "opencode-jce.bunx"]
    : ["opencode-jce", "opencode-jce.cmd", "opencode-jce.exe", "opencode-jce.bunx"];
  const staleDirs = isWindows
    ? [bunBinDir, join(process.env.APPDATA || "", "npm")]
    : [bunBinDir, npmBinDir].filter(Boolean);

  for (const dir of staleDirs) {
    if (!dir) continue;
    for (const file of staleFiles) {
      const filePath = join(dir, file);
      if (existsSync(filePath)) {
        await rm(filePath, { force: true });
      }
    }
  }

  if (isWindows) {
    const cmdPath = join(bunBinDir, "opencode-jce.cmd");
    const cmdContent = `@echo off\r\nbun run "${join(cliDir, "src", "index.ts")}" -- %*`;
    await writeFile(cmdPath, cmdContent, "ascii");
  } else {
    const shimPath = join(bunBinDir, "opencode-jce");
    const shimContent = `#!/usr/bin/env sh\nexec bun run "${join(cliDir, "src", "index.ts")}" "$@"\n`;
    await writeFile(shimPath, shimContent, "utf-8");
    await chmod(shimPath, 0o755);
  }

  info("CLI shim updated.");
}

// ─── Local File Helpers ──────────────────────────────────────

/**
 * Read and parse a local JSON file. Returns null if it doesn't exist or can't be parsed.
 */
async function readLocalJson<T>(filePath: string): Promise<T | null> {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Write a JSON object to a file with pretty formatting.
 */
async function writeJson(filePath: string, data: unknown): Promise<void> {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * Write a string to a file, creating parent directories if needed.
 */
async function writeTextFile(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(filePath, content, "utf-8");
}

// ─── Merge Logic ─────────────────────────────────────────────

/**
 * Merge agents.json: add new agents by ID, skip existing ones.
 * Returns the number of new agents added.
 */
async function mergeAgents(configDir: string): Promise<number> {
  const localPath = join(configDir, "agents.json");
  const remoteContent = await fetchRemoteFile("agents.json");
  if (!remoteContent) return -1;

  let remoteData: { agents: Array<{ id: string; [key: string]: unknown }> };
  try {
    remoteData = JSON.parse(remoteContent);
  } catch {
    return 0;
  }

  if (!remoteData.agents || !Array.isArray(remoteData.agents)) return 0;

  const localData = await readLocalJson<{ agents: Array<{ id: string; [key: string]: unknown }> }>(localPath);
  const localAgents = localData?.agents ?? [];
  const localIds = new Set(localAgents.map((a) => a.id));

  const newAgents = remoteData.agents.filter((a) => !localIds.has(a.id));
  if (newAgents.length === 0 && localAgents.length > 0) return 0;

  const mergedAgents = [...localAgents, ...newAgents];
  await writeJson(localPath, { agents: mergedAgents });
  return newAgents.length;
}

/**
 * Merge mcp.json: add new MCP servers by key, skip existing ones.
 * Returns the number of new servers added.
 */
async function mergeMcpServers(configDir: string): Promise<number> {
  const localPath = join(configDir, "mcp.json");
  const remoteContent = await fetchRemoteFile("mcp.json");
  if (!remoteContent) return -1;

  let remoteData: { mcpServers: Record<string, unknown> };
  try {
    remoteData = JSON.parse(remoteContent);
  } catch {
    return 0;
  }

  if (!remoteData.mcpServers || typeof remoteData.mcpServers !== "object") return 0;

  const localData = await readLocalJson<{ mcpServers: Record<string, unknown> }>(localPath);
  const localServers = localData?.mcpServers ?? {};

  let addedCount = 0;
  const merged = { ...localServers };

  for (const [key, value] of Object.entries(remoteData.mcpServers)) {
    if (!(key in merged)) {
      merged[key] = value;
      addedCount++;
    }
  }

  if (addedCount === 0 && Object.keys(localServers).length > 0) return 0;

  await writeJson(localPath, { mcpServers: merged });
  return addedCount;
}

/**
 * Merge lsp.json: add new LSP entries by key, skip existing ones.
 * Returns the number of new entries added.
 */
async function mergeLspEntries(configDir: string): Promise<number> {
  const localPath = join(configDir, "lsp.json");
  const remoteContent = await fetchRemoteFile("lsp.json");
  if (!remoteContent) return -1;

  let remoteData: { lsp: Record<string, unknown> };
  try {
    remoteData = JSON.parse(remoteContent);
  } catch {
    return 0;
  }

  if (!remoteData.lsp || typeof remoteData.lsp !== "object") return 0;

  const localData = await readLocalJson<{ lsp: Record<string, unknown> }>(localPath);
  const localLsp = localData?.lsp ?? {};

  let addedCount = 0;
  const merged = { ...localLsp };

  for (const [key, value] of Object.entries(remoteData.lsp)) {
    if (!(key in merged)) {
      merged[key] = value;
      addedCount++;
    }
  }

  if (addedCount === 0 && Object.keys(localLsp).length > 0) return 0;

  await writeJson(localPath, { lsp: merged });
  return addedCount;
}

/**
 * Merge a directory: copy new files only, skip existing filenames.
 * Returns the number of new files added.
 */
async function mergeDirectory(configDir: string, dirName: string): Promise<DirectoryMergeResult> {
  const localDir = join(configDir, dirName);
  const remoteFiles = await fetchDirectoryListing(dirName);
  if (remoteFiles.length === 0) {
    // Distinguish "nothing new" from "fetch failed"
    if (!existsSync(localDir) || readdirSync(localDir).length === 0) {
      return { added: 0, failed: 0, listingFailed: true }; // Likely fetch failure — local dir is empty/missing
    }
    return { added: 0, failed: 0, listingFailed: false };
  }

  if (!existsSync(localDir)) {
    await mkdir(localDir, { recursive: true });
  }

  let addedCount = 0;
  let failedCount = 0;

  for (const fileName of remoteFiles) {
    const localPath = join(localDir, fileName);
    if (existsSync(localPath)) {
      continue; // Skip existing files
    }

    const content = await fetchRemoteFile(`${dirName}/${fileName}`);
    if (content) {
      await writeTextFile(localPath, content);
      addedCount++;
    } else {
      failedCount++;
    }
  }

  return { added: addedCount, failed: failedCount, listingFailed: false };
}

/**
 * Merge skill directories: each skill is a subdirectory containing SKILL.md.
 * Uses the locally cloned CLI source (already downloaded in Step 1) to avoid
 * GitHub API rate limits. Falls back to API if local source unavailable.
 */
async function mergeSkillDirectories(configDir: string): Promise<DirectoryMergeResult> {
  const localDir = join(configDir, "skills");
  const cliSkillsDir = join(configDir, "cli", "config", "skills");

  // Try local source first (from the CLI clone in Step 1)
  if (existsSync(cliSkillsDir)) {
    return mergeSkillsFromLocal(localDir, cliSkillsDir);
  }

  // Fallback: fetch from GitHub API (may hit rate limits for 50+ skills)
  return mergeSkillsFromApi(localDir);
}

async function mergeSkillsFromLocal(localDir: string, sourceDir: string): Promise<DirectoryMergeResult> {
  if (!existsSync(localDir)) {
    await mkdir(localDir, { recursive: true });
  }

  let addedCount = 0;
  const entries = readdirSync(sourceDir);

  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry);
    const destPath = join(localDir, entry);

    // Only process directories that contain SKILL.md
    const sourceSkillPath = join(sourcePath, "SKILL.md");
    const destSkillPath = join(destPath, "SKILL.md");
    if (!existsSync(sourceSkillPath)) continue;
    if (existsSync(destPath)) {
      const sourceContent = await readFile(sourceSkillPath, "utf-8");
      const destContent = existsSync(destSkillPath) ? await readFile(destSkillPath, "utf-8") : "";
      if (sourceContent === destContent) continue;
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      if (destContent) await writeTextFile(join(destPath, `SKILL.md.backup.${timestamp}`), destContent);
      await cp(sourcePath, destPath, { recursive: true, force: true });
      addedCount++;
      continue;
    }

    await cp(sourcePath, destPath, { recursive: true });
    addedCount++;
  }

  return { added: addedCount, failed: 0, listingFailed: false };
}

async function mergeSkillsFromApi(localDir: string): Promise<DirectoryMergeResult> {
  const remoteSkills = await fetchSubdirectoryListing("skills");
  if (remoteSkills.length === 0) {
    if (!existsSync(localDir) || readdirSync(localDir).length === 0) {
      return { added: 0, failed: 0, listingFailed: true };
    }
    return { added: 0, failed: 0, listingFailed: false };
  }

  if (!existsSync(localDir)) {
    await mkdir(localDir, { recursive: true });
  }

  let addedCount = 0;
  let failedCount = 0;

  for (const skillName of remoteSkills) {
    const localSkillDir = join(localDir, skillName);

    const skillFiles = await fetchDirectoryListing(`skills/${skillName}`);
    if (skillFiles.length === 0) {
      failedCount++;
      continue;
    }

    await mkdir(localSkillDir, { recursive: true });
    let skillAdded = false;

    for (const fileName of skillFiles) {
      const content = await fetchRemoteFile(`skills/${skillName}/${fileName}`);
      if (content) {
        const targetPath = join(localSkillDir, fileName);
        if (existsSync(targetPath)) {
          const existing = await readFile(targetPath, "utf-8");
          if (existing === content) continue;
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          await writeTextFile(join(localSkillDir, `${fileName}.backup.${timestamp}`), existing);
        }
        await writeTextFile(targetPath, content);
        skillAdded = true;
      }
    }

    if (skillAdded) {
      addedCount++;
    } else {
      failedCount++;
      await rm(localSkillDir, { recursive: true, force: true });
    }
  }

  return { added: addedCount, failed: failedCount, listingFailed: false };
}

/**
 * Handle AGENTS.md: always overwrite (system instruction must be latest).
 * Returns true if updated.
 */
async function updateAgentsMd(configDir: string): Promise<boolean> {
  const content = await fetchRemoteFile("AGENTS.md");
  if (!content) return false;

  const localPath = join(configDir, "AGENTS.md");

  // Preserve user edits: backup before overwriting
  if (existsSync(localPath)) {
    const localContent = await readFile(localPath, "utf-8");
    if (localContent !== content) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const backupPath = join(configDir, `AGENTS.md.backup.${timestamp}`);
      await writeTextFile(backupPath, localContent);
      info(`  AGENTS.md changed — backup saved to ${backupPath}`);
    }
  }

  await writeTextFile(localPath, content);
  return true;
}

/**
 * Handle fallback.json: skip if already exists (user may have customized).
 * Returns true if the file was written (i.e., it didn't exist before).
 */
async function handleFallback(configDir: string): Promise<FallbackStatus> {
  const localPath = join(configDir, "fallback.json");
  if (existsSync(localPath)) {
    return "skipped"; // Skip — user may have customized
  }

  const content = await fetchRemoteFile("fallback.json");
  if (!content) return "fetch-failed";

  await writeTextFile(localPath, content);
  return "written";
}

/**
 * Ensure OpenCode's primary config exists before migrations register MCP/LSP.
 */
async function ensureOpenCodeJson(configDir: string): Promise<boolean> {
  const result = ensureOpenCodeJsonEntries(configDir);
  if (result.repaired && result.backupPath) {
    warn(`Malformed opencode.json was backed up to ${result.backupPath} and rebuilt.`);
  }
  return result.changed;
}

async function ensureTuiJson(configDir: string): Promise<boolean> {
  const result = ensureTuiJsonEntries(configDir);
  if (result.repaired && result.backupPath) {
    warn(`Malformed tui.json was backed up to ${result.backupPath} and rebuilt.`);
  }
  return result.changed;
}

async function backupConfigForUpdate(configDir: string): Promise<void> {
  if (!existsSync(configDir)) return;
  const backupDir = join(configDir, ".backup-update");
  
  // Clean old backup if exists
  if (existsSync(backupDir)) {
    await rm(backupDir, { recursive: true, force: true });
  }
  
  await mkdir(backupDir, { recursive: true });
  
  // Backup only critical config files
  const filesToBackup = ["opencode.json", "tui.json"];
  for (const file of filesToBackup) {
    const src = join(configDir, file);
    const dst = join(backupDir, file);
    if (existsSync(src)) {
      await cp(src, dst, { force: true });
    }
  }
  
  info(`Backed up config to: ${backupDir}`);
}

// ─── Main Merge Orchestrator ─────────────────────────────────

/**
 * Perform a merge-based update: fetch remote configs and merge them
 * with local configs, preserving user customizations.
 */
async function mergeUpdatedConfigs(): Promise<MergeStats> {
  const configDir = getConfigDir();

  // Ensure config directory exists
  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }

  const stats: MergeStats = {
    opencodeJsonChanged: false,
    tuiJsonChanged: false,
    agents: 0,
    mcpServers: 0,
    lspEntries: 0,
    profiles: 0,
    prompts: 0,
    skills: 0,
    agentsMdUpdated: false,
    fallbackSkipped: false,
    fallbackFetchFailed: false,
    fetchFailed: 0,
    fetchAttempted: 0,
  };

  // 1. Merge JSON config files
  info("Ensuring opencode.json...");
  stats.opencodeJsonChanged = await ensureOpenCodeJson(configDir);

  info("Ensuring tui.json...");
  stats.tuiJsonChanged = await ensureTuiJson(configDir);

  info("Merging agents.json...");
  stats.fetchAttempted++;
  stats.agents = await mergeAgents(configDir);
  if (stats.agents < 0) { stats.fetchFailed++; stats.agents = 0; }

  info("Merging mcp.json...");
  stats.fetchAttempted++;
  stats.mcpServers = await mergeMcpServers(configDir);
  if (stats.mcpServers < 0) { stats.fetchFailed++; stats.mcpServers = 0; }

  info("Merging lsp.json...");
  stats.fetchAttempted++;
  stats.lspEntries = await mergeLspEntries(configDir);
  if (stats.lspEntries < 0) { stats.fetchFailed++; stats.lspEntries = 0; }

  // 2. Merge directories (only add new files)
  info("Merging profiles/...");
  stats.fetchAttempted++;
  const profileMerge = await mergeDirectory(configDir, "profiles");
  stats.profiles = profileMerge.added;
  if (profileMerge.listingFailed) stats.fetchFailed++;
  stats.fetchFailed += profileMerge.failed;
  stats.fetchAttempted += profileMerge.added + profileMerge.failed;

  info("Merging prompts/...");
  stats.fetchAttempted++;
  const promptMerge = await mergeDirectory(configDir, "prompts");
  stats.prompts = promptMerge.added;
  if (promptMerge.listingFailed) stats.fetchFailed++;
  stats.fetchFailed += promptMerge.failed;
  stats.fetchAttempted += promptMerge.added + promptMerge.failed;

  info("Merging skills/...");
  stats.fetchAttempted++;
  const skillMerge = await mergeSkillDirectories(configDir);
  stats.skills = skillMerge.added;
  if (skillMerge.listingFailed) stats.fetchFailed++;
  stats.fetchFailed += skillMerge.failed;
  stats.fetchAttempted += skillMerge.added + skillMerge.failed;

  // 3. AGENTS.md — overwrite only if remote is newer, preserve user edits otherwise
  info("Updating AGENTS.md...");
  stats.fetchAttempted++;
  stats.agentsMdUpdated = await updateAgentsMd(configDir);
  if (!stats.agentsMdUpdated && !existsSync(join(configDir, "AGENTS.md"))) { stats.fetchFailed++; }

  // 4. fallback.json — skip if exists
  info("Checking fallback.json...");
  stats.fetchAttempted++;
  const fallbackStatus = await handleFallback(configDir);
  stats.fallbackSkipped = fallbackStatus === "skipped";
  stats.fallbackFetchFailed = fallbackStatus === "fetch-failed";
  if (fallbackStatus === "fetch-failed") { stats.fetchFailed++; }

  return stats;
}

// ─── Report ──────────────────────────────────────────────────

/**
 * Print a human-readable summary of what was merged.
 */
function printMergeReport(stats: MergeStats): void {
  console.log();
  heading("Merge Summary");

  const items: string[] = [];

  if (stats.agents > 0) items.push(`${stats.agents} agent(s)`);
  if (stats.mcpServers > 0) items.push(`${stats.mcpServers} MCP server(s)`);
  if (stats.lspEntries > 0) items.push(`${stats.lspEntries} LSP entry/entries`);
  if (stats.profiles > 0) items.push(`${stats.profiles} profile(s)`);
  if (stats.prompts > 0) items.push(`${stats.prompts} prompt(s)`);
  if (stats.skills > 0) items.push(`${stats.skills} skill(s)`);

  if (items.length > 0) {
    success(`Added: ${items.join(", ")}`);
  } else {
    info("No new items to add — your config already has everything.");
  }

  if (stats.agentsMdUpdated) {
    success("AGENTS.md updated to latest version.");
  }

  if (stats.fallbackSkipped) {
    info("fallback.json skipped (local copy preserved).");
  }

  if (stats.opencodeJsonChanged) {
    success("opencode.json updated with missing defaults.");
  }
  if (stats.tuiJsonChanged) {
    success("tui.json updated with Token Savings TUI plugin defaults.");
  }
}

// ─── Command ─────────────────────────────────────────────────

export const updateCommand = new Command("update")
  .description("Update CLI and merge latest configuration from GitHub")
  .option("--check", "Only check for updates without applying them")
  .option("--force", "Force sync even when local version is newer than remote")
  .action(async (options: { check?: boolean; force?: boolean }) => {
    logCommandStart("update", options);
    banner();
    heading("Update Check");

    // Ensure version file exists
    await initVersionFile();

    // Use the actual binary version (VERSION) as the authoritative local version.
    // version.json tracks config schema, but the binary version is what determines
    // whether the CLI itself needs updating.
    const localVersion = VERSION;

    info(`Current local version: ${chalk.bold(localVersion)}`);

    // Fetch latest version from GitHub
    info("Checking for updates...");
    const latestVersion = await fetchLatestVersion();

    if (!latestVersion) {
      error("Could not reach GitHub to check for updates.");
      error("Check your internet connection and try again.");
      logCommandError("update", "Failed to fetch latest version from GitHub");
      process.exit(EXIT_ERROR);
    }

    info(`Latest remote version: ${chalk.bold(latestVersion)}`);
    console.log();

    const comparison = compareVersions(latestVersion, localVersion);
    const isHandoff = process.env.OPENCODE_JCE_UPDATED_CLI_HANDOFF === "1";

    if (comparison > 0) {
      info(`${chalk.yellow("Update available:")} ${localVersion} → ${latestVersion}`);
    } else if (comparison < 0) {
      warn(`Local version (${localVersion}) is newer than remote (${latestVersion}).`);
      if (!options.force) {
        info("Skipping self-update to avoid downgrading. Use --force only if you intentionally want to sync remote main.");
      }
    } else {
      info("Version is current. Syncing latest files...");
    }

    // Check-only mode
    if (options.check) {
      if (comparison > 0) {
        info("Run `opencode-jce update` to apply the update.");
      } else if (comparison < 0) {
        info("No update applied because local version is newer than remote.");
      } else {
        info("Run `opencode-jce update` to sync latest files.");
      }
      logCommandSuccess("update", `check complete, latest=${latestVersion}`);
      process.exit(EXIT_SUCCESS);
    }

    if (comparison < 0 && !options.force) {
      logCommandSuccess("update", `skipped downgrade, local=${localVersion}, remote=${latestVersion}`);
      process.exit(EXIT_SUCCESS);
    }

    const configDir = getConfigDir();
    try {
      await backupConfigForUpdate(configDir);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      error(`Backup failed: ${msg}`);
      error("Update aborted before changing CLI or configuration because no recovery backup could be created.");
      logCommandError("update", `backup failed: ${msg}`);
      process.exit(EXIT_ERROR);
    }

    // Step 1: Self-update CLI
    console.log();
    heading("Step 1: Update CLI");
    const cliUpdated = await selfUpdateCli(latestVersion);
    if (!cliUpdated) {
      logCommandError("update", "CLI self-update failed");
      process.exit(EXIT_ERROR);
    }
    if (comparison > 0 && !isHandoff) {
      await handoffToUpdatedCli();
    }

    // Step 2: Merge config files
    console.log();
    heading("Step 2: Merge Configuration");

    // Merge remote configs into local
    info("Downloading and merging latest configuration...");
    const stats = await mergeUpdatedConfigs();

    // Check if anything was actually fetched
    const totalChanges =
      stats.agents +
      stats.mcpServers +
      stats.lspEntries +
      stats.profiles +
      stats.prompts +
      stats.skills +
      (stats.agentsMdUpdated ? 1 : 0) +
      (stats.opencodeJsonChanged ? 1 : 0) +
      (stats.tuiJsonChanged ? 1 : 0);

    if (stats.fetchFailed > 0) {
      warn(`${stats.fetchFailed}/${stats.fetchAttempted} fetch(es) failed. Update may have failed.`);
      warn("Check your internet connection or try again later.");
      warn("Attempting to restore configuration from backup...");
      
      // Rollback config on fetch failure
      const configDir = getConfigDir();
      const backupDir = join(configDir, ".backup-update");
      if (existsSync(backupDir)) {
        try {
          const opencodeJsonBackup = join(backupDir, "opencode.json");
          const tuiJsonBackup = join(backupDir, "tui.json");
          
          if (existsSync(opencodeJsonBackup)) {
            await cp(opencodeJsonBackup, join(configDir, "opencode.json"), { force: true });
            success("Restored opencode.json from backup.");
          }
          if (existsSync(tuiJsonBackup)) {
            await cp(tuiJsonBackup, join(configDir, "tui.json"), { force: true });
            success("Restored tui.json from backup.");
          }
        } catch (rollbackErr) {
          warn(`Rollback failed: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`);
        }
      }
      
      logCommandError("update", `${stats.fetchFailed} fetches failed during merge; config rolled back`);
      process.exit(EXIT_ERROR);
    }

    // Print merge report
    printMergeReport(stats);

    // Run migrations based on version.json state (independent of binary version)
    console.log();
    info("Running migrations...");
    const migrationsRun = await runMigrations(latestVersion || CURRENT_CONFIG_VERSION);
    if (migrationsRun > 0) {
      success(`Ran ${migrationsRun} migration(s).`);
    } else {
      info("No migrations needed.");
    }

    // Final summary
    console.log();
    heading("Update Complete");
    if (comparison > 0) {
      success(`Version: ${localVersion} → ${latestVersion}`);
    } else {
      success(`Synced to latest build (v${latestVersion}).`);
    }
    const terminated = await terminateStaleOpenCodeProcesses();
    if (terminated.length > 0) {
      warn(`Stopped ${terminated.length} stale OpenCode process(es) so the updated plugin/CLI is loaded next run.`);
    }
    info("Your existing customizations have been preserved.");
    info("Run `opencode-jce doctor` to verify your installation.");

    logCommandSuccess("update", `synced to ${latestVersion}, added ${totalChanges} item(s)`);
    process.exit(EXIT_SUCCESS);
  });
