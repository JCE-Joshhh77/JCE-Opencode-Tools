import { join, dirname, resolve, sep } from "path";
import { existsSync, mkdirSync, rmSync } from "fs";
import { readFile, writeFile, rename } from "fs/promises";

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

export interface InstallPluginOptions {
  trusted?: boolean;
  allowLocalMcp?: boolean;
}

const PLUGIN_TYPES = ["mcp", "agent", "prompt"] as const;
const MCP_TYPES = ["local", "remote"] as const;

const SHELL_EXPANSION_PATTERN = /\$\{|\$[A-Z_]|[`;$|&<>(){}]|\\[nt]/i;
const BLOCKED_HOSTNAMES = ["localhost", "127.0.0.1", "::1", "0.0.0.0"];
const SAFE_LOCAL_MCP_COMMANDS = new Set(["bun", "node", "npx"]);

function isValidMcpRemoteUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    if (BLOCKED_HOSTNAMES.includes(parsed.hostname)) return false;
    return parsed.hostname.length > 0 && parsed.hostname.includes(".");
  } catch {
    return false;
  }
}

function isValidMcpEnvValue(value: string): boolean {
  return !SHELL_EXPANSION_PATTERN.test(value);
}

function isPluginType(value: unknown): value is PluginManifest["type"] {
  return typeof value === "string" && (PLUGIN_TYPES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validatePluginManifest(value: unknown): PluginManifest {
  if (!isRecord(value)) throw new Error("plugin.json must be an object.");
  if (typeof value.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,98}$/.test(value.name)) throw new Error("plugin.json has invalid name.");
  if (typeof value.version !== "string" || value.version.trim().length === 0) throw new Error("plugin.json has invalid version.");
  if (!isPluginType(value.type)) throw new Error("plugin.json has unsupported type. Expected one of: mcp, agent, prompt.");
  if ("description" in value && typeof value.description !== "string") throw new Error("plugin.json description must be a string.");
  if (!isRecord(value.config)) throw new Error("plugin.json config must be an object.");

  const manifest: PluginManifest = {
    name: value.name,
    version: value.version,
    type: value.type,
    description: typeof value.description === "string" ? value.description : "",
    config: value.config,
  };
  validatePluginMcpConfig(getPluginMcpConfig(manifest));
  return manifest;
}

function validatePluginMcpConfig(pluginMcp: Record<string, unknown> | null): void {
  if (!pluginMcp) return;
  const validName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,98}$/;
  for (const [name, entry] of Object.entries(pluginMcp)) {
    if (!validName.test(name)) throw new Error(`Invalid MCP key: ${name}`);
    if (!isRecord(entry)) throw new Error(`Invalid MCP config for ${name}: entry must be an object.`);
    if (typeof entry.type !== "string" || !(MCP_TYPES as readonly string[]).includes(entry.type)) throw new Error(`Invalid MCP config for ${name}: type must be local or remote.`);
    if (entry.type === "local") {
      if (!Array.isArray(entry.command) || entry.command.length === 0 || !entry.command.every((item) => typeof item === "string" && item.trim().length > 0)) {
        throw new Error(`Invalid MCP config for ${name}: local command must be a non-empty string array.`);
      }
    }
    if (entry.type === "remote") {
      if (typeof entry.url !== "string" || !isValidMcpRemoteUrl(entry.url)) throw new Error(`Invalid MCP config for ${name}: remote url must be https with a valid hostname.`);
    }
    if ("env" in entry && (!isRecord(entry.env) || !Object.values(entry.env).every((value) => typeof value === "string" && isValidMcpEnvValue(value)))) {
      throw new Error(`Invalid MCP config for ${name}: env values must be strings without shell expansion patterns.`);
    }
    if ("enabled" in entry && typeof entry.enabled !== "boolean") throw new Error(`Invalid MCP config for ${name}: enabled must be boolean.`);
  }
}

function hasLocalMcpCommand(pluginMcp: Record<string, unknown> | null): boolean {
  if (!pluginMcp) return false;
  return Object.values(pluginMcp).some((entry) => isRecord(entry) && entry.type === "local");
}

export function summarizeMcpTrustRisk(pluginMcp: Record<string, unknown>): string[] {
  return Object.entries(pluginMcp).map(([name, entry]) => {
    if (!isRecord(entry)) return `${name}: invalid entry`;
    if (entry.type === "remote") return `${name}: remote ${typeof entry.url === "string" ? entry.url : "unknown-url"}`;
    const command = Array.isArray(entry.command) ? entry.command.filter((item): item is string => typeof item === "string") : [];
    const binary = command[0] ?? "unknown";
    const envKeys = isRecord(entry.env) ? Object.keys(entry.env).sort().join(",") || "none" : "none";
    const allowlisted = SAFE_LOCAL_MCP_COMMANDS.has(binary) ? "known-runner" : "custom-runner";
    return `${name}: local ${command.join(" ")} (${allowlisted}); env keys: ${envKeys}; persists to opencode.json`;
  });
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
  if (!isRecord(registry) || !Array.isArray(registry.plugins)) return [];
  return registry.plugins.filter((plugin): plugin is InstalledPlugin => isRecord(plugin)
    && typeof plugin.name === "string"
    && typeof plugin.version === "string"
    && isPluginType(plugin.type)
    && typeof plugin.description === "string"
    && typeof plugin.source === "string"
    && typeof plugin.installedAt === "string");
}

/**
 * Save the plugins registry.
 */
export async function savePluginsRegistry(plugins: InstalledPlugin[], options: { mergeLatest?: boolean } = {}): Promise<void> {
  const registryPath = getPluginsPath();
  const dir = dirname(registryPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const existing = options.mergeLatest && existsSync(registryPath) ? await loadPluginsRegistry() : [];
  const merged = new Map<string, InstalledPlugin>();
  for (const plugin of existing) merged.set(plugin.name, plugin);
  for (const plugin of plugins) merged.set(plugin.name, plugin);
  const registry: PluginsRegistry = { plugins: Array.from(merged.values()) };
  const tmpPath = `${registryPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, JSON.stringify(registry, null, 2) + "\n", "utf-8");
  await rename(tmpPath, registryPath);
}

// ─── Plugin Operations ───────────────────────────────────────

/**
 * Install a plugin from a GitHub URL.
 * Clones the repo, reads plugin.json, and registers it.
 */
export async function installPlugin(githubUrl: string, options: InstallPluginOptions = {}): Promise<{ success: boolean; plugin?: InstalledPlugin; error?: string; requiresTrust?: boolean; mcpPreview?: Record<string, unknown> }> {
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
    manifest = validatePluginManifest(JSON.parse(content));
  } catch {
    removeDir(pluginDir);
    return { success: false, error: "Invalid plugin.json — could not parse manifest." };
  }

  if (existing.some((p) => p.name === manifest.name)) {
    removeDir(pluginDir);
    return { success: false, error: `Plugin "${manifest.name}" is already installed.` };
  }

  const appliedMcp = getPluginMcpConfig(manifest);
  if (appliedMcp && !options.trusted) {
    removeDir(pluginDir);
    return {
      success: false,
      error: "Plugin declares MCP commands. Re-run with --yes after reviewing the MCP preview.",
      requiresTrust: true,
      mcpPreview: appliedMcp,
    };
  }
  if (appliedMcp && hasLocalMcpCommand(appliedMcp) && !options.allowLocalMcp) {
    removeDir(pluginDir);
    return {
      success: false,
      error: `Plugin declares local MCP commands. Re-run with --yes --allow-local-mcp after reviewing: ${summarizeMcpTrustRisk(appliedMcp).join(" | ")}`,
      requiresTrust: true,
      mcpPreview: appliedMcp,
    };
  }

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

  try {
    await applyPluginConfig(manifest);
    existing.push(plugin);
    await savePluginsRegistry(existing, { mergeLatest: true });
  } catch (err) {
    await rollbackAppliedPluginConfig(plugin);
    removeDir(pluginDir);
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to install plugin safely: ${msg}` };
  }

  return { success: true, plugin };
}

/**
 * Merge supported plugin config into opencode.json.
 */
export async function applyPluginConfig(manifest: PluginManifest): Promise<void> {
  manifest = validatePluginManifest(manifest);
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
