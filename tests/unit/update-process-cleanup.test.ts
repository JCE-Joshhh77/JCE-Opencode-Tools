import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertCliPayloadComplete, planStaleOpenCodeProcessKills, resolveCliPayloadManifestForInstalledBase, type ProcessSnapshot } from "../../src/commands/update.ts";

describe("update stale OpenCode process cleanup", () => {
  test("plans stale OpenCode/plugin processes but excludes the current update process", () => {
    const processes: ProcessSnapshot[] = [
      { pid: 100, ppid: 1, command: "opencode" },
      { pid: 101, ppid: 1, command: "bun run /Users/me/.config/opencode/cli/src/plugin/index.ts" },
      { pid: 102, ppid: 1, command: "opencode-jce update" },
      { pid: 103, ppid: 1, command: "bun run /Users/me/.config/opencode/cli/src/index.ts -- update" },
      { pid: 104, ppid: 1, command: "node unrelated.js" },
    ];
    expect(planStaleOpenCodeProcessKills(processes, 999).map((entry) => entry.pid)).toEqual([100, 101]);
  });

  test("installers invoke stale process cleanup after CLI installation", () => {
    const root = process.cwd();
    const sh = readFileSync(join(root, "install.sh"), "utf8");
    const ps = readFileSync(join(root, "install.ps1"), "utf8");
    expect(sh).toContain("terminate_stale_opencode_processes");
    expect(sh).toContain("OPENCODE_JCE_SKIP_PROCESS_CLEANUP");
    expect(ps).toContain("Stop-StaleOpenCodeProcesses");
    expect(ps).toContain("OPENCODE_JCE_SKIP_PROCESS_CLEANUP");
  });

  test("payload manifest resolver supports installed cli base dir", () => {
    const root = mkdtempSync(join(tmpdir(), "update-manifest-"));
    try {
      mkdirSync(join(root, "cli", "config"), { recursive: true });
      const manifest = join(root, "cli", "config", "cli-payload.txt");
      writeFileSync(manifest, "src/index.ts\n", "utf8");
      expect(resolveCliPayloadManifestForInstalledBase(root)).toBe(manifest);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("payload completeness validation reads manifest from staged cli source", () => {
    const root = mkdtempSync(join(tmpdir(), "update-payload-"));
    try {
      mkdirSync(join(root, "config"), { recursive: true });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "config", "cli-payload.txt"), "src/index.ts\n", "utf8");
      writeFileSync(join(root, "src", "index.ts"), "console.log('ok');\n", "utf8");
      expect(() => assertCliPayloadComplete(root)).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
