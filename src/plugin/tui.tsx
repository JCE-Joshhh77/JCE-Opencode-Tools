import { createElement, insert, setProp } from "@opentui/solid";
import type { PluginOptions } from "@opencode-ai/plugin";
import type { TuiPluginApi, TuiPluginMeta } from "@opencode-ai/plugin/tui";
import { createContextBudgetLineSignal } from "./lib/token-savings-sidebar.js";

function createTokenSavingsBox(api: TuiPluginApi): any {
  const line = createContextBudgetLineSignal(api);
  const box = createElement("box");
  const title = createElement("text");
  const value = createElement("text");
  const bold = createElement("b");

  setProp(title, "fg", api.theme.current.text);
  setProp(value, "fg", api.theme.current.textMuted);
  insert(bold, "Token Savings");
  insert(title, bold);
  insert(value, line);
  insert(box, [title, value]);

  return box;
}

export async function tui(api: TuiPluginApi, _options: PluginOptions | undefined, _meta: TuiPluginMeta): Promise<void> {
  api.slots.register({
    order: 600,
    slots: {
      sidebar_content: (_ctx: unknown, _props: { session_id: string }) => {
        return createTokenSavingsBox(api);
      },
    },
  });
}

export default {
  id: "opencode-jce-token-savings",
  tui,
};
