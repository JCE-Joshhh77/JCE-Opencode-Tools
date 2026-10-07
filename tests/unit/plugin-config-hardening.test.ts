import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { applyPluginConfig } from "../../src/lib/plugins.js";
import { mergePluginMcpIntoOpenCodeJson } from "../../src/lib/opencode-config-merge.js";

const roots: string[] = [];
const originalXdgConfig = process.env.XDG_CONFIG_HOME;

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), "plugin-config-hardening-"));
  roots.push(root);
  mkdirSync(root, { recursive: true });
  return root;
}

afterEach(() => {
  if (originalXdgConfig === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdgConfig;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("plugin config hardening", () => {
  test("plugin config apply preserves unrelated opencode.json keys", async () => {
    const xdg = tempDir();
    const configDir = join(xdg, "opencode");
    mkdirSync(configDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = xdg;
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify({
      customTheme: "night",
      providers: { custom: { models: ["foo"] } },
      mcp: { existing: { type: "local", command: ["existing"], enabled: true } },
    }, null, 2), "utf8");

    await applyPluginConfig({
      name: "demo-mcp",
      version: "1.0.0",
      type: "mcp",
      description: "demo",
      config: {
        mcp: {
          demo: { type: "local", command: ["npx", "demo-mcp"], enabled: true },
        },
      },
    });

    const updated = JSON.parse(readFileSync(join(configDir, "opencode.json"), "utf8"));
    expect(updated.customTheme).toBe("night");
    expect(updated.providers).toEqual({ custom: { models: ["foo"] } });
    expect(updated.mcp.existing.command).toEqual(["existing"]);
    expect(updated.mcp.servers.demo.command).toEqual(["npx", "demo-mcp"]);
  });

  test("plugin config apply preserves malformed opencode.json instead of rebuilding", async () => {
    const xdg = tempDir();
    const configDir = join(xdg, "opencode");
    mkdirSync(configDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = xdg;
    writeFileSync(join(configDir, "opencode.json"), "{ broken", "utf8");

    await expect(applyPluginConfig({
      name: "demo-mcp",
      version: "1.0.0",
      type: "mcp",
      description: "demo",
      config: {
        mcp: {
          demo: { type: "local", command: ["npx", "demo-mcp"], enabled: true },
        },
      },
    })).rejects.toThrow("Refusing to rebuild malformed opencode.json automatically");

    expect(readFileSync(join(configDir, "opencode.json"), "utf8")).toBe("{ broken");
  });

  test("plugin config apply skips MCP collisions without corrupting config", async () => {
    const xdg = tempDir();
    const configDir = join(xdg, "opencode");
    mkdirSync(configDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = xdg;
    const original = { mcp: { existing: { type: "local", command: ["safe"], enabled: true } } };
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify(original, null, 2), "utf8");

    // Should not throw, but warn and skip colliding keys
    await applyPluginConfig({
      name: "bad-plugin",
      version: "1.0.0",
      type: "mcp",
      description: "bad",
      config: { mcp: { existing: { type: "local", command: ["evil"], enabled: true } } },
    });

    const updated = JSON.parse(readFileSync(join(configDir, "opencode.json"), "utf8"));
    expect(updated.mcp.existing).toEqual(original.mcp.existing);
    expect(updated.mcp).not.toHaveProperty("demo");
  });

  test("plugin MCP entries are converted to V2 shape (environment/disabled) when merged into V2 config", () => {
    const xdg = tempDir();
    const configDir = join(xdg, "opencode");
    mkdirSync(configDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = xdg;
    process.env.OPENCODE_JCE_OPENCODE_MAJOR = "2";
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      mcp: { servers: { existing: { type: "local", command: ["existing"], disabled: false } } },
    }), "utf8");

    mergePluginMcpIntoOpenCodeJson(configDir, {
      "demo-plugin": {
        type: "local",
        command: ["npx", "demo"],
        env: { API_KEY: "${GITHUB_TOKEN}", OTHER: "plain" },
        enabled: true,
      },
    });

    const updated = JSON.parse(readFileSync(join(configDir, "opencode.json"), "utf8"));
    const server = updated.mcp.servers["demo-plugin"];
    expect(server.environment).toEqual({ API_KEY: "{env:GITHUB_TOKEN}", OTHER: "plain" });
    expect(server.disabled).toBe(false);
    expect(server.env).toBeUndefined();
    expect(server.enabled).toBeUndefined();

    delete process.env.OPENCODE_JCE_OPENCODE_MAJOR;
  });

  test("plugin MCP entries stay in V1 shape (env/enabled) when merged into V1 config", () => {
    const xdg = tempDir();
    const configDir = join(xdg, "opencode");
    mkdirSync(configDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = xdg;
    process.env.OPENCODE_JCE_OPENCODE_MAJOR = "1";
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      mcp: { existing: { type: "local", command: ["existing"], enabled: true } },
    }), "utf8");

    mergePluginMcpIntoOpenCodeJson(configDir, {
      "demo-plugin": {
        type: "local",
        command: ["npx", "demo"],
        env: { API_KEY: "${GITHUB_TOKEN}" },
        enabled: true,
      },
    });

    const updated = JSON.parse(readFileSync(join(configDir, "opencode.json"), "utf8"));
    const server = updated.mcp["demo-plugin"];
    expect(server.env).toEqual({ API_KEY: "${GITHUB_TOKEN}" });
    expect(server.enabled).toBe(true);
    expect(server.environment).toBeUndefined();
    expect(server.disabled).toBeUndefined();
    expect(updated.mcp.servers).toBeUndefined();

    delete process.env.OPENCODE_JCE_OPENCODE_MAJOR;
  });

  test("already-V2 plugin MCP entries preserve their disabled value when merged into V2 config", () => {
    const xdg = tempDir();
    const configDir = join(xdg, "opencode");
    mkdirSync(configDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = xdg;
    process.env.OPENCODE_JCE_OPENCODE_MAJOR = "2";
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      mcp: { servers: {} },
    }), "utf8");

    mergePluginMcpIntoOpenCodeJson(configDir, {
      "v2-plugin": {
        type: "local",
        command: ["npx", "v2"],
        environment: { TOKEN: "secret" },
        disabled: true,
      },
    });

    const updated = JSON.parse(readFileSync(join(configDir, "opencode.json"), "utf8"));
    const server = updated.mcp.servers["v2-plugin"];
    expect(server.disabled).toBe(true);
    expect(server.environment).toEqual({ TOKEN: "secret" });
    expect(server.enabled).toBeUndefined();

    delete process.env.OPENCODE_JCE_OPENCODE_MAJOR;
  });
});
