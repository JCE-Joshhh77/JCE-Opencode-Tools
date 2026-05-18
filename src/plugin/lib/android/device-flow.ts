import type { AndroidEnvironmentProbe } from "./environment-probe.js";

export interface AndroidDeviceFlowStep { id: string; command: string; reason: string; blockedBy: string[]; evidence: string[] }
export interface AndroidDeviceFlowPlan { runnable: boolean; steps: AndroidDeviceFlowStep[]; blockers: string[] }

function step(id: string, command: string, reason: string, blockers: string[] = []): AndroidDeviceFlowStep {
  return { id, command, reason, blockedBy: blockers, evidence: [`${command} output captured`, "Failure/logcat excerpt reviewed when relevant"] };
}

export function planAndroidDeviceCrashFlow(input: { module?: string | null; packageName?: string; environment?: AndroidEnvironmentProbe }): AndroidDeviceFlowPlan {
  const module = input.module ?? ":app";
  const packageName = input.packageName ?? "<applicationId>";
  const blockers: string[] = [];
  if (!input.environment?.adb.available) blockers.push("adb unavailable");
  if (input.environment && input.environment.adb.devices.filter((device) => device.state === "device").length === 0) blockers.push("no authorized device/emulator");
  const apk = `${module.replace(/^:/, "").replace(/:/g, "/")}/build/outputs/apk/debug/${module.split(":").filter(Boolean).pop() ?? "app"}-debug.apk`;
  const steps = [
    step("build", `./gradlew ${module}:assembleDebug`, "Build debug APK before device reproduction."),
    step("clear-logcat", "adb logcat -c", "Clear stale logs before reproducing crash.", blockers),
    step("install", `adb install -r ${apk}`, "Install the freshly built APK.", blockers),
    step("launch", `adb shell monkey -p ${packageName} 1`, "Launch app package to reproduce startup/runtime crash.", blockers),
    step("collect-logcat", `adb logcat -d AndroidRuntime:E '*:S'`, "Collect focused AndroidRuntime crash evidence.", blockers),
  ];
  return { runnable: blockers.length === 0, steps, blockers };
}
