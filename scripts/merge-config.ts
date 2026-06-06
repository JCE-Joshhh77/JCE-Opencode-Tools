#!/usr/bin/env bun
/**
 * Merges OpenCode JCE config with existing config.
 * Strategy: ADD what's missing, DON'T TOUCH what exists.
 *
 * Usage: bun run scripts/merge-config.ts <source-dir> <target-dir>
 *   source-dir: directory containing new config files (e.g., /tmp/opencode-jce/config)
 *   target-dir: user's config directory (e.g., ~/.config/opencode)
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  cpSync,
  statSync,
  renameSync,
  unlinkSync,
} from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { ensureOpenCodeJsonEntries, ensureTuiJsonEntries } from "../src/lib/opencode-config-merge.js";

/** Write JSON atomically: write to unique .tmp then rename */
function writeJsonAtomic(filePath: string, data: unknown): void {
  const tmpFile = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    writeFileSync(tmpFile, JSON.stringify(data, null, 2) + "\n");
    renameSync(tmpFile, filePath);
  } catch (error) {
    try {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    } catch {
      // Best-effort cleanup
    }
    throw error;
  }
}

const sourceDir = process.argv[2]; // e.g., /tmp/opencode-jce/config
const targetDir = process.argv[3]; // e.g., ~/.config/opencode

if (!sourceDir || !targetDir) {
  console.error("Usage: merge-config.ts <source-dir> <target-dir>");
  console.error("  source-dir: directory containing new config files");
  console.error("  target-dir: user's config directory");
  process.exit(1);
}

if (!existsSync(sourceDir)) {
  console.error(`Source directory does not exist: ${sourceDir}`);
  process.exit(1);
}

// Ensure target directories exist
mkdirSync(targetDir, { recursive: true });
mkdirSync(join(targetDir, "profiles"), { recursive: true });

// --- Merge mcp.json ---
function mergeMcp() {
  const targetFile = join(targetDir, "mcp.json");
  const sourceFile = join(sourceDir, "mcp.json");

  if (!existsSync(sourceFile)) return;

  let sourceData: any;
  try {
    sourceData = JSON.parse(readFileSync(sourceFile, "utf8"));
  } catch {
    throw new Error(`Failed to parse ${sourceFile}: invalid JSON`);
  }

  if (!sourceData || typeof sourceData !== "object") {
    throw new Error(`Invalid data in ${sourceFile}: expected JSON object`);
  }

  if (existsSync(targetFile)) {
    let targetData: any;
    try {
      targetData = JSON.parse(readFileSync(targetFile, "utf8"));
    } catch {
      throw new Error(`Failed to parse ${targetFile}: invalid JSON`);
    }
    if (!targetData || typeof targetData !== "object") {
      throw new Error(`Invalid data in ${targetFile}: expected JSON object`);
    }
    // Only add servers that don't exist in target
    for (const [key, value] of Object.entries(sourceData.mcpServers || {})) {
      if (!targetData.mcpServers?.[key]) {
        if (!targetData.mcpServers) targetData.mcpServers = {};
        targetData.mcpServers[key] = value;
        console.log(`  [+] MCP server added: ${key}`);
      } else {
        console.log(`  [=] MCP server exists, skipped: ${key}`);
      }
    }
    writeJsonAtomic(targetFile, targetData);
  } else {
    // No existing file, just copy
    copyFileSync(sourceFile, targetFile);
    console.log(`  [+] mcp.json created (new)`);
  }
}

// --- Merge agents.json ---
function mergeAgents() {
  const targetFile = join(targetDir, "agents.json");
  const sourceFile = join(sourceDir, "agents.json");

  if (!existsSync(sourceFile)) return;

  let sourceData: any;
  try {
    sourceData = JSON.parse(readFileSync(sourceFile, "utf8"));
  } catch {
    throw new Error(`Failed to parse ${sourceFile}: invalid JSON`);
  }

  if (!sourceData || typeof sourceData !== "object") {
    throw new Error(`Invalid data in ${sourceFile}: expected JSON object`);
  }

  if (existsSync(targetFile)) {
    let targetData: any;
    try {
      targetData = JSON.parse(readFileSync(targetFile, "utf8"));
    } catch {
      throw new Error(`Failed to parse ${targetFile}: invalid JSON`);
    }
    if (!targetData || typeof targetData !== "object") {
      throw new Error(`Invalid data in ${targetFile}: expected JSON object`);
    }
    const existingIds = new Set(
      (targetData.agents || []).map((a: any) => a.id)
    );

    let added = 0;
    for (const agent of sourceData.agents || []) {
      if (!existingIds.has(agent.id)) {
        if (!targetData.agents) targetData.agents = [];
        targetData.agents.push(agent);
        added++;
      }
    }
    console.log(`  [+] Agents: ${added} added, ${existingIds.size} preserved`);
    writeJsonAtomic(targetFile, targetData);
  } else {
    copyFileSync(sourceFile, targetFile);
    console.log(`  [+] agents.json created (new)`);
  }
}

// --- Merge lsp.json ---
function mergeLsp() {
  const targetFile = join(targetDir, "lsp.json");
  const sourceFile = join(sourceDir, "lsp.json");

  if (!existsSync(sourceFile)) return;

  let sourceData: any;
  try {
    sourceData = JSON.parse(readFileSync(sourceFile, "utf8"));
  } catch {
    throw new Error(`Failed to parse ${sourceFile}: invalid JSON`);
  }

  if (!sourceData || typeof sourceData !== "object") {
    throw new Error(`Invalid data in ${sourceFile}: expected JSON object`);
  }

  if (existsSync(targetFile)) {
    let targetData: any;
    try {
      targetData = JSON.parse(readFileSync(targetFile, "utf8"));
    } catch {
      throw new Error(`Failed to parse ${targetFile}: invalid JSON`);
    }
    if (!targetData || typeof targetData !== "object") {
      throw new Error(`Invalid data in ${targetFile}: expected JSON object`);
    }
    for (const [key, value] of Object.entries(sourceData.lsp || {})) {
      if (!targetData.lsp?.[key]) {
        if (!targetData.lsp) targetData.lsp = {};
        (targetData.lsp as Record<string, unknown>)[key] = value;
        console.log(`  [+] LSP added: ${key}`);
      } else {
        console.log(`  [=] LSP exists, skipped: ${key}`);
      }
    }
    writeJsonAtomic(targetFile, targetData);
  } else {
    copyFileSync(sourceFile, targetFile);
    console.log(`  [+] lsp.json created (new)`);
  }
}

// --- Merge profiles (only copy missing) ---
function mergeProfiles() {
  const sourceProfiles = join(sourceDir, "profiles");
  const targetProfiles = join(targetDir, "profiles");

  if (!existsSync(sourceProfiles)) return;

  let added = 0;
  let skipped = 0;
  for (const file of readdirSync(sourceProfiles)) {
    const sourcePath = join(sourceProfiles, file);
    // Skip directories
    if (statSync(sourcePath).isDirectory()) continue;

    const target = join(targetProfiles, file);
    if (!existsSync(target)) {
      copyFileSync(sourcePath, target);
      added++;
    } else {
      skipped++;
    }
  }
  console.log(`  [+] Profiles: ${added} added, ${skipped} already exist`);
}

// --- Merge prompts directory (only copy missing) ---
function mergePrompts() {
  const sourcePrompts = join(sourceDir, "prompts");
  const targetPrompts = join(targetDir, "prompts");

  if (!existsSync(sourcePrompts)) return;

  mkdirSync(targetPrompts, { recursive: true });

  let added = 0;
  let skipped = 0;
  for (const file of readdirSync(sourcePrompts)) {
    const sourcePath = join(sourcePrompts, file);
    // Skip directories
    if (statSync(sourcePath).isDirectory()) continue;

    const target = join(targetPrompts, file);
    if (!existsSync(target)) {
      copyFileSync(sourcePath, target);
      added++;
    } else {
      skipped++;
    }
  }
  console.log(`  [+] Prompts: ${added} added, ${skipped} already exist`);
}

// --- Merge skills directory (only copy missing skill directories) ---
function mergeSkills() {
  const sourceSkills = join(sourceDir, "skills");
  const targetSkills = join(targetDir, "skills");

  if (!existsSync(sourceSkills)) return;

  mkdirSync(targetSkills, { recursive: true });

  let added = 0;
  let skipped = 0;
  for (const entry of readdirSync(sourceSkills)) {
    const sourcePath = join(sourceSkills, entry);
    const targetPath = join(targetSkills, entry);

    if (statSync(sourcePath).isDirectory()) {
      // New structure: skill directories with SKILL.md
      if (!existsSync(targetPath)) {
        cpSync(sourcePath, targetPath, { recursive: true });
        added++;
      } else {
        skipped++;
      }
    } else if (entry.endsWith(".md")) {
      // Legacy structure: flat .md files (backward compat)
      if (!existsSync(targetPath)) {
        copyFileSync(sourcePath, targetPath);
        added++;
      } else {
        skipped++;
      }
    }
  }
  console.log(`  [+] Skills: ${added} added, ${skipped} already exist`);
}

// --- Copy only if not exists (for other files) ---
function copyIfMissing(filename: string) {
  const sourceFile = join(sourceDir, filename);
  const targetFile = join(targetDir, filename);

  if (!existsSync(sourceFile)) return;

  if (!existsSync(targetFile)) {
    copyFileSync(sourceFile, targetFile);
    console.log(`  [+] ${filename} created (new)`);
  } else {
    console.log(`  [=] ${filename} exists, skipped`);
  }
}

// --- Check if a command exists in PATH ---
function commandExists(cmd: string): boolean {
  if (!/^[\w@./+:-]+$/.test(cmd)) return false;

  try {
    const checkCmd = process.platform === "win32" ? "where" : "which";
    execFileSync(checkCmd, [cmd], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// --- Filetype to extensions mapping (subset for LSP) ---
const FILETYPE_EXTENSIONS: Record<string, string[]> = {
  python: [".py", ".pyi"],
  typescript: [".ts", ".tsx"],
  javascript: [".js", ".jsx", ".mjs", ".cjs"],
  typescriptreact: [".tsx"],
  javascriptreact: [".jsx"],
  rust: [".rs"],
  go: [".go"],
  dockerfile: [".dockerfile"],
  sql: [".sql"],
  java: [".java"],
  c: [".c", ".h"],
  cpp: [".cpp", ".cc", ".cxx", ".hpp", ".hh"],
  objc: [".m", ".mm"],
  php: [".php"],
  ruby: [".rb"],
  bash: [".sh", ".bash"],
  sh: [".sh"],
  zsh: [".zsh"],
  yaml: [".yaml", ".yml"],
  yml: [".yaml", ".yml"],
  html: [".html", ".htm"],
  css: [".css"],
  scss: [".scss"],
  less: [".less"],
  kotlin: [".kt", ".kts"],
  dart: [".dart"],
  lua: [".lua"],
  svelte: [".svelte"],
  vue: [".vue"],
  terraform: [".tf", ".tfvars"],
  tf: [".tf"],
  hcl: [".hcl"],
  zig: [".zig"],
  markdown: [".md"],
  toml: [".toml"],
  graphql: [".graphql", ".gql"],
  gql: [".graphql", ".gql"],
  elixir: [".ex", ".exs"],
  eelixir: [".eex", ".heex"],
  scala: [".scala", ".sbt"],
  csharp: [".cs"],
  json: [".json", ".jsonc"],
};

// --- Auto-detect installed LSP servers from lsp.json ---
function detectInstalledLsp(): Record<string, { command: string[]; extensions: string[] }> {
  const lspFile = join(sourceDir, "lsp.json");
  if (!existsSync(lspFile)) return {};

  let lspData: { lsp: Record<string, { command: string; args: string[]; filetypes: string[] }> };
  try {
    lspData = JSON.parse(readFileSync(lspFile, "utf8"));
  } catch {
    return {};
  }

  const result: Record<string, { command: string[]; extensions: string[] }> = {};

  for (const [name, entry] of Object.entries(lspData.lsp || {})) {
    if (!commandExists(entry.command)) continue;

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

// --- Create OpenCode's primary config file if it does not exist ---
function ensureOpenCodeJson() {
  const targetFile = join(targetDir, "opencode.json");
  const existed = existsSync(targetFile);
  const before = existed ? readFileSync(targetFile, "utf8") : null;
  const result = ensureOpenCodeJsonEntries(targetDir);
  const after = readFileSync(targetFile, "utf8");

  if (result.repaired && result.backupPath) {
    console.log(`  [!] opencode.json was invalid; backed up to ${result.backupPath}`);
    console.log(`  [+] opencode.json created (repaired)`);
    return;
  }

  if (!existed) {
    const parsed = JSON.parse(after) as { lsp?: Record<string, unknown> };
    const lspCount = parsed.lsp && typeof parsed.lsp === "object" ? Object.keys(parsed.lsp).length : 0;
    console.log(`  [+] opencode.json created (new) — MCP servers pre-configured, ${lspCount} LSP server(s) auto-detected`);
    return;
  }

  if (before !== after) {
    console.log(`  [+] opencode.json defaults merged`);
  } else {
    console.log(`  [=] opencode.json exists, all defaults present`);
  }
}

function ensureTuiJson() {
  const targetFile = join(targetDir, "tui.json");
  const existed = existsSync(targetFile);
  const before = existed ? readFileSync(targetFile, "utf8") : null;
  const result = ensureTuiJsonEntries(targetDir);
  const after = readFileSync(targetFile, "utf8");

  if (result.repaired && result.backupPath) {
    console.log(`  [!] tui.json was invalid; backed up to ${result.backupPath}`);
    console.log(`  [+] tui.json created (repaired)`);
    return;
  }

  if (!existed) {
    console.log(`  [+] tui.json created (new) — Token Savings TUI plugin registered`);
    return;
  }

  if (before !== after) {
    console.log(`  [+] tui.json defaults merged`);
  } else {
    console.log(`  [=] tui.json exists, all defaults present`);
  }
}

// --- Run all merges ---
console.log("");
console.log("Merging configuration (preserving existing settings)...");
console.log("");

let hasErrors = false;

console.log("MCP Tools:");
try {
  mergeMcp();
} catch (err: any) {
  console.error(`  [ERROR] MCP merge failed: ${err.message}`);
  hasErrors = true;
}
console.log("");

console.log("AI Agents:");
try {
  mergeAgents();
} catch (err: any) {
  console.error(`  [ERROR] Agents merge failed: ${err.message}`);
  hasErrors = true;
}
console.log("");

console.log("LSP Servers:");
try {
  mergeLsp();
} catch (err: any) {
  console.error(`  [ERROR] LSP merge failed: ${err.message}`);
  hasErrors = true;
}
console.log("");

console.log("Model Profiles:");
try {
  mergeProfiles();
} catch (err: any) {
  console.error(`  [ERROR] Profiles merge failed: ${err.message}`);
  hasErrors = true;
}
console.log("");

console.log("Prompt Templates:");
try {
  mergePrompts();
} catch (err: any) {
  console.error(`  [ERROR] Prompts merge failed: ${err.message}`);
  hasErrors = true;
}
console.log("");

console.log("Skills:");
try {
  mergeSkills();
} catch (err: any) {
  console.error(`  [ERROR] Skills merge failed: ${err.message}`);
  hasErrors = true;
}
console.log("");

console.log("Other configs:");
try {
  ensureOpenCodeJson();
  ensureTuiJson();
  copyIfMissing("AGENTS.md");
  copyIfMissing("fallback.json");
} catch (err: any) {
  console.error(`  [ERROR] Copy failed: ${err.message}`);
  hasErrors = true;
}
console.log("");

if (hasErrors) {
  console.log("Done with errors — some merges failed. Check messages above.");
  process.exit(1);
} else {
  console.log("Done — existing config preserved!");
}
