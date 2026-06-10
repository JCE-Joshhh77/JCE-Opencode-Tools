import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { RuntimeState } from "./runtime-state.js";

function readJson<T>(path: string): T | null {
  try { return JSON.parse(readFileSync(path, "utf-8")) as T; } catch { return null; }
}

export function buildProjectBrain(projectRoot: string, memory: RuntimeState): string {
  const pkg = readJson<{ scripts?: Record<string, string>; version?: string; dependencies?: Record<string, string> }>(join(projectRoot, "package.json"));
  const versionFiles = ["package.json", "install.ps1", "install.sh", "src/lib/constants.ts"].filter((file) => existsSync(join(projectRoot, file)));
  const skillDir = join(projectRoot, "config", "skills");
  const skillCount = existsSync(skillDir) ? readdirSync(skillDir).length : 0;
  return [
    "JCE-Worker Project Brain",
    "========================",
    `Version: ${pkg?.version ?? "unknown"}`,
    `Scripts: ${Object.keys(pkg?.scripts ?? {}).join(", ") || "none"}`,
    `Version sync files: ${versionFiles.join(", ")}`,
    `Skill directories: ${skillCount}`,
    `Known learnings: ${memory.wisdom.length}`,
    `Task recipes: ${memory.taskLearnings.length}`,
    "Generated/runtime paths: .opencode-jce/, .playwright-mcp/, .opencode-context.md",
    "Recommended verification: bun run typecheck; bun test; bun audit",
  ].join("\n");
}
