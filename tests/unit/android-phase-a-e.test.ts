import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeAndroidBuildOptimization,
  assessAndroidCompatibility,
  assessAndroidReleaseReadiness,
  auditAndroidSecurity,
  buildAndroidAdvancedFlow,
  buildAndroidOrchestrationPlan,
  evaluateAndroidEvidence,
  planAndroidCommands,
  planAndroidDeviceCrashFlow,
  probeAndroidEnvironment,
} from "../../src/plugin/lib/android/index.ts";

function fixture(): string { return mkdtempSync(join(tmpdir(), "opencode-jce-android-phase-")); }

function writeProject(root: string): void {
  mkdirSync(join(root, "app", "src", "main", "res", "xml"), { recursive: true });
  mkdirSync(join(root, "gradle", "wrapper"), { recursive: true });
  writeFileSync(join(root, "gradlew"), "", "utf8");
  writeFileSync(join(root, "settings.gradle.kts"), "include(\":app\")", "utf8");
  writeFileSync(join(root, "gradle.properties"), "org.gradle.jvmargs=-Xmx2g", "utf8");
  writeFileSync(join(root, "gradle", "wrapper", "gradle-wrapper.properties"), "distributionUrl=https\\://services.gradle.org/distributions/gradle-7.6-bin.zip", "utf8");
  writeFileSync(join(root, "gradle", "libs.versions.toml"), "agp = \"8.7.0\"\nkotlin = \"2.0.21\"\nksp = \"1.9.24-1.0.20\"\ncomposeCompiler = \"1.5.15\"", "utf8");
  writeFileSync(join(root, "app", "build.gradle.kts"), `plugins { id("com.android.application"); id("org.jetbrains.kotlin.android"); id("kotlin-kapt") }
android { namespace = "com.example"; compileSdk = 35; defaultConfig { applicationId = "com.example"; minSdk = 26; targetSdk = 33 }; buildFeatures { compose = true }; signingConfigs { create("release") } }
dependencies { api("androidx.room:room-runtime:+"); implementation("com.google.dagger:hilt-android:2.52") }`, "utf8");
  writeFileSync(join(root, "app", "src", "main", "AndroidManifest.xml"), `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-permission android:name="android.permission.CAMERA"/><application android:allowBackup="true" android:usesCleartextTraffic="true" android:networkSecurityConfig="@xml/network_security_config"><activity android:name=".MainActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.VIEW"/></intent-filter></activity></application></manifest>`, "utf8");
  writeFileSync(join(root, "app", "src", "main", "res", "xml", "network_security_config.xml"), `<network-security-config><base-config cleartextTrafficPermitted="true" /></network-security-config>`, "utf8");
}

describe("Android Phase A-E capabilities", () => {
  test("probes environment with injectable runner and surfaces blockers", () => {
    const root = fixture();
    try {
      const env = probeAndroidEnvironment(root, {}, (command) => {
        if (command === "java") return { stdout: "openjdk version \"17.0.10\"" };
        throw new Error("adb missing");
      });
      expect(env.java.available).toBe(true);
      expect(env.adb.available).toBe(false);
      expect(env.blockers.some((item) => item.includes("Android SDK"))).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("plans commands, gates evidence, and builds orchestration/device plans", () => {
    const root = fixture();
    try {
      writeProject(root);
      const report = buildAndroidAdvancedFlow({ root, prompt: "fix Android manifest release crash", changedFiles: ["app/src/main/AndroidManifest.xml"] });
      const environment = { java: { available: true }, sdk: { detected: true, platforms: ["android-35"], buildTools: ["35.0.0"] }, adb: { available: true, devices: [] }, gradle: { wrapperPresent: true }, blockers: [], warnings: [] };
      const commandPlan = planAndroidCommands({ profile: report.profile, flows: report.selectedFlows, changedFiles: ["app/src/main/AndroidManifest.xml"], environment });
      expect(commandPlan.commands.some((command) => command.command.includes("processDebugMainManifest"))).toBe(true);
      const gate = evaluateAndroidEvidence(commandPlan.commands, commandPlan.commands.filter((command) => command.priority === "required").map((command) => ({ command: command.command, exitCode: 0 })));
      expect(gate.status).toBe("pass");
      const orchestration = buildAndroidOrchestrationPlan(report, commandPlan);
      expect(orchestration.nodes.map((node) => node.id)).toContain("android.evidence");
      const devicePlan = planAndroidDeviceCrashFlow({ module: report.profile.primaryModule, packageName: "com.example", environment });
      expect(devicePlan.runnable).toBe(false);
      expect(devicePlan.steps.map((step) => step.id)).toContain("collect-logcat");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("assesses compatibility, security, release readiness, and build optimization", () => {
    const root = fixture();
    try {
      writeProject(root);
      const report = buildAndroidAdvancedFlow({ root, prompt: "release security optimize" });
      const compatibility = assessAndroidCompatibility(report.scan, { java: { available: true, version: "openjdk version \"11.0.1\"" }, sdk: { detected: true, platforms: [], buildTools: [] }, adb: { available: false, devices: [] }, gradle: { wrapperPresent: true }, blockers: [], warnings: [] });
      expect(compatibility.some((finding) => finding.area === "AGP/Gradle" && finding.severity === "error")).toBe(true);
      expect(compatibility.some((finding) => finding.area === "Kotlin/KSP")).toBe(true);
      const security = auditAndroidSecurity(report.scan);
      expect(security.some((finding) => finding.rule === "cleartext")).toBe(true);
      const release = assessAndroidReleaseReadiness(report.scan);
      expect(release.ready).toBe(false);
      const optimization = analyzeAndroidBuildOptimization(report.scan);
      expect(optimization.some((finding) => finding.area === "configuration-cache")).toBe(true);
      expect(optimization.some((finding) => finding.area === "dynamic-versions")).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
