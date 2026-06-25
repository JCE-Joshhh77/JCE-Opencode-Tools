import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { exportFactoryDroidPlugin } from "../../src/lib/factory-droid.ts";
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
      expect(result.droids).toEqual(["jce-worker", "oracle", "jce-researcher", "explorer", "frontend", "android"]);
      expect(result.skills).toBeGreaterThan(20);
      expect(result.commands).toContain("jce-review");

      const manifest = JSON.parse(readFileSync(join(out, ".factory-plugin", "plugin.json"), "utf8"));
      expect(manifest.name).toBe("jce-opencode-tools");
      expect(manifest.version).toBe(VERSION);

      const worker = readFileSync(join(out, "droids", "jce-worker.md"), "utf8");
      expect(worker).toContain("name: jce-worker");
      expect(worker).toContain("model: inherit");
      expect(worker).toContain('"Edit"');
      expect(worker).toContain('"Execute"');
      expect(worker).toContain("JCE-Worker");
      const explorer = readFileSync(join(out, "droids", "explorer.md"), "utf8");
      expect(explorer).toContain('["Read","LS","Grep","Glob"]');

      expect(existsSync(join(out, "skills", "typescript", "SKILL.md"))).toBe(true);
      expect(readFileSync(join(out, "commands", "jce-android.md"), "utf8")).toContain("$ARGUMENTS");

      const mcp = JSON.parse(readFileSync(join(out, "mcp.json"), "utf8"));
      expect(mcp.mcpServers["context-keeper"].command).toBe("bun");
      expect(mcp.mcpServers["context-keeper"].args[1]).toContain("/cli/src/mcp/context-keeper.ts");
      expect(readFileSync(join(out, "README.md"), "utf8")).toContain("droid plugin install jce-opencode-tools@factory-jce");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
