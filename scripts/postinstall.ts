/**
 * Postinstall script — runs after `bun install` in the cli/ folder.
 * Removes the .exe shim that bun creates (which takes precedence over .cmd on Windows)
 * and ensures the .cmd shim points to the correct local CLI folder.
 *
 * This fixes the issue where `bun install -g` creates an .exe that runs stale code
 * from bun's global cache instead of the updated code in ~/.config/opencode/cli/.
 */
import { existsSync, unlinkSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const isWindows = process.platform === "win32";
if (!isWindows) process.exit(0);

const home = process.env.USERPROFILE || process.env.HOME || "";
const bunBinDir = join(home, ".bun", "bin");

const { getConfigDir } = await import("../src/lib/config.ts");
const configCliDir = join(getConfigDir(), "cli");

// Remove .exe and .bunx that take precedence over .cmd
for (const file of ["opencode-jce.exe", "opencode-jce.bunx", "opencode-jce"]) {
  const filePath = join(bunBinDir, file);
  if (existsSync(filePath)) {
    try {
      unlinkSync(filePath);
    } catch {
      // Ignore — file may be in use
    }
  }
}

// Ensure .cmd shim exists and points to the correct location
if (!existsSync(bunBinDir)) {
  mkdirSync(bunBinDir, { recursive: true });
}

const cmdPath = join(bunBinDir, "opencode-jce.cmd");
const cmdContent = `@echo off\r\nbun run "${join(configCliDir, "src", "index.ts")}" -- %*\r\n`;
writeFileSync(cmdPath, cmdContent, "ascii");
