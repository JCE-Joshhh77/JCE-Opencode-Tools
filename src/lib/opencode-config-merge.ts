import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync, readdirSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { execFileSync } from "child_process";
import { buildDefaultMcpConfig, buildDefaultOpenCodeJson, buildDefaultTuiJson, type OpenCodeMajorVersion } from "./opencode-json-template.js";
import { buildAgentConfigs } from "../plugin/config.js";
import { cleanupLegacyMcpEntries } from "./version.js";

export interface EnsureOpenCodeJsonResult {
  changed: boolean;
  repaired: boolean;
  backupPath?: string;
  /** True when the file was recovered by tidying recoverable syntax (e.g. trailing commas) — all settings preserved. */
  tidied?: boolean;
}

export interface EnsureTuiJsonResult {
  changed: boolean;
  repaired: boolean;
  backupPath?: string;
  tidied?: boolean;
}

export interface ReadOpenCodeJsonResult {
  config: Record<string, unknown>;
  repaired: boolean;
  backupPath?: string;
  tidied?: boolean;
}

export function parseOpenCodeMajorVersion(output: string): OpenCodeMajorVersion | null {
  const match = output.match(/(?:^|\s|v)(\d+)(?:\.|\s|$)/i);
  if (!match) return null;
  const major = Number(match[1]);
  if (!Number.isInteger(major) || major < 1) return null;
  return major >= 2 ? 2 : 1;
}

let detectedOpenCodeMajorVersion: OpenCodeMajorVersion | undefined;

export function detectOpenCodeMajorVersion(configDir?: string): OpenCodeMajorVersion {
  const override = process.env.OPENCODE_JCE_OPENCODE_MAJOR;
  if (override === "1" || override === "2") return Number(override) as OpenCodeMajorVersion;

  if (detectedOpenCodeMajorVersion) return detectedOpenCodeMajorVersion;
  try {
    const output = execFileSync("opencode", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 });
    const detected = parseOpenCodeMajorVersion(output);
    if (detected) return detectedOpenCodeMajorVersion = detected;
  } catch {
    // Infer from existing files when OpenCode is not currently on PATH.
  }
  if (configDir) {
    if (existsSync(join(configDir, "cli.json"))) return 2;
    if (existsSync(join(configDir, "tui.json"))) return 1;
    try {
      const config = JSON.parse(readFileSync(join(configDir, "opencode.json"), "utf8"));
      if (Array.isArray(config?.plugins)) return 2;
      if (Array.isArray(config?.plugin)) return 1;
    } catch {}
  }
  return detectedOpenCodeMajorVersion = 2;
}

function tuiConfigName(majorVersion: OpenCodeMajorVersion): "tui.json" | "cli.json" {
  return majorVersion === 1 ? "tui.json" : "cli.json";
}

/**
 * Remove trailing commas (a comma immediately followed by `}` or `]`, modulo
 * whitespace) from a JSON document, WITHOUT touching anything inside strings.
 *
 * This is lossless: trailing commas carry no data, so a successful
 * `JSON.parse` of the tidied text yields the exact same settings the user
 * intended. It is the single most common reason an otherwise-valid
 * opencode.json fails strict parsing.
 */
export function stripTrailingCommas(raw: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw[j]!)) j++;
      if (j < raw.length && (raw[j] === "}" || raw[j] === "]")) {
        continue; // drop trailing comma
      }
    }
    out += ch;
  }
  return out;
}

/**
 * Strip a leading UTF-8/UTF-16 Byte Order Mark (\uFEFF) if present.
 *
 * A BOM is the single most common reason an otherwise-valid opencode.json fails
 * to parse: editors (notably PowerShell's `Out-File`/`Set-Content` and some
 * Windows tools) prepend it, and `JSON.parse` rejects it with
 * "Unrecognized token '\uFEFF'". The BOM carries no data, so removing it is
 * fully lossless.
 */
export function stripBom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

/**
 * Attempt to recover a malformed JSON object by tidying recoverable syntax.
 * Returns the parsed object on success, or null when the document is still
 * unparseable (genuinely malformed — caller should refuse rather than guess).
 *
 * Recoverable issues handled (all lossless — they carry no data):
 *   1. Leading BOM (\uFEFF) — common from Windows/PowerShell editors.
 *   2. Structural trailing commas before } or ].
 */
function tryTidyParse(raw: string): Record<string, unknown> | null {
  try {
    const tidied = stripTrailingCommas(stripBom(raw));
    const parsed = JSON.parse(tidied);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // still malformed
  }
  return null;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  const root = realpathSync(dirname(filePath));
  const target = resolve(filePath);
  const rel = relative(root, target);
  if (rel.startsWith("..") || rel === "" || existsSync(target) && lstatSync(target).isSymbolicLink()) {
    throw new Error(`Refusing unsafe config write outside config root or through symlink: ${filePath}`);
  }
  // Unique temp name (pid + timestamp + random) so concurrent writers never
  // collide on a shared `.tmp` file and clobber each other's rename.
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
    renameSync(tmp, filePath);
  } catch (error) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // Best-effort cleanup
    }
    throw error;
  }
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
  if (lstatSync(configDir).isSymbolicLink()) throw new Error(`Refusing unsafe config write through symlinked config root: ${configDir}`);
  writeJsonAtomic(configPath, data);
}

export function writeTuiJsonAtomic(configDir: string, data: unknown, majorVersion: OpenCodeMajorVersion = detectOpenCodeMajorVersion(configDir)): void {
  const configPath = join(configDir, tuiConfigName(majorVersion));
  mkdirSync(configDir, { recursive: true });
  if (lstatSync(configDir).isSymbolicLink()) throw new Error(`Refusing unsafe config write through symlinked config root: ${configDir}`);
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

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function readOrRepairOpenCodeJson(configDir: string): ReadOpenCodeJsonResult {
  const configPath = join(configDir, "opencode.json");
  mkdirSync(configDir, { recursive: true });
  if (lstatSync(configDir).isSymbolicLink() || existsSync(configPath) && lstatSync(configPath).isSymbolicLink()) {
    throw new Error(`Refusing unsafe opencode.json access through symlink: ${configPath}`);
  }

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
    // Before refusing: attempt a LOSSLESS tidy (e.g. strip trailing commas).
    // Trailing commas carry no data, so a successful tidy-parse preserves every
    // user setting exactly. Back up the original, then return the recovered
    // config so the merge can proceed and rewrite a clean, formatted file.
    const tidied = tryTidyParse(raw);
    if (tidied) {
      const backupPath = `${configPath}.invalid-${timestamp()}`;
      writeFileSync(backupPath, raw, "utf8");
      cleanupOldBackups(configDir, "^opencode\\.json\\.invalid-");
      return { config: tidied, repaired: false, tidied: true, backupPath };
    }
    throw new Error(`Refusing to rebuild malformed opencode.json automatically. Fix the file or restore from a backup: ${configPath}`);
  }

  const backupPath = `${configPath}.invalid-${timestamp()}`;
  renameSync(configPath, backupPath);
  cleanupOldBackups(configDir, "^opencode\\.json\\.invalid-");
  return { config: {}, repaired: true, backupPath };
}

export function readOrRepairTuiJson(configDir: string, majorVersion: OpenCodeMajorVersion = detectOpenCodeMajorVersion(configDir)): ReadOpenCodeJsonResult {
  const configName = tuiConfigName(majorVersion);
  const configPath = join(configDir, configName);
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
  cleanupOldBackups(configDir, `^${configName.replace(".", "\\.")}\\.invalid-`);
  return { config: {}, repaired: true, backupPath };
}

export function ensureOpenCodeJsonEntries(
  configDir: string,
  majorVersion: OpenCodeMajorVersion = detectOpenCodeMajorVersion(configDir),
): EnsureOpenCodeJsonResult {
  const defaults = buildDefaultOpenCodeJson(configDir, buildAgentConfigs(), majorVersion) as Record<string, unknown>;
  const configPath = join(configDir, "opencode.json");
  const { config: current, repaired, backupPath, tidied } = readOrRepairOpenCodeJson(configDir);

  const merged: Record<string, unknown> = { ...current };
  if (!("$schema" in merged) && "$schema" in defaults) merged.$schema = defaults.$schema;
  if (majorVersion === 1) {
    merged.plugin = mergeStringArray(merged.plugin, defaults.plugin);
  } else {
    const legacyPlugins = Array.isArray(merged.plugin) ? merged.plugin : [];
    merged.plugins = mergeStringArray(merged.plugins, [...legacyPlugins, ...(defaults.plugins as unknown[] ?? [])]);
  }
  if (majorVersion === 1) {
    merged.agent = mergeRecord(merged.agent, defaults.agent);
    merged.mcp = mergeRecord(merged.mcp, defaults.mcp);
  } else {
    const legacyAgents = objectRecord(merged.agent);
    const defaultAgents = objectRecord(defaults.agents);
    const safeAgentDefaults = Object.fromEntries(Object.entries(defaultAgents).filter(([id]) => !(id in legacyAgents)));
    merged.agents = mergeRecord(merged.agents, safeAgentDefaults);

    const currentMcp = objectRecord(merged.mcp);
    const currentServers = objectRecord(currentMcp.servers);
    const defaultServers = objectRecord(objectRecord(defaults.mcp).servers);
    const safeServerDefaults = Object.fromEntries(Object.entries(defaultServers).filter(([id]) => !(id in currentMcp)));
    merged.mcp = { ...currentMcp, servers: mergeRecord(currentServers, safeServerDefaults) };
  }
  merged.lsp = mergeRecord(merged.lsp, defaults.lsp);
  cleanupLegacyMcpEntries(merged as Record<string, any>);

  const mcp = objectRecord(merged.mcp);
  const defaultMcp = objectRecord(defaults.mcp);
  const usesLegacyContextKeeper = majorVersion === 2 && "context-keeper" in mcp;
  const mcpServers = majorVersion === 1 || usesLegacyContextKeeper ? mcp : objectRecord(mcp.servers);
  const defaultMcpServers = majorVersion === 1 || usesLegacyContextKeeper
    ? buildDefaultMcpConfig(configDir, 1)
    : objectRecord(defaultMcp.servers);
  const defaultContextKeeper = defaultMcpServers["context-keeper"];
  const contextKeeper = mcpServers["context-keeper"];
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

    const managedContextKeeper = Array.isArray(currentCommand) && currentCommand.some((part) =>
      typeof part === "string" && /(?:^|[/\\])src[/\\]mcp[/\\]context-keeper\.ts$/.test(part)
    );
    if (currentContextKeeper && managedContextKeeper && (needsProjectRoot || needsCliPath)) {
      mcpServers["context-keeper"] = defaultContextKeeper;
    }
  }

  const before = JSON.stringify(current);
  const after = JSON.stringify(merged);
  // A tidied file must always be rewritten so the recovered/clean JSON replaces
  // the malformed original on disk.
  if (!existsSync(configPath) || repaired || tidied || before !== after) {
    writeOpenCodeJsonAtomic(configDir, merged);
    return { changed: true, repaired, backupPath, tidied };
  }

  return { changed: false, repaired, backupPath, tidied };
}

export function ensureTuiJsonEntries(
  configDir: string,
  majorVersion: OpenCodeMajorVersion = detectOpenCodeMajorVersion(configDir),
): EnsureTuiJsonResult {
  const defaults = buildDefaultTuiJson(configDir, majorVersion) as Record<string, unknown>;
  const configPath = join(configDir, tuiConfigName(majorVersion));
  const { config: current, repaired, backupPath } = readOrRepairTuiJson(configDir, majorVersion);

  const merged: Record<string, unknown> = { ...current };
  if (!("$schema" in merged) && "$schema" in defaults) merged.$schema = defaults.$schema;
  if (majorVersion === 1) {
    merged.plugin = mergeStringArray(merged.plugin, defaults.plugin);
    merged.plugin_enabled = mergeRecord(merged.plugin_enabled, defaults.plugin_enabled);
  } else {
    merged.plugins = mergeStringArray(merged.plugins, defaults.plugins);
  }

  const before = JSON.stringify(current);
  const after = JSON.stringify(merged);
  if (!existsSync(configPath) || repaired || before !== after) {
    writeTuiJsonAtomic(configDir, merged, majorVersion);
    return { changed: true, repaired, backupPath };
  }

  return { changed: false, repaired, backupPath };
}

/** Convert a plugin manifest MCP entry (V1 shape: env/enabled) to native V2 shape (environment/disabled). */
export function convertPluginMcpEntryToV2(entry: Record<string, unknown>): Record<string, unknown> {
  const { env, enabled, ...server } = entry;
  const result: Record<string, unknown> = { ...server };
  if (env && typeof env === "object" && !Array.isArray(env)) {
    result.environment = Object.fromEntries(
      Object.entries(env as Record<string, unknown>).map(([key, value]) => [
        key,
        typeof value === "string"
          ? value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, "{env:$1}")
          : value,
      ]),
    );
  }
  // Only override `disabled` when converting from V1 `enabled` field.
  // For already-V2 entries (no `enabled` field), preserve the existing `disabled` from `...server`.
  if ("enabled" in entry) {
    result.disabled = enabled === false;
  }
  return result;
}

export function mergePluginMcpIntoOpenCodeJson(configDir: string, pluginMcp: Record<string, unknown>): EnsureOpenCodeJsonResult {
  const base = ensureOpenCodeJsonEntries(configDir);
  const { config, repaired, backupPath } = readOrRepairOpenCodeJson(configDir);
  const majorVersion = detectOpenCodeMajorVersion(configDir);
  const mcp = objectRecord(config.mcp);
  const currentMcp = majorVersion === 1 ? mcp : objectRecord(mcp.servers);
  const legacyMcp = majorVersion === 1 ? {} : mcp;

  // Convert plugin MCP entries to the native shape for the detected version.
  const normalizedPluginMcp = Object.fromEntries(
    Object.entries(pluginMcp).map(([key, entry]) => [
      key,
      majorVersion === 1 || !isRecord(entry)
        ? entry
        : convertPluginMcpEntryToV2(entry as Record<string, unknown>),
    ]),
  );

  const collisions = Object.keys(normalizedPluginMcp).filter((key) => key in currentMcp || key in legacyMcp);
  if (collisions.length > 0) {
    // Instead of throwing, warn and skip colliding keys
    console.warn(`⚠️  MCP key collision(s) detected: ${collisions.join(", ")}`);
    console.warn("   Skipping colliding keys to preserve existing configuration.");
    
    // Filter out colliding keys
    const safePluginMcp = Object.fromEntries(
      Object.entries(normalizedPluginMcp).filter(([key]) => !collisions.includes(key))
    );
    
    if (Object.keys(safePluginMcp).length === 0) {
      console.warn("   No new MCP entries to merge.");
      return { changed: false, repaired: base.repaired || repaired, backupPath: backupPath ?? base.backupPath };
    }

    const next = {
      ...config,
      mcp: majorVersion === 1
        ? { ...currentMcp, ...safePluginMcp }
        : { ...mcp, servers: { ...currentMcp, ...safePluginMcp } },
    };
    writeOpenCodeJsonAtomic(configDir, next);
    return { changed: true, repaired: base.repaired || repaired, backupPath: backupPath ?? base.backupPath };
  }

  const next = {
    ...config,
    mcp: majorVersion === 1
      ? { ...currentMcp, ...normalizedPluginMcp }
      : { ...mcp, servers: { ...currentMcp, ...normalizedPluginMcp } },
  };
  writeOpenCodeJsonAtomic(configDir, next);
  return { changed: true, repaired: base.repaired || repaired, backupPath: backupPath ?? base.backupPath };
}
