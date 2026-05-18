import { buildAndroidVerificationRecipe, type AndroidVerificationCommand } from "./verification-recipe.js";
import type { AndroidAdvancedProfile, AndroidFlowTemplate } from "./advanced-flow.js";
import type { AndroidEnvironmentProbe } from "./environment-probe.js";

export interface PlannedAndroidCommand extends AndroidVerificationCommand {
  priority: "required" | "recommended" | "optional";
  blockedBy: string[];
  expectedEvidence: string[];
  timeoutMs: number;
}

export interface AndroidCommandPlan { commands: PlannedAndroidCommand[]; blockers: string[]; notes: string[] }

function uniqueByCommand(commands: PlannedAndroidCommand[]): PlannedAndroidCommand[] {
  const seen = new Set<string>();
  return commands.filter((command) => seen.has(command.command) ? false : (seen.add(command.command), true));
}

function planned(command: AndroidVerificationCommand, priority: PlannedAndroidCommand["priority"], env?: AndroidEnvironmentProbe): PlannedAndroidCommand {
  const blockedBy: string[] = [];
  if (command.requiresDevice && env && env.adb.devices.filter((device) => device.state === "device").length === 0) blockedBy.push("No authorized adb device/emulator available.");
  if (env && env.blockers.length && command.command.includes("gradlew")) blockedBy.push(...env.blockers);
  return { ...command, priority, blockedBy, expectedEvidence: [`${command.command} exits with code 0`, "Relevant stdout/stderr reviewed"], timeoutMs: command.releaseSensitive ? 900_000 : command.requiresDevice ? 600_000 : 300_000 };
}

export function planAndroidCommands(input: { profile: AndroidAdvancedProfile; flows: AndroidFlowTemplate[]; changedFiles?: string[]; diffText?: string; environment?: AndroidEnvironmentProbe }): AndroidCommandPlan {
  const recipe = buildAndroidVerificationRecipe({ files: input.changedFiles ?? [], diffText: input.diffText, module: input.profile.primaryModule });
  const flowCommands = input.flows.flatMap((flow) => flow.recommendedCommands);
  const base = recipe.commands.length ? recipe.commands : input.profile.verificationMatrix;
  const commands = uniqueByCommand([
    ...base.map((item) => planned(item, item.optional ? "optional" : "required", input.environment)),
    ...flowCommands.map((item) => planned(item, item.optional ? "optional" : "recommended", input.environment)),
  ]);
  return { commands, blockers: [...new Set(commands.flatMap((command) => command.blockedBy))], notes: recipe.notes };
}
