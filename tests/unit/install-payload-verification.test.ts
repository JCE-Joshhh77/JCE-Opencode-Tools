import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const androidPayloadFiles = [
  "advanced-flow.ts",
  "environment-probe.ts",
  "command-planner.ts",
  "evidence-gate.ts",
  "compatibility-matrix.ts",
  "security-auditor.ts",
  "release-readiness.ts",
  "build-optimizer.ts",
  "orchestration-plan.ts",
  "device-flow.ts",
];
const flutterPayloadFiles = [
  "project-scanner.ts",
  "verification-recipe.ts",
  "failure-classifier.ts",
  "environment-probe.ts",
  "advanced-flow.ts",
  "command-planner.ts",
  "evidence-gate.ts",
  "release-readiness.ts",
];
const jceIntelligencePayloadFiles = [
  "src/plugin/hooks/jce-worker-guard.ts",
  "src/plugin/hooks/open-work-enforcer.ts",
  "src/plugin/hooks/todo-enforcer.ts",
  "src/plugin/lib/compaction-loop-guard.ts",
  "src/commands/analytics.ts",
  "src/commands/capabilities.ts",
  "src/commands/docs.ts",
  "src/commands/evidence.ts",
  "src/commands/flow.ts",
  "src/commands/skills.ts",
  "src/plugin/lib/jce-intelligence.ts",
  "src/plugin/lib/api/index.ts",
  "src/plugin/lib/devops/index.ts",
  "src/plugin/lib/security-flow/index.ts",
  "src/plugin/lib/web/index.ts",
];

describe("installer CLI payload verification", () => {
  test("TypeScript update verifies JCE intelligence payload before swapping CLI", () => {
    const text = readFileSync(join(root, "src", "commands", "update.ts"), "utf8");
    expect(text).toContain("REQUIRED_CLI_PAYLOAD_FILES");
    expect(text).toContain("assertCliPayloadComplete(stagingDir)");
    for (const file of jceIntelligencePayloadFiles) {
      expect(text).toContain(file);
    }
  });

  test("PowerShell installer verifies Android advanced modules before swapping CLI", () => {
    const text = readFileSync(join(root, "install.ps1"), "utf8");
    expect(text).toContain("function Test-JceCliPayload");
    expect(text).toContain("Test-JceCliPayload $stagingDir");
    for (const file of androidPayloadFiles) {
      expect(text).toContain(`src\\plugin\\lib\\android\\${file}`);
    }
    for (const file of flutterPayloadFiles) {
      expect(text).toContain(`src\\plugin\\lib\\flutter\\${file}`);
    }
    for (const file of jceIntelligencePayloadFiles) {
      expect(text).toContain(file.split("/").join("\\"));
    }
  });

  test("Unix installer verifies Android advanced modules before swapping CLI", () => {
    const text = readFileSync(join(root, "install.sh"), "utf8");
    expect(text).toContain("verify_jce_cli_payload()");
    expect(text).toContain("verify_jce_cli_payload \"$staging_dir\"");
    for (const file of androidPayloadFiles) {
      expect(text).toContain(`src/plugin/lib/android/${file}`);
    }
    for (const file of flutterPayloadFiles) {
      expect(text).toContain(`src/plugin/lib/flutter/${file}`);
    }
    for (const file of jceIntelligencePayloadFiles) {
      expect(text).toContain(file);
    }
  });

  test("Unix installer configures Fish PATH for Bun global binaries", () => {
    const text = readFileSync(join(root, "install.sh"), "utf8");
    expect(text).toContain("ensure_fish_bun_path()");
    expect(text).toContain("${XDG_CONFIG_HOME:-$HOME/.config}/fish");
    expect(text).toContain("command -v fish");
    expect(text).toContain("# OpenCode JCE: Bun global bin");
    expect(text).toContain("set -gx PATH \"$bun_bin\" \\$PATH");
    expect(text.match(/ensure_fish_bun_path/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
});
