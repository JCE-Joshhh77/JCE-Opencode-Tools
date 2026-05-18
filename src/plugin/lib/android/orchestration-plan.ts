import type { AndroidAdvancedFlowReport } from "./advanced-flow.js";
import type { AndroidCommandPlan } from "./command-planner.js";

export interface AndroidTaskGraphNode { id: string; title: string; dependsOn: string[]; evidenceRequired: string[]; risk: "low" | "medium" | "high" }
export interface AndroidOrchestrationPlan { nodes: AndroidTaskGraphNode[]; approvalRequired: string[]; memoryUpdates: string[] }

export function buildAndroidOrchestrationPlan(report: AndroidAdvancedFlowReport, commandPlan: AndroidCommandPlan): AndroidOrchestrationPlan {
  const nodes: AndroidTaskGraphNode[] = [
    { id: "android.scan", title: "Scan Android project and profile modules", dependsOn: [], evidenceRequired: ["AndroidProjectScan"], risk: "low" },
    { id: "android.environment", title: "Probe JDK/SDK/adb environment", dependsOn: ["android.scan"], evidenceRequired: ["AndroidEnvironmentProbe"], risk: "low" },
    { id: "android.flow", title: "Select Android flow templates", dependsOn: ["android.scan"], evidenceRequired: report.selectedFlows.map((flow) => flow.title), risk: "low" },
    { id: "android.verify", title: "Run planned Android verification", dependsOn: ["android.flow", "android.environment"], evidenceRequired: commandPlan.commands.filter((command) => command.priority === "required").map((command) => command.command), risk: "medium" },
    { id: "android.evidence", title: "Evaluate Android evidence gate", dependsOn: ["android.verify"], evidenceRequired: ["pass/fail/blocked/insufficient gate result"], risk: "medium" },
    { id: "android.context", title: "Persist Android profile context", dependsOn: ["android.evidence"], evidenceRequired: report.profile.persistentContext, risk: "low" },
  ];
  const approvalRequired = commandPlan.commands.filter((command) => command.releaseSensitive || /bundleRelease|signing|targetSdk|minSdk/.test(command.command)).map((command) => command.command);
  return { nodes, approvalRequired: [...new Set(approvalRequired)], memoryUpdates: report.profile.persistentContext };
}
