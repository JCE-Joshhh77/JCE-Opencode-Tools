import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("uninstall confirmation flags", () => {
  test("--yes confirms protected removals instead of selecting --force skip behavior", () => {
    const source = readFileSync(join(process.cwd(), "src", "commands", "uninstall.ts"), "utf8");
    expect(source).toContain("removeLspServers(force, yes, keepLsp)");
    expect(source).toContain("removeOpenCodeCli(force, yes)");
    expect(source).toContain("const confirmed = yes || await askConfirmation");
    expect(source).not.toContain("removeLspServers(force || yes");
    expect(source).not.toContain("removeOpenCodeCli(force || yes");
  });
});
