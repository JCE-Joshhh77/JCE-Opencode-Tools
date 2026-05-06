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
  test("resolves any role to a model config with provider and model", () => {
    const result = resolveAgentModel("jce-worker");
    expect(result.provider).toBeDefined();
    expect(result.model).toBeDefined();
    expect(typeof result.provider).toBe("string");
    expect(typeof result.model).toBe("string");
  });

  test("returns fallback for unknown role", () => {
    const result = resolveAgentModel("unknown-role");
    expect(result).toBeDefined();
    expect(typeof result.provider).toBe("string");
    expect(typeof result.model).toBe("string");
    expect(result.provider.length).toBeGreaterThan(0);
    expect(result.model.length).toBeGreaterThan(0);
  });

  test("all known roles resolve without error", () => {
    const roles = ["jce-worker", "oracle", "jce-researcher", "explorer", "frontend"];
    for (const role of roles) {
      const result = resolveAgentModel(role);
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
