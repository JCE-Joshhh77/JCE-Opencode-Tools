import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resolveAgentModel } from "../../src/plugin/lib/profile-resolver.ts";

const originalXdg = process.env.XDG_CONFIG_HOME;

function tempConfigDir(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `opencode-jce-${name}-`));
  const configDir = join(root, "opencode");
  mkdirSync(configDir, { recursive: true });
  process.env.XDG_CONFIG_HOME = root;
  return configDir;
}

afterEach(() => {
  if (process.env.XDG_CONFIG_HOME?.includes("opencode-jce-")) {
    rmSync(process.env.XDG_CONFIG_HOME, { recursive: true, force: true });
  }
  if (originalXdg === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = originalXdg;
  }
});

describe("profile resolver", () => {
  test("resolves configured providers for known roles when available", () => {
    const configDir = tempConfigDir("known-role-provider");
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify({
      provider: {
        enowxlabs: {
          models: {
            "gpt-5.5": { name: "gpt-5.5" },
          },
        },
      },
    }), "utf-8");

    const result = resolveAgentModel("jce-worker");
    expect(result).toEqual({ provider: "enowxlabs", model: "gpt-5.5" });
  });

  test("returns null when no profiles or configured providers exist", () => {
    tempConfigDir("no-provider-models");
    writeFileSync(join(process.env.XDG_CONFIG_HOME!, "opencode", "opencode.json"), JSON.stringify({}), "utf-8");

    const result = resolveAgentModel("jce-worker");
    expect(result).toBeNull();
  });

  test("returns configured provider for unknown role when available", () => {
    const configDir = tempConfigDir("unknown-role-provider");
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify({
      provider: {
        enowxlabs: {
          models: {
            "gpt-5.5": { name: "gpt-5.5" },
          },
        },
      },
    }), "utf-8");

    const result = resolveAgentModel("unknown-role");
    expect(result).not.toBeNull();
    if (!result) throw new Error("Expected configured provider model for unknown role");
    expect(result.provider).toBeDefined();
    expect(result.model).toBeDefined();
    expect(typeof result.provider).toBe("string");
    expect(typeof result.model).toBe("string");
  });

  test("all known roles resolve without error", () => {
    const configDir = tempConfigDir("all-known-roles");
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify({
      provider: {
        enowxlabs: {
          models: {
            "gpt-5.5": { name: "gpt-5.5" },
          },
        },
      },
    }), "utf-8");

    const roles = ["jce-worker", "oracle", "jce-researcher", "explorer", "frontend"];
    for (const role of roles) {
      const result = resolveAgentModel(role);
      expect(result).not.toBeNull();
      if (!result) throw new Error(`Expected model for role ${role}`);
      expect(result.provider).toBeDefined();
      expect(result.model).toBeDefined();
    }
  });

  test("prefers configured provider models over stale profile fallbacks", () => {
    const configDir = tempConfigDir("provider-models");
    mkdirSync(join(configDir, "profiles"), { recursive: true });
    writeFileSync(join(configDir, "profiles", "budget.json"), JSON.stringify({
      provider: "openai",
      model: "gpt-4o-mini",
    }), "utf-8");
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify({
      provider: {
        enowxlabs: {
          models: {
            "gpt-5.5": { name: "gpt-5.5 (enowX Labs)" },
            "gpt-5.4": { name: "gpt-5.4 (enowX Labs)" },
          },
        },
      },
    }), "utf-8");

    expect(resolveAgentModel("jce-worker")).toEqual({ provider: "enowxlabs", model: "gpt-5.5" });
  });
});
