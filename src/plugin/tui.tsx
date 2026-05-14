/** @jsxImportSource @opentui/solid */
import type { PluginOptions } from "@opencode-ai/plugin";
import type { TuiPluginApi, TuiPluginMeta } from "@opencode-ai/plugin/tui";
import { createContextBudgetLineSignal } from "./lib/token-savings-sidebar.js";

export async function tui(api: TuiPluginApi, _options: PluginOptions | undefined, _meta: TuiPluginMeta): Promise<void> {
  api.slots.register({
    order: 600,
    slots: {
      sidebar_content: (_ctx: unknown, _props: { session_id: string }) => {
        const line = createContextBudgetLineSignal(api);

        return (
          <box>
            <text fg={api.theme.current.text}>
              <b>Token Savings</b>
            </text>
            <text fg={api.theme.current.textMuted}>{line()}</text>
          </box>
        );
      },
    },
  });
}

export default {
  id: "opencode-jce-token-savings",
  tui,
};
