import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planStaleOpenCodeProcessKills, type ProcessSnapshot } from "../../src/commands/update.ts";

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
});
