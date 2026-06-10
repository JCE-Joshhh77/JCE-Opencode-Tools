import { Command } from "commander";
import { join } from "path";
import { auditSkills, buildSkillDoctorReport, hardenSkillDescriptions, resolveSkillConflicts, resolveSkillConflictsV2 } from "../plugin/lib/jce-intelligence.js";
import { explainSkillRouting } from "../plugin/lib/skill-loader.js";
import { heading, info, success, warn } from "../lib/ui.js";

export const skillsCommand = new Command("skills")
  .description("Audit and resolve JCE skill routing")
  .addCommand(new Command("explain")
    .description("Explain weighted routing for a prompt")
    .argument("prompt", "Prompt text to analyze")
    .option("--agent <name>", "Optional sub-agent profile context")
    .option("--json", "Print JSON")
    .action((prompt, options) => {
      const report = explainSkillRouting(String(prompt), options.agent);
      if (options.json) { console.log(JSON.stringify(report, null, 2)); return; }
      heading("Skill Routing Explain");
      info(`Intent: ${report.intent}`);
      info(`Confidence: ${report.confidence}`);
      success(`Selected: ${report.selected.map((item) => item.skill).join(", ") || "none"}`);
      console.log("Candidates:");
      for (const candidate of report.candidates.slice(0, 10)) console.log(`  - ${candidate.skill}: ${candidate.total} :: ${candidate.contributions.map((item) => `${item.source}=${item.score}`).join(", ")}`);
      if (report.rejected.length) {
        console.log("Rejected:");
        for (const item of report.rejected.slice(0, 10)) warn(`${item.skill}: ${item.reason}`);
      }
    }))
  .addCommand(new Command("doctor")
    .description("Check registry metadata health for routing")
    .option("--json", "Print JSON")
    .action((options) => {
      const report = buildSkillDoctorReport();
      if (options.json) { console.log(JSON.stringify(report, null, 2)); return; }
      heading("Skill Routing Doctor");
      info(`Total skills: ${report.totalSkills}`);
      info(`Missing metadata: ${report.missingMetadata.length || 0}`);
      info(`Weak prompts: ${report.weakPrompts.length || 0}`);
      info(`Manual/internal routes: ${report.manualOnly.join(", ") || "none"}`);
      if (report.missingMetadata.length) for (const skill of report.missingMetadata) warn(`Missing metadata: ${skill}`);
      if (report.weakPrompts.length) for (const skill of report.weakPrompts) warn(`Weak sample prompt: ${skill}`);
    }))
  .addCommand(new Command("audit")
    .description("Score installed repository skills for routing quality")
    .option("--json", "Print JSON")
    .action((options) => {
      const report = auditSkills(join(process.cwd(), "config", "skills"));
      if (options.json) { console.log(JSON.stringify(report, null, 2)); return; }
      heading("JCE Skill Audit");
      info(`${report.total} skills, average score ${report.averageScore}/100, ${report.errors} errors, ${report.warnings} warnings`);
      for (const result of report.results.slice(0, 15)) {
        const line = `${result.name}: ${result.score}/100`;
        result.score >= 85 ? success(line) : warn(line);
        for (const finding of result.findings.slice(0, 3)) console.log(`      - ${finding.severity}: ${finding.message}`);
      }
    }))
  .addCommand(new Command("resolve")
    .description("Resolve skill conflicts from a comma-separated list")
    .argument("skills", "Comma-separated skill names")
    .option("--max <count>", "Maximum selected skills", "4")
    .option("--intent <text>", "Intent text for v2 context ranking")
    .option("--file <path...>", "Files in scope for v2 context ranking")
    .option("--v2", "Use context-aware skill resolver v2")
    .option("--why", "Print suppressed skills and reasons")
    .option("--json", "Print JSON")
    .action((skillsText, options) => {
      const input = String(skillsText).split(",").map((s) => s.trim()).filter(Boolean);
      const resolution = options.v2 || options.intent || options.file
        ? resolveSkillConflictsV2(input, { intent: options.intent, files: options.file, max: Number(options.max) })
        : resolveSkillConflicts(input, Number(options.max));
      if (options.json) { console.log(JSON.stringify(resolution, null, 2)); return; }
      heading("Skill Conflict Resolution");
      success(`Selected: ${resolution.selected.join(", ") || "none"}`);
      if (options.why || resolution.suppressed.length <= 6) for (const item of resolution.suppressed) warn(`Suppressed ${item.skill}: ${item.reason}`);
    }))
  .addCommand(new Command("harden")
    .description("Harden skill frontmatter descriptions for better routing")
    .option("--write", "Apply description updates")
    .option("--json", "Print JSON")
    .action((options) => {
      const report = hardenSkillDescriptions(join(process.cwd(), "config", "skills"), { write: Boolean(options.write) });
      if (options.json) { console.log(JSON.stringify(report, null, 2)); return; }
      heading("Skill Description Hardening");
      info(`${report.checked} skills checked, ${report.changed} ${options.write ? "updated" : "would change"}.`);
      for (const change of report.changes.slice(0, 20)) warn(`${change.name}: ${change.description}`);
    }));
