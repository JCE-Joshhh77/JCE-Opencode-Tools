import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ensureOpenCodeJsonEntries, ensureTuiJsonEntries } from "../../src/lib/opencode-config-merge.ts";

function tempConfigDir(): string {
  const root = mkdtempSync(join(tmpdir(), "opencode-config-merge-"));
  mkdirSync(root, { recursive: true });
  return root;
}

describe("opencode config merge", () => {
  test("preserves unknown top-level user keys while adding missing JCE entries", () => {
    const configDir = tempConfigDir();
    const configPath = join(configDir, "opencode.json");
    writeFileSync(configPath, JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      customTheme: "tokyo-night",
      providers: { custom: { models: ["foo"] } },
    }, null, 2));

    ensureOpenCodeJsonEntries(configDir);

    const merged = JSON.parse(readFileSync(configPath, "utf8"));
    expect(merged.customTheme).toBe("tokyo-night");
    expect(merged.providers).toEqual({ custom: { models: ["foo"] } });
    expect(Array.isArray(merged.plugin)).toBe(true);
    expect(merged.mcp).toBeTruthy();
  });

  test("refuses to rebuild non-empty malformed opencode.json", () => {
    const configDir = tempConfigDir();
    const configPath = join(configDir, "opencode.json");
    writeFileSync(configPath, "{ invalid json");

    expect(() => ensureOpenCodeJsonEntries(configDir)).toThrow("Refusing to rebuild malformed opencode.json automatically");
    expect(readFileSync(configPath, "utf8")).toBe("{ invalid json");
  });

  test("does not duplicate JCE plugin entries on repeated merge", () => {
    const configDir = tempConfigDir();

    ensureOpenCodeJsonEntries(configDir);
    ensureOpenCodeJsonEntries(configDir);

    const merged = JSON.parse(readFileSync(join(configDir, "opencode.json"), "utf8"));
    const pluginEntries = Array.isArray(merged.plugin) ? merged.plugin : [];
    expect(pluginEntries.length).toBe(new Set(pluginEntries).size);
  });

  test("creates tui.json with Token Savings TUI plugin without duplicating entries", () => {
    const configDir = tempConfigDir();

    ensureTuiJsonEntries(configDir);
    ensureTuiJsonEntries(configDir);

    const merged = JSON.parse(readFileSync(join(configDir, "tui.json"), "utf8"));
    expect(merged.$schema).toBe("https://opencode.ai/tui.json");
    expect(merged.plugin).toContain(`file://${configDir.replace(/\\/g, "/")}/cli/src/plugin/tui.tsx`);
    expect(merged.plugin.length).toBe(new Set(merged.plugin).size);
    expect(merged.plugin_enabled["opencode-jce-token-savings"]).toBe(true);
  });

  test("preserves existing user value for JCE-known sections when already configured", () => {
    const configDir = tempConfigDir();
    const configPath = join(configDir, "opencode.json");
    writeFileSync(configPath, JSON.stringify({
      plugin: ["custom-plugin"],
      mcp: { customServer: { type: "remote", url: "https://example.com", enabled: true } },
      lsp: { custom: { command: ["custom-lsp"], extensions: [".foo"] } },
    }, null, 2));

    ensureOpenCodeJsonEntries(configDir);

    const merged = JSON.parse(readFileSync(configPath, "utf8"));
    expect(merged.plugin).toContain("custom-plugin");
    expect(merged.mcp.customServer).toBeTruthy();
    expect(merged.lsp.custom).toBeTruthy();
  });
});
