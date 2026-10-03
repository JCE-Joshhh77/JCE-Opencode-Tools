import { join, resolve, sep } from "path";
import { existsSync } from "fs";
import { readFile, rename, rm, writeFile, mkdir } from "fs/promises";
import { getConfigDir } from "./config.js";
import { sanitizeGitUrl } from "./plugins.js";

export interface TeamConfig {
  repoUrl: string;
  lastSync: string;
  branch: string;
}

interface TeamWrite {
  path: string;
  content: string;
}

export async function commitTeamWrites(pendingWrites: TeamWrite[], renameFile = rename, recoverFile = rename): Promise<void> {
  const token = `.team-${process.pid}-${Date.now()}`;
  const staged = pendingWrites.map((pending) => ({ ...pending, temp: `${pending.path}${token}.tmp`, backup: `${pending.path}${token}.bak`, existed: existsSync(pending.path) }));
  const committed: typeof staged = [];
  const preserveBackups = new Set<string>();
  let activating: (typeof staged)[number] | undefined;
  try {
    for (const pending of staged) {
      await mkdir(resolve(pending.path, ".."), { recursive: true });
      await writeFile(pending.temp, pending.content, "utf-8");
    }
    for (const pending of staged) {
      activating = pending;
      if (pending.existed) await rename(pending.path, pending.backup);
      await renameFile(pending.temp, pending.path);
      committed.push(pending);
      activating = undefined;
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    if (activating?.existed && existsSync(activating.backup)) {
      try { await recoverFile(activating.backup, activating.path); } catch (rollbackError) { preserveBackups.add(activating.backup); rollbackErrors.push(rollbackError); }
    }
    for (const pending of committed.reverse()) {
      try {
        await rm(pending.path, { force: true });
        if (pending.existed) await recoverFile(pending.backup, pending.path);
      } catch (rollbackError) {
        preserveBackups.add(pending.backup);
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], `Team write failed and rollback failed: ${rollbackErrors.map(String).join("; ")}`);
    throw error;
  } finally {
    for (const pending of staged) {
      await rm(pending.temp, { force: true });
      if (preserveBackups.has(pending.backup)) continue;
      await rm(pending.backup, { force: true });
    }
  }
}

function parseTeamConfig(content: string, path: string): TeamConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Failed to parse team config: invalid JSON in ${path}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Failed to parse team config: expected object in ${path}`);
  const config = parsed as Partial<TeamConfig>;
  if (typeof config.repoUrl !== "string" || typeof config.branch !== "string" || typeof config.lastSync !== "string") {
    throw new Error(`Failed to parse team config: missing repoUrl, branch, or lastSync in ${path}`);
  }
  const repoValidation = validateTeamRepoUrl(config.repoUrl);
  if (!repoValidation.valid) throw new Error(repoValidation.error);
  const branchError = validateTeamBranch(config.branch);
  if (branchError) throw new Error(branchError);
  return { repoUrl: sanitizeGitUrl(config.repoUrl), branch: config.branch, lastSync: config.lastSync };
}

const TEAM_CONFIG_FILE = "team.json";

export function validateTeamRepoUrl(repoUrl: string): { valid: boolean; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(repoUrl);
  } catch {
    return { valid: false, error: "Invalid repository URL format" };
  }

  if (parsed.protocol !== "https:") {
    return { valid: false, error: "Repository URL must use https: protocol" };
  }
  if (parsed.username || parsed.password) {
    return { valid: false, error: "Repository URL must not contain credentials" };
  }
  if (parsed.hostname !== "github.com") {
    return { valid: false, error: "Repository URL must use github.com" };
  }
  if (!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(parsed.pathname)) {
    return { valid: false, error: "Repository URL must be a GitHub owner/repo URL" };
  }

  return { valid: true };
}

function validateTeamBranch(branch: string): string | null {
  if (!/^[a-zA-Z0-9._\/-]+$/.test(branch)) return "Team branch name contains invalid characters";
  if (branch.includes("..")) return "Branch name must not contain '..' sequences";
  if (branch.startsWith("/") || branch.endsWith("/") || branch.endsWith(".")) return "Branch name has an invalid format";
  return null;
}

/**
 * Get the path to the team config file.
 */
export function getTeamConfigPath(configDir = getConfigDir()): string {
  return join(configDir, TEAM_CONFIG_FILE);
}

/**
 * Load team config. Returns null if not initialized.
 */
export async function loadTeamConfig(configDir = getConfigDir()): Promise<TeamConfig | null> {
  const configPath = getTeamConfigPath(configDir);

  if (!existsSync(configPath)) {
    return null;
  }

  const content = await readFile(configPath, "utf-8").catch((err) => {
    throw new Error(`Failed to read team config: ${err.code ?? err.message} (${configPath})`);
  });
  return parseTeamConfig(content, configPath);
}

/**
 * Save team config.
 */
export async function saveTeamConfig(config: TeamConfig, configDir = getConfigDir()): Promise<void> {
  const configPath = getTeamConfigPath(configDir);

  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }

  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Initialize team sync with a Git repository URL.
 */
export async function initTeamSync(
  repoUrl: string,
  branch: string = "main"
): Promise<{ success: boolean; error?: string }> {
  try {
    const repoValidation = validateTeamRepoUrl(repoUrl);
    if (!repoValidation.valid) return { success: false, error: repoValidation.error };
    const branchError = validateTeamBranch(branch);
    if (branchError) return { success: false, error: branchError };

    const config: TeamConfig = {
      repoUrl: sanitizeGitUrl(repoUrl),
      lastSync: new Date().toISOString(),
      branch,
    };

    await saveTeamConfig(config);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Push current config to the team repository.
 */
export async function pushTeamConfig(): Promise<{ success: boolean; error?: string }> {
  const configDir = getConfigDir();
  const teamConfig = await loadTeamConfig(configDir);

  if (!teamConfig) {
    return { success: false, error: "Team sync not initialized. Run: opencode-jce team init <git-url>" };
  }

  const repoValidation = validateTeamRepoUrl(teamConfig.repoUrl);
  if (!repoValidation.valid) return { success: false, error: repoValidation.error };
  const branchError = validateTeamBranch(teamConfig.branch);
  if (branchError) return { success: false, error: branchError };

  const tempDir = join(configDir, ".team-sync");

  try {
    // Always remove stale .team-sync before clone
    if (existsSync(tempDir)) {
      await cleanup(tempDir);
    }

    // Clone the team repo
    const proc = Bun.spawn(["git", "clone", "--depth", "1", "--branch", teamConfig.branch, teamConfig.repoUrl, tempDir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;

    if (proc.exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      return { success: false, error: `Failed to clone team repo: ${stderr}` };
    }

    // Copy config files to the team repo
    const filesToSync = ["agents.json", "mcp.json", "lsp.json"];
    for (const file of filesToSync) {
      const srcPath = join(configDir, file);
      if (existsSync(srcPath)) {
        const content = await readFile(srcPath, "utf-8");
        await writeFile(join(tempDir, file), content, "utf-8");
      }
    }

    // Copy profiles
    const profilesDir = join(configDir, "profiles");
    const tempProfilesDir = join(tempDir, "profiles");
    if (existsSync(profilesDir)) {
      if (!existsSync(tempProfilesDir)) {
        await mkdir(tempProfilesDir, { recursive: true });
      }
      const { readdirSync } = await import("fs");
      const profiles = readdirSync(profilesDir).filter((f) => f.endsWith(".json"));
      const safeProfilesRoot = resolve(tempProfilesDir);
      for (const profile of profiles) {
        const resolvedDst = resolve(join(tempProfilesDir, profile));
        if (!resolvedDst.startsWith(safeProfilesRoot + sep)) continue;
        const content = await readFile(join(profilesDir, profile), "utf-8");
        await writeFile(join(tempProfilesDir, profile), content, "utf-8");
      }
    }

    // Git add, commit, push
    const addProc = Bun.spawn(["git", "add", "."], { cwd: tempDir, stdout: "pipe", stderr: "pipe" });
    await addProc.exited;
    if (addProc.exitCode !== 0) {
      const stderr = await new Response(addProc.stderr).text();
      await cleanup(tempDir);
      return { success: false, error: `Failed to stage team config: ${stderr.trim()}` };
    }

    const commitProc = Bun.spawn(["git", "commit", "-m", `sync: update config from ${new Date().toISOString()}`], {
      cwd: tempDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await commitProc.exited;

    if (commitProc.exitCode !== 0) {
      const stderr = await new Response(commitProc.stderr).text();
      const stdout = await new Response(commitProc.stdout).text();
      const output = `${stdout}\n${stderr}`;
      if (!output.includes("nothing to commit") && !output.includes("no changes added to commit")) {
        await cleanup(tempDir);
        return { success: false, error: `Failed to commit team config: ${output.trim()}` };
      }
      await cleanup(tempDir);
      return { success: true };
    }

    const pushProc = Bun.spawn(["git", "push", "origin", teamConfig.branch], {
      cwd: tempDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await pushProc.exited;

    if (pushProc.exitCode !== 0) {
      const stderr = await new Response(pushProc.stderr).text();
      await cleanup(tempDir);
      return { success: false, error: `Failed to push: ${stderr}` };
    }

    // Update last sync time
    teamConfig.lastSync = new Date().toISOString();
    await saveTeamConfig(teamConfig, configDir);

    await cleanup(tempDir);
    return { success: true };
  } catch (err: any) {
    await cleanup(tempDir);
    return { success: false, error: err.message };
  }
}

/**
 * Pull latest config from the team repository.
 */
export async function pullTeamConfig(): Promise<{ success: boolean; error?: string }> {
  const configDir = getConfigDir();
  const teamConfig = await loadTeamConfig(configDir);

  if (!teamConfig) {
    return { success: false, error: "Team sync not initialized. Run: opencode-jce team init <git-url>" };
  }

  const repoValidation = validateTeamRepoUrl(teamConfig.repoUrl);
  if (!repoValidation.valid) return { success: false, error: repoValidation.error };
  const branchError = validateTeamBranch(teamConfig.branch);
  if (branchError) return { success: false, error: branchError };

  const tempDir = join(configDir, ".team-sync");

  try {
    // Clone the team repo
    if (existsSync(tempDir)) {
      await cleanup(tempDir);
    }

    const proc = Bun.spawn(["git", "clone", "--depth", "1", "--branch", teamConfig.branch, teamConfig.repoUrl, tempDir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;

    if (proc.exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      return { success: false, error: `Failed to clone team repo: ${stderr}` };
    }

    // Validate the complete snapshot before changing local files.
    const pendingWrites: Array<{ path: string; content: string }> = [];
    const filesToSync = ["agents.json", "mcp.json", "lsp.json"];
    for (const file of filesToSync) {
      const srcPath = join(tempDir, file);
      const dstPath = join(configDir, file);
      if (existsSync(srcPath)) {
        const content = await readFile(srcPath, "utf-8");
        let parsed: any;
        try { parsed = JSON.parse(content); } catch { throw new Error(`Invalid JSON in team snapshot: ${file}`); }
        if (file === "agents.json") {
          if (!Array.isArray(parsed.agents)) throw new Error(`Invalid team snapshot structure: ${file}`);
        }
        if (file === "mcp.json") {
          if (!parsed.mcpServers || typeof parsed.mcpServers !== "object" || Array.isArray(parsed.mcpServers)) throw new Error(`Invalid team snapshot structure: ${file}`);
        }
        if (file === "lsp.json") {
          if (!parsed.lsp || typeof parsed.lsp !== "object" || Array.isArray(parsed.lsp)) throw new Error(`Invalid team snapshot structure: ${file}`);
        }
        pendingWrites.push({ path: dstPath, content });
      }
    }

    const tempProfilesDir = join(tempDir, "profiles");
    const profilesDir = join(configDir, "profiles");
    if (existsSync(tempProfilesDir)) {
      const { readdirSync } = await import("fs");
      const profiles = readdirSync(tempProfilesDir).filter((f) => f.endsWith(".json"));
      const safeProfilesRoot = resolve(profilesDir);
      for (const profile of profiles) {
        const resolvedDst = resolve(join(profilesDir, profile));
        if (!resolvedDst.startsWith(safeProfilesRoot + sep)) continue; // skip traversal
        const srcProfile = join(tempProfilesDir, profile);
        const dstProfile = join(profilesDir, profile);
        const content = await readFile(srcProfile, "utf-8");
        try { JSON.parse(content); } catch { throw new Error(`Invalid JSON in team snapshot: profiles/${profile}`); }
        pendingWrites.push({ path: dstProfile, content });
      }
    }

    teamConfig.lastSync = new Date().toISOString();
    pendingWrites.push({ path: getTeamConfigPath(configDir), content: JSON.stringify(teamConfig, null, 2) + "\n" });
    await commitTeamWrites(pendingWrites);

    await cleanup(tempDir);
    return { success: true };
  } catch (err: any) {
    await cleanup(tempDir);
    return { success: false, error: err.message };
  }
}

/**
 * Get team sync status.
 */
export async function getTeamStatus(): Promise<{
  initialized: boolean;
  repoUrl?: string;
  branch?: string;
  lastSync?: string;
}> {
  const config = await loadTeamConfig();

  if (!config) {
    return { initialized: false };
  }

  return {
    initialized: true,
    repoUrl: config.repoUrl,
    branch: config.branch,
    lastSync: config.lastSync,
  };
}

/**
 * Clean up temporary directory.
 */
async function cleanup(dir: string): Promise<void> {
  try {
    const { rmSync } = await import("fs");
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}
