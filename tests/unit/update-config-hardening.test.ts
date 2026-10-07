import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ensureOpenCodeJsonEntries } from "../../src/lib/opencode-config-merge.ts";
import { assertSafeUpdateConfigRoot } from "../../src/commands/update.ts";

const roots: string[] = [];

function tempConfigDir(): string {
  const root = mkdtempSync(join(tmpdir(), "update-config-hardening-"));
  roots.push(root);
  mkdirSync(root, { recursive: true });
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("update config hardening", () => {
  test("refuses to rebuild non-empty malformed opencode.json during ensure flow", () => {
    const configDir = tempConfigDir();
    const configPath = join(configDir, "opencode.json");
    writeFileSync(configPath, "{ nope", "utf8");

    expect(() => ensureOpenCodeJsonEntries(configDir, 2)).toThrow("Refusing to rebuild malformed opencode.json automatically");
    expect(readFileSync(configPath, "utf8")).toBe("{ nope");
  });

  test("refuses to overwrite opencode.json through a symlink", () => {
    const root = tempConfigDir();
    const outsideDir = join(root, "outside");
    mkdirSync(outsideDir);
    const outside = join(outsideDir, "opencode.json");
    writeFileSync(outside, JSON.stringify({ secret: true }), "utf8");
    const configDir = join(root, "config");
    symlinkSync(outsideDir, configDir, "junction");

    expect(() => ensureOpenCodeJsonEntries(configDir, 2)).toThrow();
    expect(JSON.parse(readFileSync(outside, "utf8"))).toEqual({ secret: true });
  });

  test("update rejects a symlinked config root before creating backup files", () => {
    const root = tempConfigDir();
    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "opencode.json"), "{}\n");
    const configDir = join(root, "config");
    symlinkSync(outside, configDir, "junction");

    expect(() => assertSafeUpdateConfigRoot(configDir)).toThrow("Refusing symlinked config directory");
    expect(() => readFileSync(join(outside, ".backup-update", "opencode.json"))).toThrow();
  });

  test("update rejects a nested symlink component", () => {
    const root = tempConfigDir();
    const outside = join(root, "outside");
    const linked = join(root, "linked");
    mkdirSync(outside);
    symlinkSync(outside, linked, "junction");

    expect(() => assertSafeUpdateConfigRoot(join(linked, "nested", "opencode"))).toThrow("Refusing symlinked config directory component");
    expect(existsSync(join(outside, "nested"))).toBe(false);
  });

  test("preserves existing custom providers and plugins across repeated ensure flow", () => {
    const configDir = tempConfigDir();
    const configPath = join(configDir, "opencode.json");
    writeFileSync(configPath, JSON.stringify({
      providers: { custom: { models: ["a", "b"] } },
      plugin: ["custom-plugin"],
    }, null, 2), "utf8");

    ensureOpenCodeJsonEntries(configDir, 2);
    ensureOpenCodeJsonEntries(configDir, 2);

    const merged = JSON.parse(readFileSync(configPath, "utf8"));
    expect(merged.providers).toEqual({ custom: { models: ["a", "b"] } });
    expect(merged.plugins).toContain("custom-plugin");
    expect(merged.plugins.length).toBe(new Set(merged.plugins).size);
  });

  test("adds native V2 JCE agent entries without overwriting legacy user agents", () => {
    const configDir = tempConfigDir();
    const configPath = join(configDir, "opencode.json");
    writeFileSync(configPath, JSON.stringify({
      agent: {
        "jce-worker": { mode: "primary", prompt: "custom worker" },
        "custom-review": { mode: "subagent", prompt: "custom review" },
      },
    }, null, 2), "utf8");

    ensureOpenCodeJsonEntries(configDir, 2);

    const merged = JSON.parse(readFileSync(configPath, "utf8"));
    expect(merged.agent["jce-worker"].prompt).toBe("custom worker");
    expect(merged.agent["custom-review"].prompt).toBe("custom review");
    expect(merged.agents["jce-researcher"]).toMatchObject({
      description: expect.any(String),
      mode: "all",
      system: expect.stringContaining("Research Scope"),
    });
    expect(merged.agents.explorer.mode).toBe("all");
    expect(merged.agents.frontend.mode).toBe("all");
    expect(merged.agents.oracle.mode).toBe("all");
    expect(merged.agents["jce-worker"]).toBeUndefined();
  });

  test("refreshes stale context-keeper command path during ensure flow", () => {
    const configDir = tempConfigDir();
    const configPath = join(configDir, "opencode.json");
    writeFileSync(configPath, JSON.stringify({
      mcp: {
        "context-keeper": {
          type: "local",
          command: ["bun", "run", "/old/cli/src/mcp/context-keeper.ts"],
          env: { PROJECT_ROOT: "${PROJECT_ROOT}" },
          enabled: true,
        },
      },
    }, null, 2), "utf8");

    const result = ensureOpenCodeJsonEntries(configDir, 2);
    const merged = JSON.parse(readFileSync(configPath, "utf8"));

    expect(result.changed).toBe(true);
    expect(merged.mcp["context-keeper"].command[2]).toContain(`${configDir.replace(/\\/g, "/")}/cli/src/mcp/context-keeper.ts`);
    expect(merged.mcp.servers["context-keeper"]).toBeUndefined();
  });
});
