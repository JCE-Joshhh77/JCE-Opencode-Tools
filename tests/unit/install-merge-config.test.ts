import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "fs";
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

  test("merge script rejects nested symlink destination before config mutations", () => {
    const root = tempConfigDir();
    const source = join(root, "source");
    const target = join(root, "target");
    const outside = join(root, "outside");
    mkdirSync(source);
    mkdirSync(target);
    mkdirSync(outside);
    writeFileSync(join(source, "mcp.json"), JSON.stringify({ remote: true }));
    writeFileSync(join(target, "mcp.json"), JSON.stringify({ local: true }));
    symlinkSync(outside, join(target, "skills"), "junction");

    const result = Bun.spawnSync([process.execPath, "run", join(process.cwd(), "scripts", "merge-config.ts"), source, target]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("Refusing symlinked config destination");
    expect(JSON.parse(readFileSync(join(target, "mcp.json"), "utf8"))).toEqual({ local: true });
  });

  test("merge script preflights source-derived nested destinations before config mutations", () => {
    const root = tempConfigDir();
    const source = join(root, "source");
    const target = join(root, "target");
    const outside = join(root, "outside");
    mkdirSync(join(source, "skills", "nested", "child"), { recursive: true });
    mkdirSync(join(target, "skills", "nested"), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(source, "mcp.json"), JSON.stringify({ remote: true }));
    writeFileSync(join(target, "mcp.json"), JSON.stringify({ local: true }));
    symlinkSync(outside, join(target, "skills", "nested", "child"), "junction");

    const result = Bun.spawnSync([process.execPath, "run", join(process.cwd(), "scripts", "merge-config.ts"), source, target]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("Refusing symlinked config destination");
    expect(JSON.parse(readFileSync(join(target, "mcp.json"), "utf8"))).toEqual({ local: true });
  });

  test("merge script rejects symlinked ancestor of nonexistent target before mkdir", () => {
    const root = tempConfigDir();
    const source = join(root, "source");
    const outside = join(root, "outside");
    mkdirSync(source);
    mkdirSync(outside);
    symlinkSync(outside, join(root, "linked"), "junction");
    const target = join(root, "linked", "new-target");

    const result = Bun.spawnSync([process.execPath, "run", join(process.cwd(), "scripts", "merge-config.ts"), source, target]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("Refusing symlinked config destination");
    expect(existsSync(target)).toBe(false);
  });
});
