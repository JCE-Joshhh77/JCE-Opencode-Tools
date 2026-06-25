import { execFileSync } from "child_process";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { exportFactoryDroidPlugin, syncFactoryDroidPersonalConfig } from "../../src/lib/factory-droid.ts";
import { VERSION } from "../../src/lib/constants.ts";

function fixture(): string {
  return mkdtempSync(join(tmpdir(), "opencode-jce-factory-"));
}

describe("Factory Droid export", () => {
  test("writes Factory plugin manifest, droids, skills, commands, and MCP config", () => {
    const root = fixture();
    try {
      const out = join(root, "factory-jce");
      const result = exportFactoryDroidPlugin(out, { sourceConfigDir: join(process.cwd(), "config"), cliDir: join(root, "cli") });

      expect(result.marketplaceName).toBe("factory-jce");
      expect(result.pluginName).toBe("jce-opencode-tools");
      expect(result.droids).toEqual(["jce-worker", "oracle", "jce-researcher", "explorer", "frontend", "android"]);
      expect(result.skills).toBeGreaterThan(20);
      expect(result.commands).toContain("jce-review");
      expect(result.commands).toContain("jce-models");
      expect(result.commands).toContain("jce-agent-model");
      expect(result.hooks).toEqual(["PreCompact", "SessionEnd", "SessionStart"]);

      const marketplace = JSON.parse(readFileSync(join(out, ".factory-plugin", "marketplace.json"), "utf8"));
      expect(marketplace.name).toBe("factory-jce");
      expect(marketplace.plugins[0].source).toBe("./jce-opencode-tools");

      const pluginRoot = join(out, "jce-opencode-tools");
      const manifest = JSON.parse(readFileSync(join(pluginRoot, ".factory-plugin", "plugin.json"), "utf8"));
      expect(manifest.name).toBe("jce-opencode-tools");
      expect(manifest.version).toBe(VERSION);

      const worker = readFileSync(join(pluginRoot, "droids", "jce-worker.md"), "utf8");
      expect(worker).toContain("name: jce-worker");
      expect(worker).toContain("model: inherit");
      expect(worker).toContain('"Edit"');
      expect(worker).toContain('"Execute"');
      expect(worker).toContain("JCE-Worker");
      const explorer = readFileSync(join(pluginRoot, "droids", "explorer.md"), "utf8");
      expect(explorer).toContain('["Read","LS","Grep","Glob"]');

      expect(existsSync(join(pluginRoot, "skills", "typescript", "SKILL.md"))).toBe(true);
      expect(readFileSync(join(pluginRoot, "commands", "jce-android.md"), "utf8")).toContain("$ARGUMENTS");
      expect(readFileSync(join(pluginRoot, "commands", "jce-models"), "utf8")).toContain("JCE Droid Agent Models");
      expect(readFileSync(join(pluginRoot, "commands", "jce-agent-model"), "utf8")).toContain("setModel(agent, model)");

      const hooks = JSON.parse(readFileSync(join(pluginRoot, "hooks", "hooks.json"), "utf8"));
      expect(hooks.hooks.PreCompact[0].matcher).toBe("manual|auto");
      expect(hooks.hooks.PreCompact[0].hooks[0].command).toContain("${DROID_PLUGIN_ROOT}/scripts/jce-context-hook.js");
      expect(hooks.hooks.SessionEnd[0].hooks[0].type).toBe("command");
      expect(hooks.hooks.SessionStart[0].hooks[0].type).toBe("command");
      expect(readFileSync(join(pluginRoot, "scripts", "jce-context-hook.js"), "utf8")).toContain("Droid ");

      const mcp = JSON.parse(readFileSync(join(pluginRoot, "mcp.json"), "utf8"));
      expect(mcp.mcpServers["context-keeper"].command).toBe("bun");
      expect(mcp.mcpServers["context-keeper"].args[1]).toContain("/cli/src/mcp/context-keeper.ts");
      expect(JSON.stringify(mcp)).not.toContain("${PROJECT_ROOT}");
      const readme = readFileSync(join(out, "README.md"), "utf8");
      expect(readme).toContain(`droid plugin marketplace add "${out}"`);
      expect(readme).toContain("droid plugin install jce-opencode-tools@factory-jce");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("syncs personal Factory config for AGENTS.md, droids, skills, and MCP", () => {
    const root = fixture();
    try {
      const out = join(root, "factory-jce");
      const factoryHome = join(root, ".factory");
      const result = exportFactoryDroidPlugin(out, { sourceConfigDir: join(process.cwd(), "config"), cliDir: join(root, "cli") });
      const synced = syncFactoryDroidPersonalConfig(factoryHome, { sourceConfigDir: join(process.cwd(), "config"), cliDir: join(root, "cli"), pluginDir: result.pluginDir });

      expect(existsSync(join(factoryHome, "AGENTS.md"))).toBe(true);
      expect(existsSync(join(factoryHome, "droids", "jce-worker.md"))).toBe(true);
      expect(existsSync(join(factoryHome, "skills", "typescript", "SKILL.md"))).toBe(true);
      expect(synced.droids).toBe(6);
      expect(synced.skills).toBeGreaterThan(20);
      expect(synced.mcpServers).toContain("context-keeper");
      expect(synced.backups).toEqual([]);
      expect(synced.warnings).toContain("Droid droids use `model: inherit`; verify Factory model/provider settings if requests fail.");

      const mcp = JSON.parse(readFileSync(join(factoryHome, "mcp.json"), "utf8"));
      expect(mcp.mcpServers["context-keeper"].command).toBe("bun");
      expect(JSON.stringify(mcp)).not.toContain("${PROJECT_ROOT}");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("quotes install path and sanitizes marketplace name", () => {
    const root = fixture();
    try {
      const out = join(root, "factory jce audit");
      const result = exportFactoryDroidPlugin(out, { sourceConfigDir: join(process.cwd(), "config"), cliDir: join(root, "cli") });
      expect(result.marketplaceName).toBe("factory-jce-audit");
      const readme = readFileSync(join(out, "README.md"), "utf8");
      expect(readme).toContain(`droid plugin marketplace add "${out}"`);
      expect(readme).toContain("droid plugin install jce-opencode-tools@factory-jce-audit");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("Droid model commands list and set per-agent models", () => {
    const root = fixture();
    try {
      const out = join(root, "factory-jce");
      const factoryHome = join(root, ".factory");
      const result = exportFactoryDroidPlugin(out, { sourceConfigDir: join(process.cwd(), "config"), cliDir: join(root, "cli") });
      syncFactoryDroidPersonalConfig(factoryHome, { sourceConfigDir: join(process.cwd(), "config"), cliDir: join(root, "cli"), pluginDir: result.pluginDir });
      writeFileSync(join(factoryHome, "settings.json"), JSON.stringify({ customModels: [{ model: "9r/cx/gpt-5.5", displayName: "GPT 5.5" }] }), "utf8");

      const env = { ...process.env, FACTORY_HOME: factoryHome };
      const listBefore = execFileSync(process.execPath, [join(result.pluginDir, "commands", "jce-models")], { encoding: "utf8", env });
      expect(listBefore).toContain("jce-worker -> inherit");
      expect(listBefore).toContain("9r/cx/gpt-5.5 (GPT 5.5)");

      const setOutput = execFileSync(process.execPath, [join(result.pluginDir, "commands", "jce-agent-model"), "jce-worker", "9r/cx/gpt-5.5"], { encoding: "utf8", env });
      expect(setOutput).toContain("jce-worker model set to custom:9r/cx/gpt-5.5");
      expect(readFileSync(join(factoryHome, "droids", "jce-worker.md"), "utf8")).toContain("model: custom:9r/cx/gpt-5.5");

      syncFactoryDroidPersonalConfig(factoryHome, { sourceConfigDir: join(process.cwd(), "config"), cliDir: join(root, "cli"), pluginDir: result.pluginDir });
      expect(readFileSync(join(factoryHome, "droids", "jce-worker.md"), "utf8")).toContain("model: custom:9r/cx/gpt-5.5");

      execFileSync(process.execPath, [join(result.pluginDir, "commands", "jce-agent-model"), "jce-worker", "default"], { encoding: "utf8", env });
      expect(readFileSync(join(factoryHome, "droids", "jce-worker.md"), "utf8")).toContain("model: inherit");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("Droid context hook checkpoints project context", () => {
    const root = fixture();
    try {
      const out = join(root, "factory-jce");
      const project = join(root, "project");
      mkdirSync(project, { recursive: true });
      const result = exportFactoryDroidPlugin(out, { sourceConfigDir: join(process.cwd(), "config"), cliDir: join(root, "cli") });
      const hookScript = join(result.pluginDir, "scripts", "jce-context-hook.js");

      execFileSync(process.execPath, [hookScript], {
        input: JSON.stringify({ cwd: project, hook_event_name: "PreCompact", trigger: "auto" }),
        encoding: "utf8",
      });

      const context = readFileSync(join(project, ".opencode-context.md"), "utf8");
      expect(context).toContain("Droid PreCompact (auto) checkpoint");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("backs up existing personal Factory files before overwriting", () => {
    const root = fixture();
    try {
      const out = join(root, "factory-jce");
      const factoryHome = join(root, ".factory");
      mkdirSync(join(factoryHome, "droids"), { recursive: true });
      mkdirSync(join(factoryHome, "skills"), { recursive: true });
      writeFileSync(join(factoryHome, "AGENTS.md"), "custom agents\n", "utf8");
      writeFileSync(join(factoryHome, "droids", "custom.md"), "custom droid\n", "utf8");
      writeFileSync(join(factoryHome, "skills", "custom.md"), "custom skill\n", "utf8");

      const result = exportFactoryDroidPlugin(out, { sourceConfigDir: join(process.cwd(), "config"), cliDir: join(root, "cli") });
      const synced = syncFactoryDroidPersonalConfig(factoryHome, { sourceConfigDir: join(process.cwd(), "config"), cliDir: join(root, "cli"), pluginDir: result.pluginDir });

      expect(synced.backups).toHaveLength(3);
      expect(synced.backups.some((backup) => backup.includes("AGENTS.md.jce-backup"))).toBe(true);
      expect(synced.backups.some((backup) => backup.includes("droids.jce-backup"))).toBe(true);
      expect(synced.backups.some((backup) => backup.includes("skills.jce-backup"))).toBe(true);
      for (const backup of synced.backups) expect(existsSync(backup)).toBe(true);
      expect(readFileSync(synced.backups.find((backup) => backup.includes("AGENTS.md.jce-backup"))!, "utf8")).toBe("custom agents\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
