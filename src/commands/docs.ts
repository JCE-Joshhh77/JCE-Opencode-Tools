import { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { generateAgentsCanonicalMarkdown, generateCapabilitiesMarkdown } from "../plugin/lib/jce-intelligence.js";
import { success, warn } from "../lib/ui.js";

export const docsCommand = new Command("docs")
  .description("Generate JCE documentation artifacts")
  .addCommand(new Command("generate")
    .description("Generate capability matrix markdown")
    .option("--check", "Check whether generated docs already exist")
    .option("--output <path>", "Output markdown path", "docs/capabilities.md")
    .option("--canonical-agents", "Generate canonical JCE-Worker protocol instead of capabilities")
    .action((options) => {
      const output = join(process.cwd(), options.output);
      const markdown = options.canonicalAgents ? generateAgentsCanonicalMarkdown() : generateCapabilitiesMarkdown();
      if (options.check) {
        if (!existsSync(output)) { warn(`Missing generated docs: ${options.output}`); process.exitCode = 1; return; }
        if (readFileSync(output, "utf8") !== markdown) { warn(`Generated docs are stale: ${options.output}`); process.exitCode = 1; return; }
        success(`Generated docs exist: ${options.output}`);
        return;
      }
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, markdown, "utf8");
      success(`Wrote ${options.output}`);
    }));
