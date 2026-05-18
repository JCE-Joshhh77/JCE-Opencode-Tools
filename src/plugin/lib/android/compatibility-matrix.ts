import type { AndroidProjectScan } from "./project-scanner.js";
import type { AndroidEnvironmentProbe } from "./environment-probe.js";

export interface AndroidCompatibilityFinding { severity: "ok" | "warning" | "error"; area: string; message: string; recommendation: string }

function major(version?: string): number | null { const match = version?.match(/^(\d+)/); return match ? Number(match[1]) : null; }

export function assessAndroidCompatibility(scan: AndroidProjectScan, env?: AndroidEnvironmentProbe): AndroidCompatibilityFinding[] {
  const findings: AndroidCompatibilityFinding[] = [];
  const agpMajor = major(scan.versions.agp);
  const gradleMajor = major(scan.versions.gradleWrapper);
  if (scan.versions.agp && scan.versions.gradleWrapper) {
    if (agpMajor && agpMajor >= 8 && gradleMajor && gradleMajor < 8) findings.push({ severity: "error", area: "AGP/Gradle", message: `AGP ${scan.versions.agp} usually requires Gradle 8.x+.`, recommendation: "Upgrade Gradle wrapper or align AGP to supported Gradle version." });
    else findings.push({ severity: "ok", area: "AGP/Gradle", message: `AGP ${scan.versions.agp} and Gradle ${scan.versions.gradleWrapper} are declared.`, recommendation: "Verify with ./gradlew projects." });
  }
  if (scan.versions.kotlin && scan.versions.ksp && !scan.versions.ksp.startsWith(scan.versions.kotlin)) findings.push({ severity: "warning", area: "Kotlin/KSP", message: `Kotlin ${scan.versions.kotlin} and KSP ${scan.versions.ksp} may be misaligned.`, recommendation: "Use a KSP artifact matching the Kotlin version prefix." });
  const kotlinMajor = major(scan.versions.kotlin);
  if (scan.capabilities.compose && kotlinMajor !== null && kotlinMajor >= 2 && scan.versions.composeCompiler && major(scan.versions.composeCompiler) === 1) findings.push({ severity: "warning", area: "Compose Compiler", message: "Kotlin 2.x with legacy Compose compiler version detected.", recommendation: "Use the Compose compiler Gradle plugin for Kotlin 2.x or verify compatibility explicitly." });
  const javaVersion = env?.java.version?.match(/version "?(\d+)/)?.[1];
  if (agpMajor && agpMajor >= 8 && javaVersion && Number(javaVersion) < 17) findings.push({ severity: "error", area: "JDK", message: `AGP ${scan.versions.agp} requires a modern JDK; detected Java ${javaVersion}.`, recommendation: "Use JDK 17+ for AGP 8.x projects." });
  for (const module of scan.modules) {
    const target = Number(module.targetSdk ?? 0);
    if (target && target < 34) findings.push({ severity: "warning", area: "Play targetSdk", message: `${module.path} targetSdk ${target} may be below current Play policy expectations.`, recommendation: "Review current Play target API requirements before release." });
    const compile = Number(module.compileSdk ?? 0);
    if (target && compile && target > compile) findings.push({ severity: "error", area: "SDK", message: `${module.path} targetSdk is greater than compileSdk.`, recommendation: "Set compileSdk >= targetSdk." });
  }
  if (findings.length === 0 && scan.detected) findings.push({ severity: "ok", area: "Android", message: "No obvious Android compatibility risks detected from static scan.", recommendation: "Run planned Gradle verification commands." });
  return findings;
}
