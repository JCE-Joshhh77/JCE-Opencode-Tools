import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAndroidAdvancedFlow, buildAndroidAdvancedProfile, scanAndroidProject, selectAndroidFlowKinds } from "../../src/plugin/lib/android/index.ts";

function fixture(): string {
  return mkdtempSync(join(tmpdir(), "opencode-jce-android-advanced-"));
}

function writeComposeProject(root: string): void {
  mkdirSync(join(root, "app", "src", "main", "res", "layout"), { recursive: true });
  mkdirSync(join(root, "app", "src", "test"), { recursive: true });
  mkdirSync(join(root, "gradle"), { recursive: true });
  writeFileSync(join(root, "gradlew"), "", "utf8");
  writeFileSync(join(root, "settings.gradle.kts"), "include(\":app\")", "utf8");
  writeFileSync(join(root, "gradle", "libs.versions.toml"), "agp = \"8.7.0\"\nkotlin = \"2.0.21\"\ncomposeCompiler = \"1.5.15\"", "utf8");
  writeFileSync(join(root, "app", "build.gradle.kts"), `plugins { id("com.android.application"); id("org.jetbrains.kotlin.android"); id("com.google.devtools.ksp") }
android { namespace = "com.example"; compileSdk = 35; defaultConfig { applicationId = "com.example"; minSdk = 26; targetSdk = 35 }; buildFeatures { compose = true }; signingConfigs { create("release") } }
dependencies { implementation("androidx.room:room-runtime:2.6.1"); implementation("androidx.datastore:datastore-preferences:1.1.1"); implementation("com.google.dagger:hilt-android:2.52") }`, "utf8");
}

describe("Android advanced flow", () => {
  test("builds a durable Android profile with architecture signals and verification matrix", () => {
    const root = fixture();
    try {
      writeComposeProject(root);
      const scan = scanAndroidProject(root);
      const profile = buildAndroidAdvancedProfile(scan, ["app/src/main/java/com/example/HomeViewModel.kt"], "@Composable fun Home() {} Room Migration");

      expect(profile.projectType).toBe("native-android");
      expect(profile.uiToolkit).toBe("mixed");
      expect(profile.language).toBe("kotlin");
      expect(profile.primaryModule).toBe(":app");
      expect(profile.architectureSignals).toContain("Jetpack Compose UI");
      expect(profile.architectureSignals).toContain("Room persistence");
      expect(profile.verificationMatrix.some((item) => item.command.includes(":app:testDebugUnitTest"))).toBe(true);
      expect(profile.persistentContext.some((line) => line.includes("Android profile"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("selects specialized flows from prompt, files, and failure classification", () => {
    const kinds = selectAndroidFlowKinds({
      root: ".",
      prompt: "fix release crash, audit permission security, optimize startup",
      changedFiles: ["app/src/main/AndroidManifest.xml", "app/proguard-rules.pro"],
    }, { detected: true, kind: "runtime-crash", confidence: "high", summary: "crash", evidence: [], likelyCauses: [], recommendedNextCommands: [], recommendedFilesToInspect: [], risks: [] });

    expect(kinds).toContain("diagnose");
    expect(kinds).toContain("release");
    expect(kinds).toContain("security");
    expect(kinds).toContain("performance");
  });

  test("builds end-to-end advanced flow report with environment blockers and classifier evidence", () => {
    const root = fixture();
    try {
      writeComposeProject(root);
      const report = buildAndroidAdvancedFlow({
        root,
        prompt: "diagnose Android crash and prepare release readiness",
        changedFiles: ["app/src/main/AndroidManifest.xml"],
        failureLog: "E AndroidRuntime: FATAL EXCEPTION: main\nE AndroidRuntime: Process: com.example\nE AndroidRuntime: Caused by: java.lang.IllegalStateException",
        environment: { adbAvailable: false },
      });

      expect(report.failure?.kind).toBe("runtime-crash");
      expect(report.selectedFlows.map((flow) => flow.kind)).toContain("diagnose");
      expect(report.selectedFlows.map((flow) => flow.kind)).toContain("release");
      expect(report.environmentFindings.some((finding) => finding.includes("adb is unavailable"))).toBe(true);
      expect(report.nextActions.some((action) => action.includes("Persist Android profile"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
