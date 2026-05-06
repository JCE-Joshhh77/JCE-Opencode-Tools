import { join, dirname, resolve, sep } from "path";
import { existsSync, mkdirSync, rmSync } from "fs";
import { readFile, writeFile } from "fs/promises";

import { getConfigDir } from "./config.js";
import { ensureOpenCodeJsonEntries, mergePluginMcpIntoOpenCodeJson, readOrRepairOpenCodeJson, writeOpenCodeJsonAtomic } from "./opencode-config-merge.js";

/**
 * Remove a directory recursively (cross-platform).
 */
function removeDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Non-fatal
  }
}

// ─── Types ───────────────────────────────────────────────────

export interface PluginManifest {
  name: string;
  version: string;
  type: "mcp" | "agent" | "prompt";
  description: string;
  config: Record<string, unknown>;
}

export interface InstalledPlugin {
  name: string;
  version: string;
  type: "mcp" | "agent" | "prompt";
  description: string;
  source: string; // GitHub URL
  installDir?: string;
  installedAt: string;
  appliedMcp?: Record<string, unknown>;
}

const PLUGIN_TYPES = ["mcp", "agent", "prompt"] as const;

function isPluginType(value: unknown): value is PluginManifest["type"] {
  return typeof value === "string" && (PLUGIN_TYPES as readonly string[]).includes(value);
}

export interface PluginsRegistry {
  plugins: InstalledPlugin[];
}

// ─── Paths ───────────────────────────────────────────────────

/**
 * Get the path to the plugins registry file.
 */
export function getPluginsPath(): string {
  return join(getConfigDir(), "plugins.json");
}

/**
 * Get the path to the plugins install directory.
 */
export function getPluginsDir(): string {
  return join(getConfigDir(), "plugins");
}

// ─── Registry Operations ─────────────────────────────────────

/**
 * Load the plugins registry.
 */
export async function loadPluginsRegistry(): Promise<InstalledPlugin[]> {
  const registryPath = getPluginsPath();

  if (!existsSync(registryPath)) {
    return [];
  }

  const content = await readFile(registryPath, "utf-8");
  let registry: PluginsRegistry;
  try {
    registry = JSON.parse(content);
  } catch {
    throw new Error(`Failed to parse ${registryPath}: invalid JSON`);
  }
  return registry.plugins || [];
}

/**
 * Save the plugins registry.
 */
export async function savePluginsRegistry(plugins: InstalledPlugin[]): Promise<void> {
  const registryPath = getPluginsPath();
  const dir = dirname(registryPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const registry: PluginsRegistry = { plugins };
  await writeFile(registryPath, JSON.stringify(registry, null, 2), "utf-8");
}

// ─── Plugin Operations ───────────────────────────────────────

/**
 * Install a plugin from a GitHub URL.
 * Clones the repo, reads plugin.json, and registers it.
 */
export async function installPlugin(githubUrl: string): Promise<{ success: boolean; plugin?: InstalledPlugin; error?: string }> {
  const pluginsDir = getPluginsDir();

  if (!existsSync(pluginsDir)) {
    mkdirSync(pluginsDir, { recursive: true });
  }

  const parsedUrl = parseGitHubPluginUrl(githubUrl);
  if (!parsedUrl) {
    return { success: false, error: "Invalid GitHub URL. Expected format: https://github.com/user/repo" };
  }
  const repoName = parsedUrl.repo;

  const pluginDir = join(pluginsDir, repoName);
  const resolvedPluginsDir = resolve(pluginsDir);
  const resolvedPluginDir = resolve(pluginDir);
  if (!resolvedPluginDir.startsWith(resolvedPluginsDir + sep)) {
    return { success: false, error: "Invalid GitHub URL: resolved plugin path escapes plugins directory." };
  }

  // Check if already installed
  const existing = await loadPluginsRegistry();
  if (existing.some((p) => p.installDir === repoName || p.source === githubUrl)) {
    return { success: false, error: `Plugin "${repoName}" is already installed.` };
  }

  // Clone the repository
  try {
    if (existsSync(pluginDir)) {
      removeDir(pluginDir);
    }
    const proc = Bun.spawn(["git", "clone", "--depth", "1", githubUrl, pluginDir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    if (proc.exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`git clone failed: ${stderr}`);
    }
  } catch (err: any) {
    return { success: false, error: `Failed to clone repository: ${err.message}` };
  }

  // Read plugin.json
  const manifestPath = join(pluginDir, "plugin.json");
  if (!existsSync(manifestPath)) {
    // Cleanup
    removeDir(pluginDir);
    return { success: false, error: "Repository does not contain a plugin.json manifest." };
  }

  let manifest: PluginManifest;
  try {
    const content = await readFile(manifestPath, "utf-8");
    manifest = JSON.parse(content);
  } catch {
    removeDir(pluginDir);
    return { success: false, error: "Invalid plugin.json — could not parse manifest." };
  }

  // Validate manifest
  if (!manifest.name || !manifest.version || !manifest.type) {
    removeDir(pluginDir);
    return { success: false, error: "plugin.json is missing required fields (name, version, type)." };
  }

  if (!isPluginType(manifest.type)) {
    removeDir(pluginDir);
    return { success: false, error: "plugin.json has unsupported type. Expected one of: mcp, agent, prompt." };
  }

  if (existing.some((p) => p.name === manifest.name)) {
    removeDir(pluginDir);
    return { success: false, error: `Plugin "${manifest.name}" is already installed.` };
  }

  const appliedMcp = getPluginMcpConfig(manifest);

  // Register the plugin
  const plugin: InstalledPlugin = {
    name: manifest.name,
    version: manifest.version,
    type: manifest.type,
    description: manifest.description || "",
    source: sanitizeGitUrl(githubUrl),
    installDir: repoName,
    installedAt: new Date().toISOString(),
    ...(appliedMcp ? { appliedMcp } : {}),
  };

  await applyPluginConfig(manifest);
  existing.push(plugin);
  try {
    await savePluginsRegistry(existing);
  } catch (err) {
    await rollbackAppliedPluginConfig(plugin);
    removeDir(pluginDir);
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to save plugin registry: ${msg}` };
  }

  return { success: true, plugin };
}

/**
 * Merge supported plugin config into opencode.json.
 */
export async function applyPluginConfig(manifest: PluginManifest): Promise<void> {
  const configDir = getConfigDir();
  ensureOpenCodeJsonEntries(configDir);

  if (manifest.type === "mcp") {
    const pluginMcp = getPluginMcpConfig(manifest);
    if (!pluginMcp) return;
    mergePluginMcpIntoOpenCodeJson(configDir, pluginMcp);
  }
}

/**
 * Remove an installed plugin by name.
 */
export async function removePlugin(name: string): Promise<{ success: boolean; error?: string }> {
  const plugins = await loadPluginsRegistry();
  const index = plugins.findIndex((p) => p.name === name);

  if (index === -1) {
    return { success: false, error: `Plugin "${name}" is not installed.` };
  }

  const plugin = plugins[index];

  await removeAppliedPluginConfig(plugin);

  // Remove the plugin directory
  const pluginDirName = plugin.installDir || name;
  const pluginDir = join(getPluginsDir(), pluginDirName);
  const resolvedPluginsDir = resolve(getPluginsDir());
  const resolvedPluginDir = resolve(pluginDir);
  if (existsSync(pluginDir)) {
    try {
      if (resolvedPluginDir.startsWith(resolvedPluginsDir + sep)) {
        removeDir(pluginDir);
      }
    } catch {
      // Non-fatal — registry will still be updated
    }
  }

  plugins.splice(index, 1);
  await savePluginsRegistry(plugins);

  return { success: true };
}

function getPluginMcpConfig(manifest: PluginManifest): Record<string, unknown> | null {
  const pluginMcp = manifest.config.mcp;
  if (!pluginMcp || typeof pluginMcp !== "object" || Array.isArray(pluginMcp)) return null;
  return pluginMcp as Record<string, unknown>;
}

async function removeAppliedPluginConfig(plugin: InstalledPlugin): Promise<void> {
  if (!plugin.appliedMcp || Object.keys(plugin.appliedMcp).length === 0) return;

  const configDir = getConfigDir();
  const configPath = join(configDir, "opencode.json");
  if (!existsSync(configPath)) return;

  const { config } = readOrRepairOpenCodeJson(configDir);
  if (!config.mcp || typeof config.mcp !== "object" || Array.isArray(config.mcp)) return;
  const currentMcp = config.mcp as Record<string, unknown>;

  let changed = false;
  for (const [key, value] of Object.entries(plugin.appliedMcp)) {
    if (JSON.stringify(currentMcp[key]) === JSON.stringify(value)) {
      delete currentMcp[key];
      changed = true;
    }
  }

  if (changed) writeOpenCodeJsonAtomic(configDir, config);
}

async function rollbackAppliedPluginConfig(plugin: InstalledPlugin): Promise<void> {
  await removeAppliedPluginConfig(plugin);
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Sanitize a Git URL by stripping any embedded username/password.
 */
export function sanitizeGitUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Parse and validate a GitHub plugin URL.
 */
export function parseGitHubPluginUrl(url: string): { owner: string; repo: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
    return null;
  }

  // Reject URLs with embedded credentials
  if (parsed.username || parsed.password) {
    return null;
  }

  const parts = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length !== 2) return null;

  const [owner, rawRepo] = parts;
  const repo = rawRepo.endsWith(".git") ? rawRepo.slice(0, -4) : rawRepo;
  const validName = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;

  if (!validName.test(owner) || !validName.test(repo)) return null;
  if ([".", ".."].includes(owner) || [".", ".."].includes(repo)) return null;

  return { owner, repo };
}
