import { Command } from "commander";
import { buildAnalyticsRecommendations, loadEvidence, loadTelemetry, summarizeTelemetry } from "../plugin/lib/jce-intelligence.js";
import { heading, info, success } from "../lib/ui.js";

export const analyticsCommand = new Command("analytics")
  .description("Show local non-PII JCE telemetry summary")
  .option("--json", "Print JSON")
  .option("--recommendations", "Print workflow improvement recommendations")
  .action((options) => {
    const events = loadTelemetry(process.cwd());
    const summary = summarizeTelemetry(events);
    const recommendations = buildAnalyticsRecommendations(events, loadEvidence(process.cwd()));
    if (options.json) { console.log(JSON.stringify({ events: events.length, summary, recommendations }, null, 2)); return; }
    heading("JCE Analytics");
    for (const [key, value] of Object.entries(summary).sort((a, b) => b[1] - a[1])) success(`${key}: ${value}`);
    if (options.recommendations) for (const item of recommendations) info(`Recommendation: ${item}`);
    info(`${events.length} telemetry events.`);
  });
