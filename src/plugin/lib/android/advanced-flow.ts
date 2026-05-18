import { scanAndroidProject, type AndroidProjectScan } from "./project-scanner.js";
import { classifyAndroidFailure, type AndroidFailureClassification } from "./failure-classifier.js";
import { buildAndroidVerificationRecipe, type AndroidVerificationCommand } from "./verification-recipe.js";

export type AndroidFlowKind = "diagnose" | "feature" | "ui" | "data" | "release" | "performance" | "security";

export interface AndroidEnvironmentFacts {
  javaHome?: string;
  androidHome?: string;
  androidSdkRoot?: string;
  adbAvailable?: boolean;
  authorizedDeviceCount?: number;
}

export interface AndroidAdvancedProfile {
  projectType: "native-android" | "android-library" | "react-native-host" | "flutter-host" | "kmp" | "unknown";
  uiToolkit: "compose" | "xml-views" | "mixed" | "unknown";
  language: "kotlin" | "java" | "mixed" | "unknown";
  architectureSignals: string[];
  primaryModule: string | null;
  verificationMatrix: AndroidVerificationCommand[];
  persistentContext: string[];
  risks: string[];
}

export interface AndroidFlowTemplate {
  kind: AndroidFlowKind;
  title: string;
  triggers: string[];
  steps: string[];
  evidenceRequired: string[];
  recommendedCommands: AndroidVerificationCommand[];
  escalation: string[];
}

export interface AndroidAdvancedFlowReport {
  profile: AndroidAdvancedProfile;
  scan: AndroidProjectScan;
  environmentFindings: string[];
  failure?: AndroidFailureClassification;
  selectedFlows: AndroidFlowTemplate[];
  nextActions: string[];
}

export interface AndroidAdvancedFlowInput {
  root: string;
  prompt?: string;
  changedFiles?: string[];
  diffText?: string;
  failureLog?: string;
  environment?: AndroidEnvironmentFacts;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function detectLanguage(scan: AndroidProjectScan): AndroidAdvancedProfile["language"] {
  const hasKotlin = scan.modules.some((module) => module.pluginIds.some((id) => id.includes("kotlin")) || module.usesKsp || module.usesKapt);
  const hasJavaOnly = scan.modules.some((module) => module.pluginIds.some((id) => id === "java" || id === "java-library"));
  if (hasKotlin && hasJavaOnly) return "mixed";
  if (hasKotlin) return "kotlin";
  if (hasJavaOnly) return "java";
  return "unknown";
}

function detectProjectType(scan: AndroidProjectScan): AndroidAdvancedProfile["projectType"] {
  const plugins = scan.modules.flatMap((module) => module.pluginIds);
  if (plugins.includes("com.android.application")) return "native-android";
  if (plugins.includes("com.android.library")) return "android-library";
  if (plugins.some((plugin) => plugin.includes("multiplatform"))) return "kmp";
  return scan.detected ? "unknown" : "unknown";
}

function detectUiToolkit(scan: AndroidProjectScan): AndroidAdvancedProfile["uiToolkit"] {
  if (scan.capabilities.compose && scan.capabilities.xmlViews) return "mixed";
  if (scan.capabilities.compose) return "compose";
  if (scan.capabilities.xmlViews) return "xml-views";
  return "unknown";
}

function primaryModule(scan: AndroidProjectScan): string | null {
  return scan.modules.find((module) => module.pluginIds.includes("com.android.application"))?.path ?? scan.modules[0]?.path ?? null;
}

function architectureSignals(scan: AndroidProjectScan): string[] {
  const signals: string[] = [];
  if (scan.capabilities.multiModule) signals.push("multi-module Gradle structure");
  if (scan.capabilities.compose) signals.push("Jetpack Compose UI");
  if (scan.capabilities.xmlViews) signals.push("XML/View UI resources");
  if (scan.capabilities.hilt) signals.push("Hilt/Dagger dependency injection");
  if (scan.capabilities.room) signals.push("Room persistence");
  if (scan.capabilities.dataStore) signals.push("DataStore preferences/config");
  if (scan.capabilities.workManager) signals.push("WorkManager background work");
  if (scan.capabilities.ndk) signals.push("NDK/native code");
  if (scan.capabilities.releaseSigningConfigured) signals.push("release signing configured");
  return signals;
}

function profileRisks(scan: AndroidProjectScan): string[] {
  const risks = [...scan.warnings];
  if (scan.capabilities.compose && !scan.versions.composeCompiler && !scan.versions.kotlin) risks.push("Compose detected but Kotlin/Compose compiler compatibility could not be established.");
  if (scan.modules.some((module) => module.usesRoom) && !scan.modules.some((module) => module.hasUnitTest)) risks.push("Room detected without obvious JVM test source sets; migration coverage may be missing.");
  if (scan.capabilities.releaseSigningConfigured && !scan.recommendedVerification.some((command) => command.includes("bundleRelease"))) risks.push("Release signing exists; release packaging should be part of readiness checks.");
  return unique(risks);
}

export function buildAndroidAdvancedProfile(scan: AndroidProjectScan, changedFiles: string[] = [], diffText = ""): AndroidAdvancedProfile {
  const module = primaryModule(scan);
  const recipe = buildAndroidVerificationRecipe({ files: changedFiles, diffText, module });
  const fallbackCommands = scan.recommendedVerification.map((command) => ({ command, reason: "Baseline Android project verification from project scan." }));
  const verificationMatrix = recipe.commands.length ? recipe.commands : fallbackCommands;
  const persistentContext = unique([
    scan.detected ? `Android profile: ${detectProjectType(scan)}, module ${module ?? "unknown"}, UI ${detectUiToolkit(scan)}, language ${detectLanguage(scan)}.` : undefined,
    scan.versions.agp ? `Android AGP ${scan.versions.agp}${scan.versions.kotlin ? `, Kotlin ${scan.versions.kotlin}` : ""}.` : undefined,
    verificationMatrix.length ? `Android verification commands: ${verificationMatrix.slice(0, 3).map((item) => item.command).join(", ")}.` : undefined,
  ].filter(Boolean) as string[]);

  return {
    projectType: detectProjectType(scan),
    uiToolkit: detectUiToolkit(scan),
    language: detectLanguage(scan),
    architectureSignals: architectureSignals(scan),
    primaryModule: module,
    verificationMatrix,
    persistentContext,
    risks: profileRisks(scan),
  };
}

function command(commandText: string, reason: string, extra: Partial<AndroidVerificationCommand> = {}): AndroidVerificationCommand {
  return { command: commandText, reason, ...extra };
}

function template(kind: AndroidFlowKind, module: string | null, commands: AndroidVerificationCommand[]): AndroidFlowTemplate {
  const prefix = module ? `./gradlew ${module}:` : "./gradlew ";
  const library: Record<AndroidFlowKind, AndroidFlowTemplate> = {
    diagnose: {
      kind,
      title: "Android diagnose flow",
      triggers: ["build failure", "crash", "Gradle error", "test failure", "logcat"],
      steps: ["Scan settings/build files and module layout", "Classify failure signature before editing", "Inspect recommended files", "Apply minimal fix", "Run targeted Gradle/adb verification"],
      evidenceRequired: ["failure classification", "files inspected", "fresh verification output"],
      recommendedCommands: commands.length ? commands : [command(`${prefix}assembleDebug`, "Verify debug build after diagnosis.")],
      escalation: ["Use android_logcat for device crashes", "Ask jce-researcher for AGP/Kotlin/KSP compatibility docs", "Ask oracle after 3 failed fix attempts"],
    },
    feature: {
      kind,
      title: "Android feature flow",
      triggers: ["add feature", "implement screen", "new use case"],
      steps: ["Profile architecture boundaries", "Locate route/screen/repository extension points", "Implement state and data changes", "Add JVM tests", "Run unit + assemble verification"],
      evidenceRequired: ["architecture touchpoints", "tests added/updated", "unit/build output"],
      recommendedCommands: [command(`${prefix}testDebugUnitTest`, "Verify feature logic."), command(`${prefix}assembleDebug`, "Verify debug build.")],
      escalation: ["Use android agent for native implementation", "Use frontend only for cross-platform/web UI"],
    },
    ui: {
      kind,
      title: "Android UI flow",
      triggers: ["Compose", "XML layout", "screen", "accessibility"],
      steps: ["Locate UI state owner", "Keep composables/views deterministic", "Check accessibility semantics/resources", "Run UI-aware verification", "Capture manual/device evidence when available"],
      evidenceRequired: ["state flow reviewed", "accessibility risk reviewed", "unit or instrumentation evidence"],
      recommendedCommands: [command(`${prefix}testDebugUnitTest`, "Verify UI state logic."), command(`${prefix}connectedDebugAndroidTest`, "Verify platform UI behavior when available.", { requiresDevice: true, optional: true })],
      escalation: ["Use emulator/logcat when visual or lifecycle behavior is uncertain"],
    },
    data: {
      kind,
      title: "Android data/offline flow",
      triggers: ["Room", "DataStore", "Retrofit", "repository", "migration"],
      steps: ["Identify source of truth", "Review mapper/repository boundaries", "Protect migrations and transactions", "Add DAO/repository tests", "Run JVM tests"],
      evidenceRequired: ["migration/data risk noted", "DAO/repository test output"],
      recommendedCommands: [command(`${prefix}testDebugUnitTest`, "Verify DAO/repository/migration behavior.")],
      escalation: ["Escalate destructive migration or sync conflict design to oracle"],
    },
    release: {
      kind,
      title: "Android release readiness flow",
      triggers: ["release", "AAB", "R8", "ProGuard", "signing", "Play Console"],
      steps: ["Check versionCode/versionName", "Validate signing secret handling", "Run bundle/shrinker checks", "Audit permissions and backup policy", "Report release blockers"],
      evidenceRequired: ["bundleRelease output", "lintVitalRelease output", "signing/secrets review"],
      recommendedCommands: [command(`${prefix}bundleRelease`, "Verify release bundle packaging.", { releaseSensitive: true }), command(`${prefix}lintVitalRelease`, "Catch release-only Android issues.", { releaseSensitive: true })],
      escalation: ["Do not modify signing/minSdk/targetSdk without explicit confirmation"],
    },
    performance: {
      kind,
      title: "Android performance flow",
      triggers: ["slow", "jank", "ANR", "startup", "build performance"],
      steps: ["Identify measured bottleneck", "Separate runtime vs build performance", "Apply minimal optimization", "Verify with repeatable metric", "Document remaining risks"],
      evidenceRequired: ["baseline metric or failure signal", "post-change metric/verification"],
      recommendedCommands: [command(`${prefix}assembleDebug --profile`, "Collect Gradle build profile when build speed is the issue.", { optional: true })],
      escalation: ["Use oracle for systemic jank/ANR architecture decisions"],
    },
    security: {
      kind,
      title: "Android security/privacy flow",
      triggers: ["permission", "exported", "WebView", "token", "cleartext", "privacy"],
      steps: ["Audit manifest exported components and permissions", "Scan network security and WebView bridges", "Check secret/token storage", "Run manifest/lint verification", "Report privacy/security risks"],
      evidenceRequired: ["manifest/security files reviewed", "lint or manifest processing output"],
      recommendedCommands: [command(`${prefix}processDebugMainManifest`, "Validate manifest security-sensitive merge behavior."), command(`${prefix}lintDebug`, "Run Android lint for security/privacy checks.")],
      escalation: ["Escalate auth/crypto/storage policy decisions to security/auth specialist"],
    },
  };
  return library[kind];
}

export function selectAndroidFlowKinds(input: AndroidAdvancedFlowInput, failure?: AndroidFailureClassification): AndroidFlowKind[] {
  const corpus = `${input.prompt ?? ""}\n${input.changedFiles?.join("\n") ?? ""}\n${input.diffText ?? ""}`.toLowerCase();
  const kinds = new Set<AndroidFlowKind>();
  if (failure?.detected || /fix|bug|error|crash|fail|diagnos|logcat|gradle/.test(corpus)) kinds.add("diagnose");
  if (/feature|add|implement|buat|tambah/.test(corpus)) kinds.add("feature");
  if (/compose|@composable|layout|ui|screen|accessibility|a11y/.test(corpus)) kinds.add("ui");
  if (/room|datastore|retrofit|repository|dao|migration|offline|api/.test(corpus)) kinds.add("data");
  if (/release|aab|apk|r8|proguard|signing|play console|versioncode/.test(corpus)) kinds.add("release");
  if (/slow|performance|jank|anr|startup|optimi[sz]e/.test(corpus)) kinds.add("performance");
  if (/security|permission|exported|webview|token|secret|cleartext|privacy/.test(corpus)) kinds.add("security");
  if (kinds.size === 0) kinds.add("diagnose");
  return [...kinds];
}

function environmentFindings(env: AndroidEnvironmentFacts | undefined): string[] {
  if (!env) return ["Android environment facts were not provided; verify JDK, Android SDK, Gradle wrapper, and adb before device flows."];
  const findings: string[] = [];
  if (!env.javaHome) findings.push("JAVA_HOME was not reported; Gradle/AGP may fail if Java toolchain is unavailable.");
  if (!env.androidHome && !env.androidSdkRoot) findings.push("ANDROID_HOME/ANDROID_SDK_ROOT were not reported; SDK platform resolution may fail.");
  if (env.adbAvailable === false) findings.push("adb is unavailable; logcat/install/instrumentation flows are blocked.");
  if (env.adbAvailable && (env.authorizedDeviceCount ?? 0) === 0) findings.push("adb is available but no authorized device/emulator was reported.");
  return findings;
}

export function buildAndroidAdvancedFlow(input: AndroidAdvancedFlowInput): AndroidAdvancedFlowReport {
  const scan = scanAndroidProject(input.root);
  const failure = input.failureLog ? classifyAndroidFailure(input.failureLog) : undefined;
  const profile = buildAndroidAdvancedProfile(scan, input.changedFiles, input.diffText);
  const selectedFlows = selectAndroidFlowKinds(input, failure).map((kind) => template(kind, profile.primaryModule, profile.verificationMatrix));
  const nextActions = unique([
    scan.detected ? "Persist Android profile facts in project context for future sessions." : "Confirm this is an Android project; scanner did not detect Android build files.",
    failure?.detected ? `Triage ${failure.kind} using classifier evidence before patching.` : undefined,
    ...selectedFlows.flatMap((flow) => flow.recommendedCommands.slice(0, 2).map((item) => `Run: ${item.command} — ${item.reason}`)),
  ].filter(Boolean) as string[]);

  return {
    profile,
    scan,
    environmentFindings: environmentFindings(input.environment),
    failure,
    selectedFlows,
    nextActions,
  };
}
