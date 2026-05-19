import { join } from "path";
import { existsSync } from "fs";
import { readFile, writeFile, mkdir, rename } from "fs/promises";
import { randomBytes } from "crypto";
import { getConfigDir } from "./config.js";
import { log } from "./logger.js";

export interface VersionInfo {
  version: string;
  installedAt: string;
  lastUpdated: string;
}

export interface Migration {
  fromVersion: string;
  toVersion: string;
  description: string;
  migrate: () => Promise<void>;
}

type MutableConfig = Record<string, any>;

function isLocalCommand(entry: unknown, command: string[]): boolean {
  return Boolean(
    entry &&
    typeof entry === "object" &&
    Array.isArray((entry as { command?: unknown }).command) &&
    JSON.stringify((entry as { command: string[] }).command) === JSON.stringify(command)
  );
}

export function cleanupLegacyMcpEntries(config: MutableConfig): boolean {
  if (!config.mcp || typeof config.mcp !== "object" || Array.isArray(config.mcp)) return false;

  let changed = false;
  const mcp = config.mcp as Record<string, any>;

  if (isLocalCommand(mcp["web-fetch"], ["npx", "-y", "@modelcontextprotocol/server-fetch"])) {
    delete mcp["web-fetch"];
    changed = true;
  }

  if (isLocalCommand(mcp.filesystem, ["npx", "-y", "@modelcontextprotocol/server-filesystem", "./"])) {
    delete mcp.filesystem;
    changed = true;
  }

  if (isLocalCommand(mcp.postgres, ["npx", "-y", "@modelcontextprotocol/server-postgres"])) {
    const connStr = mcp.postgres.env?.POSTGRES_CONNECTION_STRING;
    if (!connStr || connStr === "${DATABASE_URL}") {
      delete mcp.postgres;
      changed = true;
    }
  }

  return changed;
}

/**
 * Current version of the config schema.
 */
export const CURRENT_CONFIG_VERSION = "3.3.5";

/**
 * Get the path to the version.json file.
 */
export function getVersionFilePath(): string {
  return join(getConfigDir(), "version.json");
}

/**
 * Read the current version info from version.json.
 * Returns null if the file doesn't exist.
 */
export async function getVersionInfo(): Promise<VersionInfo | null> {
  const versionPath = getVersionFilePath();

  if (!existsSync(versionPath)) {
    return null;
  }

  try {
    const content = await readFile(versionPath, "utf-8");
    return JSON.parse(content) as VersionInfo;
  } catch {
    return null;
  }
}

/**
 * Write version info to version.json.
 */
export async function writeVersionInfo(info: VersionInfo): Promise<void> {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }

  const versionPath = getVersionFilePath();
  const tmpPath = `${versionPath}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmpPath, JSON.stringify(info, null, 2), "utf-8");
  await rename(tmpPath, versionPath);
}

/**
 * Initialize version.json if it doesn't exist.
 * Called during install or first run.
 */
export async function initVersionFile(): Promise<VersionInfo> {
  const existing = await getVersionInfo();
  if (existing) {
    return existing;
  }

  const info: VersionInfo = {
    version: "1.0.0",
    installedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };

  await writeVersionInfo(info);
  return info;
}

/**
 * Update the version and lastUpdated timestamp.
 */
export async function updateVersion(newVersion: string): Promise<VersionInfo> {
  const existing = await getVersionInfo();

  const info: VersionInfo = {
    version: newVersion,
    installedAt: existing?.installedAt || new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };

  await writeVersionInfo(info);
  return info;
}

/**
 * Registry of all migrations, ordered by version.
 */
const migrations: Migration[] = [
  {
    fromVersion: "1.4.0",
    toVersion: "1.6.0",
    description: "Register context-keeper MCP server in opencode.json",
    migrate: async () => {
      const configDir = getConfigDir();
      const opencodeJsonPath = join(configDir, "opencode.json");
      const contextKeeperPath = join(configDir, "cli", "src", "mcp", "context-keeper.ts");

      if (!existsSync(opencodeJsonPath)) {
        log("INFO", "migration", "opencode.json not found, skipping context-keeper registration");
        return;
      }

      if (!existsSync(contextKeeperPath)) {
        log("INFO", "migration", "context-keeper.ts not found, skipping registration");
        return;
      }

      const content = await readFile(opencodeJsonPath, "utf-8");
      const config = JSON.parse(content);

      if (!config.mcp) config.mcp = {};
      if (config.mcp["context-keeper"]) {
        log("INFO", "migration", "context-keeper already registered");
        return;
      }

      // Normalize path (forward slashes for cross-platform)
      const normalizedPath = contextKeeperPath.replace(/\\/g, "/");

      config.mcp["context-keeper"] = {
        type: "local",
        command: ["bun", "run", normalizedPath],
        env: { PROJECT_ROOT: "${PROJECT_ROOT}" },
        enabled: true,
      };

      await writeFile(opencodeJsonPath, JSON.stringify(config, null, 2) + "\n");
      log("INFO", "migration", "context-keeper registered in opencode.json");
    },
  },
  {
    fromVersion: "1.9.0",
    toVersion: "1.9.5",
    description: "Remove defunct web-fetch MCP server, disable postgres by default",
    migrate: async () => {
      const configDir = getConfigDir();
      const opencodeJsonPath = join(configDir, "opencode.json");

      if (!existsSync(opencodeJsonPath)) {
        log("INFO", "migration", "opencode.json not found, skipping MCP cleanup");
        return;
      }

      const content = await readFile(opencodeJsonPath, "utf-8");
      const config = JSON.parse(content);

      if (cleanupLegacyMcpEntries(config)) {
        await writeFile(opencodeJsonPath, JSON.stringify(config, null, 2) + "\n");
        log("INFO", "migration", "Removed legacy JCE MCP defaults");
      }
    },
  },
];

/**
 * Compare two semver version strings.
 * Returns -1 if a < b, 0 if a == b, 1 if a > b.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (version: string) => {
    const withoutBuild = version.split("+")[0];
    const [core, prerelease] = withoutBuild.split("-", 2);
    const parts = core.split(".").map((part) => {
      const parsed = Number(part);
      return Number.isFinite(parsed) ? parsed : 0;
    });
    return { parts, prerelease };
  };

  const parsedA = parse(a);
  const parsedB = parse(b);

  for (let i = 0; i < 3; i++) {
    const numA = parsedA.parts[i] || 0;
    const numB = parsedB.parts[i] || 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }

  if (parsedA.prerelease && !parsedB.prerelease) return -1;
  if (!parsedA.prerelease && parsedB.prerelease) return 1;
  if (parsedA.prerelease && parsedB.prerelease) {
    const idsA = parsedA.prerelease.split(".");
    const idsB = parsedB.prerelease.split(".");
    const len = Math.max(idsA.length, idsB.length);

    for (let i = 0; i < len; i++) {
      const idA = idsA[i];
      const idB = idsB[i];
      if (idA === undefined) return -1;
      if (idB === undefined) return 1;
      if (idA === idB) continue;

      const numA = /^[0-9]+$/.test(idA) ? Number(idA) : null;
      const numB = /^[0-9]+$/.test(idB) ? Number(idB) : null;

      if (numA !== null && numB !== null) {
        if (numA < numB) return -1;
        if (numA > numB) return 1;
        continue;
      }
      if (numA !== null) return -1;
      if (numB !== null) return 1;
      const lexical = idA.localeCompare(idB);
      if (lexical !== 0) return lexical < 0 ? -1 : 1;
    }
  }

  return 0;
}

/**
 * Get migrations that need to be run to go from currentVersion to targetVersion.
 */
export function getPendingMigrations(currentVersion: string, targetVersion: string): Migration[] {
  return migrations.filter((m) => {
    // Run migration if user's current version is below the migration's target
    // AND the migration's target is within the update target
    return compareVersions(currentVersion, m.toVersion) < 0 &&
           compareVersions(m.toVersion, targetVersion) <= 0;
  });
}

/**
 * Run all pending migrations from the current version to the target version.
 * Returns the number of migrations run.
 */
export async function runMigrations(targetVersion?: string): Promise<number> {
  const target = targetVersion || CURRENT_CONFIG_VERSION;
  const versionInfo = await getVersionInfo();
  const currentVersion = versionInfo?.version || "1.0.0";

  if (compareVersions(currentVersion, target) >= 0) {
    return 0; // Already up to date
  }

  const pending = getPendingMigrations(currentVersion, target);

  let lastSuccessfulVersion = currentVersion;

  for (const migration of pending) {
    log("INFO", "migration", `Running migration: ${migration.description} (${migration.fromVersion} -> ${migration.toVersion})`);
    try {
      await migration.migrate();
      lastSuccessfulVersion = migration.toVersion;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("ERROR", "migration", `Migration failed (${migration.fromVersion} -> ${migration.toVersion}): ${msg}`);
      // Update version to last successful migration so failed ones retry next time
      if (compareVersions(lastSuccessfulVersion, currentVersion) > 0) {
        await updateVersion(lastSuccessfulVersion);
      }
      throw new Error(`Migration failed: ${migration.description} — ${msg}`);
    }
  }

  // Update version file after all successful migrations
  await updateVersion(target);

  return pending.length;
}
