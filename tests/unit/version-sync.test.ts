import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { VERSION } from "../../src/lib/constants.js";

/**
 * Static version-sync invariant.
 *
 * Every place that hardcodes a semver string must match VERSION in
 * src/lib/constants.ts. Drift here has historically caused real bugs:
 * users on the new CLI but a stale README/install script saw mixed
 * versions and skipped self-update flows.
 *
 * This test does NOT replace the runtime release_ready workflow check;
 * it is a fast CI guard so we never publish with a desynced manifest.
 */

interface VersionSite {
  /** Repo-relative path. */
  path: string;
  /** Regex that must match the expected VERSION exactly once. */
  pattern: RegExp;
  /** Optional human label for assertion messages. */
  label?: string;
}

function root(...parts: string[]): string {
  return join(process.cwd(), ...parts);
}

/**
 * Build the canonical site list at call time so VERSION substitution happens
 * after the import above has resolved. The pattern uses VERSION literally
 * (escaped for regex) so a missing or mismatched value yields a clear fail.
 */
function buildSites(): VersionSite[] {
  const v = VERSION.replace(/\./g, "\\.");
  return [
    { path: "package.json", pattern: new RegExp(`"version"\\s*:\\s*"${v}"`), label: "package.json version field" },
    { path: "install.ps1", pattern: new RegExp(`\\$Version\\s*=\\s*"${v}"`), label: "install.ps1 $Version" },
    { path: "install.sh", pattern: new RegExp(`VERSION="${v}"`), label: "install.sh VERSION" },
    { path: "src/lib/version.ts", pattern: new RegExp(`CURRENT_CONFIG_VERSION\\s*=\\s*"${v}"`), label: "src/lib/version.ts CURRENT_CONFIG_VERSION" },
    { path: "src/mcp/context-keeper.ts", pattern: new RegExp(`version:\\s*"${v}"`), label: "context-keeper MCP server version" },
    { path: "README.md", pattern: new RegExp(`Version-${v}-`), label: "README.md shields.io badge" },
    { path: "CHANGELOG.md", pattern: new RegExp(`##\\s*\\[${v}\\]`), label: "CHANGELOG entry header" },
  ];
}

describe("version sync invariant", () => {
  test("VERSION constant is a valid semver string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });

  test("every required version site matches constants.ts VERSION", () => {
    const sites = buildSites();
    const failures: string[] = [];

    for (const site of sites) {
      const absolute = root(site.path);
      if (!existsSync(absolute)) {
        failures.push(`${site.label ?? site.path}: file missing at ${site.path}`);
        continue;
      }
      const content = readFileSync(absolute, "utf8");
      if (!site.pattern.test(content)) {
        failures.push(`${site.label ?? site.path}: pattern ${site.pattern} did NOT match VERSION ${VERSION} in ${site.path}`);
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `Version sync drift detected — bump VERSION in src/lib/constants.ts and update these sites:\n  - ${failures.join("\n  - ")}`,
      );
    }
  });

  test("tests/unit/ui.test.ts asserts the current VERSION", () => {
    const content = readFileSync(root("tests/unit/ui.test.ts"), "utf8");
    expect(content).toContain(`v${VERSION}`);
  });

  test("tests/unit/plugin-workflow-tool.test.ts asserts the current VERSION", () => {
    const content = readFileSync(root("tests/unit/plugin-workflow-tool.test.ts"), "utf8");
    expect(content).toContain(`Current version: ${VERSION}`);
  });
});
