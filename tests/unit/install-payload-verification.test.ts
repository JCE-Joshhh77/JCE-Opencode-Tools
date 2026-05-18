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

describe("installer CLI payload verification", () => {
  test("PowerShell installer verifies Android advanced modules before swapping CLI", () => {
    const text = readFileSync(join(root, "install.ps1"), "utf8");
    expect(text).toContain("function Test-JceCliPayload");
    expect(text).toContain("Test-JceCliPayload $stagingDir");
    for (const file of androidPayloadFiles) {
      expect(text).toContain(`src\\plugin\\lib\\android\\${file}`);
    }
  });

  test("Unix installer verifies Android advanced modules before swapping CLI", () => {
    const text = readFileSync(join(root, "install.sh"), "utf8");
    expect(text).toContain("verify_jce_cli_payload()");
    expect(text).toContain("verify_jce_cli_payload \"$staging_dir\"");
    for (const file of androidPayloadFiles) {
      expect(text).toContain(`src/plugin/lib/android/${file}`);
    }
  });
});
