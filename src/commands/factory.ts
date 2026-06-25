import { Command } from "commander";
import { join } from "path";
import { getConfigDir } from "../lib/config.js";
import { exportFactoryDroidPlugin } from "../lib/factory-droid.js";
import { error, info, success } from "../lib/ui.js";
import { logCommandError, logCommandStart, logCommandSuccess } from "../lib/logger.js";
import { EXIT_ERROR, EXIT_SUCCESS } from "../types.js";

const exportCommand = new Command("export")
  .description("Generate a Factory Droid plugin package from JCE agents and skills")
  .option("-o, --output <dir>", "Output directory", join(getConfigDir(), "factory-jce"))
  .option("--clean", "Delete existing output directory before export")
  .action(async (opts: { output: string; clean?: boolean }) => {
    logCommandStart("factory export", { output: opts.output });
    try {
      const result = exportFactoryDroidPlugin(opts.output, {
        sourceConfigDir: join(getConfigDir(), "cli", "config"),
        cliDir: join(getConfigDir(), "cli"),
        clean: opts.clean === true,
      });
      success(`Factory Droid plugin exported to: ${result.outputDir}`);
      info(`Droids: ${result.droids.join(", ")}`);
      info(`Skills: ${result.skills}`);
      info(`Commands: ${result.commands.map((c) => `/${c}`).join(", ")}`);
      info(`Install in Droid: droid plugin marketplace add ${result.outputDir}`);
      info(`Then: droid plugin install ${result.pluginName}@${result.marketplaceName}`);
      logCommandSuccess("factory export", `droids=${result.droids.length} skills=${result.skills}`);
      process.exit(EXIT_SUCCESS);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      error(`Factory Droid export failed: ${message}`);
      logCommandError("factory export", message);
      process.exit(EXIT_ERROR);
    }
  });

export const factoryCommand = new Command("factory")
  .description("Export/install JCE support files for Factory Droid")
  .addCommand(exportCommand);
