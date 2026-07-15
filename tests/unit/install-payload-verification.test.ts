import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_PAYLOAD_MANIFEST_PATH, getRequiredCliPayloadFiles } from "../../src/lib/cli-payload.ts";

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
const payloadPaths = getRequiredCliPayloadFiles(root);
const manifestText = readFileSync(join(root, CLI_PAYLOAD_MANIFEST_PATH), "utf8");

describe("installer CLI payload verification", () => {
  test("TypeScript update verifies JCE intelligence payload before swapping CLI", () => {
    const text = readFileSync(join(root, "src", "commands", "update.ts"), "utf8");
    expect(text).toContain("getRequiredCliPayloadFiles");
    expect(text).toContain("assertCliPayloadComplete(stagingDir)");
    for (const file of getRequiredCliPayloadFiles(root)) expect(manifestText).toContain(file);
  });

  test("payload includes generated agent prompts so updated users receive prompt changes", () => {
    // Only assert files that are shipped in the committed cli-payload + repo tree.
    // WIP paths (why.ts, chinese-translator, slash-model-command) stay out until those features land.
    expect(payloadPaths).toContain("src/commands/droid.ts");
    expect(payloadPaths).toContain("src/commands/factory.ts");
    expect(payloadPaths).toContain("src/lib/factory-droid.ts");
    expect(payloadPaths).toContain("src/plugin/config.ts");
    expect(payloadPaths).toContain("src/plugin/agents/jce-worker.ts");
    expect(payloadPaths).toContain("config/AGENTS.md");
    for (const file of payloadPaths) {
      expect(existsSync(join(root, file)), `payload entry missing from repo: ${file}`).toBe(true);
    }
  });

  test("PowerShell installer verifies Android advanced modules before swapping CLI", () => {
    const text = readFileSync(join(root, "install.ps1"), "utf8");
    expect(text).toContain("function Test-JceCliPayload");
    expect(text).toContain("Test-JceCliPayload $stagingDir");
    for (const file of androidPayloadFiles) {
      expect(manifestText).toContain(`src/plugin/lib/android/${file}`);
    }
    for (const file of flutterPayloadFiles) {
      expect(manifestText).toContain(`src/plugin/lib/flutter/${file}`);
    }
    expect(text).toContain('config\\cli-payload.txt');
    expect(text).toContain('Get-Content $manifest');
    expect(text).toContain('Copy-Item (Join-Path $TempDir "config") (Join-Path $stagingDir "config") -Recurse');
    // Windows MAX_PATH: install deps in staging; never recursive-copy node_modules.
    expect(text).not.toContain('Copy-Item (Join-Path $TempDir "node_modules")');
    expect(text).toContain('bun install --ignore-scripts');
    expect(text).toContain('Push-Location $stagingDir');
  });

  test("Unix installer verifies Android advanced modules before swapping CLI", () => {
    const text = readFileSync(join(root, "install.sh"), "utf8");
    expect(text).toContain("verify_jce_cli_payload()");
    expect(text).toContain("verify_jce_cli_payload \"$staging_dir\"");
    for (const file of androidPayloadFiles) {
      expect(manifestText).toContain(`src/plugin/lib/android/${file}`);
    }
    for (const file of flutterPayloadFiles) {
      expect(manifestText).toContain(`src/plugin/lib/flutter/${file}`);
    }
    expect(text).toContain('config/cli-payload.txt');
    expect(text).toContain('done < "$manifest"');
    expect(text).toContain('cp -r "$TEMP_DIR/config" "$staging_dir/config"');
    // Match PowerShell: install deps in staging, do not cp -r node_modules.
    expect(text).not.toContain('cp -r "$TEMP_DIR/node_modules"');
    expect(text).toContain('cd "$staging_dir" && bun install --ignore-scripts');
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
