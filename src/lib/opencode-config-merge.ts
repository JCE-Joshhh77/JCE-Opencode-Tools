import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { buildDefaultOpenCodeJson } from "./opencode-json-template.js";
import { cleanupLegacyMcpEntries } from "./version.js";

export interface EnsureOpenCodeJsonResult {
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

export function writeOpenCodeJsonAtomic(configDir: string, data: unknown): void {
  const configPath = join(configDir, "opencode.json");
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
  return { config: {}, repaired: true, backupPath };
}

export function ensureOpenCodeJsonEntries(configDir: string): EnsureOpenCodeJsonResult {
  const defaults = buildDefaultOpenCodeJson(configDir) as Record<string, unknown>;
  const configPath = join(configDir, "opencode.json");
  const { config: current, repaired, backupPath } = readOrRepairOpenCodeJson(configDir);

  const merged: Record<string, unknown> = { ...current };
  if (!("$schema" in merged) && "$schema" in defaults) merged.$schema = defaults.$schema;
  merged.plugin = mergeStringArray(merged.plugin, defaults.plugin);
  merged.mcp = mergeRecord(merged.mcp, defaults.mcp);
  merged.lsp = mergeRecord(merged.lsp, defaults.lsp);
  cleanupLegacyMcpEntries(merged as Record<string, any>);

  const contextKeeper = merged.mcp && typeof merged.mcp === "object" && !Array.isArray(merged.mcp)
    ? (merged.mcp as Record<string, unknown>)["context-keeper"]
    : undefined;
  const defaultContextKeeper = defaults.mcp && typeof defaults.mcp === "object" && !Array.isArray(defaults.mcp)
    ? (defaults.mcp as Record<string, unknown>)["context-keeper"]
    : undefined;
  if (
    contextKeeper &&
    typeof contextKeeper === "object" &&
    !Array.isArray(contextKeeper) &&
    defaultContextKeeper &&
    typeof defaultContextKeeper === "object" &&
    !Array.isArray(defaultContextKeeper) &&
    (!(contextKeeper as Record<string, unknown>).env ||
      typeof (contextKeeper as Record<string, unknown>).env !== "object" ||
      !("PROJECT_ROOT" in ((contextKeeper as Record<string, unknown>).env as Record<string, unknown>)))
  ) {
    (merged.mcp as Record<string, unknown>)["context-keeper"] = defaultContextKeeper;
  }

  const before = JSON.stringify(current);
  const after = JSON.stringify(merged);
  if (!existsSync(configPath) || repaired || before !== after) {
    writeOpenCodeJsonAtomic(configDir, merged);
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
    throw new Error(`MCP key collision: ${collisions.join(", ")}`);
  }

  const next = {
    ...config,
    mcp: { ...currentMcp, ...pluginMcp },
  };
  writeOpenCodeJsonAtomic(configDir, next);
  return { changed: true, repaired: base.repaired || repaired, backupPath: backupPath ?? base.backupPath };
}
