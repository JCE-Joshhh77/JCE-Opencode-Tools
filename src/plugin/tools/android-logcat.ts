import { execFileSync } from "node:child_process";
import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { classifyAndroidFailure } from "../lib/android/failure-classifier.js";

const z = tool.schema;

export interface AdbRunResult {
  ok: boolean;
  stdout: string;
  stderr?: string;
}

export type AdbRunner = (args: string[], options?: { timeoutMs?: number }) => AdbRunResult;

export interface AndroidLogcatOptions {
  packageName?: string;
  deviceId?: string;
  lines?: number;
  clearBefore?: boolean;
  includeRaw?: boolean;
}

export interface AndroidLogcatAnalysis {
  status: "ok" | "blocked";
  devices: string[];
  selectedDevice?: string;
  packageName?: string;
  pid?: string;
  logExcerpt: string;
  classification: ReturnType<typeof classifyAndroidFailure>;
  warnings: string[];
  nextCommands: string[];
}

function defaultAdbRunner(args: string[], options: { timeoutMs?: number } = {}): AdbRunResult {
  try {
    const stdout = execFileSync("adb", args, { encoding: "utf8", timeout: options.timeoutMs ?? 15000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    return { ok: true, stdout };
  } catch (error) {
    const err = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    const stdout = Buffer.isBuffer(err.stdout) ? err.stdout.toString("utf8") : String(err.stdout ?? "");
    const stderr = Buffer.isBuffer(err.stderr) ? err.stderr.toString("utf8") : String(err.stderr ?? err.message ?? "adb command failed");
    return { ok: false, stdout, stderr };
  }
}

function isValidPackageName(name: string): boolean {
  return /^[a-zA-Z0-9._]+$/.test(name);
}

function adbArgs(deviceId: string | undefined, args: string[]): string[] {
  return deviceId ? ["-s", deviceId, ...args] : args;
}

function parseDevices(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("List of devices"))
    .filter((line) => /\bdevice\b/.test(line) && !/offline|unauthorized/.test(line))
    .map((line) => line.split(/\s+/)[0])
    .filter(Boolean);
}

function normalizeLines(lines: number | undefined): number {
  if (!Number.isFinite(lines)) return 800;
  return Math.min(Math.max(Math.trunc(lines ?? 800), 50), 5000);
}

function filterLogcat(raw: string, packageName?: string, pid?: string): string {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (!packageName && !pid) return lines.join("\n");
  const fatalIndex = lines.findIndex((line) => /FATAL EXCEPTION|ANR in|Fatal signal|AndroidRuntime|Caused by:/i.test(line));
  const contextual = fatalIndex >= 0 ? lines.slice(Math.max(0, fatalIndex - 20), fatalIndex + 120) : [];
  const filtered = lines.filter((line) => (pid ? line.includes(pid) : false) || (packageName ? line.includes(packageName) : false) || /FATAL EXCEPTION|ANR in|Fatal signal|AndroidRuntime|Caused by:|INSTALL_FAILED/i.test(line));
  return [...new Set([...contextual, ...filtered])].join("\n");
}

export function analyzeAndroidLogcat(options: AndroidLogcatOptions = {}, runner: AdbRunner = defaultAdbRunner): AndroidLogcatAnalysis {
  const warnings: string[] = [];
  const lines = normalizeLines(options.lines);
  const devicesResult = runner(["devices"], { timeoutMs: 10000 });
  if (!devicesResult.ok) {
    return {
      status: "blocked",
      devices: [],
      packageName: options.packageName,
      logExcerpt: "",
      classification: classifyAndroidFailure(devicesResult.stderr ?? devicesResult.stdout),
      warnings: [`adb devices failed: ${devicesResult.stderr ?? "unknown error"}`],
      nextCommands: ["Install Android platform-tools and ensure adb is on PATH.", "Run adb devices and authorize the device/emulator."],
    };
  }

  const devices = parseDevices(devicesResult.stdout);
  if (options.deviceId && !devices.includes(options.deviceId)) {
    return {
      status: "blocked",
      devices,
      packageName: options.packageName,
      logExcerpt: "",
      classification: classifyAndroidFailure(""),
      warnings: [`Requested device ${options.deviceId} is not an authorized device (adb devices: ${devices.join(", ") || "none"}).`],
      nextCommands: ["Run adb devices and confirm the serial is online and authorized.", "Pass a deviceId that appears in the authorized list, or omit it to auto-select."],
    };
  }
  const selectedDevice = options.deviceId ?? devices[0];
  if (!selectedDevice) {
    return {
      status: "blocked",
      devices,
      packageName: options.packageName,
      logExcerpt: "",
      classification: classifyAndroidFailure(""),
      warnings: ["No authorized Android device/emulator detected."],
      nextCommands: ["Start an emulator or connect a device.", "Run adb devices and accept the authorization prompt."],
    };
  }
  if (devices.length > 1 && !options.deviceId) warnings.push(`Multiple devices detected; selected ${selectedDevice}. Pass deviceId to choose explicitly.`);

  let pid: string | undefined;
  if (options.packageName) {
    if (!isValidPackageName(options.packageName)) {
      warnings.push(`Invalid package name: ${options.packageName}. Must be alphanumeric with dots/underscores only.`);
    } else {
      const pidResult = runner(adbArgs(selectedDevice, ["shell", "pidof", options.packageName]), { timeoutMs: 5000 });
      if (pidResult.ok && pidResult.stdout.trim()) pid = pidResult.stdout.trim().split(/\s+/)[0];
      else warnings.push(`Could not resolve pid for ${options.packageName}; falling back to package/error keyword filtering.`);
    }
  }

  if (options.clearBefore) {
    const clearResult = runner(adbArgs(selectedDevice, ["logcat", "-c"]), { timeoutMs: 5000 });
    if (!clearResult.ok) warnings.push(`adb logcat -c failed: ${clearResult.stderr ?? "unknown error"}`);
  }

  const logResult = runner(adbArgs(selectedDevice, ["logcat", "-d", "-v", "time", "-t", String(lines)]), { timeoutMs: 20000 });
  if (!logResult.ok) {
    return {
      status: "blocked",
      devices,
      selectedDevice,
      packageName: options.packageName,
      pid,
      logExcerpt: logResult.stdout,
      classification: classifyAndroidFailure(logResult.stderr ?? logResult.stdout),
      warnings: [...warnings, `adb logcat failed: ${logResult.stderr ?? "unknown error"}`],
      nextCommands: ["Run adb logcat -d manually to inspect device output."],
    };
  }

  const filtered = filterLogcat(logResult.stdout, options.packageName, pid);
  const excerpt = (filtered || logResult.stdout).split(/\r?\n/).slice(0, options.includeRaw ? 500 : 160).join("\n");
  const classification = classifyAndroidFailure(excerpt);
  return {
    status: "ok",
    devices,
    selectedDevice,
    packageName: options.packageName,
    pid,
    logExcerpt: excerpt,
    classification,
    warnings,
    nextCommands: classification.recommendedNextCommands.length
      ? classification.recommendedNextCommands
      : ["Reproduce the issue, then rerun android_logcat with the packageName."],
  };
}

function formatAnalysis(analysis: AndroidLogcatAnalysis): string {
  const c = analysis.classification;
  return [
    "Android Logcat Analysis",
    `Status: ${analysis.status}`,
    `Device: ${analysis.selectedDevice ?? "none"}`,
    `Package: ${analysis.packageName ?? "not specified"}`,
    `PID: ${analysis.pid ?? "unknown"}`,
    `Failure: ${c.kind} (${c.confidence})`,
    `Summary: ${c.summary}`,
    "",
    "Evidence",
    ...(c.evidence.length ? c.evidence.map((line) => `- ${line}`) : ["- none"]),
    "",
    "Likely Causes",
    ...(c.likelyCauses.length ? c.likelyCauses.map((line) => `- ${line}`) : ["- none"]),
    "",
    "Recommended Files",
    ...(c.recommendedFilesToInspect.length ? c.recommendedFilesToInspect.map((line) => `- ${line}`) : ["- none"]),
    "",
    "Next Commands",
    ...(analysis.nextCommands.length ? analysis.nextCommands.map((line) => `- ${line}`) : ["- none"]),
    "",
    "Warnings",
    ...(analysis.warnings.length ? analysis.warnings.map((line) => `- ${line}`) : ["- none"]),
    "",
    "Log Excerpt",
    analysis.logExcerpt ? `\`\`\`\n${analysis.logExcerpt}\n\`\`\`` : "- none",
  ].join("\n");
}

export function buildAndroidLogcatTool(runner: AdbRunner = defaultAdbRunner): ToolDefinition {
  return tool({
    description: "Collect and analyze Android logcat from an attached device/emulator using adb, then classify common Android failures.",
    args: {
      packageName: z.string().optional().describe("Android applicationId/package name to focus logcat filtering, e.g. com.example.app"),
      deviceId: z.string().optional().describe("Specific adb device serial. If omitted, the first authorized device is used."),
      lines: z.number().optional().describe("Number of recent logcat lines to read, clamped from 50 to 5000. Default 800."),
      clearBefore: z.boolean().optional().describe("Clear logcat before reading. Use only when you will reproduce the issue immediately after."),
      includeRaw: z.boolean().optional().describe("Include a larger raw excerpt in the result."),
    },
    async execute(args) {
      const analysis = analyzeAndroidLogcat({
        packageName: args.packageName as string | undefined,
        deviceId: args.deviceId as string | undefined,
        lines: args.lines as number | undefined,
        clearBefore: Boolean(args.clearBefore),
        includeRaw: Boolean(args.includeRaw),
      }, runner);
      return formatAnalysis(analysis);
    },
  });
}
