import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..", "..");
const CONFIG = join(ROOT, "config");

/** Helper: read and parse a JSON file */
function readJSON(path: string): unknown {
  const content = readFileSync(path, "utf-8");
  return JSON.parse(content);
}

// ─── agents.json ─────────────────────────────────────────────

describe("config/agents.json", () => {
  const agents = readJSON(join(CONFIG, "agents.json")) as {
    agents: Array<{
      id: string;
      name: string;
      role: string;
      systemPrompt: string;
      preferredProfile: string;
      maxTokens: number;
      tools: string[];
    }>;
  };

  test("has exactly 42 agents", () => {
    expect(agents.agents).toHaveLength(42);
  });

  test("each agent has required field 'id'", () => {
    for (const agent of agents.agents) {
      expect(typeof agent.id).toBe("string");
      expect(agent.id.length).toBeGreaterThan(0);
    }
  });

  test("each agent has required field 'name'", () => {
    for (const agent of agents.agents) {
      expect(typeof agent.name).toBe("string");
      expect(agent.name.length).toBeGreaterThan(0);
    }
  });

  test("each agent has required field 'role'", () => {
    for (const agent of agents.agents) {
      expect(typeof agent.role).toBe("string");
      expect(agent.role.length).toBeGreaterThan(0);
    }
  });

  test("each agent has required field 'systemPrompt'", () => {
    for (const agent of agents.agents) {
      expect(typeof agent.systemPrompt).toBe("string");
      expect(agent.systemPrompt.length).toBeGreaterThan(0);
    }
  });

  test("each agent has required field 'preferredProfile'", () => {
    for (const agent of agents.agents) {
      expect(typeof agent.preferredProfile).toBe("string");
      expect(agent.preferredProfile.length).toBeGreaterThan(0);
    }
  });

  test("each agent has required field 'maxTokens' (positive number)", () => {
    for (const agent of agents.agents) {
      expect(typeof agent.maxTokens).toBe("number");
      expect(agent.maxTokens).toBeGreaterThan(0);
    }
  });

  test("each agent has required field 'tools' (array)", () => {
    for (const agent of agents.agents) {
      expect(Array.isArray(agent.tools)).toBe(true);
    }
  });

  test("all agent IDs are unique", () => {
    const ids = agents.agents.map((a) => a.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

// ─── mcp.json ────────────────────────────────────────────────

describe("config/mcp.json", () => {
  const mcp = readJSON(join(CONFIG, "mcp.json")) as {
    mcpServers: Record<string, { command: string; args: string[] }>;
  };

  test("has exactly 6 MCP servers", () => {
    expect(Object.keys(mcp.mcpServers)).toHaveLength(6);
  });

  test("does not include MCP servers known to close without local env", () => {
    expect(mcp.mcpServers).not.toHaveProperty("filesystem");
    expect(mcp.mcpServers).not.toHaveProperty("web-fetch");
    expect(mcp.mcpServers).not.toHaveProperty("postgres");
  });

  test("each MCP server has 'command' field", () => {
    for (const [name, server] of Object.entries(mcp.mcpServers)) {
      expect(typeof server.command).toBe("string");
      expect(server.command.length).toBeGreaterThan(0);
    }
  });

  test("each MCP server has 'args' array", () => {
    for (const [name, server] of Object.entries(mcp.mcpServers)) {
      expect(Array.isArray(server.args)).toBe(true);
    }
  });
});

// ─── lsp.json ────────────────────────────────────────────────

describe("config/lsp.json", () => {
  const lsp = readJSON(join(CONFIG, "lsp.json")) as {
    lsp: Record<
      string,
      {
        server: string;
        command: string;
        args: string[];
        filetypes: string[];
        installCommand: string;
      }
    >;
  };

  test("has exactly 28 LSP servers", () => {
    expect(Object.keys(lsp.lsp)).toHaveLength(28);
  });

  test("each LSP entry has required field 'server'", () => {
    for (const [name, entry] of Object.entries(lsp.lsp)) {
      expect(typeof entry.server).toBe("string");
      expect(entry.server.length).toBeGreaterThan(0);
    }
  });

  test("each LSP entry has required field 'command'", () => {
    for (const [name, entry] of Object.entries(lsp.lsp)) {
      expect(typeof entry.command).toBe("string");
      expect(entry.command.length).toBeGreaterThan(0);
    }
  });

  test("each LSP entry has required field 'args' (array)", () => {
    for (const [name, entry] of Object.entries(lsp.lsp)) {
      expect(Array.isArray(entry.args)).toBe(true);
    }
  });

  test("each LSP entry has required field 'filetypes' (non-empty array)", () => {
    for (const [name, entry] of Object.entries(lsp.lsp)) {
      expect(Array.isArray(entry.filetypes)).toBe(true);
      expect(entry.filetypes.length).toBeGreaterThan(0);
    }
  });

  test("each LSP entry has required field 'installCommand'", () => {
    for (const [name, entry] of Object.entries(lsp.lsp)) {
      expect(typeof entry.installCommand).toBe("string");
      expect(entry.installCommand.length).toBeGreaterThan(0);
    }
  });
});

// ─── Profile files ───────────────────────────────────────────

describe("config/profiles/", () => {
  const profileDir = join(CONFIG, "profiles");
  const expectedProfiles = [
    "budget",
    "claude-haiku",
    "codestral",
    "deepseek-coder",
    "deepseek-v3",
    "gemini-2.5",
    "gemini-flash",
    "gpt-4o",
    "grok-3",
    "hybrid-hemat",
    "llama-70b",
    "local",
    "mistral-large",
    "o3",
    "opus-latest",
    "quality",
    "qwen-coder",
    "sonnet-4.6",
    "speed",
  ];

  test("all 19 profile files exist", () => {
    for (const name of expectedProfiles) {
      const filePath = join(profileDir, `${name}.json`);
      expect(existsSync(filePath)).toBe(true);
    }
  });

  test("all profile files parse as valid JSON", () => {
    for (const name of expectedProfiles) {
      const filePath = join(profileDir, `${name}.json`);
      expect(() => readJSON(filePath)).not.toThrow();
    }
  });

  test("each profile has an 'id' field", () => {
    for (const name of expectedProfiles) {
      const filePath = join(profileDir, `${name}.json`);
      const profile = readJSON(filePath) as { id: string };
      expect(typeof profile.id).toBe("string");
      expect(profile.id.length).toBeGreaterThan(0);
    }
  });

  test("each profile 'id' matches its filename", () => {
    for (const name of expectedProfiles) {
      const filePath = join(profileDir, `${name}.json`);
      const profile = readJSON(filePath) as { id: string };
      expect(profile.id).toBe(name);
    }
  });

  test("exactly 19 profile files in directory", () => {
    const files = readdirSync(profileDir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(19);
  });
});

// ─── fallback.json ───────────────────────────────────────────

describe("config/fallback.json", () => {
  test("parses correctly as valid JSON", () => {
    expect(() => readJSON(join(CONFIG, "fallback.json"))).not.toThrow();
  });

  test("has 'providers' array", () => {
    const fallback = readJSON(join(CONFIG, "fallback.json")) as {
      providers: unknown[];
    };
    expect(Array.isArray(fallback.providers)).toBe(true);
    expect(fallback.providers.length).toBeGreaterThan(0);
  });

  test("has 'maxRetries' number", () => {
    const fallback = readJSON(join(CONFIG, "fallback.json")) as {
      maxRetries: number;
    };
    expect(typeof fallback.maxRetries).toBe("number");
    expect(fallback.maxRetries).toBeGreaterThan(0);
  });

  test("has 'timeoutMs' number", () => {
    const fallback = readJSON(join(CONFIG, "fallback.json")) as {
      timeoutMs: number;
    };
    expect(typeof fallback.timeoutMs).toBe("number");
    expect(fallback.timeoutMs).toBeGreaterThan(0);
  });
});

// ─── AGENTS.md ───────────────────────────────────────────────

describe("config/AGENTS.md", () => {
  test("exists", () => {
    expect(existsSync(join(CONFIG, "AGENTS.md"))).toBe(true);
  });

  test("is non-empty", () => {
    const content = readFileSync(join(CONFIG, "AGENTS.md"), "utf-8");
    expect(content.trim().length).toBeGreaterThan(0);
  });
});

// ─── skills/ directory ───────────────────────────────────────

describe("config/skills/", () => {
  const skillsDir = join(CONFIG, "skills");

  test("directory exists", () => {
    expect(existsSync(skillsDir)).toBe(true);
  });

  test("has exactly 74 skill directories with SKILL.md", () => {
    const skillDirs = readdirSync(skillsDir).filter((f) => {
      const fullPath = join(skillsDir, f);
      return statSync(fullPath).isDirectory() && existsSync(join(fullPath, "SKILL.md"));
    });
    expect(skillDirs).toHaveLength(74);
  });

  test("all SKILL.md files are non-empty and have frontmatter", () => {
    const skillDirs = readdirSync(skillsDir).filter((f) => statSync(join(skillsDir, f)).isDirectory());
    for (const dir of skillDirs) {
      const skillFile = join(skillsDir, dir, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      const content = readFileSync(skillFile, "utf-8");
      expect(content.trim().length).toBeGreaterThan(0);
      expect(content.startsWith("---\n")).toBe(true);
      expect(content).toContain("name:");
      expect(content).toContain("description:");
    }
  });
});
