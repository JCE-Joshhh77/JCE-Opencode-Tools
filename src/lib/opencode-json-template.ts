/**
 * Default opencode.json template for fresh installs.
 * Contains all MCP servers and plugin config that should be active out-of-the-box.
 *
 * Format: OpenCode native (NOT Claude Desktop format).
 * - MCP: { "type", "command"/"url", "env", "enabled" }
 * - LSP: auto-detected from installed commands at install time.
 */

import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { commandExistsSync, FILETYPE_EXTENSIONS } from "./utils.js";

// ─── LSP Auto-Detection ──────────────────────────────────────

interface LspEntry {
  command: string[];
  extensions: string[];
}

interface LegacyAgentEntry {
  description: string;
  mode: "primary" | "subagent" | "all";
  prompt: string;
}

interface NativeAgentEntry {
  description: string;
  mode: "primary" | "subagent" | "all";
  system: string;
}

export const AGENT_DESCRIPTIONS: Record<string, string> = {
  "jce-worker": "Autonomous engineering worker and single front door for planning, frontend/backend execution, delegation, review, and verification.",
  oracle: "Architecture and debugging specialist for hard technical decisions and root-cause analysis.",
  "jce-researcher": "Evidence-first technical research analyst for docs, libraries, codebases, GitHub, and web sources.",
  explorer: "Fast codebase navigation agent for mapping files, symbols, references, and implementation details.",
  frontend: "UI/UX and frontend specialist for components, accessibility, responsive design, and visual verification.",
  android: "Native Android specialist for Gradle, Kotlin/Java Android, Compose, adb/logcat, APK/AAB, and release diagnostics.",
};

const AGENT_MODES: Record<string, LegacyAgentEntry["mode"]> = {
  "jce-worker": "primary",
  oracle: "all",
  "jce-researcher": "all",
  explorer: "all",
  frontend: "all",
  android: "all",
};

/**
 * Scan lsp.json and return LSP servers whose commands are found in PATH.
 */
export function detectInstalledLsp(configDir: string): Record<string, LspEntry> {
  const lspFile = join(configDir, "lsp.json");
  if (!existsSync(lspFile)) return {};

  let lspData: { lsp: Record<string, { command: string; args: string[]; filetypes: string[] }> };
  try {
    lspData = JSON.parse(readFileSync(lspFile, "utf8"));
  } catch {
    return {};
  }

  const result: Record<string, LspEntry> = {};

  for (const [name, entry] of Object.entries(lspData.lsp || {})) {
    if (!commandExistsSync(entry.command)) continue;

    const extensions: string[] = [];
    for (const ft of entry.filetypes) {
      const exts = FILETYPE_EXTENSIONS[ft];
      if (exts) {
        for (const ext of exts) {
          if (!extensions.includes(ext)) extensions.push(ext);
        }
      }
    }
    if (extensions.length === 0) continue;

    result[name] = {
      command: [entry.command, ...entry.args],
      extensions,
    };
  }

  return result;
}

export function buildJceAgents(
  agentConfigs: Record<string, { systemPrompt: string }>,
  majorVersion: OpenCodeMajorVersion = 2,
): Record<string, LegacyAgentEntry | NativeAgentEntry> {
  return Object.fromEntries(Object.entries(agentConfigs).map(([id, config]) => [id, {
    description: AGENT_DESCRIPTIONS[id] ?? id,
    mode: AGENT_MODES[id] ?? "all",
    ...(majorVersion === 1 ? { prompt: config.systemPrompt } : { system: config.systemPrompt }),
  }])) as Record<string, LegacyAgentEntry | NativeAgentEntry>;
}

// ─── Template Builder ────────────────────────────────────────

export function buildDefaultMcpConfig(
  configDir: string,
  majorVersion: OpenCodeMajorVersion = 2,
): Record<string, unknown> {
  const contextKeeperPath = join(configDir, "cli", "src", "mcp", "context-keeper.ts")
    .replace(/\\/g, "/");

  const servers = {
    "context-keeper": {
      type: "local",
      command: ["bun", "run", contextKeeperPath],
      env: {
        PROJECT_ROOT: "${PROJECT_ROOT}",
      },
      enabled: true,
    },
    "context7": {
      type: "remote",
      url: "https://mcp.context7.com/mcp",
      enabled: true,
    },
    "github-search": {
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-github"],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}",
      },
      enabled: true,
    },
    "memory": {
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-memory"],
      enabled: true,
    },
    "playwright": {
      type: "local",
      command: ["npx", "-y", "@playwright/mcp@latest"],
      enabled: true,
    },
    "sequential-thinking": {
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
      enabled: true,
    },
  };

  if (majorVersion === 1) return servers;
  return {
    servers: Object.fromEntries(Object.entries(servers).map(([id, value]) => {
      const { env, enabled, ...server } = value as Record<string, any>;
      return [id, {
        ...server,
        ...(env ? {
          environment: Object.fromEntries(Object.entries(env).map(([key, entry]) => [
            key,
            typeof entry === "string"
              ? entry.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, "{env:$1}")
              : entry,
          ])),
        } : {}),
        disabled: !enabled,
      }];
    })),
  };
}

/**
 * Build the default opencode.json content.
 * @param configDir - The resolved config directory (e.g., ~/.config/opencode)
 *                    Used to compute the context-keeper path and detect LSP.
 */
export type OpenCodeMajorVersion = 1 | 2;

export function buildDefaultOpenCodeJson(
  configDir: string,
  agentConfigs?: Record<string, { systemPrompt: string }>,
  majorVersion: OpenCodeMajorVersion = 2,
): Record<string, unknown> {
  // Auto-detect installed LSP servers
  const lsp = detectInstalledLsp(configDir);

  const normalizedConfigDir = configDir.replace(/\\/g, "/");
  return {
    $schema: "https://opencode.ai/config.json",
    ...(majorVersion === 1
      ? { plugin: [`file://${normalizedConfigDir}/cli/src/plugin/index.ts`] }
      : { plugins: [`file://${normalizedConfigDir}/cli`] }),
    ...(majorVersion === 1
      ? { agent: agentConfigs ? buildJceAgents(agentConfigs, 1) : {} }
      : { agents: agentConfigs ? buildJceAgents(agentConfigs, 2) : {} }),
    mcp: buildDefaultMcpConfig(configDir, majorVersion),
    lsp,
  };
}

export function buildDefaultTuiJson(configDir: string, majorVersion: OpenCodeMajorVersion = 2): Record<string, unknown> {
  const normalizedConfigDir = configDir.replace(/\\/g, "/");
  return majorVersion === 1
    ? {
        $schema: "https://opencode.ai/tui.json",
        plugin: [`file://${normalizedConfigDir}/cli/src/plugin/tui.tsx`],
        plugin_enabled: { "opencode-jce-token-savings": true },
      }
    : {
        $schema: "https://opencode.ai/v2/cli.json",
        plugins: [`file://${normalizedConfigDir}/cli`],
      };
}
