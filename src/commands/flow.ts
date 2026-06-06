import { Command } from "commander";
import { scanApiProject } from "../plugin/lib/api/index.js";
import { scanDevopsProject } from "../plugin/lib/devops/index.js";
import { scanSecurityProject } from "../plugin/lib/security-flow/index.js";
import { scanWebProject } from "../plugin/lib/web/index.js";
import { heading, info, success, warn } from "../lib/ui.js";

type FlowKind = "web" | "frontend" | "api" | "devops" | "security";

function scan(kind: FlowKind, root: string): unknown {
  if (kind === "web" || kind === "frontend") return scanWebProject(root);
  if (kind === "api") return scanApiProject(root);
  if (kind === "devops") return scanDevopsProject(root);
  return scanSecurityProject(root);
}

export const flowCommand = new Command("flow")
  .description("Run advanced flow scanners")
  .argument("<kind>", "web, frontend, api, devops, or security")
  .option("--root <path>", "Project root", process.cwd())
  .option("--json", "Print JSON")
  .action((kind: string, options) => {
    if (!["web", "frontend", "api", "devops", "security"].includes(kind)) {
      console.error(`Unknown flow: ${kind}`);
      process.exitCode = 1;
      return;
    }
    const result = scan(kind as FlowKind, options.root);
    if (options.json) { console.log(JSON.stringify(result, null, 2)); return; }
    const data = result as { detected?: boolean; risks?: string[]; verification?: string[]; frontendFlow?: string[]; patternRecommendations?: Array<{ surface: string; recommendedPattern: string; rationale: string }>; visualQa?: { required: boolean; evidence: string[] } };
    heading(`${kind} advanced flow`);
    data.detected ? success("Project signals detected") : warn("No strong project signals detected");
    if (data.verification?.length) info(`Verification: ${data.verification.join(", ")}`);
    if (data.patternRecommendations?.length) {
      info(`UI patterns: ${data.patternRecommendations.map((item) => `${item.surface} -> ${item.recommendedPattern}`).join(", ")}`);
    }
    if (data.frontendFlow?.length) {
      info(`Frontend flow: ${data.frontendFlow.join(" | ")}`);
    }
    if (data.visualQa?.required) info(`Visual QA evidence: ${data.visualQa.evidence.join(", ")}`);
    for (const risk of data.risks?.slice(0, 20) ?? []) warn(risk);
  });
