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
import { platform } from "os";
import { commandExistsSync, FILETYPE_EXTENSIONS } from "./utils.js";

// ─── LSP Auto-Detection ──────────────────────────────────────

interface LspEntry {
  command: string[];
  extensions: string[];
}

interface NativeAgentEntry {
  description: string;
  mode: "primary" | "subagent" | "all";
  prompt: string;
}

const AGENT_DESCRIPTIONS: Record<string, string> = {
  "jce-worker": "Autonomous engineering worker and single front door for planning, frontend/backend execution, delegation, review, and verification.",
  oracle: "Architecture and debugging specialist for hard technical decisions and root-cause analysis.",
  "jce-researcher": "Evidence-first technical research analyst for docs, libraries, codebases, GitHub, and web sources.",
  explorer: "Fast codebase navigation agent for mapping files, symbols, references, and implementation details.",
  frontend: "UI/UX and frontend specialist for components, accessibility, responsive design, and visual verification.",
  android: "Native Android specialist for Gradle, Kotlin/Java Android, Compose, adb/logcat, APK/AAB, and release diagnostics.",
};

const AGENT_MODES: Record<string, NativeAgentEntry["mode"]> = {
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

export function buildNativeJceAgents(agentConfigs: Record<string, { systemPrompt: string }>): Record<string, NativeAgentEntry> {
  return Object.fromEntries(Object.entries(agentConfigs).map(([id, config]) => [id, {
    description: AGENT_DESCRIPTIONS[id] ?? id,
    mode: AGENT_MODES[id] ?? "all",
    prompt: config.systemPrompt,
  }])) as Record<string, NativeAgentEntry>;
}

// ─── Template Builder ────────────────────────────────────────

export function buildDefaultMcpConfig(configDir: string): Record<string, unknown> {
  const contextKeeperPath = join(configDir, "cli", "src", "mcp", "context-keeper.ts")
    .replace(/\\/g, "/");

  return {
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
}

/**
 * Build the default opencode.json content.
 * @param configDir - The resolved config directory (e.g., ~/.config/opencode)
 *                    Used to compute the context-keeper path and detect LSP.
 */
export function buildDefaultOpenCodeJson(configDir: string, agentConfigs?: Record<string, { systemPrompt: string }>): Record<string, unknown> {
  // Auto-detect installed LSP servers
  const lsp = detectInstalledLsp(configDir);

  return {
    $schema: "https://opencode.ai/config.json",
    plugin: [
      `file://${configDir.replace(/\\/g, "/")}/cli/src/plugin/index.ts`,
    ],
    agent: agentConfigs ? buildNativeJceAgents(agentConfigs) : {},
    mcp: buildDefaultMcpConfig(configDir),
    lsp,
  };
}

export function buildDefaultTuiJson(configDir: string): Record<string, unknown> {
  return {
    $schema: "https://opencode.ai/tui.json",
    plugin: [
      `file://${configDir.replace(/\\/g, "/")}/cli/src/plugin/tui.tsx`,
    ],
    plugin_enabled: {
      "opencode-jce-token-savings": true,
    },
  };
}
