import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { scanWebProject } from "../../src/plugin/lib/web/index.ts";
import { scanApiProject } from "../../src/plugin/lib/api/index.ts";
import { scanDevopsProject } from "../../src/plugin/lib/devops/index.ts";
import { scanSecurityProject } from "../../src/plugin/lib/security-flow/index.ts";

function fixture(): string { return mkdtempSync(join(tmpdir(), "opencode-jce-flow-")); }

describe("advanced flow filesystem scanners", () => {
  test("scans Next.js routes hooks env and accessibility risks", () => {
    const root = fixture();
    mkdirSync(join(root, "app", "users", "[id]"), { recursive: true });
    writeFileSync(join(root, "next.config.js"), "module.exports = {}", "utf8");
    writeFileSync(join(root, "app", "users", "[id]", "page.tsx"), "'use client'; import {useEffect} from 'react'; const k=process.env.NEXT_PUBLIC_API; export default()=> <img src='/x.png' />", "utf8");
    const scan = scanWebProject(root);
    expect(scan.framework).toBe("nextjs");
    expect(scan.routes.some((route) => route.dynamic)).toBe(true);
    expect(scan.stateHooks).toContain("useEffect");
    expect(scan.envKeys).toContain("NEXT_PUBLIC_API");
    expect(scan.accessibilityRisks.length).toBeGreaterThan(0);
    expect(scan.visualQa.required).toBe(true);
    expect(scan.frontendFlow).toContain("Run visual-qa-rubric with browser screenshots when a runnable app is available.");
  });

  test("recommends frontend UI patterns from route and form signals", () => {
    const root = fixture();
    mkdirSync(join(root, "app", "dashboard"), { recursive: true });
    writeFileSync(join(root, "app", "dashboard", "page.tsx"), "export default()=> <form><input name='q' /></form>", "utf8");
    const scan = scanWebProject(root);

    expect(scan.patternRecommendations.map((item) => item.recommendedPattern)).toEqual(expect.arrayContaining(["Data Dashboard", "Forms / Onboarding"]));
  });

  test("scans API endpoints with auth validation and database signals", () => {
    const root = fixture();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "users.controller.ts"), "export async function GET(){ const user = await prisma.user.findMany(); jwt.verify('x'); schema.parse({}); return user }", "utf8");
    const scan = scanApiProject(root);
    expect(scan.endpoints).toHaveLength(1);
    expect(scan.endpoints[0]?.authSignals).toContain("jwt");
    expect(scan.endpoints[0]?.validationSignals).toContain("schema");
    expect(scan.endpoints[0]?.databaseSignals).toContain("prisma");
  });

  test("scans DevOps workflows and Dockerfile risks", () => {
    const root = fixture();
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    writeFileSync(join(root, "Dockerfile"), "FROM node\nADD . /app\n", "utf8");
    writeFileSync(join(root, ".github", "workflows", "ci.yml"), "on: pull_request_target\njobs:\n  test:\n    steps:\n      - run: echo ${{ secrets.TOKEN }}\n", "utf8");
    const scan = scanDevopsProject(root);
    expect(scan.dockerfiles).toContain("Dockerfile");
    expect(scan.workflows.length).toBeGreaterThan(0);
    expect(scan.findings.some((finding) => finding.severity === "high")).toBe(true);
  });

  test("scans security findings with severity and remediation", () => {
    const root = fixture();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "unsafe.ts"), "const api_key='123456789012345'; el.innerHTML = user; db.query(`SELECT * FROM users WHERE id=${id}`);", "utf8");
    const scan = scanSecurityProject(root);
    expect(scan.findings.some((finding) => finding.severity === "critical")).toBe(true);
    expect(scan.findings.some((finding) => finding.type === "xss")).toBe(true);
    expect(scan.findings.every((finding) => finding.remediation.length > 0)).toBe(true);
  });
});
