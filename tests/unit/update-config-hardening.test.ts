import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ensureOpenCodeJsonEntries } from "../../src/lib/opencode-config-merge.ts";

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

    expect(() => ensureOpenCodeJsonEntries(configDir)).toThrow("Refusing to rebuild malformed opencode.json automatically");
    expect(readFileSync(configPath, "utf8")).toBe("{ nope");
  });

  test("preserves existing custom providers and plugins across repeated ensure flow", () => {
    const configDir = tempConfigDir();
    const configPath = join(configDir, "opencode.json");
    writeFileSync(configPath, JSON.stringify({
      providers: { custom: { models: ["a", "b"] } },
      plugin: ["custom-plugin"],
    }, null, 2), "utf8");

    ensureOpenCodeJsonEntries(configDir);
    ensureOpenCodeJsonEntries(configDir);

    const merged = JSON.parse(readFileSync(configPath, "utf8"));
    expect(merged.providers).toEqual({ custom: { models: ["a", "b"] } });
    expect(merged.plugin).toContain("custom-plugin");
    expect(merged.plugin.length).toBe(new Set(merged.plugin).size);
  });

  test("adds native JCE agent entries for OpenCode Desktop without overwriting user agents", () => {
    const configDir = tempConfigDir();
    const configPath = join(configDir, "opencode.json");
    writeFileSync(configPath, JSON.stringify({
      agent: {
        "jce-worker": { mode: "primary", prompt: "custom worker" },
        "custom-review": { mode: "subagent", prompt: "custom review" },
      },
    }, null, 2), "utf8");

    ensureOpenCodeJsonEntries(configDir);

    const merged = JSON.parse(readFileSync(configPath, "utf8"));
    expect(merged.agent["jce-worker"].prompt).toBe("custom worker");
    expect(merged.agent["custom-review"].prompt).toBe("custom review");
    expect(merged.agent["jce-researcher"]).toMatchObject({
      description: expect.any(String),
      mode: "all",
      prompt: expect.stringContaining("Research Scope"),
    });
    expect(merged.agent.explorer.mode).toBe("all");
    expect(merged.agent.frontend.mode).toBe("all");
    expect(merged.agent.oracle.mode).toBe("all");
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

    const result = ensureOpenCodeJsonEntries(configDir);
    const merged = JSON.parse(readFileSync(configPath, "utf8"));

    expect(result.changed).toBe(true);
    expect(merged.mcp["context-keeper"].command[2]).toContain(`${configDir.replace(/\\/g, "/")}/cli/src/mcp/context-keeper.ts`);
  });
});
