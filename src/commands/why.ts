import { Command } from "commander";
import { loadSessionState } from "../plugin/lib/session-store.js";
import { resolvePolicyProfile } from "../plugin/lib/policy-profile.js";
import { formatJceWorkerWhy } from "../plugin/lib/jce-worker-report.js";
import { EXIT_SUCCESS } from "../types.js";

export const whyCommand = new Command("why")
  .description("Explain why JCE-Worker blocked, asked, or chose the next action")
  .option("--json", "Print JSON")
  .action((opts: { json?: boolean }) => {
    const root = process.cwd();
    const loaded = loadSessionState(root);
    const policy = resolvePolicyProfile(root);
    if (opts.json) {
      console.log(JSON.stringify({ runtime: loaded.state.runtime, policy, orchestration: loaded.state.orchestration }, null, 2));
    } else {
      console.log(formatJceWorkerWhy(loaded.state.runtime, policy, loaded.state.orchestration));
    }
    process.exitCode = EXIT_SUCCESS;
  });
