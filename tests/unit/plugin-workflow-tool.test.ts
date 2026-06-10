import { describe, expect, test } from "bun:test";
import { buildWorkflowTool } from "../../src/plugin/tools/workflow.ts";

function context(directory = process.cwd()) {
  return {
    sessionID: "s",
    messageID: "m",
    agent: "jce-worker",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: () => { throw new Error("not implemented"); },
  } as any;
}

describe("jce workflow tool", () => {
  test("returns verification recipe", async () => {
    const tool = buildWorkflowTool();
    const result = await tool.execute({ action: "verification_recipe", taskType: "release" } as any, context());

    expect(result).toContain("Commands");
    expect(result).toContain("bun run typecheck");
  });

  test("returns safe commit plan from supplied status text", async () => {
    const tool = buildWorkflowTool();
    const result = await tool.execute({
      action: "safe_commit_plan",
      gitStatus: " M src/plugin/index.ts\n?? .opencode-jce/cache.json\n",
      includeDocs: false,
    } as any, context());

    expect(result).toContain("Safe To Stage");
    expect(result).toContain("src/plugin/index.ts");
    expect(result).toContain("Excluded");
    expect(result).toContain(".opencode-jce/cache.json");
    expect(result).toContain("Guard Issues");
  });

  test("returns summary from supplied status text", async () => {
    const tool = buildWorkflowTool();
    const result = await tool.execute({
      action: "summary",
      scope: "Task 5",
      gitStatus: " M src/plugin/tools/workflow.ts\n?? .opencode-jce/cache.json\n",
    } as any, context());

    expect(result).toContain("Summary");
    expect(result).toContain("Scope: Task 5");
    expect(result).toContain("Current version: 3.5.5");
    expect(result).toContain("Changed Files");
    expect(result).toContain("M src/plugin/tools/workflow.ts");
    expect(result).toContain("Local-Only / Excluded Files");
    expect(result).toContain("?? .opencode-jce/cache.json");
  });

  test("returns release readiness report from supplied status text", async () => {
    const tool = buildWorkflowTool();
    const result = await tool.execute({
      action: "release_ready",
      targetVersion: "2.0.16",
      gitStatus: " M package.json\n",
      includeDocs: true,
      verificationEvidence: "bun run typecheck exit 0\nbun test 0 fail\nbun ./src/index.ts validate exit 0\nbash -n install.sh exit 0\nbun ./src/index.ts --version 2.0.16",
    } as any, context());

    expect(result).toContain("Status");
    expect(result).toContain("Version Sync");
    expect(result).toContain("Required Verification");
    expect(result).toContain("Safe Commit Plan");
    expect(result).toContain("Blockers");
  });

  test("returns coding plan for safe editing and debug loop", async () => {
    const tool = buildWorkflowTool();
    const result = await tool.execute({
      action: "code_task_plan",
      taskType: "bugfix",
      scope: "fix update handoff",
      gitStatus: " M src/commands/update.ts\n M tests/unit/audit-fixes.test.ts\n",
    } as any, context());

    expect(result).toContain("Coding Brain v3.1");
    expect(result).toContain("Bugfix Protocol");
    expect(result).toContain("Safe Edit Engine v3.4");
    expect(result).toContain("Autonomous Debug Loop v3.5");
    expect(result).toContain("src/commands/update.ts");
  });

  test("returns project learning report", async () => {
    const tool = buildWorkflowTool();
    const result = await tool.execute({
      action: "project_learning",
      gitStatus: " M package.json\n M src/plugin/index.ts\n",
    } as any, context());

    expect(result).toContain("Project Learning v3.3");
    expect(result).toContain("Package manager: bun");
    expect(result).toContain("Detected areas");
  });
});
