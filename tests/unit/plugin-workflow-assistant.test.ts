import { describe, expect, test } from "bun:test";
import { buildCodeTaskPlan, buildProjectLearningReport, buildReleaseReadyReport, buildSafeCommitPlan, buildVerificationRecipe, buildWorkflowSummary, parseGitStatusPorcelain } from "../../src/plugin/lib/workflow-assistant.ts";

const syncedVersions = {
  "package.json": '{ "version": "2.0.13" }',
  "install.sh": 'VERSION="2.0.13"',
  "install.ps1": '$Version = "2.0.13"',
  "src/lib/constants.ts": 'export const VERSION = "2.0.13";',
  "src/lib/version.ts": 'export const CURRENT_CONFIG_VERSION = "2.0.13";',
  "src/mcp/context-keeper.ts": 'version: "2.0.13",',
  "README.md": "Version-2.0.13-green",
  "tests/unit/ui.test.ts": 'expect(output).toContain("v2.0.13");',
};

describe("workflow assistant", () => {
  test("workflow summary separates changed and local-only files", () => {
    const result = buildWorkflowSummary({
      scope: "release 2.0.13",
      files: parseGitStatusPorcelain(" M package.json\n?? .opencode-jce/cache.json\n?? notes.txt\n"),
      currentVersion: "2.0.13",
    });

    expect(result).toContain("Summary");
    expect(result).toContain("release 2.0.13");
    expect(result).toContain("Current version: 2.0.13");
    expect(result).toContain("Changed Files");
    expect(result).toContain("package.json");
    expect(result).toContain("Local-Only / Excluded Files");
    expect(result).toContain(".opencode-jce/cache.json");
    expect(result).toContain("notes.txt");
    expect(result).toContain("Suggested Next Step");
  });

  test("builds release verification recipe", () => {
    const result = buildVerificationRecipe("release");

    expect(result).toBe([
      "Commands",
      "- bun run typecheck",
      "- bun test",
      "- bun ./src/index.ts validate",
      "- bash -n install.sh",
      "- bun ./src/index.ts --version",
      "",
      "Success Criteria",
      "- tsc --noEmit exits 0",
      "- bun test reports 0 fail",
      "- All config files are valid",
      "- bash syntax check exits 0",
      "- CLI version matches target release",
      "",
      "Notes",
      "- Run safe_commit_plan before staging release files.",
    ].join("\n"));
  });

  test("builds agent prompt verification recipe", () => {
    const result = buildVerificationRecipe("agent_prompt");

    expect(result).toContain("bun test tests/unit/plugin-agents.test.ts");
    expect(result).toContain("prompt markers");
    expect(result).toContain("Notes");
  });

  test("builds bugfix coding plan with root cause and debug loop", () => {
    const result = buildCodeTaskPlan({ taskType: "bugfix", changedFiles: ["src/plugin/index.ts", "tests/unit/plugin-integration.test.ts"] });

    expect(result).toContain("Coding Brain v3.1");
    expect(result).toContain("Bugfix Protocol");
    expect(result).toContain("reproduce the symptom");
    expect(result).toContain("Root Cause");
    expect(result).toContain("Safe Edit Engine v3.4");
    expect(result).toContain("Autonomous Debug Loop v3.5");
    expect(result).toContain("After three failed focused fixes");
    expect(result).toContain("bun test tests/unit/plugin-integration.test.ts");
    expect(result).toContain("bun run typecheck");
  });

  test("builds feature coding plan with acceptance criteria and test plan", () => {
    const result = buildCodeTaskPlan({ taskType: "feature", scope: "add workflow helper", changedFiles: ["src/plugin/tools/workflow.ts"] });

    expect(result).toContain("Scope: add workflow helper");
    expect(result).toContain("Feature Protocol");
    expect(result).toContain("Acceptance Criteria");
    expect(result).toContain("minimal useful slice");
    expect(result).toContain("Impact Scan");
    expect(result).toContain("Risk Review");
  });

  test("builds project learning report from package scripts and changed files", () => {
    const result = buildProjectLearningReport({
      packageJson: JSON.stringify({ scripts: { test: "bun test", typecheck: "tsc --noEmit", build: "bun build" }, dependencies: { "@opencode-ai/plugin": "1.0.0" } }),
      files: parseGitStatusPorcelain(" M src/plugin/index.ts\n M install.sh\n"),
    });

    expect(result).toContain("Project Learning v3.3");
    expect(result).toContain("Package manager: bun");
    expect(result).toContain("Test command: bun test");
    expect(result).toContain("Typecheck command: tsc --noEmit");
    expect(result).toContain("Build command: bun build");
    expect(result).toContain("Detected areas");
    expect(result).toContain("plugin");
    expect(result).toContain("installer");
  });

  test("parses porcelain git status", () => {
    const files = parseGitStatusPorcelain(" M src/plugin/index.ts\n?? docs/superpowers/plans/new.md\n?? .opencode-jce/cache.json\n");

    expect(files).toEqual([
      { status: "M", path: "src/plugin/index.ts" },
      { status: "??", path: "docs/superpowers/plans/new.md" },
      { status: "??", path: ".opencode-jce/cache.json" },
    ]);
  });

  test("parses rename and copy porcelain destinations", () => {
    const files = parseGitStatusPorcelain([
      "R  src/old name.ts -> src/new name.ts",
      "C  src/source.ts -> src/copy.ts",
      "R  src/no-destination.ts",
    ].join("\n"));

    expect(files).toEqual([
      { status: "R", path: "src/new name.ts" },
      { status: "C", path: "src/copy.ts" },
      { status: "R", path: "src/no-destination.ts" },
    ]);
  });

  test("safe commit plan excludes local context and includes docs only when requested", () => {
    const files = parseGitStatusPorcelain([
      " M src/plugin/index.ts",
      " M .opencode-context.md",
      "?? docs/superpowers/plans/new.md",
      "?? DOCS\\SUPERPOWERS\\PLANS\\caps.md",
      "?? .opencode-jce/cache.json",
      "?? notes.txt",
      "?? .env.local",
    ].join("\n"));

    const withoutDocs = buildSafeCommitPlan(files, { includeDocs: false });
    expect(withoutDocs).toContain("Safe To Stage");
    expect(withoutDocs).toContain("src/plugin/index.ts");
    expect(withoutDocs).not.toContain("git add src/plugin/index.ts docs/superpowers/plans/new.md");
    expect(withoutDocs).toContain("Review First\n- docs/superpowers/plans/new.md (docs require includeDocs=true)\n- DOCS\\SUPERPOWERS\\PLANS\\caps.md (docs require includeDocs=true)");
    expect(withoutDocs).not.toContain("git add -- src/plugin/index.ts 'DOCS\\SUPERPOWERS\\PLANS\\caps.md'");
    expect(withoutDocs).toContain("Excluded");
    expect(withoutDocs).toContain(".opencode-context.md");
    expect(withoutDocs).toContain(".opencode-jce/cache.json");
    expect(withoutDocs).toContain(".env.local");

    const withDocs = buildSafeCommitPlan(files, { includeDocs: true });
    expect(withDocs).toContain("docs/superpowers/plans/new.md");
    expect(withDocs).toContain("git add -- src/plugin/index.ts docs/superpowers/plans/new.md 'DOCS\\SUPERPOWERS\\PLANS\\caps.md'");
  });

  test("safe commit plan quotes shell paths with single quotes", () => {
    const result = buildSafeCommitPlan([
      { status: "??", path: "src/plugin/$draft file.ts" },
      { status: "??", path: "src/plugin/user's file.ts" },
    ]);

    expect(result).toContain("git add -- 'src/plugin/$draft file.ts' 'src/plugin/user'\\''s file.ts'");
  });

  test("safe commit plan excludes protected and secret-looking paths case-insensitively", () => {
    const result = buildSafeCommitPlan([
      { status: "M", path: ".OpenCode-Context.md" },
      { status: "M", path: ".OPENCODE-CONTEXT-ARCHIVE.md" },
      { status: "??", path: ".OPENCODE-JCE\\cache.json" },
      { status: "??", path: ".ENV.local" },
      { status: "??", path: "config/creds.json" },
      { status: "??", path: "keys/id_rsa" },
      { status: "??", path: "keys/private.key" },
      { status: "??", path: ".npmrc" },
      { status: "??", path: ".pypirc" },
    ]);

    expect(result).toContain("Excluded");
    expect(result).toContain(".OpenCode-Context.md");
    expect(result).toContain(".OPENCODE-JCE\\cache.json");
    expect(result).toContain("config/creds.json");
    expect(result).toContain("No safe git add command available.");
  });

  test("safe commit plan omits git add when no files are safe", () => {
    const result = buildSafeCommitPlan([
      { status: "??", path: ".env.local" },
    ]);

    expect(result).toContain("Safe To Stage\n- none");
    expect(result).toContain("No safe git add command available.");
    expect(result).not.toContain("git add --");
  });

  test("release readiness needs verification when versions are synced", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.13",
      files: syncedVersions,
      statusFiles: parseGitStatusPorcelain(" M package.json\n M src/lib/constants.ts\n"),
      verificationEvidence: "",
    });

    expect(result).toContain("Status");
    expect(result).toContain("NEEDS_VERIFICATION");
    expect(result).toContain("Version Sync");
    expect(result).toContain("package.json: ok");
    expect(result).toContain("Required Verification");
  });

  test("release readiness is ready when versions sync and verification passes", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.13",
      files: syncedVersions,
      statusFiles: [],
      verificationEvidence: "bun run typecheck exit 0; bun test 623 pass 0 fail; bun ./src/index.ts validate exit 0; bash -n install.sh exit 0; bun ./src/index.ts --version 2.0.13",
    });

    expect(result).toContain("Status\nREADY");
  });

  test("release readiness safe commit plan includes changed release files", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.13",
      files: syncedVersions,
      statusFiles: parseGitStatusPorcelain(" M package.json\n M src/lib/constants.ts\n M README.md\n"),
      verificationEvidence: "bun run typecheck exit 0; bun test 623 pass 0 fail; bun ./src/index.ts validate exit 0; bash -n install.sh exit 0; bun ./src/index.ts --version 2.0.13",
    });

    expect(result).toContain("Safe Commit Plan");
    expect(result).toContain("package.json");
    expect(result).toContain("src/lib/constants.ts");
    expect(result).toContain("README.md");
    expect(result).toContain("git add -- package.json src/lib/constants.ts README.md");
  });

  test("release readiness rejects excluded files even when versions and verification pass", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.13",
      files: syncedVersions,
      statusFiles: parseGitStatusPorcelain(" M package.json\n?? .env.local\n"),
      verificationEvidence: "bun run typecheck exit 0; bun test 623 pass 0 fail; bun ./src/index.ts validate exit 0; bash -n install.sh exit 0; bun ./src/index.ts --version 2.0.13",
    });

    expect(result).toContain("Status\nNOT_READY");
    expect(result).toContain(".env.local excluded from safe commit plan");
  });

  test("release readiness rejects docs plans without includeDocs", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.13",
      files: syncedVersions,
      statusFiles: parseGitStatusPorcelain(" M package.json\n?? docs/superpowers/plans/release.md\n"),
      verificationEvidence: "bun run typecheck exit 0; bun test 623 pass 0 fail; bun ./src/index.ts validate exit 0; bash -n install.sh exit 0; bun ./src/index.ts --version 2.0.13",
    });

    expect(result).toContain("Status\nNOT_READY");
    expect(result).toContain("docs/superpowers/plans/release.md requires includeDocs=true");
  });

  test("release readiness rejects stale semver remnants", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.13",
      files: { ...syncedVersions, "README.md": "Version-2.0.13-green previous 2.0.8" },
      statusFiles: [],
      verificationEvidence: "bun run typecheck exit 0; bun test 623 pass 0 fail; bun ./src/index.ts validate exit 0; bash -n install.sh exit 0; bun ./src/index.ts --version 2.0.13",
    });

    expect(result).toContain("Status\nNOT_READY");
    expect(result).toContain("README.md: stale 2.0.8");
  });

  test("release readiness needs verification for unrelated pass evidence", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.13",
      files: syncedVersions,
      statusFiles: [],
      verificationEvidence: "docs spellcheck passed",
    });

    expect(result).toContain("Status\nNEEDS_VERIFICATION");
  });

  test("release readiness needs verification when release commands failed", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.13",
      files: syncedVersions,
      statusFiles: [],
      verificationEvidence: "bun run typecheck failed with error; bun test 622 pass 1 fail; bun ./src/index.ts validate failed; bash -n install.sh failed exit 1; bun ./src/index.ts --version wrong 2.0.8",
    });

    expect(result).toContain("Status\nNEEDS_VERIFICATION");
  });

  test("release readiness needs verification when release command exits nonzero", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.13",
      files: syncedVersions,
      statusFiles: [],
      verificationEvidence: "bun run typecheck exit 2; bun test 623 pass 0 fail; bun ./src/index.ts validate exit 0; bash -n install.sh exit 0; bun ./src/index.ts --version 2.0.13",
    });

    expect(result).toContain("Status\nNEEDS_VERIFICATION");
  });

  test("release readiness needs verification when release command exited with nonzero", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.13",
      files: syncedVersions,
      statusFiles: [],
      verificationEvidence: "bun run typecheck exited with 2; bun test 623 pass 0 fail; bun ./src/index.ts validate exit 0; bash -n install.sh exit 0; bun ./src/index.ts --version 2.0.13",
    });

    expect(result).toContain("Status\nNEEDS_VERIFICATION");
  });

  test("release readiness needs verification when release command returned nonzero", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.13",
      files: syncedVersions,
      statusFiles: [],
      verificationEvidence: "bun run typecheck returned 2; bun test 623 pass 0 fail; bun ./src/index.ts validate exit 0; bash -n install.sh exit 0; bun ./src/index.ts --version 2.0.13",
    });

    expect(result).toContain("Status\nNEEDS_VERIFICATION");
  });

  test("release readiness is ready with full release evidence", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.13",
      files: syncedVersions,
      statusFiles: [],
      verificationEvidence: "bun run typecheck exit 0; bun test 623 pass 0 fail; bun ./src/index.ts validate exit 0; bash -n install.sh exit 0; bun ./src/index.ts --version 2.0.13",
    });

    expect(result).toContain("Status\nREADY");
  });

  test("release readiness reports README version mismatch", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.13",
      files: { ...syncedVersions, "README.md": "Version-2.0.8-green" },
      statusFiles: [],
      verificationEvidence: "623 pass 0 fail 2.0.13",
    });

    expect(result).toContain("NOT_READY");
    expect(result).toContain("README.md: missing 2.0.13");
  });

  test("release readiness rejects invalid target version", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "v2",
      files: syncedVersions,
      statusFiles: [],
      verificationEvidence: "623 pass 0 fail",
    });

    expect(result).toContain("NOT_READY");
    expect(result).toContain("Invalid targetVersion");
  });
});
