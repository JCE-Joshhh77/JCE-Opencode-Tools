import { describe, test, expect } from "bun:test";
import { validateAgainstSchema } from "../../src/lib/schema.js";

// ─── agents.schema.json ─────────────────────────────────────

describe("agents.schema.json validation", () => {
  test("valid agents config passes", async () => {
    const validData = {
      agents: [
        {
          id: "test-agent",
          name: "Test Agent",
          role: "Testing",
          systemPrompt: "You are a test agent.",
          preferredProfile: "speed",
          maxTokens: 4096,
          tools: ["read", "bash"],
        },
      ],
    };
    const result = await validateAgainstSchema(validData, "agents.schema.json");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("multiple agents pass validation", async () => {
    const validData = {
      agents: [
        {
          id: "agent-1",
          name: "Agent One",
          role: "Role A",
          systemPrompt: "Prompt A",
          preferredProfile: "speed",
          maxTokens: 2048,
          tools: [],
        },
        {
          id: "agent-2",
          name: "Agent Two",
          role: "Role B",
          systemPrompt: "Prompt B",
          preferredProfile: "quality",
          maxTokens: 8192,
          tools: ["read"],
        },
      ],
    };
    const result = await validateAgainstSchema(validData, "agents.schema.json");
    expect(result.valid).toBe(true);
  });

  test("missing required field 'id' fails", async () => {
    const invalidData = {
      agents: [
        {
          name: "No ID Agent",
          role: "Testing",
          systemPrompt: "Prompt",
          preferredProfile: "speed",
          maxTokens: 4096,
          tools: [],
        },
      ],
    };
    const result = await validateAgainstSchema(invalidData, "agents.schema.json");
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("missing required field 'tools' fails", async () => {
    const invalidData = {
      agents: [
        {
          id: "test",
          name: "Test",
          role: "Testing",
          systemPrompt: "Prompt",
          preferredProfile: "speed",
          maxTokens: 4096,
        },
      ],
    };
    const result = await validateAgainstSchema(invalidData, "agents.schema.json");
    expect(result.valid).toBe(false);
  });

  test("empty agents array fails (minItems: 1)", async () => {
    const invalidData = { agents: [] };
    const result = await validateAgainstSchema(invalidData, "agents.schema.json");
    expect(result.valid).toBe(false);
  });

  test("missing 'agents' key fails", async () => {
    const invalidData = { notAgents: [] };
    const result = await validateAgainstSchema(invalidData, "agents.schema.json");
    expect(result.valid).toBe(false);
  });

  test("extra properties on agent fail (additionalProperties: false)", async () => {
    const invalidData = {
      agents: [
        {
          id: "test",
          name: "Test",
          role: "Testing",
          systemPrompt: "Prompt",
          preferredProfile: "speed",
          maxTokens: 4096,
          tools: [],
          extraField: "not allowed",
        },
      ],
    };
    const result = await validateAgainstSchema(invalidData, "agents.schema.json");
    expect(result.valid).toBe(false);
  });

  test("duplicate agent IDs fail even when objects differ", async () => {
    const invalidData = {
      agents: [
        {
          id: "dup",
          name: "One",
          role: "Role A",
          systemPrompt: "Prompt A",
          preferredProfile: "speed",
          maxTokens: 4096,
          tools: [],
        },
        {
          id: "dup",
          name: "Two",
          role: "Role B",
          systemPrompt: "Prompt B",
          preferredProfile: "quality",
          maxTokens: 2048,
          tools: ["read"],
        },
      ],
    };
    const result = await validateAgainstSchema(invalidData, "agents.schema.json");
    expect(result.valid).toBe(false);
  });

  test("fractional maxTokens fails", async () => {
    const invalidData = {
      agents: [
        {
          id: "fractional",
          name: "Fractional",
          role: "Testing",
          systemPrompt: "Prompt",
          preferredProfile: "speed",
          maxTokens: 1.5,
          tools: [],
        },
      ],
    };
    const result = await validateAgainstSchema(invalidData, "agents.schema.json");
    expect(result.valid).toBe(false);
  });
});

// ─── mcp.schema.json ────────────────────────────────────────

describe("mcp.schema.json validation", () => {
  test("valid MCP config passes", async () => {
    const validData = {
      mcpServers: {
        "test-server": {
          command: "npx",
          args: ["-y", "some-package"],
          description: "A test server",
        },
      },
    };
    const result = await validateAgainstSchema(validData, "mcp.schema.json");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("MCP server with env passes", async () => {
    const validData = {
      mcpServers: {
        "with-env": {
          command: "npx",
          args: ["-y", "pkg"],
          env: { API_KEY: "test" },
        },
      },
    };
    const result = await validateAgainstSchema(validData, "mcp.schema.json");
    expect(result.valid).toBe(true);
  });

  test("missing 'command' fails", async () => {
    const invalidData = {
      mcpServers: {
        broken: {
          args: ["-y"],
        },
      },
    };
    const result = await validateAgainstSchema(invalidData, "mcp.schema.json");
    expect(result.valid).toBe(false);
  });

  test("missing 'mcpServers' key fails", async () => {
    const invalidData = { servers: {} };
    const result = await validateAgainstSchema(invalidData, "mcp.schema.json");
    expect(result.valid).toBe(false);
  });
});

// ─── opencode.schema.json ────────────────────────────────────

describe("opencode.schema.json validation", () => {
  test("valid active OpenCode config passes", async () => {
    const validData = {
      $schema: "https://opencode.ai/config.json",
      plugin: ["file:///home/user/.config/opencode/cli/src/plugin/index.ts"],
      mcp: {
        memory: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-memory"], enabled: true },
        context7: { type: "remote", url: "https://mcp.context7.com/mcp", enabled: true },
      },
      lsp: {
        python: { command: ["pyright-langserver", "--stdio"], extensions: [".py"] },
      },
    };

    const result = await validateAgainstSchema(validData, "opencode.schema.json");
    expect(result.valid).toBe(true);
  });

  test("active OpenCode MCP entry without command or url fails", async () => {
    const invalidData = {
      mcp: {
        broken: { type: "local", enabled: true },
      },
    };

    const result = await validateAgainstSchema(invalidData, "opencode.schema.json");
    expect(result.valid).toBe(false);
  });
});

// ─── lsp.schema.json ────────────────────────────────────────

describe("lsp.schema.json validation", () => {
  test("valid LSP config passes", async () => {
    const validData = {
      lsp: {
        python: {
          server: "pyright",
          command: "pyright-langserver",
          args: ["--stdio"],
          filetypes: ["python"],
          installCommand: "npm install -g pyright",
        },
      },
    };
    const result = await validateAgainstSchema(validData, "lsp.schema.json");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("missing 'server' field fails", async () => {
    const invalidData = {
      lsp: {
        broken: {
          command: "some-cmd",
          args: [],
          filetypes: ["test"],
          installCommand: "npm install -g test",
        },
      },
    };
    const result = await validateAgainstSchema(invalidData, "lsp.schema.json");
    expect(result.valid).toBe(false);
  });

  test("empty filetypes array fails (minItems: 1)", async () => {
    const invalidData = {
      lsp: {
        broken: {
          server: "test",
          command: "test-cmd",
          args: [],
          filetypes: [],
          installCommand: "npm install -g test",
        },
      },
    };
    const result = await validateAgainstSchema(invalidData, "lsp.schema.json");
    expect(result.valid).toBe(false);
  });

  test("missing 'lsp' key fails", async () => {
    const invalidData = { languages: {} };
    const result = await validateAgainstSchema(invalidData, "lsp.schema.json");
    expect(result.valid).toBe(false);
  });
});

// ─── Non-existent schema ────────────────────────────────────

describe("schema loading errors", () => {
  test("non-existent schema file throws", async () => {
    expect(
      validateAgainstSchema({}, "does-not-exist.schema.json")
    ).rejects.toThrow();
  });
});

describe("profile.schema.json validation", () => {
  test("fractional maxTokens fails", async () => {
    const data = {
      id: "speed",
      name: "Speed",
      description: "Fast profile",
      provider: "openai",
      model: "gpt",
      maxTokens: 1.5,
      temperature: 0.2,
      apiKeyEnv: "OPENAI_API_KEY",
      tokenSaving: { contextTruncation: true, maxContextMessages: 10 },
    };
    const result = await validateAgainstSchema(data, "profile.schema.json");
    expect(result.valid).toBe(false);
  });
});

describe("fallback.schema.json validation", () => {
  test("fractional retry counts fail", async () => {
    const data = {
      providers: [{ name: "openai", priority: 1, apiKeyEnv: "OPENAI_API_KEY", healthEndpoint: "https://api.openai.com/v1/models" }],
      maxRetries: 0.2,
      timeoutMs: 5000,
    };
    const result = await validateAgainstSchema(data, "fallback.schema.json");
    expect(result.valid).toBe(false);
  });
});
