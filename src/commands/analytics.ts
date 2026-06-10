import { Command } from "commander";
import { buildAnalyticsRecommendations, loadEvidence, loadTelemetry, summarizeRoutingQuality, summarizeSkillTelemetry, summarizeTelemetry } from "../plugin/lib/jce-intelligence.js";
import { heading, info, success } from "../lib/ui.js";

export const analyticsCommand = new Command("analytics")
  .description("Show local non-PII JCE telemetry summary")
  .option("--json", "Print JSON")
  .option("--recommendations", "Print workflow improvement recommendations")
  .action((options) => {
    const events = loadTelemetry(process.cwd());
    const summary = summarizeTelemetry(events);
    const skillSummary = summarizeSkillTelemetry(events);
    const routingQuality = summarizeRoutingQuality(events);
    const recommendations = buildAnalyticsRecommendations(events, loadEvidence(process.cwd()));
    if (options.json) { console.log(JSON.stringify({ events: events.length, summary, skillSummary, routingQuality, recommendations }, null, 2)); return; }
    heading("JCE Analytics");
    for (const [key, value] of Object.entries(summary).sort((a, b) => b[1] - a[1])) success(`${key}: ${value}`);
    for (const [skill, value] of Object.entries(skillSummary.finalUsed).sort((a, b) => b[1] - a[1]).slice(0, 10)) info(`Final used ${skill}: ${value}`);
    for (const item of routingQuality.usefulSkills.slice(0, 5)) info(`Useful skill ${item.skill}: ${item.score}`);
    for (const item of routingQuality.noisySkills.slice(0, 5)) info(`Noisy skill ${item.skill}: ${item.score}`);
    if (options.recommendations) for (const item of recommendations) info(`Recommendation: ${item}`);
    info(`${events.length} telemetry events.`);
  });
