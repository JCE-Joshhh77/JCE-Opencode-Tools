import type { AndroidProjectScan } from "./project-scanner.js";
import { auditAndroidSecurity, type AndroidSecurityFinding } from "./security-auditor.js";

export interface AndroidReleaseReadiness { ready: boolean; checks: { status: "pass" | "warning" | "fail"; name: string; message: string }[]; securityFindings: AndroidSecurityFinding[]; commands: string[] }

export function assessAndroidReleaseReadiness(scan: AndroidProjectScan): AndroidReleaseReadiness {
  const app = scan.modules.find((module) => module.pluginIds.includes("com.android.application"));
  const checks: AndroidReleaseReadiness["checks"] = [];
  checks.push(app ? { status: "pass", name: "application-module", message: `Application module ${app.path} detected.` } : { status: "fail", name: "application-module", message: "No Android application module detected." });
  checks.push(scan.capabilities.releaseSigningConfigured ? { status: "warning", name: "signing", message: "Release signing is configured; verify secrets are not committed and CI injects credentials." } : { status: "warning", name: "signing", message: "Release signing config not detected by static scan." });
  if (app?.targetSdk) checks.push(Number(app.targetSdk) >= 34 ? { status: "pass", name: "target-sdk", message: `targetSdk ${app.targetSdk} detected.` } : { status: "warning", name: "target-sdk", message: `targetSdk ${app.targetSdk} may be below Play requirements.` });
  else checks.push({ status: "fail", name: "target-sdk", message: "targetSdk could not be resolved." });
  const securityFindings = auditAndroidSecurity(scan);
  for (const finding of securityFindings.filter((item) => item.severity === "error")) checks.push({ status: "fail", name: `security:${finding.rule}`, message: finding.message });
  const module = app?.path ?? ":app";
  const commands = [`./gradlew ${module}:bundleRelease`, `./gradlew ${module}:lintVitalRelease`];
  return { ready: checks.every((check) => check.status !== "fail"), checks, securityFindings, commands };
}
