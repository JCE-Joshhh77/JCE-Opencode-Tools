/**
 * Skill Security Scanner — supply-chain defense for malicious skills.
 *
 * Threat model: a skill is a Markdown instruction file injected into the system
 * prompt. A malicious skill cannot exfiltrate data itself; instead it embeds
 * directives that try to make the AI exfiltrate via other tools (bash/webfetch),
 * read secrets, or silently disobey the user (prompt injection).
 *
 * Design: keyword-only scanning is useless here — legit skills mention `.env`,
 * `secret`, `token` hundreds of times and use `curl` in install examples. We
 * therefore score by SIGNAL COMBINATIONS (egress + secret-source + stealth/
 * injection language), which is what actually distinguishes an attack from
 * normal security documentation. Pure module: callers pass file text.
 */

export type SkillRiskSeverity = "info" | "warning" | "critical";

export interface SkillSecuritySignal {
  id: string;
  severity: SkillRiskSeverity;
  message: string;
  evidence?: string;
}

export interface SkillSecurityResult {
  name: string;
  path?: string;
  /** 0 = clean, higher = riskier. */
  riskScore: number;
  /** true when riskScore crosses the block threshold. */
  blocked: boolean;
  signals: SkillSecuritySignal[];
}

export interface SkillSecurityReport {
  total: number;
  flagged: number;
  blocked: number;
  results: SkillSecurityResult[];
}

/** riskScore at/above this is treated as malicious and blocked from injection. */
export const SKILL_BLOCK_THRESHOLD = 60;

// Trusted hosts that legit skills reference in docs/install examples. A URL to
// one of these does NOT count as suspicious egress.
// The regex must only match a trusted host when the host label actually ENDS
// there — anchored with (?=[/:?#]|$) — and must be extracted from the URL's
// authority component, otherwise lookalike domains (github.com.attacker.io)
// and trusted-host mentions in query strings (evil.io/?ref=github.com) would
// be treated as trusted and bypass the exfiltration detector.
const TRUSTED_HOSTS = new Set([
  "github.com",
  "githubusercontent.com",
  "npmjs.com",
  "nodejs.org",
  "astral.sh",
  "python.org",
  "pypi.org",
  "crates.io",
  "go.dev",
  "golang.org",
  "rust-lang.org",
  "docker.com",
  "kubernetes.io",
  "developer.android.com",
  "kotlinlang.org",
  "gradle.org",
  "developer.mozilla.org",
  "w3.org",
  "opencode.ai",
  "anthropic.com",
  "example.com",
  "example.org",
  "localhost",
  "127.0.0.1",
]);

/** Exact-host check (supports subdomains of trusted roots, e.g. raw.githubusercontent.com). */
function isTrustedUrl(raw: string): boolean {
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (TRUSTED_HOSTS.has(host)) return true;
  const dot = host.lastIndexOf(".");
  if (dot <= 0) return false;
  const parent = host.slice(dot + 1);
  const rest = host.slice(0, dot);
  // Allow any subdomain of a trusted root (githubusercontent.com etc.), but
  // NOT lookalikes such as github.com.attacker.io (that is a subdomain of
  // attacker.io, not of a trusted root).
  const labels = rest.split(".");
  for (let i = 0; i < labels.length; i++) {
    if (TRUSTED_HOSTS.has(labels.slice(i).join(".") + "." + parent)) return true;
  }
  return false;
}

const TRUSTED_HOST = {
  test: (url: string): boolean => isTrustedUrl(url),
};

function truncate(value: string, max = 120): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Lines that look like outbound network calls to a NON-trusted destination. */
function findSuspiciousEgress(text: string): string[] {
  const hits: string[] = [];
  const urlRe = /\bhttps?:\/\/[^\s"'`)]+/gi;
  const cmdRe = /\b(curl|wget|Invoke-WebRequest|iwr|nc|netcat|scp|rsync|ftp)\b/i;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const urls = line.match(urlRe) ?? [];
    const externalUrl = urls.find((u) => !TRUSTED_HOST.test(u));
    const hasCmd = cmdRe.test(line);
    // Egress is suspicious when: an external URL is POSTed/piped/fetched, OR a
    // network command targets an external/variable host.
    if (externalUrl && /\b(POST|--data|-d\b|--upload|-T\b|fetch\(|axios|XMLHttpRequest|sendBeacon)\b/i.test(line)) {
      hits.push(truncate(line));
    } else if (hasCmd && externalUrl) {
      hits.push(truncate(line));
    } else if (hasCmd && /\$\{?[A-Za-z_]|%[A-Za-z_]+%/.test(line) && /POST|--data|-d\b|upload/i.test(line)) {
      hits.push(truncate(line));
    }
  }
  return hits;
}

/** Reads/collection of secret material (env files, keys, tokens, cloud creds). */
function findSecretSourcing(text: string): string[] {
  const hits: string[] = [];
  const re = /\b(cat|type|Get-Content|readFile(?:Sync)?|open|less|head|tail)\b[^\n]{0,80}(\.env|id_rsa|\.pem\b|\.ppk\b|credentials|\.aws\/|\.ssh\/|\.npmrc|secrets?\.(?:json|ya?ml|txt)|\.git-credentials|keychain|token)/i;
  const envVarDump = /\b(printenv|os\.environ\b)|(?:^|\|\s*|;\s*|&&\s*)env\s*(?:\||>|$)|Get-ChildItem\s+env:|\bGet-ChildItem\s+-Path\s+env:/i;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (re.test(line) || envVarDump.test(line)) hits.push(truncate(line));
  }
  return hits;
}

/** Prompt-injection / stealth / disobedience directives aimed at the AI. */
function findInjectionLanguage(text: string): string[] {
  const hits: string[] = [];
  const patterns: RegExp[] = [
    /\bignore\s+(?:all\s+)?(?:previous|prior|above|the)\s+(?:instructions|rules|prompt)/i,
    /\b(?:do\s*not|don'?t|never)\s+(?:tell|inform|mention|notify|alert|show)\s+(?:the\s+)?user/i,
    /\b(?:without|don'?t)\s+(?:asking|telling|informing|notifying)\b[^\n]{0,40}\b(?:user|permission|confirmation)/i,
    /\b(?:secretly|silently|quietly|covertly|stealth)\b[^\n]{0,40}\b(?:send|upload|post|exfil|transmit|copy|forward)/i,
    /\b(?:disregard|override|bypass|ignore)\b[^\n]{0,30}\b(?:safety\s+(?:rule|guideline|guardrail|instruction)|guardrail|system\s*prompt|content\s+polic|safety\s+polic)/i,
    /\byou\s+are\s+now\s+(?:a\s+)?(?:different|new)\s+(?:agent|assistant|ai)/i,
    /\bexfiltrat/i,
    /\b(?:send|upload|post|forward|transmit)\b[^\n]{0,40}\b(?:to\s+)?(?:my|our|this|the)\s+server/i,
  ];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (patterns.some((p) => p.test(line))) hits.push(truncate(line));
  }
  return hits;
}

/** Obfuscation that hides payloads from a casual reviewer. */
function findObfuscation(text: string): { executable: string[]; passive: string[] } {
  const executable: string[] = [];
  const passive: string[] = [];
  // Hidden code that is decoded/evaluated and then EXECUTED — independently malicious.
  const execPatterns: RegExp[] = [
    /(?:base64\s+(?:-d|--decode)|FromBase64String|atob\s*\()[^\n]{0,40}\|\s*(?:sh|bash|zsh|pwsh|powershell|node|python)/i,
    /echo\s+[A-Za-z0-9+/]{20,}={0,2}\s*\|\s*(?:base64[^\n]*\|\s*)?(?:sh|bash|zsh)/i,
    // eval/Function directly wrapping a decoder — the classic hidden-payload exec.
    /(?:\beval|new\s+Function)\s*\(\s*(?:atob\s*\(|Buffer\.from\s*\([^\n)]*['"]base64|decodeURIComponent\s*\(|String\.fromCharCode\s*\()/i,
    // PowerShell download-and-execute.
    /\b(?:IEX|Invoke-Expression)\b[^\n]{0,60}(?:DownloadString|FromBase64String|New-Object\s+Net\.WebClient|http)/i,
  ];
  // Passive obfuscation: long encoded blob with no obvious execution (weaker signal).
  // Threshold is 300 chars (not 120) to avoid false-positives on legitimate base64
  // content such as embedded fonts, JWT examples, or image data URIs in skill docs.
  const passivePatterns: RegExp[] = [
    /[A-Za-z0-9+/]{300,}={0,2}/,
    /(?:\\x[0-9a-f]{2}){20,}/i,
  ];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (execPatterns.some((p) => p.test(line))) executable.push(truncate(line));
    else if (passivePatterns.some((p) => p.test(line))) passive.push(truncate(line));
  }
  return { executable, passive };
}

/**
 * Scan a single skill's raw text. Scoring is combination-weighted: a lone signal
 * is low risk (legit docs), but egress + secret-sourcing, or any injection/
 * exfiltration directive, escalates fast toward the block threshold.
 */
export function scanSkillContent(name: string, text: string, path?: string): SkillSecurityResult {
  const egress = findSuspiciousEgress(text);
  const secrets = findSecretSourcing(text);
  const injection = findInjectionLanguage(text);
  const obfuscation = findObfuscation(text);

  const signals: SkillSecuritySignal[] = [];
  let score = 0;

  if (injection.length) {
    score += 50 + Math.min(injection.length - 1, 3) * 10;
    signals.push({ id: "prompt-injection", severity: "critical", message: `Prompt-injection / stealth directive aimed at the AI (${injection.length}).`, evidence: injection[0] });
  }
  if (egress.length && secrets.length) {
    score += 60;
    signals.push({ id: "exfil-combo", severity: "critical", message: "Reads sensitive data AND sends it to an external/variable destination.", evidence: `${secrets[0]} || ${egress[0]}` });
  } else {
    if (egress.length) {
      score += 25 + Math.min(egress.length - 1, 3) * 5;
      signals.push({ id: "suspicious-egress", severity: "warning", message: `Outbound network call to a non-trusted destination (${egress.length}).`, evidence: egress[0] });
    }
    if (secrets.length) {
      score += 20 + Math.min(secrets.length - 1, 3) * 5;
      signals.push({ id: "secret-sourcing", severity: "warning", message: `Reads secret material such as .env/keys/credentials (${secrets.length}).`, evidence: secrets[0] });
    }
  }
  if (obfuscation.executable.length) {
    score += 60 + Math.min(obfuscation.executable.length - 1, 3) * 10;
    signals.push({ id: "obfuscation", severity: "critical", message: `Obfuscated payload decoded and EXECUTED, hiding intent from review (${obfuscation.executable.length}).`, evidence: obfuscation.executable[0] });
  }
  if (obfuscation.passive.length) {
    score += 20 + Math.min(obfuscation.passive.length - 1, 3) * 5;
    signals.push({ id: "obfuscation-blob", severity: "warning", message: `Large encoded/hex blob with hidden content (${obfuscation.passive.length}).`, evidence: obfuscation.passive[0] });
  }

  const riskScore = Math.min(100, score);
  return { name, path, riskScore, blocked: riskScore >= SKILL_BLOCK_THRESHOLD, signals };
}

/** Aggregate scan over many skills (name + text pairs). */
export function scanSkills(skills: Array<{ name: string; text: string; path?: string }>): SkillSecurityReport {
  const results = skills
    .map((s) => scanSkillContent(s.name, s.text, s.path))
    .sort((a, b) => b.riskScore - a.riskScore || a.name.localeCompare(b.name));
  return {
    total: results.length,
    flagged: results.filter((r) => r.signals.length > 0).length,
    blocked: results.filter((r) => r.blocked).length,
    results,
  };
}
