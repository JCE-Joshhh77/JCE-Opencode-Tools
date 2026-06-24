import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { loadPluginsRegistry, installPlugin, removePlugin, sanitizeGitUrl } from "../lib/plugins.js";
import { heading, info, success, error } from "../lib/ui.js";
import { logCommandStart, logCommandSuccess, logCommandError } from "../lib/logger.js";
import { EXIT_SUCCESS, EXIT_ERROR } from "../types.js";
import {
  getConfigurableAgentIds,
  getJcePluginSettingsPath,
  listAvailableModels,
  loadJcePluginSettings,
  saveJcePluginSettings,
  type JcePluginSettings,
} from "../plugin/lib/settings.js";

// ─── Subcommands ─────────────────────────────────────────────

const installCommand = new Command("install")
  .description("Install a plugin from a GitHub repository")
  .argument("<github-url>", "GitHub repository URL (e.g. https://github.com/user/repo)")
  .option("--yes", "Apply plugin MCP config after review without interactive confirmation")
  .option("--allow-local-mcp", "Allow plugin to persist local MCP commands after --yes review")
  .action(async (githubUrl: string, opts: { yes?: boolean; allowLocalMcp?: boolean }) => {
    logCommandStart("plugin install", { url: sanitizeGitUrl(githubUrl) });

    info(`Installing plugin from: ${sanitizeGitUrl(githubUrl)}`);
    console.log();

    const result = await installPlugin(githubUrl, { trusted: opts.yes === true, allowLocalMcp: opts.allowLocalMcp === true });

    if (!result.success) {
      if (result.requiresTrust && result.mcpPreview) {
        error(result.error!);
        info("MCP config preview:");
        console.log(JSON.stringify(result.mcpPreview, null, 2));
        info("Review commands/env above, then re-run with --yes for remote MCP or --yes --allow-local-mcp for local commands if trusted.");
        logCommandError("plugin install", "MCP trust confirmation required");
        process.exit(EXIT_ERROR);
      }
      error(result.error!);
      logCommandError("plugin install", result.error!);
      process.exit(EXIT_ERROR);
    }

    const plugin = result.plugin!;
    success(`Plugin "${plugin.name}" v${plugin.version} installed successfully.`);
    info(`  Type: ${plugin.type}`);
    info(`  Description: ${plugin.description}`);
    logCommandSuccess("plugin install", `name=${plugin.name} version=${plugin.version}`);
    process.exit(EXIT_SUCCESS);
  });

const listCommand = new Command("list")
  .description("Show installed plugins")
  .action(async () => {
    logCommandStart("plugin list");

    const plugins = await loadPluginsRegistry();

    heading("Installed Plugins");
    console.log();

    if (plugins.length === 0) {
      info("No plugins installed.");
      info("Usage: opencode-jce plugin install <github-url>");
      process.exit(EXIT_SUCCESS);
    }

    for (const plugin of plugins) {
      const name = chalk.bold(plugin.name.padEnd(20));
      const version = chalk.dim(`v${plugin.version}`);
      const type = chalk.cyan(`[${plugin.type}]`);
      console.log(`  ${name} ${version.padEnd(12)} ${type}`);
      if (plugin.description) {
        console.log(`  ${"".padEnd(20)} ${chalk.dim(plugin.description)}`);
      }
    }

    console.log();
    info(`Total: ${plugins.length} plugin(s)`);
    logCommandSuccess("plugin list", `count=${plugins.length}`);
    process.exit(EXIT_SUCCESS);
  });

const removeCommand = new Command("remove")
  .description("Remove an installed plugin")
  .argument("<name>", "Plugin name to remove")
  .action(async (name: string) => {
    logCommandStart("plugin remove", { name });

    const result = await removePlugin(name);

    if (!result.success) {
      error(result.error!);
      logCommandError("plugin remove", result.error!);
      process.exit(EXIT_ERROR);
    }

    success(`Plugin "${name}" removed.`);
    logCommandSuccess("plugin remove", `name=${name}`);
    process.exit(EXIT_SUCCESS);
  });

function printAgentModelSettings(settings: JcePluginSettings, models: string[]): void {
  heading("JCE Plugin Agent Models");
  console.log();
  for (const agent of getConfigurableAgentIds()) {
    const value = settings.agents[agent];
    const label = typeof value === "string" && models.includes(value)
      ? value
      : "Use active OpenCode model";
    console.log(`  ${chalk.bold(agent.padEnd(10))} ${label}`);
  }
  console.log();
  info(`Settings file: ${getJcePluginSettingsPath()}`);
}

const modelsCommand = new Command("models")
  .description("Show available OpenCode models and JCE plugin agent model settings")
  .action(async () => {
    logCommandStart("plugin models");
    const models = listAvailableModels();
    const settings = loadJcePluginSettings();
    printAgentModelSettings(settings, models);
    console.log();
    heading("Available Models");
    console.log();
    if (models.length === 0) {
      info("No models found in opencode.json provider config.");
    } else {
      for (const model of models) console.log(`  ${model}`);
    }
    logCommandSuccess("plugin models", `models=${models.length}`);
    process.exit(EXIT_SUCCESS);
  });

const configureCommand = new Command("configure")
  .description("Interactively configure JCE plugin agent models")
  .action(async () => {
    logCommandStart("plugin configure");
    const models = listAvailableModels();
    if (models.length === 0) {
      error("No models found in opencode.json provider config.");
      error("Run `opencode-jce doctor` to verify your OpenCode provider configuration.");
      logCommandError("plugin configure", "no models available");
      process.exit(EXIT_ERROR);
    }

    const settings = loadJcePluginSettings();
    const choices = ["Use active OpenCode model", ...models];
    const rl = createInterface({ input, output });
    try {
      heading("Configure JCE Plugin Agent Models");
      console.log();
      choices.forEach((choice, index) => console.log(`  ${index + 1}. ${choice}`));
      console.log();

      for (const agent of getConfigurableAgentIds()) {
        const current = settings.agents[agent];
        const currentIndex = typeof current === "string" ? models.indexOf(current) + 2 : 1;
        const fallbackIndex = currentIndex > 1 ? currentIndex : 1;
        const answer = await rl.question(`${agent} model? [${fallbackIndex}] `);
        const parsed = answer.trim() === "" ? fallbackIndex : Number(answer.trim());
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > choices.length) {
          error(`Invalid choice for ${agent}: ${answer}`);
          logCommandError("plugin configure", `invalid choice for ${agent}`);
          process.exit(EXIT_ERROR);
        }
        settings.agents[agent] = parsed === 1 ? null : models[parsed - 2];
      }

      await saveJcePluginSettings(settings);
      console.log();
      success(`Saved JCE plugin settings to ${getJcePluginSettingsPath()}`);
      info("Restart OpenCode for agent model changes to apply.");
      logCommandSuccess("plugin configure", "saved settings");
      process.exit(EXIT_SUCCESS);
    } finally {
      rl.close();
    }
  });

// ─── Main Command ────────────────────────────────────────────

export const pluginCommand = new Command("plugin")
  .description("Manage community plugins and JCE plugin settings")
  .addCommand(installCommand)
  .addCommand(listCommand)
  .addCommand(removeCommand)
  .addCommand(modelsCommand)
  .addCommand(configureCommand);
