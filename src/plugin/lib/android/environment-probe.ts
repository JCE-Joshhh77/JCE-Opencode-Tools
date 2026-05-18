import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export interface AndroidDeviceInfo { id: string; state: string }
export interface AndroidEnvironmentProbe {
  java: { available: boolean; version?: string; javaHome?: string };
  sdk: { detected: boolean; path?: string; platforms: string[]; buildTools: string[] };
  adb: { available: boolean; devices: AndroidDeviceInfo[] };
  gradle: { wrapperPresent: boolean; wrapperPath?: string };
  blockers: string[];
  warnings: string[];
}

export type AndroidProbeRunner = (command: string, args: string[]) => { stdout: string; stderr?: string };

const defaultRunner: AndroidProbeRunner = (command, args) => ({ stdout: execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) });

function tryRun(runner: AndroidProbeRunner, command: string, args: string[]): string | null {
  try { const result = runner(command, args); return `${result.stdout}\n${result.stderr ?? ""}`.trim(); } catch { return null; }
}

function listDir(path: string): string[] { try { return existsSync(path) ? readdirSync(path) : []; } catch { return []; } }

function sdkPath(env: NodeJS.ProcessEnv): string | undefined {
  return env.ANDROID_HOME || env.ANDROID_SDK_ROOT || (env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Android", "Sdk") : undefined);
}

function parseDevices(text: string | null): AndroidDeviceInfo[] {
  if (!text) return [];
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("List of devices"))
    .map((line) => { const [id, state] = line.split(/\s+/); return id && state ? { id, state } : null; })
    .filter((item): item is AndroidDeviceInfo => item !== null);
}

export function probeAndroidEnvironment(root: string, env: NodeJS.ProcessEnv = process.env, runner: AndroidProbeRunner = defaultRunner): AndroidEnvironmentProbe {
  const javaOutput = tryRun(runner, "java", ["-version"]);
  const adbOutput = tryRun(runner, "adb", ["devices"]);
  const sdk = sdkPath(env);
  const wrapperBat = join(root, "gradlew.bat");
  const wrapperUnix = join(root, "gradlew");
  const wrapperPath = existsSync(wrapperBat) ? wrapperBat : existsSync(wrapperUnix) ? wrapperUnix : undefined;
  const devices = parseDevices(adbOutput);
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!javaOutput) blockers.push("Java runtime is not available on PATH; Gradle/AGP cannot run reliably.");
  if (!sdk || !existsSync(sdk)) blockers.push("Android SDK path was not detected via ANDROID_HOME, ANDROID_SDK_ROOT, or LOCALAPPDATA fallback.");
  if (!wrapperPath) warnings.push("Gradle wrapper is missing; use project wrapper for reproducible Android builds.");
  if (!adbOutput) warnings.push("adb is unavailable; logcat/install/instrumentation flows are blocked.");
  if (adbOutput && devices.filter((device) => device.state === "device").length === 0) warnings.push("adb is available but no authorized device/emulator is attached.");
  return {
    java: { available: Boolean(javaOutput), version: javaOutput?.split(/\r?\n/)[0], javaHome: env.JAVA_HOME },
    sdk: { detected: Boolean(sdk && existsSync(sdk)), path: sdk, platforms: sdk ? listDir(join(sdk, "platforms")) : [], buildTools: sdk ? listDir(join(sdk, "build-tools")) : [] },
    adb: { available: Boolean(adbOutput), devices },
    gradle: { wrapperPresent: Boolean(wrapperPath), wrapperPath },
    blockers,
    warnings,
  };
}
