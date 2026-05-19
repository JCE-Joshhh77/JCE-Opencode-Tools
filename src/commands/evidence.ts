import { Command } from "commander";
import { appendEvidence, loadEvidence } from "../plugin/lib/jce-intelligence.js";
import { heading, info, success } from "../lib/ui.js";

export const evidenceCommand = new Command("evidence")
  .description("Manage local JCE verification evidence")
  .addCommand(new Command("list")
    .description("List stored evidence")
    .option("--json", "Print JSON")
    .action((options) => {
      const records = loadEvidence(process.cwd());
      if (options.json) { console.log(JSON.stringify(records, null, 2)); return; }
      heading("Evidence Store");
      for (const record of records.slice(-20)) success(`${record.id} [${record.status}] ${record.summary}`);
      info(`${records.length} evidence records.`);
    }))
  .addCommand(new Command("recent")
    .description("Show recent stored evidence")
    .option("--limit <count>", "Maximum records", "10")
    .option("--json", "Print JSON")
    .action((options) => {
      const records = loadEvidence(process.cwd()).slice(-Number(options.limit || 10));
      if (options.json) { console.log(JSON.stringify(records, null, 2)); return; }
      heading("Recent Evidence");
      for (const record of records) success(`${record.timestamp} ${record.id} [${record.status}] ${record.summary}`);
      info(`${records.length} recent evidence records.`);
    }))
  .addCommand(new Command("verify-current")
    .description("Check whether current project has passing command evidence")
    .option("--json", "Print JSON")
    .action((options) => {
      const records = loadEvidence(process.cwd());
      const passing = records.filter((record) => record.type === "command" && record.status === "pass");
      const result = { total: records.length, passingCommandEvidence: passing.length, ready: passing.length > 0 };
      if (options.json) { console.log(JSON.stringify(result, null, 2)); return; }
      heading("Evidence Readiness");
      (result.ready ? success : info)(result.ready ? `Ready: ${passing.length} passing command evidence record(s).` : "Not ready: no passing command evidence found.");
      if (!result.ready) process.exitCode = 1;
    }))
  .addCommand(new Command("add")
    .description("Add a manual evidence record")
    .requiredOption("--task <id>", "Task id")
    .requiredOption("--summary <text>", "Evidence summary")
    .option("--type <type>", "Evidence type", "manual")
    .option("--status <status>", "Evidence status", "unknown")
    .option("--command <command>", "Command used")
    .action((options) => {
      const record = appendEvidence(process.cwd(), { taskId: options.task, summary: options.summary, type: options.type, status: options.status, command: options.command });
      success(`Recorded ${record.id}`);
    }));
