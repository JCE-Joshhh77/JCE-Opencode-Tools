import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { buildDefaultOpenCodeJson, buildDefaultTuiJson } from "./opencode-json-template.js";
import { buildAgentConfigs } from "../plugin/config.js";
import { cleanupLegacyMcpEntries } from "./version.js";

export interface EnsureOpenCodeJsonResult {
  changed: boolean;
  repaired: boolean;
  backupPath?: string;
}

export interface EnsureTuiJsonResult {
  changed: boolean;
  repaired: boolean;
  backupPath?: string;
}

export interface ReadOpenCodeJsonResult {
  config: Record<string, unknown>;
  repaired: boolean;
  backupPath?: string;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  renameSync(tmp, filePath);
}

/**
 * Clean up old malformed JSON backups, keeping only the latest 3.
 * Deletes older backup files permanently via unlinkSync.
 */
function cleanupOldBackups(configDir: string, patternStr: string): void {
  try {
    const pattern = new RegExp(patternStr);
    const files = readdirSync(configDir)
      .filter((f: string) => pattern.test(f))
      .sort()
      .reverse();

    // Keep latest 3, delete older ones
    for (const file of files.slice(3)) {
      try {
        const fullPath = join(configDir, file);
        if (existsSync(fullPath)) {
          unlinkSync(fullPath);
        }
      } catch {}
    }
  } catch {}
}

export function writeOpenCodeJsonAtomic(configDir: string, data: unknown): void {
  const configPath = join(configDir, "opencode.json");
  mkdirSync(configDir, { recursive: true });
  writeJsonAtomic(configPath, data);
}

export function writeTuiJsonAtomic(configDir: string, data: unknown): void {
  const configPath = join(configDir, "tui.json");
  mkdirSync(configDir, { recursive: true });
  writeJsonAtomic(configPath, data);
}

function mergeStringArray(existing: unknown, defaults: unknown): string[] {
  const base = Array.isArray(existing) ? existing.filter((item): item is string => typeof item === "string") : [];
  const additions = Array.isArray(defaults) ? defaults.filter((item): item is string => typeof item === "string") : [];
  return [...base, ...additions.filter((item) => !base.includes(item))];
}

function mergeRecord(existing: unknown, defaults: unknown): Record<string, unknown> {
  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? existing as Record<string, unknown> : {};
  const additions = defaults && typeof defaults === "object" && !Array.isArray(defaults) ? defaults as Record<string, unknown> : {};
  return { ...base, ...Object.fromEntries(Object.entries(additions).filter(([key]) => !(key in base))) };
}

export function readOrRepairOpenCodeJson(configDir: string): ReadOpenCodeJsonResult {
  const configPath = join(configDir, "opencode.json");
  mkdirSync(configDir, { recursive: true });

  if (!existsSync(configPath)) return { config: {}, repaired: false };

  const raw = readFileSync(configPath, "utf8");
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { config: parsed as Record<string, unknown>, repaired: false };
    }
  } catch {
    // handled below
  }

  if (raw.trim().length > 0) {
    throw new Error(`Refusing to rebuild malformed opencode.json automatically. Fix the file or restore from a backup: ${configPath}`);
  }

  const backupPath = `${configPath}.invalid-${timestamp()}`;
  renameSync(configPath, backupPath);
  cleanupOldBackups(configDir, "^opencode\\.json\\.invalid-");
  return { config: {}, repaired: true, backupPath };
}

export function readOrRepairTuiJson(configDir: string): ReadOpenCodeJsonResult {
  const configPath = join(configDir, "tui.json");
  mkdirSync(configDir, { recursive: true });

  if (!existsSync(configPath)) return { config: {}, repaired: false };

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { config: parsed as Record<string, unknown>, repaired: false };
    }
  } catch {
    // handled below
  }

  const backupPath = `${configPath}.invalid-${timestamp()}`;
  renameSync(configPath, backupPath);
  cleanupOldBackups(configDir, "^tui\\.json\\.invalid-");
  return { config: {}, repaired: true, backupPath };
}

export function ensureOpenCodeJsonEntries(configDir: string): EnsureOpenCodeJsonResult {
  const defaults = buildDefaultOpenCodeJson(configDir, buildAgentConfigs()) as Record<string, unknown>;
  const configPath = join(configDir, "opencode.json");
  const { config: current, repaired, backupPath } = readOrRepairOpenCodeJson(configDir);

  const merged: Record<string, unknown> = { ...current };
  if (!("$schema" in merged) && "$schema" in defaults) merged.$schema = defaults.$schema;
  merged.plugin = mergeStringArray(merged.plugin, defaults.plugin);
  merged.agent = mergeRecord(merged.agent, defaults.agent);
  merged.mcp = mergeRecord(merged.mcp, defaults.mcp);
  merged.lsp = mergeRecord(merged.lsp, defaults.lsp);
  cleanupLegacyMcpEntries(merged as Record<string, any>);

  const mcp = merged.mcp && typeof merged.mcp === "object" && !Array.isArray(merged.mcp)
    ? merged.mcp as Record<string, unknown>
    : {};
  const defaultContextKeeper = defaults.mcp && typeof defaults.mcp === "object" && !Array.isArray(defaults.mcp)
    ? (defaults.mcp as Record<string, unknown>)["context-keeper"]
    : undefined;
  const contextKeeper = mcp["context-keeper"];
  if (defaultContextKeeper && typeof defaultContextKeeper === "object" && !Array.isArray(defaultContextKeeper)) {
    const currentContextKeeper = contextKeeper && typeof contextKeeper === "object" && !Array.isArray(contextKeeper)
      ? contextKeeper as Record<string, unknown>
      : undefined;
    const currentCommand = currentContextKeeper?.command;
    const defaultCommand = (defaultContextKeeper as Record<string, unknown>).command;
    const currentEnv = currentContextKeeper?.env;
    const needsProjectRoot = !currentEnv ||
      typeof currentEnv !== "object" ||
      !("PROJECT_ROOT" in (currentEnv as Record<string, unknown>));
    const needsCliPath = !Array.isArray(currentCommand) ||
      !Array.isArray(defaultCommand) ||
      JSON.stringify(currentCommand) !== JSON.stringify(defaultCommand);

    if (currentContextKeeper && (needsProjectRoot || needsCliPath)) {
      mcp["context-keeper"] = defaultContextKeeper;
    }
  }

  const before = JSON.stringify(current);
  const after = JSON.stringify(merged);
  if (!existsSync(configPath) || repaired || before !== after) {
    writeOpenCodeJsonAtomic(configDir, merged);
    return { changed: true, repaired, backupPath };
  }

  return { changed: false, repaired, backupPath };
}

export function ensureTuiJsonEntries(configDir: string): EnsureTuiJsonResult {
  const defaults = buildDefaultTuiJson(configDir) as Record<string, unknown>;
  const configPath = join(configDir, "tui.json");
  const { config: current, repaired, backupPath } = readOrRepairTuiJson(configDir);

  const merged: Record<string, unknown> = { ...current };
  if (!("$schema" in merged) && "$schema" in defaults) merged.$schema = defaults.$schema;
  merged.plugin = mergeStringArray(merged.plugin, defaults.plugin);
  merged.plugin_enabled = mergeRecord(merged.plugin_enabled, defaults.plugin_enabled);

  const before = JSON.stringify(current);
  const after = JSON.stringify(merged);
  if (!existsSync(configPath) || repaired || before !== after) {
    writeTuiJsonAtomic(configDir, merged);
    return { changed: true, repaired, backupPath };
  }

  return { changed: false, repaired, backupPath };
}

export function mergePluginMcpIntoOpenCodeJson(configDir: string, pluginMcp: Record<string, unknown>): EnsureOpenCodeJsonResult {
  const base = ensureOpenCodeJsonEntries(configDir);
  const { config, repaired, backupPath } = readOrRepairOpenCodeJson(configDir);
  const currentMcp = config.mcp && typeof config.mcp === "object" && !Array.isArray(config.mcp)
    ? config.mcp as Record<string, unknown>
    : {};

  const collisions = Object.keys(pluginMcp).filter((key) => key in currentMcp);
  if (collisions.length > 0) {
    // Instead of throwing, warn and skip colliding keys
    console.warn(`⚠️  MCP key collision(s) detected: ${collisions.join(", ")}`);
    console.warn("   Skipping colliding keys to preserve existing configuration.");
    
    // Filter out colliding keys
    const safePluginMcp = Object.fromEntries(
      Object.entries(pluginMcp).filter(([key]) => !collisions.includes(key))
    );
    
    if (Object.keys(safePluginMcp).length === 0) {
      console.warn("   No new MCP entries to merge.");
      return { changed: false, repaired: base.repaired || repaired, backupPath: backupPath ?? base.backupPath };
    }

    const next = {
      ...config,
      mcp: { ...currentMcp, ...safePluginMcp },
    };
    writeOpenCodeJsonAtomic(configDir, next);
    return { changed: true, repaired: base.repaired || repaired, backupPath: backupPath ?? base.backupPath };
  }

  const next = {
    ...config,
    mcp: { ...currentMcp, ...pluginMcp },
  };
  writeOpenCodeJsonAtomic(configDir, next);
  return { changed: true, repaired: base.repaired || repaired, backupPath: backupPath ?? base.backupPath };
}
