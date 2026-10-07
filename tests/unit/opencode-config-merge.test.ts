import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { detectOpenCodeMajorVersion, ensureOpenCodeJsonEntries, ensureTuiJsonEntries, parseOpenCodeMajorVersion, stripTrailingCommas, stripBom } from "../../src/lib/opencode-config-merge.ts";
import { readdirSync } from "fs";

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

    ensureOpenCodeJsonEntries(configDir, 2);

    const merged = JSON.parse(readFileSync(configPath, "utf8"));
    expect(merged.customTheme).toBe("tokyo-night");
    expect(merged.providers).toEqual({ custom: { models: ["foo"] } });
    expect(Array.isArray(merged.plugins)).toBe(true);
    expect(merged.mcp.servers).toBeTruthy();
  });

  test("refuses to rebuild non-empty malformed opencode.json", () => {
    const configDir = tempConfigDir();
    const configPath = join(configDir, "opencode.json");
    writeFileSync(configPath, "{ invalid json");

    expect(() => ensureOpenCodeJsonEntries(configDir, 2)).toThrow("Refusing to rebuild malformed opencode.json automatically");
    expect(readFileSync(configPath, "utf8")).toBe("{ invalid json");
  });

  test("does not duplicate JCE plugin entries on repeated merge", () => {
    const configDir = tempConfigDir();

    ensureOpenCodeJsonEntries(configDir, 2);
    ensureOpenCodeJsonEntries(configDir, 2);

    const merged = JSON.parse(readFileSync(join(configDir, "opencode.json"), "utf8"));
    const pluginEntries = Array.isArray(merged.plugins) ? merged.plugins : [];
    expect(pluginEntries.length).toBe(new Set(pluginEntries).size);
  });

  test("creates cli.json with JCE CLI plugin without duplicating entries", () => {
    const configDir = tempConfigDir();

    ensureTuiJsonEntries(configDir, 2);
    ensureTuiJsonEntries(configDir, 2);

    const merged = JSON.parse(readFileSync(join(configDir, "cli.json"), "utf8"));
    expect(merged.$schema).toBe("https://opencode.ai/v2/cli.json");
    expect(merged.plugins).toContain(`file://${configDir.replace(/\\/g, "/")}/cli`);
    expect(merged.plugins.length).toBe(new Set(merged.plugins).size);
  });

  test("preserves existing user value for JCE-known sections when already configured", () => {
    const configDir = tempConfigDir();
    const configPath = join(configDir, "opencode.json");
    writeFileSync(configPath, JSON.stringify({
      plugin: ["custom-plugin"],
      mcp: { customServer: { type: "remote", url: "https://example.com", enabled: true } },
      lsp: { custom: { command: ["custom-lsp"], extensions: [".foo"] } },
    }, null, 2));

    ensureOpenCodeJsonEntries(configDir, 2);

    const merged = JSON.parse(readFileSync(configPath, "utf8"));
    // V1 `plugin` is migrated to V2 `plugins`.
    expect(merged.plugins).toContain("custom-plugin");
    expect(merged.plugin).toBeUndefined();
    // V1 flat MCP servers are migrated to V2 `mcp.servers` with shape conversion.
    expect(merged.mcp.servers.customServer).toBeTruthy();
    expect(merged.mcp.servers.customServer.disabled).toBe(false);
    expect(merged.mcp.servers.customServer.enabled).toBeUndefined();
    expect(merged.lsp.custom).toBeTruthy();
  });

  test("tidies a recoverable trailing comma instead of refusing, preserving all settings", () => {
    const configDir = tempConfigDir();
    const configPath = join(configDir, "opencode.json");
    // Mirrors the real-world failure: a trailing comma inside an array.
    const malformed = [
      "{",
      '  "model": "9router/kr/claude-opus-4.8",',
      '  "provider": {',
      '    "9router": {',
      '      "models": {',
      '        "codebuddy/claude-opus-4.6": {',
      '          "name": "codebuddy/claude-opus-4.6",',
      '          "modalities": { "input": ["text", "image", "pdf",], "output": ["text"] }',
      "        }",
      "      }",
      "    }",
      "  }",
      "}",
      "",
    ].join("\n");
    writeFileSync(configPath, malformed, "utf8");

    const result = ensureOpenCodeJsonEntries(configDir, 2);
    expect(result.tidied).toBe(true);
    expect(result.backupPath).toBeTruthy();

    // The file is now valid JSON and every user setting is intact.
    const merged = JSON.parse(readFileSync(configPath, "utf8"));
    expect(merged.model).toBe("9router/kr/claude-opus-4.8");
    expect(merged.provider["9router"].models["codebuddy/claude-opus-4.6"].name).toBe("codebuddy/claude-opus-4.6");
    expect(merged.provider["9router"].models["codebuddy/claude-opus-4.6"].modalities.input).toEqual(["text", "image", "pdf"]);
    // JCE entries were still merged in.
    expect(Array.isArray(merged.plugins)).toBe(true);

    // Original malformed content was backed up, not lost.
    const backups = readdirSync(configDir).filter((f) => f.startsWith("opencode.json.invalid-"));
    expect(backups.length).toBeGreaterThanOrEqual(1);
  });

  test("stripTrailingCommas removes only structural trailing commas, never inside strings", () => {
    // Trailing commas before } and ] are removed.
    expect(stripTrailingCommas('{"a":[1,2,],}')).toBe('{"a":[1,2]}');
    // A comma that is a legitimate separator is preserved.
    expect(stripTrailingCommas('{"a":1,"b":2}')).toBe('{"a":1,"b":2}');
    // A comma inside a string value must NOT be touched.
    expect(stripTrailingCommas('{"a":"x, y, z",}')).toBe('{"a":"x, y, z"}');
    // Escaped quotes inside strings handled correctly.
    expect(stripTrailingCommas('{"a":"say \\"hi\\",",}')).toBe('{"a":"say \\"hi\\","}');
  });

  test("stripBom removes a leading BOM only when present", () => {
    expect(stripBom("\uFEFF{}")).toBe("{}");
    expect(stripBom("{}")).toBe("{}");
    // A BOM mid-string is not at index 0, so it is left untouched.
    expect(stripBom('{"a":"x\uFEFFy"}')).toBe('{"a":"x\uFEFFy"}');
  });

  test("tidies a BOM-prefixed file (the real-world cause) and reformats it cleanly", () => {
    const configDir = tempConfigDir();
    const configPath = join(configDir, "opencode.json");
    // A valid config preceded by a UTF-8 BOM — exactly what PowerShell editors
    // produce, and what made the user's file fail to parse.
    const valid = JSON.stringify({
      model: "9router/kr/claude-opus-4.8",
      provider: { "9router": { options: { baseURL: "http://127.0.0.1:20128/v1" } } },
    });
    writeFileSync(configPath, "\uFEFF" + valid, "utf8");

    const result = ensureOpenCodeJsonEntries(configDir, 2);
    expect(result.tidied).toBe(true);
    expect(result.backupPath).toBeTruthy();

    // File now parses, settings preserved, and it is pretty-printed (2-space),
    // so a previously cramped/BOM'd file becomes easy to read.
    const text = readFileSync(configPath, "utf8");
    expect(text.charCodeAt(0)).not.toBe(0xfeff); // BOM gone
    expect(text).toContain("\n  "); // reformatted with indentation
    const merged = JSON.parse(text);
    expect(merged.model).toBe("9router/kr/claude-opus-4.8");
    expect(merged.provider["9router"].options.baseURL).toBe("http://127.0.0.1:20128/v1");
    expect(Array.isArray(merged.plugins)).toBe(true);
  });

  test("creates V1 opencode.json and tui.json entries when OpenCode 1 is selected", () => {
    const configDir = tempConfigDir();
    ensureOpenCodeJsonEntries(configDir, 1);
    ensureTuiJsonEntries(configDir, 1);

    const server = JSON.parse(readFileSync(join(configDir, "opencode.json"), "utf8"));
    const tui = JSON.parse(readFileSync(join(configDir, "tui.json"), "utf8"));
    expect(server.plugin).toContain(`file://${configDir.replace(/\\/g, "/")}/cli/src/plugin/index.ts`);
    expect(server.plugins).toBeUndefined();
    expect(tui.$schema).toBe("https://opencode.ai/tui.json");
    expect(tui.plugin).toContain(`file://${configDir.replace(/\\/g, "/")}/cli/src/plugin/tui.tsx`);
    expect(tui.plugin_enabled["opencode-jce-token-savings"]).toBe(true);
    expect(server.agent["jce-worker"].prompt).toBeString();
    expect(server.mcp["context-keeper"].env).toBeTruthy();
  });

  test("creates native V2 agents and MCP servers without duplicating legacy IDs", () => {
    const configDir = tempConfigDir();
    const configPath = join(configDir, "opencode.json");
    writeFileSync(configPath, JSON.stringify({
      agent: { "jce-worker": { prompt: "legacy custom worker" } },
      mcp: { "context-keeper": { type: "local", command: ["custom-context"] } },
    }));

    ensureOpenCodeJsonEntries(configDir, 2);

    const config = JSON.parse(readFileSync(configPath, "utf8"));
    // V1 `agent` is migrated to V2 `agents` with `prompt`→`system`.
    expect(config.agent).toBeUndefined();
    expect(config.agents["jce-worker"].system).toBe("legacy custom worker");
    expect(config.agents["jce-worker"].prompt).toBeUndefined();
    expect(config.agents["jce-researcher"].system).toContain("Research Scope");
    // V1 flat MCP servers are migrated to V2 `mcp.servers`.
    expect(config.mcp.servers["context-keeper"].command).toEqual(["custom-context"]);
    expect(config.mcp["context-keeper"]).toBeUndefined();
    expect(config.mcp.servers.memory).toMatchObject({ disabled: false });
  });

  test("parses V1 and V2 OpenCode version output", () => {
    expect(parseOpenCodeMajorVersion("opencode v1.18.34")).toBe(1);
    expect(parseOpenCodeMajorVersion("opencode v2.0.24")).toBe(2);
    expect(parseOpenCodeMajorVersion("unknown")).toBeNull();
  });

  test("honors explicit OpenCode major override for installer and test isolation", () => {
    const previous = process.env.OPENCODE_JCE_OPENCODE_MAJOR;
    try {
      process.env.OPENCODE_JCE_OPENCODE_MAJOR = "1";
      expect(detectOpenCodeMajorVersion()).toBe(1);
      process.env.OPENCODE_JCE_OPENCODE_MAJOR = "2";
      expect(detectOpenCodeMajorVersion()).toBe(2);
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_JCE_OPENCODE_MAJOR;
      else process.env.OPENCODE_JCE_OPENCODE_MAJOR = previous;
    }
  });

  test("migrates V2 config back to V1 shape when user selects V1", () => {
    const configDir = tempConfigDir();
    const configPath = join(configDir, "opencode.json");
    writeFileSync(configPath, JSON.stringify({
      agents: { "jce-worker": { mode: "primary", system: "V2 worker prompt" } },
      plugins: ["file:///old/cli"],
      mcp: {
        servers: {
          "context-keeper": { type: "local", command: ["bun", "run", "/old/ck.ts"], environment: { PROJECT_ROOT: "{env:PROJECT_ROOT}" }, disabled: false },
          memory: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-memory"], disabled: false },
        },
      },
    }));

    ensureOpenCodeJsonEntries(configDir, 1);

    const config = JSON.parse(readFileSync(configPath, "utf8"));
    // V2 `agents` is migrated back to V1 `agent` with `system`→`prompt`.
    expect(config.agents).toBeUndefined();
    expect(config.agent["jce-worker"].prompt).toBe("V2 worker prompt");
    expect(config.agent["jce-worker"].system).toBeUndefined();
    // V2 `plugins` is migrated back to V1 `plugin`.
    expect(config.plugins).toBeUndefined();
    expect(config.plugin).toBeDefined();
    // V2 `mcp.servers` is flattened back to V1 flat `mcp`.
    expect(config.mcp.servers).toBeUndefined();
    expect(config.mcp["context-keeper"].enabled).toBe(true);
    expect(config.mcp["context-keeper"].env.PROJECT_ROOT).toBe("${PROJECT_ROOT}");
    expect(config.mcp.memory.enabled).toBe(true);
  });

  test("cleans up the other version's TUI config file when switching versions", () => {
    const configDir = tempConfigDir();
    // Start with V1 tui.json
    writeFileSync(join(configDir, "tui.json"), JSON.stringify({
      $schema: "https://opencode.ai/tui.json",
      plugin: ["file:///old/tui.tsx"],
    }));

    ensureTuiJsonEntries(configDir, 2);

    // V1 tui.json should be deleted, V2 cli.json should be created.
    expect(existsSync(join(configDir, "tui.json"))).toBe(false);
    expect(existsSync(join(configDir, "cli.json"))).toBe(true);
    const cli = JSON.parse(readFileSync(join(configDir, "cli.json"), "utf8"));
    expect(cli.$schema).toBe("https://opencode.ai/v2/cli.json");
    expect(cli.plugins).toBeDefined();

    // Now switch back to V1 — cli.json should be deleted, tui.json recreated.
    ensureTuiJsonEntries(configDir, 1);
    expect(existsSync(join(configDir, "cli.json"))).toBe(false);
    expect(existsSync(join(configDir, "tui.json"))).toBe(true);
    const tui = JSON.parse(readFileSync(join(configDir, "tui.json"), "utf8"));
    expect(tui.$schema).toBe("https://opencode.ai/tui.json");
    expect(tui.plugin).toBeDefined();
  });
});
