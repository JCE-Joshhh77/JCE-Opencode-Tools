import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ensureOpenCodeJsonEntries } from "../../src/lib/opencode-config-merge.ts";

function tempConfigDir(): string {
  const root = mkdtempSync(join(tmpdir(), "install-merge-config-"));
  mkdirSync(root, { recursive: true });
  return root;
}

describe("install merge config hardening", () => {
  test("shared merge helper preserves non-empty malformed opencode.json for installer path", () => {
    const configDir = tempConfigDir();
    const configPath = join(configDir, "opencode.json");
    writeFileSync(configPath, "{ broken", "utf8");

    expect(() => ensureOpenCodeJsonEntries(configDir)).toThrow("Refusing to rebuild malformed opencode.json automatically");
    expect(readFileSync(configPath, "utf8")).toBe("{ broken");
  });
});
