import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, cpSync } from "fs";
import { basename, dirname, join } from "path";
import { VERSION } from "./constants.js";
import { buildAgentConfigs } from "../plugin/config.js";
import { AGENT_DESCRIPTIONS } from "./opencode-json-template.js";

export interface FactoryDroidExportResult {
  outputDir: string;
  pluginDir: string;
  marketplaceName: string;
  pluginName: string;
  droids: string[];
  skills: number;
  commands: string[];
  hooks: string[];
}

export interface FactoryDroidPersonalConfigResult {
  configDir: string;
  droids: number;
  skills: number;
  mcpServers: string[];
  agentsMd: string;
  backups: string[];
  warnings: string[];
}

const DEFAULT_COMMANDS: Record<string, string> = {
  "jce-review": `---\ndescription: Run JCE evidence-first review on current changes\nargument-hint: [focus]\n---\n\nReview current repository changes with JCE standards. Focus: $ARGUMENTS\n\nReturn findings first, ordered by severity. Include file paths, verification gaps, and next action.`,
  "jce-android": `---\ndescription: Run JCE Android triage and verification planning\nargument-hint: [issue or module]\n---\n\nUse JCE Android protocols for: $ARGUMENTS\n\nIdentify module, failure type, root-cause evidence needed, focused verification command, and safe next fix.`,
  "jce-release-check": `---\ndescription: Check release readiness using JCE release safety rules\nargument-hint: [version]\n---\n\nCheck release readiness for $ARGUMENTS. Verify version sync, tests/typecheck/lint needs, staging safety, changelog truth, and approval boundaries. Do not commit, push, tag, or release without explicit user request.`,
};

const DROID_CONTEXT_HOOK_SCRIPT = [
  "#!/usr/bin/env bun",
  "const fs = require(\"fs\");",
  "const path = require(\"path\");",
  "",
  "function readStdin() {",
  "  return new Promise((resolve) => {",
  "    let data = \"\";",
  "    process.stdin.setEncoding(\"utf8\");",
  "    process.stdin.on(\"data\", (chunk) => data += chunk);",
  "    process.stdin.on(\"end\", () => resolve(data));",
  "  });",
  "}",
  "",
  "function upsertSection(text, section, line) {",
  "  const header = \"## \" + section;",
  "  const entry = \"- \" + line;",
  "  if (!text.includes(header)) return text.trimEnd() + \"\\n\\n\" + header + \"\\n\" + entry + \"\\n\";",
  "  const lines = text.split(/\\r?\\n/);",
  "  const start = lines.findIndex((item) => item.trim() === header);",
  "  let end = lines.length;",
  "  for (let i = start + 1; i < lines.length; i++) {",
  "    if (/^##\\s+/.test(lines[i])) { end = i; break; }",
  "  }",
  "  const body = lines.slice(start + 1, end);",
  "  if (!body.includes(entry)) body.push(entry);",
  "  return [...lines.slice(0, start + 1), ...body.slice(-12), ...lines.slice(end)].join(\"\\n\").replace(/\\n*$/, \"\\n\");",
  "}",
  "",
  "(async () => {",
  "  const raw = await readStdin();",
  "  let input = {};",
  "  try { input = raw ? JSON.parse(raw) : {}; } catch {}",
  "  const cwd = input.cwd || process.env.FACTORY_PROJECT_DIR || process.cwd();",
  "  const contextPath = path.join(cwd, \".opencode-context.md\");",
  "  const event = input.hook_event_name || \"DroidHook\";",
  "  const trigger = input.trigger || input.reason || input.source || \"unknown\";",
  "  const now = new Date().toISOString();",
  "  let text = \"# Project Context\\n\\n## Current Status\\n\";",
  "  if (fs.existsSync(contextPath)) text = fs.readFileSync(contextPath, \"utf8\");",
  "  text = upsertSection(text, \"Current Status\", \"Droid \" + event + \" (\" + trigger + \") checkpoint at \" + now + \".\");",
  "  fs.writeFileSync(contextPath, text, \"utf8\");",
  "  console.log(JSON.stringify({ suppressOutput: true }));",
  "})().catch((err) => {",
  "  console.error(err && err.message ? err.message : String(err));",
  "  process.exit(1);",
  "});",
].join("\n") + "\n";

const DROID_MODEL_LIB = [
  "const fs = require(\"fs\");",
  "const os = require(\"os\");",
  "const path = require(\"path\");",
  "const AGENTS = [\"jce-worker\", \"oracle\", \"jce-researcher\", \"explorer\", \"frontend\", \"android\"];",
  "function factoryHome() { return process.env.FACTORY_HOME || path.join(os.homedir(), \".factory\"); }",
  "function droidPath(agent) { return path.join(factoryHome(), \"droids\", agent + \".md\"); }",
  "function readJson(file) { try { return JSON.parse(fs.readFileSync(file, \"utf8\")); } catch { return {}; } }",
  "function readModel(agent) {",
  "  const file = droidPath(agent);",
  "  if (!fs.existsSync(file)) return \"missing\";",
  "  const match = fs.readFileSync(file, \"utf8\").match(/^model:\\s*(\\S+)\\s*$/m);",
  "  return match ? match[1] : \"inherit\";",
  "}",
  "function customModels() {",
  "  const settings = readJson(path.join(factoryHome(), \"settings.json\"));",
  "  const items = Array.isArray(settings.customModels) ? settings.customModels : [];",
  "  return items.filter((item) => item && typeof item.model === \"string\");",
  "}",
  "function normalizeModel(input) {",
  "  if (!input || input === \"default\" || input === \"inherit\") return \"inherit\";",
  "  if (input.startsWith(\"custom:\")) return input;",
  "  const custom = customModels().find((item) => item.model === input || item.displayName === input);",
  "  return custom ? \"custom:\" + custom.model : input;",
  "}",
  "function setModel(agent, input) {",
  "  if (!AGENTS.includes(agent)) throw new Error(\"Unknown JCE droid: \" + agent + \". Valid: \" + AGENTS.join(\", \"));",
  "  const file = droidPath(agent);",
  "  if (!fs.existsSync(file)) throw new Error(\"Droid file not found: \" + file + \". Run opencode-jce update first.\");",
  "  const model = normalizeModel(input);",
  "  const text = fs.readFileSync(file, \"utf8\");",
  "  const next = /^model:\\s*\\S+\\s*$/m.test(text) ? text.replace(/^model:\\s*\\S+\\s*$/m, \"model: \" + model) : text.replace(/^---\\s*$/m, \"---\\nmodel: \" + model);",
  "  fs.writeFileSync(file, next, \"utf8\");",
  "  return model;",
  "}",
].join("\n") + "\n";

const DROID_MODELS_SCRIPT = "#!/usr/bin/env bun\n" + DROID_MODEL_LIB + [
  "console.log(\"JCE Droid Agent Models\");",
  "for (const agent of AGENTS) console.log(agent + \" -> \" + readModel(agent));",
  "const custom = customModels();",
  "if (custom.length) {",
  "  console.log(\"\\nCustom BYOK models (use as /jce-agent-model <agent> <model>):\");",
  "  for (const item of custom) console.log(item.model + (item.displayName && item.displayName !== item.model ? \" (\" + item.displayName + \")\" : \"\"));",
  "}",
  "console.log(\"\\nSet: /jce-agent-model <agent> <model|default>\");",
].join("\n") + "\n";

const DROID_AGENT_MODEL_SCRIPT = "#!/usr/bin/env bun\n" + DROID_MODEL_LIB + [
  "const [agent, model, ...extra] = process.argv.slice(2);",
  "if (!agent || !model || extra.length) {",
  "  console.error(\"Usage: /jce-agent-model <agent> <model|default>\");",
  "  process.exit(1);",
  "}",
  "try {",
  "  const applied = setModel(agent, model);",
  "  console.log(agent + \" model set to \" + applied + \". Restart Droid or reload /droids if current session does not pick it up.\");",
  "} catch (err) {",
  "  console.error(err && err.message ? err.message : String(err));",
  "  process.exit(1);",
  "}",
].join("\n") + "\n";

const DROID_MODELS_COMMAND = `---
description: Show JCE Droid agent model settings
argument-hint:
---

Run this command and show the output to the user:

\`\`\`powershell
bun "\${DROID_PLUGIN_ROOT}/scripts/jce-models.js"
\`\`\`
`;

const DROID_AGENT_MODEL_COMMAND = `---
description: Set one JCE Droid agent model
argument-hint: <agent> <model|default>
---

Run this command and show the output to the user:

\`\`\`powershell
bun "\${DROID_PLUGIN_ROOT}/scripts/jce-agent-model.js" $ARGUMENTS
\`\`\`
`;

const DROID_TOOLS: Record<string, string[]> = {
  "jce-worker": ["Read", "LS", "Grep", "Glob", "Edit", "Create", "ApplyPatch", "Execute", "WebSearch", "FetchUrl"],
  oracle: ["Read", "LS", "Grep", "Glob", "Execute", "WebSearch", "FetchUrl"],
  "jce-researcher": ["Read", "LS", "Grep", "Glob", "WebSearch", "FetchUrl"],
  explorer: ["Read", "LS", "Grep", "Glob"],
  frontend: ["Read", "LS", "Grep", "Glob", "Edit", "Create", "ApplyPatch", "Execute", "WebSearch", "FetchUrl"],
  android: ["Read", "LS", "Grep", "Glob", "Edit", "Create", "ApplyPatch", "Execute", "WebSearch", "FetchUrl"],
};

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function marketplaceNameFor(path: string): string {
  return basename(path).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "factory-jce";
}

function shellQuote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function backupExisting(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const backup = `${path}.jce-backup.${new Date().toISOString().replace(/[:.]/g, "-")}`;
  renameSync(path, backup);
  return backup;
}

function writeText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

function writeExecutableText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value.endsWith("\n") ? value : `${value}\n`, { encoding: "utf8", mode: 0o755 });
}

function readDroidModels(dir: string): Record<string, string> {
  const models: Record<string, string> = {};
  if (!existsSync(dir)) return models;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const text = readFileSync(join(dir, file), "utf8");
    const name = text.match(/^name:\s*(\S+)\s*$/m)?.[1] ?? file.replace(/\.md$/, "");
    const model = text.match(/^model:\s*(\S+)\s*$/m)?.[1];
    if (model && model !== "inherit") models[name] = model;
  }
  return models;
}

function applyDroidModel(content: string, model: string | undefined): string {
  if (!model) return content;
  return content.replace(/^model:\s*\S+\s*$/m, `model: ${model}`);
}

function applyDroidModels(dir: string, models: Record<string, string>): void {
  for (const [agent, model] of Object.entries(models)) {
    const file = join(dir, `${agent}.md`);
    if (!existsSync(file)) continue;
    writeFileSync(file, applyDroidModel(readFileSync(file, "utf8"), model), "utf8");
  }
}

function copySkills(sourceDir: string, targetDir: string): number {
  if (!existsSync(sourceDir)) return 0;
  mkdirSync(targetDir, { recursive: true });
  let count = 0;
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(sourceDir, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    cpSync(join(sourceDir, entry.name), join(targetDir, entry.name), { recursive: true, force: true });
    count++;
  }
  return count;
}

function defaultCliDir(outputDir: string): string {
  return existsSync(join(process.cwd(), "src", "mcp", "context-keeper.ts"))
    ? process.cwd()
    : join(dirname(outputDir), "cli");
}

function factoryMcpServers(cliContextKeeper: string): Record<string, unknown> {
  return {
    "context-keeper": {
      command: "bun",
      args: ["run", cliContextKeeper],
      disabled: false,
    },
    context7: { type: "http", url: "https://mcp.context7.com/mcp", disabled: false },
    memory: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"], disabled: false },
    playwright: { command: "npx", args: ["-y", "@playwright/mcp@latest"], disabled: false },
    "sequential-thinking": { command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"], disabled: false },
  };
}

export function exportFactoryDroidPlugin(outputDir: string, options: { sourceConfigDir?: string; cliDir?: string; clean?: boolean } = {}): FactoryDroidExportResult {
  const root = outputDir;
  const pluginName = "jce-opencode-tools";
  const marketplaceName = marketplaceNameFor(root);
  const pluginDir = join(root, pluginName);
  const cliContextKeeper = join(options.cliDir ?? defaultCliDir(root), "src", "mcp", "context-keeper.ts").replace(/\\/g, "/");
  if (options.clean && existsSync(root)) rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });

  writeJson(join(root, ".factory-plugin", "marketplace.json"), {
    name: marketplaceName,
    description: "Local JCE plugin marketplace for Factory Droid.",
    owner: { name: "JCE" },
    plugins: [{ name: pluginName, description: "JCE agent pack for Factory Droid.", source: `./${pluginName}` }],
  });

  writeJson(join(pluginDir, ".factory-plugin", "plugin.json"), {
    name: pluginName,
    description: "JCE agent pack for Factory Droid: droids, skills, commands, and MCP tool bridge guidance.",
    version: VERSION,
    author: { name: "JCE" },
    homepage: "https://github.com/JCETools-Petra/JCE-Opencode-Tools",
    repository: "https://github.com/JCETools-Petra/JCE-Opencode-Tools",
  });

  const agents = buildAgentConfigs();
  const droids: string[] = [];
  for (const [id, config] of Object.entries(agents)) {
    const tools = JSON.stringify(DROID_TOOLS[id] ?? ["Read", "LS", "Grep", "Glob"]);
    const content = `---\nname: ${id}\ndescription: ${yamlString(AGENT_DESCRIPTIONS[id] ?? id)}\nmodel: inherit\ntools: ${tools}\n---\n\n${config.systemPrompt}\n`;
    writeText(join(pluginDir, "droids", `${id}.md`), content);
    droids.push(id);
  }

  const sourceConfigDir = options.sourceConfigDir ?? join(process.cwd(), "config");
  const skills = copySkills(join(sourceConfigDir, "skills"), join(pluginDir, "skills"));

  const commands: string[] = [];
  for (const [name, content] of Object.entries(DEFAULT_COMMANDS)) {
    writeText(join(pluginDir, "commands", `${name}.md`), content);
    commands.push(name);
  }
  writeText(join(pluginDir, "commands", "jce-models.md"), DROID_MODELS_COMMAND);
  writeText(join(pluginDir, "commands", "jce-agent-model.md"), DROID_AGENT_MODEL_COMMAND);
  writeExecutableText(join(pluginDir, "scripts", "jce-models.js"), DROID_MODELS_SCRIPT);
  writeExecutableText(join(pluginDir, "scripts", "jce-agent-model.js"), DROID_AGENT_MODEL_SCRIPT);
  commands.push("jce-models", "jce-agent-model");

  const hooks = ["PreCompact", "SessionEnd", "SessionStart"];
  writeText(join(pluginDir, "scripts", "jce-context-hook.js"), DROID_CONTEXT_HOOK_SCRIPT);
  writeJson(join(pluginDir, "hooks", "hooks.json"), {
    description: "JCE context preservation for Droid compact and session lifecycle events.",
    hooks: {
      PreCompact: [{ matcher: "manual|auto", hooks: [{ type: "command", command: "bun \"\${DROID_PLUGIN_ROOT}/scripts/jce-context-hook.js\"", timeout: 15 }] }],
      SessionEnd: [{ hooks: [{ type: "command", command: "bun \"\${DROID_PLUGIN_ROOT}/scripts/jce-context-hook.js\"", timeout: 15 }] }],
      SessionStart: [{ hooks: [{ type: "command", command: "bun \"\${DROID_PLUGIN_ROOT}/scripts/jce-context-hook.js\"", timeout: 15 }] }],
    },
  });

  writeJson(join(pluginDir, "mcp.json"), { mcpServers: factoryMcpServers(cliContextKeeper) });

  writeText(join(root, "README.md"), `# JCE for Factory Droid\n\nFactory Droid marketplace generated from JCE OpenCode Tools v${VERSION}.\n\n## Contents\n\n- Plugin: \`${pluginName}\`\n- Droids: ${droids.map((d) => `\`${d}\``).join(", ")}\n- Skills copied from JCE skill pack\n- Commands: ${commands.map((c) => `\`/${c}\``).join(", ")}\n- Hooks: ${hooks.join(", ")}\n- MCP bridge config for shared JCE/context tools\n\n## Local install\n\n\`\`\`bash\ndroid plugin marketplace add ${shellQuote(root)}\ndroid plugin install ${pluginName}@${marketplaceName}\n\`\`\`\n`);

  return { outputDir: root, pluginDir, marketplaceName, pluginName, droids, skills, commands, hooks };
}

export function syncFactoryDroidPersonalConfig(factoryConfigDir: string, options: { sourceConfigDir?: string; cliDir?: string; pluginDir?: string } = {}): FactoryDroidPersonalConfigResult {
  const sourceConfigDir = options.sourceConfigDir ?? join(process.cwd(), "config");
  const pluginDir = options.pluginDir ?? join(dirname(factoryConfigDir), "factory-jce", "jce-opencode-tools");
  const cliContextKeeper = join(options.cliDir ?? defaultCliDir(factoryConfigDir), "src", "mcp", "context-keeper.ts").replace(/\\/g, "/");
  const backups: string[] = [];
  const warnings = ["Droid droids use `model: inherit`; verify Factory model/provider settings if requests fail."];
  mkdirSync(factoryConfigDir, { recursive: true });

  const agentsSource = join(sourceConfigDir, "AGENTS.md");
  const agentsTarget = join(factoryConfigDir, "AGENTS.md");
  if (existsSync(agentsSource)) {
    const agentsBackup = backupExisting(agentsTarget);
    if (agentsBackup) backups.push(agentsBackup);
    cpSync(agentsSource, agentsTarget, { force: true });
  }

  let droids = 0;
  const pluginDroids = join(pluginDir, "droids");
  if (existsSync(pluginDroids)) {
    const droidsTarget = join(factoryConfigDir, "droids");
    const existingModels = readDroidModels(droidsTarget);
    const droidsBackup = backupExisting(droidsTarget);
    if (droidsBackup) backups.push(droidsBackup);
    cpSync(pluginDroids, droidsTarget, { recursive: true, force: true });
    applyDroidModels(droidsTarget, existingModels);
    droids = readdirSync(pluginDroids).filter((file) => file.endsWith(".md")).length;
  }

  const skillsTarget = join(factoryConfigDir, "skills");
  const pluginSkills = join(pluginDir, "skills");
  let skills = 0;
  if (existsSync(pluginSkills)) {
    const skillsBackup = backupExisting(skillsTarget);
    if (skillsBackup) backups.push(skillsBackup);
    skills = copySkills(pluginSkills, skillsTarget);
  }
  const mcpPath = join(factoryConfigDir, "mcp.json");
  const existing = readJsonObject(mcpPath);
  const existingServers = existing.mcpServers && typeof existing.mcpServers === "object" && !Array.isArray(existing.mcpServers)
    ? existing.mcpServers as Record<string, unknown>
    : {};
  const jceServers = factoryMcpServers(cliContextKeeper);
  writeJson(mcpPath, { ...existing, mcpServers: { ...existingServers, ...jceServers } });

  return { configDir: factoryConfigDir, droids, skills, mcpServers: Object.keys(jceServers), agentsMd: agentsTarget, backups, warnings };
}
