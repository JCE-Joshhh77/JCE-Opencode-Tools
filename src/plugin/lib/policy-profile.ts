import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { PolicyProfile } from "./verification-gate.js";

export type PolicyProfileSource = "command" | "session" | "project" | "default";

export interface PolicyProfileResolution {
  profile: PolicyProfile;
  source: PolicyProfileSource;
}

interface JceWorkerConfig {
  policyProfile?: PolicyProfile;
  sessionPolicyProfile?: PolicyProfile;
}

const VALID_PROFILES = new Set<PolicyProfile>(["strict", "balanced", "fast"]);

export function isPolicyProfile(value: unknown): value is PolicyProfile {
  return typeof value === "string" && VALID_PROFILES.has(value as PolicyProfile);
}

export function getJceWorkerConfigPath(projectRoot: string): string {
  return join(projectRoot, ".opencode-jce", "jce-worker-config.json");
}

function readJceWorkerConfig(projectRoot: string): JceWorkerConfig {
  const path = getJceWorkerConfigPath(projectRoot);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    return {
      policyProfile: isPolicyProfile(parsed.policyProfile) ? parsed.policyProfile : undefined,
      sessionPolicyProfile: isPolicyProfile(parsed.sessionPolicyProfile) ? parsed.sessionPolicyProfile : undefined,
    };
  } catch {
    return {};
  }
}

function writeJceWorkerConfig(projectRoot: string, config: JceWorkerConfig): void {
  const path = getJceWorkerConfigPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

export function resolvePolicyProfile(projectRoot: string, commandOverride?: unknown): PolicyProfileResolution {
  if (isPolicyProfile(commandOverride)) return { profile: commandOverride, source: "command" };
  const config = readJceWorkerConfig(projectRoot);
  if (config.sessionPolicyProfile) return { profile: config.sessionPolicyProfile, source: "session" };
  if (config.policyProfile) return { profile: config.policyProfile, source: "project" };
  return { profile: "balanced", source: "default" };
}

export function saveProjectPolicyProfile(projectRoot: string, profile: PolicyProfile): void {
  const config = readJceWorkerConfig(projectRoot);
  writeJceWorkerConfig(projectRoot, { ...config, policyProfile: profile });
}

export function saveSessionPolicyProfile(projectRoot: string, profile: PolicyProfile): void {
  const config = readJceWorkerConfig(projectRoot);
  writeJceWorkerConfig(projectRoot, { ...config, sessionPolicyProfile: profile });
}

export function clearSessionPolicyProfile(projectRoot: string): void {
  const config = readJceWorkerConfig(projectRoot);
  const { sessionPolicyProfile: _sessionPolicyProfile, ...next } = config;
  writeJceWorkerConfig(projectRoot, next);
}
