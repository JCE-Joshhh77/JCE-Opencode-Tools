import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import {
  buildReleaseReadyReport,
  buildCodeTaskPlan,
  buildProjectLearningReport,
  buildAndroidFailureTriage,
  buildAndroidVerificationRecipeReport,
  buildSafeCommitPlan,
  buildVerificationRecipe,
  buildWorkflowSummary,
  parseGitStatusPorcelain,
  type WorkflowRecipeTaskType,
} from "../lib/workflow-assistant.js";

const z = tool.schema;

function readGitStatus(cwd: string): string {
  try {
    return execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } catch {
    return "";
  }
}

function readVersion(cwd: string): string | undefined {
  const constantsPath = join(cwd, "src/lib/constants.ts");
  if (!existsSync(constantsPath)) return undefined;
  const match = readFileSync(constantsPath, "utf8").match(/VERSION\s*=\s*"([^"]+)"/);
  return match?.[1];
}

function readReleaseFiles(cwd: string): Record<string, string | undefined> {
  const files = [
    "package.json",
    "install.sh",
    "install.ps1",
    "src/lib/constants.ts",
    "src/lib/version.ts",
    "src/mcp/context-keeper.ts",
    "README.md",
    "tests/unit/ui.test.ts",
  ];

  return Object.fromEntries(files.map((file) => {
    const path = join(cwd, file);
    return [file, existsSync(path) ? readFileSync(path, "utf8") : undefined];
  }));
}

export function buildWorkflowTool(): ToolDefinition {
  return tool({
    description: "Read-only JCE workflow helper for summaries, verification recipes, safe commit plans, and release readiness.",
    args: {
      action: z.enum(["summary", "verification_recipe", "safe_commit_plan", "release_ready", "code_task_plan", "project_learning", "android_verification_recipe", "android_failure_triage"]),
      scope: z.string().optional(),
      taskType: z.enum(["agent_prompt", "bugfix", "feature", "refactor", "config", "installer", "release", "docs", "tests", "unknown"]).optional(),
      includeDocs: z.boolean().optional(),
      release: z.boolean().optional(),
      targetVersion: z.string().optional(),
      verificationEvidence: z.string().optional(),
      gitStatus: z.string().optional().describe("Optional git status --porcelain text for tests or explicit input"),
    },
    async execute(args, context) {
      const cwd = context.directory || context.worktree || process.cwd();
      const statusText = typeof args.gitStatus === "string" ? args.gitStatus : readGitStatus(cwd);
      const statusFiles = parseGitStatusPorcelain(statusText);

      switch (args.action) {
      case "summary":
        return buildWorkflowSummary({ scope: args.scope as string | undefined, files: statusFiles, currentVersion: readVersion(cwd) });
      case "verification_recipe":
        return buildVerificationRecipe((args.taskType as WorkflowRecipeTaskType | undefined) ?? "unknown");
      case "safe_commit_plan":
        return buildSafeCommitPlan(statusFiles, { includeDocs: Boolean(args.includeDocs), release: Boolean(args.release) });
      case "release_ready":
        if (typeof args.targetVersion !== "string") return "Status\nNOT_READY\n\nBlockers\n- targetVersion is required";
        return buildReleaseReadyReport({
          targetVersion: args.targetVersion,
          files: readReleaseFiles(cwd),
          statusFiles,
          includeDocs: Boolean(args.includeDocs),
          verificationEvidence: args.verificationEvidence as string | undefined,
        });
      case "code_task_plan":
        return buildCodeTaskPlan({
          taskType: args.taskType as any,
          scope: args.scope as string | undefined,
          changedFiles: statusFiles.map((file) => file.path),
        });
      case "project_learning": {
        const packageJsonPath = join(cwd, "package.json");
        return buildProjectLearningReport({
          packageJson: existsSync(packageJsonPath) ? readFileSync(packageJsonPath, "utf8") : undefined,
          files: statusFiles,
        });
      }
      case "android_verification_recipe":
        return buildAndroidVerificationRecipeReport({
          scope: args.scope as string | undefined,
          changedFiles: statusFiles.map((file) => file.path),
        });
      case "android_failure_triage":
        return buildAndroidFailureTriage((args.scope as string | undefined) ?? "");
      default:
        return "Unknown jce_workflow action.";
      }
    },
  });
}
