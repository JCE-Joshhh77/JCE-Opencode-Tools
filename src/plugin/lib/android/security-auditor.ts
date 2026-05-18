import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AndroidProjectScan } from "./project-scanner.js";

export interface AndroidSecurityFinding { severity: "info" | "warning" | "error"; rule: string; file: string; message: string; recommendation: string }
function read(path: string): string { return existsSync(path) ? readFileSync(path, "utf8") : ""; }

export function auditAndroidSecurity(scan: AndroidProjectScan): AndroidSecurityFinding[] {
  const findings: AndroidSecurityFinding[] = [];
  for (const module of scan.modules) {
    const manifestPath = join(module.directory, "src", "main", "AndroidManifest.xml");
    const manifest = read(manifestPath);
    if (!manifest) continue;
    if (/android:allowBackup\s*=\s*["']true["']/i.test(manifest)) findings.push({ severity: "warning", rule: "allow-backup", file: manifestPath, message: "Application backup is enabled.", recommendation: "Confirm backup/data-extraction policy for sensitive data." });
    if (/android:usesCleartextTraffic\s*=\s*["']true["']/i.test(manifest)) findings.push({ severity: "error", rule: "cleartext", file: manifestPath, message: "Cleartext traffic is enabled in manifest.", recommendation: "Disable for release or restrict via network security config." });
    if (/<(activity|service|receiver)[\s\S]*android:exported\s*=\s*["']true["'][\s\S]*<intent-filter/i.test(manifest)) findings.push({ severity: "warning", rule: "exported-component", file: manifestPath, message: "Exported component with intent-filter detected.", recommendation: "Verify permissions/deep-link host validation and exported necessity." });
    if (/READ_CONTACTS|ACCESS_FINE_LOCATION|RECORD_AUDIO|READ_SMS|CAMERA/.test(manifest)) findings.push({ severity: "info", rule: "dangerous-permission", file: manifestPath, message: "Dangerous permission declared.", recommendation: "Verify runtime permission UX and data-safety disclosure." });
    const networkConfig = manifest.match(/android:networkSecurityConfig\s*=\s*["']@xml\/([^"']+)/)?.[1];
    if (networkConfig) {
      const networkPath = join(module.directory, "src", "main", "res", "xml", `${networkConfig}.xml`);
      if (/cleartextTrafficPermitted\s*=\s*["']true["']/i.test(read(networkPath))) findings.push({ severity: "warning", rule: "network-cleartext", file: networkPath, message: "Network security config permits cleartext traffic.", recommendation: "Limit cleartext to debug-only domains or remove for release." });
    }
  }
  return findings;
}
