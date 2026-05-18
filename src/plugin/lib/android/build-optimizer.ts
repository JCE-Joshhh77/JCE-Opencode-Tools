import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AndroidProjectScan } from "./project-scanner.js";

export interface AndroidBuildOptimizationFinding { impact: "low" | "medium" | "high"; area: string; message: string; recommendation: string }
function read(path: string): string { return existsSync(path) ? readFileSync(path, "utf8") : ""; }

export function analyzeAndroidBuildOptimization(scan: AndroidProjectScan): AndroidBuildOptimizationFinding[] {
  const findings: AndroidBuildOptimizationFinding[] = [];
  const properties = read(join(scan.root, "gradle.properties"));
  if (!/org\.gradle\.configuration-cache\s*=\s*true/.test(properties)) findings.push({ impact: "high", area: "configuration-cache", message: "Gradle configuration cache is not enabled.", recommendation: "Enable after verifying plugin compatibility: org.gradle.configuration-cache=true." });
  if (!/org\.gradle\.caching\s*=\s*true/.test(properties)) findings.push({ impact: "medium", area: "build-cache", message: "Gradle build cache is not enabled.", recommendation: "Enable org.gradle.caching=true for repeat builds/CI." });
  if (scan.modules.some((module) => module.usesKapt)) findings.push({ impact: "high", area: "kapt", message: "KAPT detected; annotation processing may slow builds.", recommendation: "Prefer KSP for Room/Hilt-compatible processors where safe." });
  if (scan.modules.some((module) => module.usesKsp && module.usesKapt)) findings.push({ impact: "medium", area: "mixed-processors", message: "A module mixes KSP and KAPT.", recommendation: "Review generated-code processors and migrate incrementally." });
  if (!scan.versionCatalogs.length) findings.push({ impact: "medium", area: "versions", message: "No version catalog detected.", recommendation: "Centralize versions in gradle/libs.versions.toml." });
  for (const module of scan.modules) {
    const text = read(join(module.directory, "build.gradle.kts")) || read(join(module.directory, "build.gradle"));
    if (/\+['"]/.test(text)) findings.push({ impact: "high", area: "dynamic-versions", message: `${module.path} uses dynamic dependency versions.`, recommendation: "Pin versions for reproducible builds." });
    if (/\bapi\(/.test(text)) findings.push({ impact: "low", area: "api-dependencies", message: `${module.path} exposes api dependencies.`, recommendation: "Prefer implementation unless consumers need transitive API exposure." });
  }
  return findings;
}
