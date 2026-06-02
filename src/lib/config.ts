import { join, dirname } from "path";
import { homedir, platform } from "os";
import { existsSync } from "fs";
import { readFile, writeFile, mkdir } from "fs/promises";
import { FILETYPE_EXTENSIONS } from "./utils.js";

/**
 * Returns the cross-platform config directory for OpenCode JCE.
 * - All platforms: $XDG_CONFIG_HOME/opencode or ~/.config/opencode
 */
/**
 * Auto-detect the OpenCode config directory.
 * Searches for existing config (opencode.json as marker) in candidate paths.
 * Falls back to ~/.config/opencode/ (OpenCode standard on all platforms).
 */
export function getConfigDir(): string {
  const candidates: string[] = [];

  // 1. XDG_CONFIG_HOME (if set)
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (xdgConfig) {
    candidates.push(join(xdgConfig, "opencode"));
  }

  // 2. ~/.config/opencode (OpenCode standard on all platforms)
  candidates.push(join(homedir(), ".config", "opencode"));

  // Search for existing config (opencode.json is the marker)
  for (const path of candidates) {
    if (existsSync(join(path, "opencode.json"))) {
      return path;
    }
  }

  // Default: ~/.config/opencode/
  return candidates[0] || join(homedir(), ".config", "opencode");
}

/**
 * Returns the legacy config directory (%APPDATA%\opencode on Windows).
 * Used for migration purposes only.
 */
export function getLegacyConfigDir(): string {
  if (platform() === "win32" && process.env.APPDATA) {
    return join(process.env.APPDATA, "opencode");
  }
  return getConfigDir();
}

/**
 * Validate a relative path to prevent path traversal attacks.
 * Rejects paths containing "..", absolute paths, and null bytes.
 */
function validateRelativePath(relativePath: string): void {
  if (!relativePath || relativePath.includes("\0")) {
    throw new Error(`Invalid config path: contains null bytes`);
  }
  if (/^[/\\]|^[a-zA-Z]:/.test(relativePath)) {
    throw new Error(`Invalid config path: absolute paths not allowed: ${relativePath}`);
  }
  const segments = relativePath.split(/[/\\]/);
  if (segments.some((seg) => seg === "..")) {
    throw new Error(`Invalid config path: path traversal not allowed: ${relativePath}`);
  }
}

/**
 * Check if a config file exists at the given path relative to config dir.
 */
export function configFileExists(relativePath: string): boolean {
  validateRelativePath(relativePath);
  const fullPath = join(getConfigDir(), relativePath);
  return existsSync(fullPath);
}

/**
 * Load and parse a JSON config file from the config directory.
 * Returns the parsed object or throws with a user-friendly message.
 */
export async function loadConfigFile<T>(relativePath: string): Promise<T> {
  validateRelativePath(relativePath);
  const fullPath = join(getConfigDir(), relativePath);

  if (!existsSync(fullPath)) {
    throw new Error(`Config file not found: ${fullPath}`);
  }

  const content = await readFile(fullPath, "utf-8");

  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error(`Invalid JSON in: ${fullPath}`);
  }
}

/**
 * Get the full path to a config file.
 */
export function getConfigPath(relativePath: string): string {
  validateRelativePath(relativePath);
  return join(getConfigDir(), relativePath);
}

/**
 * Get the path to OpenCode's own opencode.json config file.
 * Uses the same directory as getConfigDir() for consistency.
 */
export function getOpenCodeConfigPath(): string {
  return join(getConfigDir(), "opencode.json");
}

/**
 * Load OpenCode's opencode.json config.
 * If the file does not exist, creates it with the full default template
 * (MCP servers, plugin, LSP auto-detect) so that subsequent writes
 * never produce a partial config.
 */
export async function loadOpenCodeConfig(): Promise<Record<string, any>> {
  const configPath = getOpenCodeConfigPath();

  try {
    let content = await readFile(configPath, "utf-8");
    // Strip UTF-8 BOM if present (Windows editors add this)
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }
    return JSON.parse(content) ?? {};
  } catch (err: any) {
    if (err.code === "ENOENT") {
      // Auto-create with full template
      const { buildDefaultOpenCodeJson } = await import("./opencode-json-template.js");
      const { buildAgentConfigs } = await import("../plugin/config.js");
      const configDir = getConfigDir();
      const template = buildDefaultOpenCodeJson(configDir, buildAgentConfigs());
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, JSON.stringify(template, null, 2) + "\n", "utf-8");
      return template as Record<string, any>;
    }
    
    // JSON parse error — backup before auto-creating (preserve user's broken config)
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const backupPath = `${configPath}.backup-${timestamp}`;
    await writeFile(backupPath, await readFile(configPath, "utf-8"), "utf-8");
    
    const { buildDefaultOpenCodeJson } = await import("./opencode-json-template.js");
    const { buildAgentConfigs } = await import("../plugin/config.js");
    const configDir = getConfigDir();
    const template = buildDefaultOpenCodeJson(configDir, buildAgentConfigs());
    await writeFile(configPath, JSON.stringify(template, null, 2) + "\n", "utf-8");
    console.warn(`⚠️  opencode.json had invalid JSON — backup saved to ${backupPath}`);
    console.warn(`   Fix your config or copy settings from the backup.`);
    return template as Record<string, any>;
  }
}

/**
 * Save OpenCode's opencode.json config (preserving existing keys).
 */
export async function saveOpenCodeConfig(config: Record<string, any>): Promise<void> {
  const configPath = getOpenCodeConfigPath();
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

// ─── LSP Config Mapping ─────────────────────────────────────

/**
 * OpenCode LSP format:
 * {
 *   "lsp": {
 *     "server-name": {
 *       "command": ["cmd", "--args"],
 *       "extensions": [".ts", ".js"]
 *     }
 *   }
 * }
 */

interface LspServerDef {
  command: string[];
  extensions: string[];
}

/**
 * Convert our lsp.json format to OpenCode's opencode.json lsp format.
 * Only includes servers whose command is found in PATH.
 */
export function buildOpenCodeLspConfig(
  lspJson: { lsp: Record<string, { server: string; command: string; args: string[]; filetypes: string[] }> },
  installedCommands: string[]
): Record<string, LspServerDef> {
  const result: Record<string, LspServerDef> = {};

  for (const [name, entry] of Object.entries(lspJson.lsp)) {
    // Only include if the command is installed
    if (!installedCommands.includes(entry.command)) continue;

    // Build extensions list from filetypes
    const extensions: string[] = [];
    for (const ft of entry.filetypes) {
      const exts = FILETYPE_EXTENSIONS[ft];
      if (exts) {
        for (const ext of exts) {
          if (!extensions.includes(ext)) extensions.push(ext);
        }
      }
    }

    // Skip servers with no recognized extensions
    if (extensions.length === 0) continue;

    // Build command array
    const command = [entry.command, ...entry.args];

    result[name] = { command, extensions };
  }

  return result;
}

/**
 * Merge LSP servers into OpenCode's opencode.json.
 * Only adds new servers — does not overwrite existing ones.
 * Returns the list of servers that were added.
 */
export async function mergeLspToOpenCodeConfig(
  lspServers: Record<string, LspServerDef>
): Promise<{ added: string[]; skipped: string[] }> {
  const config = await loadOpenCodeConfig();

  if (!config.lsp) {
    config.lsp = {};
  }
  if (typeof config.lsp !== "object" || Array.isArray(config.lsp)) {
    throw new Error("Invalid OpenCode config: lsp must be an object");
  }

  const added: string[] = [];
  const skipped: string[] = [];

  for (const [name, def] of Object.entries(lspServers)) {
    if (config.lsp[name]) {
      skipped.push(name);
    } else {
      config.lsp[name] = def;
      added.push(name);
    }
  }

  if (added.length > 0) {
    await saveOpenCodeConfig(config);
  }

  return { added, skipped };
}
