import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, cpSync } from "fs";
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
}

const DEFAULT_COMMANDS: Record<string, string> = {
  "jce-review": `---\ndescription: Run JCE evidence-first review on current changes\nargument-hint: [focus]\n---\n\nReview current repository changes with JCE standards. Focus: $ARGUMENTS\n\nReturn findings first, ordered by severity. Include file paths, verification gaps, and next action.`,
  "jce-android": `---\ndescription: Run JCE Android triage and verification planning\nargument-hint: [issue or module]\n---\n\nUse JCE Android protocols for: $ARGUMENTS\n\nIdentify module, failure type, root-cause evidence needed, focused verification command, and safe next fix.`,
  "jce-release-check": `---\ndescription: Check release readiness using JCE release safety rules\nargument-hint: [version]\n---\n\nCheck release readiness for $ARGUMENTS. Verify version sync, tests/typecheck/lint needs, staging safety, changelog truth, and approval boundaries. Do not commit, push, tag, or release without explicit user request.`,
};

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

function writeText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value.endsWith("\n") ? value : `${value}\n`, "utf8");
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

export function exportFactoryDroidPlugin(outputDir: string, options: { sourceConfigDir?: string; cliDir?: string; clean?: boolean } = {}): FactoryDroidExportResult {
  const root = outputDir;
  const pluginName = "jce-opencode-tools";
  const marketplaceName = basename(root);
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

  writeJson(join(pluginDir, "mcp.json"), {
    mcpServers: {
      "context-keeper": {
        command: "bun",
        args: ["run", cliContextKeeper],
        env: { PROJECT_ROOT: "${PROJECT_ROOT}" },
        disabled: false,
      },
      context7: { type: "http", url: "https://mcp.context7.com/mcp", disabled: false },
      memory: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"], disabled: false },
      playwright: { command: "npx", args: ["-y", "@playwright/mcp@latest"], disabled: false },
      "sequential-thinking": { command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"], disabled: false },
    },
  });

  writeText(join(root, "README.md"), `# JCE for Factory Droid\n\nFactory Droid marketplace generated from JCE OpenCode Tools v${VERSION}.\n\n## Contents\n\n- Plugin: \`${pluginName}\`\n- Droids: ${droids.map((d) => `\`${d}\``).join(", ")}\n- Skills copied from JCE skill pack\n- Commands: ${commands.map((c) => `\`/${c}\``).join(", ")}\n- MCP bridge config for shared JCE/context tools\n\n## Local install\n\n\`\`\`bash\ndroid plugin marketplace add ${root}\ndroid plugin install ${pluginName}@${marketplaceName}\n\`\`\`\n`);

  return { outputDir: root, pluginDir, marketplaceName, pluginName, droids, skills, commands };
}
