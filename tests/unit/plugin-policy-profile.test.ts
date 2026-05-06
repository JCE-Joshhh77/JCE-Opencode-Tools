import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  clearSessionPolicyProfile,
  getJceWorkerConfigPath,
  resolvePolicyProfile,
  saveProjectPolicyProfile,
  saveSessionPolicyProfile,
} from "../../src/plugin/lib/policy-profile.ts";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "opencode-jce-policy-profile-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("JCE-Worker policy profile config", () => {
  test("defaults to balanced when no config exists", () => {
    expect(resolvePolicyProfile(tempRoot())).toEqual({ profile: "balanced", source: "default" });
  });

  test("command override wins over session and project settings", () => {
    const root = tempRoot();
    saveProjectPolicyProfile(root, "strict");
    saveSessionPolicyProfile(root, "fast");

    expect(resolvePolicyProfile(root, "balanced")).toEqual({ profile: "balanced", source: "command" });
  });

  test("session override wins over project setting", () => {
    const root = tempRoot();
    saveProjectPolicyProfile(root, "strict");
    saveSessionPolicyProfile(root, "fast");

    expect(resolvePolicyProfile(root)).toEqual({ profile: "fast", source: "session" });
  });

  test("project setting is used when no command or session override exists", () => {
    const root = tempRoot();
    saveProjectPolicyProfile(root, "strict");

    expect(resolvePolicyProfile(root)).toEqual({ profile: "strict", source: "project" });
  });

  test("clears session override without removing project default", () => {
    const root = tempRoot();
    saveProjectPolicyProfile(root, "strict");
    saveSessionPolicyProfile(root, "fast");

    clearSessionPolicyProfile(root);

    expect(resolvePolicyProfile(root)).toEqual({ profile: "strict", source: "project" });
    expect(JSON.parse(readFileSync(getJceWorkerConfigPath(root), "utf-8"))).toEqual({ policyProfile: "strict" });
  });

  test("ignores malformed config values and falls back safely", () => {
    const root = tempRoot();
    saveProjectPolicyProfile(root, "strict");
    const path = getJceWorkerConfigPath(root);
    expect(existsSync(path)).toBe(true);
    writeFileSync(path, JSON.stringify({ policyProfile: "invalid", sessionPolicyProfile: "also-invalid" }), "utf-8");

    expect(resolvePolicyProfile(root)).toEqual({ profile: "balanced", source: "default" });
  });
});
