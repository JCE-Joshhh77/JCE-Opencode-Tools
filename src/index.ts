#!/usr/bin/env bun

import { Command } from "commander";
import { validateCommand } from "./commands/validate.js";
import { useCommand } from "./commands/use.js";
import { doctorCommand } from "./commands/doctor.js";
import { uninstallCommand } from "./commands/uninstall.js";
import { updateCommand } from "./commands/update.js";
import { setupCommand } from "./commands/setup.js";
import { routeCommand } from "./commands/route.js";
import { tokensCommand } from "./commands/tokens.js";
import { optimizeCommand } from "./commands/optimize.js";
import { agentCommand } from "./commands/agent.js";
import { promptsCommand } from "./commands/prompts.js";
import { pluginCommand } from "./commands/plugin.js";
import { teamCommand } from "./commands/team.js";
import { memoryCommand } from "./commands/memory.js";
import { dashboardCommand } from "./commands/dashboard.js";
import { fallbackCommand } from "./commands/fallback.js";
import { contextCommand } from "./commands/context.js";
import { jceWorkerCommand } from "./commands/jce-worker.js";
import { skillsCommand } from "./commands/skills.js";
import { capabilitiesCommand } from "./commands/capabilities.js";
import { evidenceCommand } from "./commands/evidence.js";
import { docsCommand } from "./commands/docs.js";
import { analyticsCommand } from "./commands/analytics.js";
import { flowCommand } from "./commands/flow.js";
import { factoryCommand } from "./commands/factory.js";
import { VERSION } from "./lib/constants.js";

const program = new Command();

program
  .name("opencode-jce")
  .description("OpenCode JCE — CLI management tool")
  .version(VERSION);

program.addCommand(validateCommand);
program.addCommand(useCommand);
program.addCommand(doctorCommand);
program.addCommand(uninstallCommand);
program.addCommand(updateCommand);
program.addCommand(setupCommand);
program.addCommand(routeCommand);
program.addCommand(tokensCommand);
program.addCommand(optimizeCommand);
program.addCommand(agentCommand);
program.addCommand(promptsCommand);
program.addCommand(pluginCommand);
program.addCommand(teamCommand);
program.addCommand(memoryCommand);
program.addCommand(dashboardCommand);
program.addCommand(fallbackCommand);
program.addCommand(contextCommand);
program.addCommand(jceWorkerCommand);
program.addCommand(skillsCommand);
program.addCommand(capabilitiesCommand);
program.addCommand(evidenceCommand);
program.addCommand(docsCommand);
program.addCommand(analyticsCommand);
program.addCommand(flowCommand);
program.addCommand(factoryCommand);

program.parse(process.argv);
