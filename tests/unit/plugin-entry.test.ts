import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("plugin entry point", () => {
  test("exports a valid PluginModule with id and server function", async () => {
    const mod = await import("../../src/plugin/index.ts");
    expect(mod.default).toBeDefined();
    expect(mod.default.id).toBe("opencode-jce");
    expect(typeof mod.default.server).toBe("function");
    expect((mod.default as any).tui).toBeUndefined();
  });

  test("provides a TUI-only Token Savings module", () => {
    const source = readFileSync(join(process.cwd(), "src", "plugin", "tui.tsx"), "utf8");
    expect(source).toContain("/** @jsxImportSource @opentui/solid */");
    expect(source).toContain('id: "opencode-jce-token-savings"');
    expect(source).toContain("tui,");
    expect(source).toContain("top:");
    expect(source).not.toContain("server:");
  });

  test("server function returns a hooks object", async () => {
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server(
      {
        client: {} as any,
        project: {} as any,
        directory: "/tmp",
        worktree: "/tmp",
        serverUrl: new URL("http://localhost:3000"),
        $: {} as any,
        experimental_workspace: { register: () => {} },
      } as any,
    );
    expect(hooks).toBeDefined();
    expect(typeof hooks).toBe("object");
  });

  test("server exposes jce_workflow tool", async () => {
    const mod = await import("../../src/plugin/index.ts");
    const hooks = await mod.default.server(
      {
        client: {} as any,
        project: {} as any,
        directory: "/tmp",
        worktree: "/tmp",
        serverUrl: new URL("http://localhost:3000"),
        $: {} as any,
        experimental_workspace: { register: () => {} },
      } as any,
    );

    expect(hooks.tool?.jce_workflow).toBeDefined();
  });
});
