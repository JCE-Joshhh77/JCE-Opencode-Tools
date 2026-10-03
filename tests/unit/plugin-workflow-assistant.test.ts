import { describe, expect, test } from "bun:test";
import { buildCodeTaskPlan, buildProjectLearningReport, buildReleaseDeltaReport, buildReleaseReadyReport, buildSafeCommitPlan, buildVerificationRecipe, buildWorkflowSummary, parseGitStatusPorcelain } from "../../src/plugin/lib/workflow-assistant.ts";

const syncedVersions = {
  "package.json": '{ "version": "2.0.16" }',
  "install.sh": 'VERSION="2.0.16"',
  "install.ps1": '$Version = "2.0.16"',
  "src/lib/constants.ts": 'export const VERSION = "2.0.16";',
  "src/lib/version.ts": 'export const CURRENT_CONFIG_VERSION = "2.0.16";',
  "src/mcp/context-keeper.ts": 'version: "2.0.16",',
  "README.md": "Version-2.0.16-green",
  "tests/unit/ui.test.ts": 'expect(output).toContain("v2.0.16");',
};

describe("workflow assistant", () => {
  test("workflow summary separates changed and local-only files", () => {
    const result = buildWorkflowSummary({
      scope: "release 2.0.16",
      files: parseGitStatusPorcelain(" M package.json\n?? .opencode-jce/cache.json\n?? notes.txt\n"),
      currentVersion: "2.0.16",
    });

    expect(result).toContain("Summary");
    expect(result).toContain("release 2.0.16");
    expect(result).toContain("Current version: 2.0.16");
    expect(result).toContain("Changed Files");
    expect(result).toContain("package.json");
    expect(result).toContain("Detected Areas");
    expect(result).toContain("release/versioning");
    expect(result).toContain("Suggested Checks");
    expect(result).toContain("bun ./src/index.ts validate");
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
      targetVersion: "2.0.16",
      files: syncedVersions,
      statusFiles: parseGitStatusPorcelain(" M package.json\n M src/lib/constants.ts\n"),
      verificationEvidence: "",
    });

    expect(result).toContain("Status");
    expect(result).toContain("NEEDS_VERIFICATION");
    expect(result).toContain("Version Sync");
    expect(result).toContain("package.json: ok");
    expect(result).toContain("Required Verification");
    expect(result).toContain("Warnings");
    expect(result).toContain("Verification evidence missing.");
    expect(result).toContain("CHANGELOG.md not included in release candidate changes.");
    expect(result).toContain("Evidence Strength");
    expect(result).toContain("- weak");
  });

  test("parses quoted rename paths containing the rename separator", () => {
    expect(parseGitStatusPorcelain('R  "old -> name.ts" -> "new -> name.ts"\n')).toEqual([
      { status: "R", path: "new -> name.ts" },
    ]);
  });

  test("parses NUL-delimited porcelain rename destinations", () => {
    expect(parseGitStatusPorcelain("R  new -> name.ts\0old -> name.ts\0 M regular.ts\0")).toEqual([
      { status: "R", path: "new -> name.ts" },
      { status: "M", path: "regular.ts" },
    ]);
  });

  test("preserves filename whitespace in NUL-delimited porcelain", () => {
    expect(parseGitStatusPorcelain("??  leading and trailing  \0")).toEqual([
      { status: "??", path: " leading and trailing  " },
    ]);
  });

  test("decodes quoted porcelain paths", () => {
    expect(parseGitStatusPorcelain(' M "src/file name.ts"\n?? "docs/caf\\303\\251 notes.md"\nR  "old name.ts" -> "new name.ts"\n')).toEqual([
      { status: "M", path: "src/file name.ts" },
      { status: "??", path: "docs/café notes.md" },
      { status: "R", path: "new name.ts" },
    ]);
  });

  test("release readiness is ready when versions sync and verification passes", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.16",
      files: syncedVersions,
      statusFiles: [],
      verificationEvidence: "bun run typecheck exit 0; bun test 623 pass 0 fail; bun ./src/index.ts validate exit 0; bash -n install.sh exit 0; bun ./src/index.ts --version 2.0.16",
    });

    expect(result).toContain("Status\nREADY");
    expect(result).toContain("Evidence Strength");
    expect(result).toContain("- strong");
  });

  test("release readiness safe commit plan includes changed release files", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.16",
      files: syncedVersions,
      statusFiles: parseGitStatusPorcelain(" M package.json\n M src/lib/constants.ts\n M README.md\n"),
      verificationEvidence: "bun run typecheck exit 0; bun test 623 pass 0 fail; bun ./src/index.ts validate exit 0; bash -n install.sh exit 0; bun ./src/index.ts --version 2.0.16",
    });

    expect(result).toContain("Safe Commit Plan");
    expect(result).toContain("package.json");
    expect(result).toContain("src/lib/constants.ts");
    expect(result).toContain("README.md");
    expect(result).toContain("git add -- package.json src/lib/constants.ts README.md");
  });

  test("release readiness rejects excluded files even when versions and verification pass", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.16",
      files: syncedVersions,
      statusFiles: parseGitStatusPorcelain(" M package.json\n?? .env.local\n"),
      verificationEvidence: "bun run typecheck exit 0; bun test 623 pass 0 fail; bun ./src/index.ts validate exit 0; bash -n install.sh exit 0; bun ./src/index.ts --version 2.0.16",
    });

    expect(result).toContain("Status\nNOT_READY");
    expect(result).toContain(".env.local excluded from safe commit plan");
    expect(result).toContain("Hard Blockers");
  });

  test("release readiness separates warnings from hard blockers when verification is partial", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.16",
      files: syncedVersions,
      statusFiles: parseGitStatusPorcelain(" M package.json\n M CHANGELOG.md\n"),
      verificationEvidence: "bun run typecheck exit 0; bun test 623 pass 0 fail",
    });

    expect(result).toContain("Status\nNEEDS_VERIFICATION");
    expect(result).toContain("Hard Blockers\n- none");
    expect(result).toContain("Warnings");
    expect(result).toContain("Missing config validation evidence.");
    expect(result).toContain("Missing install.sh syntax evidence.");
    expect(result).toContain("Missing CLI version evidence.");
    expect(result).toContain("Evidence Strength");
    expect(result).toContain("- medium");
  });

  test("release readiness rejects docs plans without includeDocs", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.16",
      files: syncedVersions,
      statusFiles: parseGitStatusPorcelain(" M package.json\n?? docs/superpowers/plans/release.md\n"),
      verificationEvidence: "bun run typecheck exit 0; bun test 623 pass 0 fail; bun ./src/index.ts validate exit 0; bash -n install.sh exit 0; bun ./src/index.ts --version 2.0.16",
    });

    expect(result).toContain("Status\nNOT_READY");
    expect(result).toContain("docs/superpowers/plans/release.md requires includeDocs=true");
  });

  test("release readiness rejects stale semver remnants", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.16",
      files: { ...syncedVersions, "README.md": "Version-2.0.16-green previous 2.0.8" },
      statusFiles: [],
      verificationEvidence: "bun run typecheck exit 0; bun test 623 pass 0 fail; bun ./src/index.ts validate exit 0; bash -n install.sh exit 0; bun ./src/index.ts --version 2.0.16",
    });

    expect(result).toContain("Status\nNOT_READY");
    expect(result).toContain("README.md: stale 2.0.8");
  });

  test("release readiness needs verification for unrelated pass evidence", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.16",
      files: syncedVersions,
      statusFiles: [],
      verificationEvidence: "docs spellcheck passed",
    });

    expect(result).toContain("Status\nNEEDS_VERIFICATION");
  });

  test("release readiness needs verification when release commands failed", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.16",
      files: syncedVersions,
      statusFiles: [],
      verificationEvidence: "bun run typecheck failed with error; bun test 622 pass 1 fail; bun ./src/index.ts validate failed; bash -n install.sh failed exit 1; bun ./src/index.ts --version wrong 2.0.8",
    });

    expect(result).toContain("Status\nNEEDS_VERIFICATION");
  });

  test("release readiness needs verification when release command exits nonzero", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.16",
      files: syncedVersions,
      statusFiles: [],
      verificationEvidence: "bun run typecheck exit 2; bun test 623 pass 0 fail; bun ./src/index.ts validate exit 0; bash -n install.sh exit 0; bun ./src/index.ts --version 2.0.16",
    });

    expect(result).toContain("Status\nNEEDS_VERIFICATION");
  });

  test("release readiness needs verification when release command exited with nonzero", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.16",
      files: syncedVersions,
      statusFiles: [],
      verificationEvidence: "bun run typecheck exited with 2; bun test 623 pass 0 fail; bun ./src/index.ts validate exit 0; bash -n install.sh exit 0; bun ./src/index.ts --version 2.0.16",
    });

    expect(result).toContain("Status\nNEEDS_VERIFICATION");
  });

  test("release readiness needs verification when release command returned nonzero", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.16",
      files: syncedVersions,
      statusFiles: [],
      verificationEvidence: "bun run typecheck returned 2; bun test 623 pass 0 fail; bun ./src/index.ts validate exit 0; bash -n install.sh exit 0; bun ./src/index.ts --version 2.0.16",
    });

    expect(result).toContain("Status\nNEEDS_VERIFICATION");
  });

  test("release readiness is ready with full release evidence", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.16",
      files: syncedVersions,
      statusFiles: [],
      verificationEvidence: "bun run typecheck exit 0; bun test 623 pass 0 fail; bun ./src/index.ts validate exit 0; bash -n install.sh exit 0; bun ./src/index.ts --version 2.0.16",
    });

    expect(result).toContain("Status\nREADY");
  });

  test("release readiness reports README version mismatch", () => {
    const result = buildReleaseReadyReport({
      targetVersion: "2.0.16",
      files: { ...syncedVersions, "README.md": "Version-2.0.8-green" },
      statusFiles: [],
      verificationEvidence: "623 pass 0 fail 2.0.16",
    });

    expect(result).toContain("NOT_READY");
    expect(result).toContain("README.md: missing 2.0.16");
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

  test("release delta summarizes changed subsystems and migration notes", () => {
    const result = buildReleaseDeltaReport({
      previousVersion: "2.0.15",
      targetVersion: "2.0.16",
      files: parseGitStatusPorcelain([
        " M src/commands/update.ts",
        " M src/plugin/index.ts",
        " M package.json",
        " M CHANGELOG.md",
        " M tests/unit/plugin-integration.test.ts",
      ].join("\n")),
    });

    expect(result).toContain("Release Delta");
    expect(result).toContain("From: 2.0.15");
    expect(result).toContain("To: 2.0.16");
    expect(result).toContain("Changed Subsystems");
    expect(result).toContain("cli/commands");
    expect(result).toContain("plugin/runtime");
    expect(result).toContain("release/versioning");
    expect(result).toContain("Likely User-Visible Changes");
    expect(result).toContain("CLI or JCE-Worker behavior changed in runtime/command paths.");
    expect(result).toContain("Migration Notes");
    expect(result).toContain("Updater behavior changed; older installed CLIs may need retest against tagged releases.");
  });
});
