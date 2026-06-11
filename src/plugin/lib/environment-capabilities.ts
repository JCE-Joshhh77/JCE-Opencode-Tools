import { existsSync } from "fs";

export interface EnvironmentCapabilities {
  git: boolean;
  gh: boolean;
  bash: boolean;
  adb: boolean;
  bun: boolean;
  browser: boolean;
  ci: boolean;
}

export function detectEnvironmentCapabilities(): EnvironmentCapabilities {
  const path = process.env.PATH ?? "";
  const has = (needle: string) => path.toLowerCase().includes(needle.toLowerCase());
  return {
    git: has("git"),
    gh: has("gh"),
    bash: has("bash"),
    adb: has("adb"),
    bun: has("bun"),
    browser: Boolean(process.env.PLAYWRIGHT_BROWSERS_PATH) || has("chrome") || has("msedge"),
    ci: Boolean(process.env.CI) || existsSync(".github/workflows"),
  };
}

export function summarizeCapabilities(cap: EnvironmentCapabilities): string[] {
  return [
    `git: ${cap.git ? "available" : "missing"}`,
    `gh: ${cap.gh ? "available" : "missing"}`,
    `bash: ${cap.bash ? "available" : "missing"}`,
    `adb: ${cap.adb ? "available" : "missing"}`,
    `bun: ${cap.bun ? "available" : "missing"}`,
    `browser: ${cap.browser ? "available" : "missing"}`,
    `ci: ${cap.ci ? "available" : "missing"}`,
  ];
}
