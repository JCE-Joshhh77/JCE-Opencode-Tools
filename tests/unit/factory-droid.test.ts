import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
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

      const mcp = JSON.parse(readFileSync(join(pluginRoot, "mcp.json"), "utf8"));
      expect(mcp.mcpServers["context-keeper"].command).toBe("bun");
      expect(mcp.mcpServers["context-keeper"].args[1]).toContain("/cli/src/mcp/context-keeper.ts");
      expect(JSON.stringify(mcp)).not.toContain("${PROJECT_ROOT}");
      expect(readFileSync(join(out, "README.md"), "utf8")).toContain("droid plugin install jce-opencode-tools@factory-jce");
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

      const mcp = JSON.parse(readFileSync(join(factoryHome, "mcp.json"), "utf8"));
      expect(mcp.mcpServers["context-keeper"].command).toBe("bun");
      expect(JSON.stringify(mcp)).not.toContain("${PROJECT_ROOT}");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
