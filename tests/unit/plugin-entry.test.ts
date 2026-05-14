import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createRoot } from "solid-js";
import { createEmptyExecutionMemory, saveExecutionMemory } from "../../src/plugin/lib/execution-memory.ts";
import { createContextBudgetLineSignal, renderContextBudgetLine } from "../../src/plugin/lib/token-savings-sidebar.ts";

function fakeTuiApi(root: string) {
  return {
    state: { path: { directory: root, worktree: root } },
  } as any;
}

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
    expect(readFileSync(join(process.cwd(), "src", "plugin", "lib", "token-savings-sidebar.ts"), "utf8")).toContain("top:");
    expect(source).not.toContain("server:");
  });

  test("Token Savings line shows diagnostics before budget events", async () => {
    const root = mkdtempSync(join(tmpdir(), "opencode-jce-tui-"));
    try {
      expect(renderContextBudgetLine(fakeTuiApi(root))).toBe("~0 token(s) saved · awaiting budget events");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("Token Savings signal refreshes from persisted execution memory", async () => {
    const root = mkdtempSync(join(tmpdir(), "opencode-jce-tui-"));
    try {
      const api = fakeTuiApi(root);
      let observed = "";

      await new Promise<void>((resolve) => {
        createRoot((dispose) => {
          const line = createContextBudgetLineSignal(api, 10);
          observed = line();

          const memory = createEmptyExecutionMemory("2026-05-14T00:00:00.000Z");
          memory.contextBudgetSummary = {
            originalChars: 100,
            compressedChars: 40,
            estimatedTokensSaved: 15,
            estimatedSavingsPercent: 60,
            tasks: 1,
            byTool: { Read: { originalChars: 100, compressedChars: 40, estimatedTokensSaved: 15, tasks: 1 } },
          };
          saveExecutionMemory(root, memory, "2026-05-14T00:00:01.000Z", { preserveWorkflowRuntime: false });

          setTimeout(() => {
            observed = line();
            dispose();
            resolve();
          }, 30);
        });
      });

      expect(observed).toBe("~15 token(s) saved · 1 event(s) · top: Read");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
