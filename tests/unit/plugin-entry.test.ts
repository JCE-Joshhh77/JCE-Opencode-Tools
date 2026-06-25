import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createRoot } from "solid-js";
import { createEmptyRuntimeState, saveRuntimeState } from "../../src/plugin/lib/runtime-state.ts";

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
    expect(source).toContain('import { createElement, insert, setProp } from "@opentui/solid"');
    expect(source).not.toContain("@jsxImportSource");
    expect(source).toContain('id: "opencode-jce-token-savings"');
    expect(source).toContain("tui,");
    expect(readFileSync(join(process.cwd(), "src", "plugin", "lib", "token-savings-sidebar.ts"), "utf8")).toContain("top:");
    expect(source).not.toContain("server:");
  });

  test("TUI-only Token Savings module imports without external preload", async () => {
    const mod = await import("../../src/plugin/tui.tsx");
    expect(mod.default.id).toBe("opencode-jce-token-savings");
    expect(typeof mod.default.tui).toBe("function");
  });

  test("TUI module registers JCE model slash commands", async () => {
    const mod = await import("../../src/plugin/tui.tsx");
    const layers: any[] = [];
    await mod.default.tui({
      keymap: { registerLayer: (layer: any) => layers.push(layer) },
      slots: { register: () => "slot" },
    } as any, undefined, {} as any);
    const commands = layers.flatMap((layer) => layer.commands ?? []);
    expect(commands.map((command) => command.slashName)).toContain("jce-models");
    expect(commands.map((command) => command.slashName)).toContain("jce-agent-model");
  });

  test("TUI /jce-models command shows scrollable model list instead of placeholder toast", async () => {
    const mod = await import("../../src/plugin/tui.tsx");
    const layers: any[] = [];
    let select: any;
    await mod.default.tui({
      keymap: { registerLayer: (layer: any) => layers.push(layer) },
      slots: { register: () => "slot" },
      ui: {
        DialogSelect: (props: any) => props,
        dialog: { replace: (render: any) => { select = render(); } },
      },
    } as any, undefined, {} as any);
    layers.flatMap((layer) => layer.commands ?? []).find((command) => command.slashName === "jce-models")?.run();
    expect(select.title).toBe("JCE Agent Models");
    expect(select.placeholder).toContain("Search models");
    expect(select.options.some((option: any) => option.title === "jce-worker" && option.category === "Agents")).toBe(true);
    expect(select.options.some((option: any) => option.category === "Available models")).toBe(true);
  });

  test("TUI /jce-agent-model command opens native agent and model pickers", async () => {
    const mod = await import("../../src/plugin/tui.tsx");
    const layers: any[] = [];
    const selects: any[] = [];
    await mod.default.tui({
      keymap: { registerLayer: (layer: any) => layers.push(layer) },
      slots: { register: () => "slot" },
      ui: {
        DialogSelect: (props: any) => props,
        dialog: { replace: (render: any) => { selects.push(render()); } },
        toast: () => undefined,
      },
    } as any, undefined, {} as any);
    layers.flatMap((layer) => layer.commands ?? []).find((command) => command.slashName === "jce-agent-model")?.run();
    expect(selects[0].title).toBe("JCE Agent Model");
    expect(selects[0].placeholder).toContain("Select agent");
    expect(selects[0].options.some((option: any) => option.title === "jce-worker" && option.category === "Agents")).toBe(true);
    selects[0].options.find((option: any) => option.title === "jce-worker")?.onSelect();
    expect(selects[1].title).toBe("JCE Agent Model: jce-worker");
    expect(selects[1].options.some((option: any) => option.value === "default")).toBe(true);
  });

  test("Token Savings line shows diagnostics before budget events", async () => {
    const root = mkdtempSync(join(tmpdir(), "opencode-jce-tui-"));
    try {
      expect(renderContextBudgetLine(fakeTuiApi(root))).toBe("~0 token(s) saved · awaiting budget events");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("Token Savings signal refreshes from persisted runtime state", async () => {

    const root = mkdtempSync(join(tmpdir(), "opencode-jce-tui-"));
    try {
      const api = fakeTuiApi(root);
      let observed = "";

      await new Promise<void>((resolve) => {
        createRoot((dispose) => {
          const line = createContextBudgetLineSignal(api, 10);
          observed = line();

          const memory = createEmptyRuntimeState("2026-05-14T00:00:00.000Z");
          memory.contextBudgetSummary = {
            originalChars: 100,
            compressedChars: 40,
            estimatedTokensSaved: 15,
            estimatedSavingsPercent: 60,
            tasks: 1,
            byTool: { Read: { originalChars: 100, compressedChars: 40, estimatedTokensSaved: 15, tasks: 1 } },
          };
          saveRuntimeState(root, memory, "2026-05-14T00:00:01.000Z", { preserveWorkflowRuntime: false });

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
