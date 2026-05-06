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
  test("backs up malformed opencode.json and rebuilds during ensure flow", () => {
    const configDir = tempConfigDir();
    const configPath = join(configDir, "opencode.json");
    writeFileSync(configPath, "{ nope", "utf8");

    const result = ensureOpenCodeJsonEntries(configDir);
    const rebuilt = JSON.parse(readFileSync(configPath, "utf8"));

    expect(result.repaired).toBe(true);
    expect(result.backupPath).toContain("opencode.json.invalid-");
    expect(rebuilt.mcp).toBeTruthy();
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
});
