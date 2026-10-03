/**
 * Process cleanup & CLI payload verification helpers.
 * Extracted from src/commands/update.ts (audit-2026-06-13 decompose).
 *
 * These are pure/process-level utilities with no dependency on the update
 * command's orchestration state, so they live here as testable functions.
 */
import { existsSync, realpathSync } from "fs";
import { join } from "path";
import { getConfigDir } from "../lib/config.js";
import { getRequiredCliPayloadFiles, resolveCliPayloadManifestPath } from "../lib/cli-payload.js";

export interface ProcessSnapshot {
  pid: number;
  ppid: number;
  command: string;
}

export function assertCliPayloadComplete(dir: string): void {
  const REQUIRED_CLI_PAYLOAD_FILES = getRequiredCliPayloadFiles(dir);
  const missing = REQUIRED_CLI_PAYLOAD_FILES.filter((file) => !existsSync(join(dir, file)));
  if (missing.length > 0) throw new Error(`Downloaded CLI source is incomplete; missing: ${missing.join(", ")}`);
}

export function resolveCliPayloadManifestForInstalledBase(baseDir: string): string {
  return resolveCliPayloadManifestPath(baseDir);
}

export function isUpdateProcessCommand(command: string): boolean {
  return /\bopencode-jce(?:\.cmd|\.ps1|\.exe)?\b[\s\S]*\bupdate\b/i.test(command) || /src[\\/]index\.ts[\s\S]*\bupdate\b/i.test(command);
}

export function isStaleOpenCodeCommand(command: string, configDir: string): boolean {
  const normalized = command.replace(/\\/g, "/");
  const cliPath = join(configDir, "cli");
  const cliDir = (existsSync(cliPath) ? realpathSync(cliPath) : cliPath).replace(/\\/g, "/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (isUpdateProcessCommand(normalized)) return false;
  return new RegExp(`${cliDir}/src/(plugin/index|mcp/context-keeper)\\.ts`, "i").test(normalized);
}

export function planStaleOpenCodeProcessKills(processes: ProcessSnapshot[], currentPid = process.pid, configDir = getConfigDir()): ProcessSnapshot[] {
  return processes
    .filter((entry) => entry.pid > 0 && entry.pid !== currentPid)
    .filter((entry) => isStaleOpenCodeCommand(entry.command, configDir));
}

export function parseUnixProcessList(output: string): ProcessSnapshot[] {
  return output.split(/\r?\n/).map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) return undefined;
    return { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? "" };
  }).filter((entry): entry is ProcessSnapshot => Boolean(entry));
}

export async function listUnixProcesses(): Promise<ProcessSnapshot[]> {
  const proc = Bun.spawn(["ps", "-axo", "pid=,ppid=,command="], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
  if (exitCode !== 0) return [];
  return parseUnixProcessList(stdout);
}

export async function terminateStaleOpenCodeProcesses(): Promise<ProcessSnapshot[]> {
  if (process.env.OPENCODE_JCE_SKIP_PROCESS_CLEANUP === "1") return [];
  if (process.platform === "win32") return [];
  const targets = planStaleOpenCodeProcessKills(await listUnixProcesses());
  for (const target of targets) {
    try { process.kill(target.pid, "SIGTERM"); } catch { /* Process may already have exited. */ }
  }
  return targets;
}