import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { generateAnalytics } from "../../src/lib/analytics.ts";
import { analyzeCostOptimizations } from "../../src/lib/optimizer.ts";
import { commitTeamWrites, pullTeamConfig, pushTeamConfig } from "../../src/lib/team.ts";
import type { Profile } from "../../src/types.ts";

const originalSpawn = Bun.spawn;
const originalXdg = process.env.XDG_CONFIG_HOME;
const roots: string[] = [];

afterEach(() => {
  Bun.spawn = originalSpawn;
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdg;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setupTeam(name: string): { configDir: string; lastSync: string } {
  const root = join(tmpdir(), `opencode-jce-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const configDir = join(root, "opencode");
  const lastSync = "2025-01-01T00:00:00.000Z";
  roots.push(root);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "opencode.json"), "{}\n");
  writeFileSync(join(configDir, "team.json"), JSON.stringify({ repoUrl: "https://github.com/acme/config.git", branch: "main", lastSync }));
  process.env.XDG_CONFIG_HOME = root;
  return { configDir, lastSync };
}

function processResult(exitCode: number, stderr = "") {
  return { exited: Promise.resolve(exitCode), exitCode, stdout: new Blob([""]).stream(), stderr: new Blob([stderr]).stream() } as ReturnType<typeof Bun.spawn>;
}

describe("core regressions", () => {
  test("team pull rejects an invalid snapshot before writes or lastSync mutation", async () => {
    const { configDir, lastSync } = setupTeam("pull-atomic");
    const originalAgents = '{"agents":[{"id":"local"}]}\n';
    writeFileSync(join(configDir, "agents.json"), originalAgents);
    Bun.spawn = ((cmd: string[]) => {
      const cloneDir = cmd.at(-1)!;
      mkdirSync(cloneDir, { recursive: true });
      writeFileSync(join(cloneDir, "agents.json"), '{"agents":[{"id":"remote"}]}\n');
      writeFileSync(join(cloneDir, "mcp.json"), "{invalid\n");
      return processResult(0);
    }) as typeof Bun.spawn;

    const result = await pullTeamConfig();

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid JSON in team snapshot: mcp.json");
    expect(readFileSync(join(configDir, "agents.json"), "utf-8")).toBe(originalAgents);
    expect(JSON.parse(readFileSync(join(configDir, "team.json"), "utf-8")).lastSync).toBe(lastSync);
    expect(readdirSync(configDir).some((file) => file.includes(".team-backup-"))).toBe(false);
  });

  test("team writes roll back all destinations when commit fails", async () => {
    const { configDir } = setupTeam("pull-write-failure");
    const agentsPath = join(configDir, "agents.json");
    const mcpPath = join(configDir, "mcp.json");
    writeFileSync(agentsPath, "local agents\n");
    writeFileSync(mcpPath, "local mcp\n");
    let renames = 0;

    await expect(commitTeamWrites([
      { path: agentsPath, content: "remote agents\n" },
      { path: mcpPath, content: "remote mcp\n" },
    ], async (from, to) => {
      if (++renames === 2) throw new Error("injected write failure");
      const { rename } = await import("fs/promises");
      await rename(from, to);
    })).rejects.toThrow("injected write failure");

    expect(readFileSync(agentsPath, "utf8")).toBe("local agents\n");
    expect(readFileSync(mcpPath, "utf8")).toBe("local mcp\n");
    expect(readdirSync(configDir).some((file) => file.includes(".team-") && /\.(tmp|bak)$/.test(file))).toBe(false);
  });

  test("team writes preserve backup and report rejected rollback", async () => {
    const { configDir } = setupTeam("rollback-failure");
    const agentsPath = join(configDir, "agents.json");
    writeFileSync(agentsPath, "local agents\n");

    await expect(commitTeamWrites([{ path: agentsPath, content: "remote agents\n" }], async () => {
      throw new Error("activation failed");
    }, async () => {
      throw new Error("recovery rejected");
    })).rejects.toThrow("Team write failed and rollback failed");

    expect(readdirSync(configDir).some((file) => file.endsWith(".bak"))).toBe(true);
  });

  test("team push fails when git add fails", async () => {
    setupTeam("push-add");
    Bun.spawn = ((cmd: string[]) => {
      if (cmd[1] === "clone") {
        mkdirSync(cmd.at(-1)!, { recursive: true });
        return processResult(0);
      }
      if (cmd[1] === "add") return processResult(1, "index write failed");
      throw new Error(`Unexpected command: ${cmd.join(" ")}`);
    }) as typeof Bun.spawn;

    await expect(pushTeamConfig()).resolves.toEqual({ success: false, error: "Failed to stage team config: index write failed" });
  });

  test("analytics trend compares daily costs instead of request costs", () => {
    const entries = [
      ...Array.from({ length: 10 }, (_, i) => ({ timestamp: `2025-01-01T00:00:${String(i).padStart(2, "0")}Z`, cost: 1 })),
      { timestamp: "2025-01-02T00:00:00Z", cost: 10 },
      { timestamp: "2025-01-03T00:00:00Z", cost: 10 },
      { timestamp: "2025-01-04T00:00:00Z", cost: 10 },
    ].map((entry) => ({ ...entry, provider: "openai", model: "gpt-4o", agent: "test", inputTokens: 1, outputTokens: 1 }));

    expect(generateAnalytics(entries, "all").costTrend).toBe("stable");
  });

  test("optimizer never suggests the current profile", () => {
    const profile: Profile = { id: "only", name: "Only", description: "", provider: "openai", model: "gpt-4-turbo", maxTokens: 1000, temperature: 0, apiKeyEnv: "KEY", tokenSaving: { contextTruncation: false, maxContextMessages: 10 } };
    const usage = [{ timestamp: "2025-01-01T00:00:00Z", provider: "openai", model: profile.model, agent: "test", inputTokens: 10, outputTokens: 10, cost: 1 }];

    expect(analyzeCostOptimizations(usage, [profile])).toEqual([]);
  });
});
