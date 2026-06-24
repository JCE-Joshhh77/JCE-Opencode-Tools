import { describe, test, expect } from "bun:test";
import { $ } from "bun";
import { readFileSync } from "fs";

const pkgVersion = JSON.parse(readFileSync("package.json", "utf-8")).version;

async function runCli(args: string[], timeoutMs = 10000): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const proc = Bun.spawn(["bun", "run", "src/index.ts", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  const exited = await Promise.race([
    proc.exited,
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), timeoutMs)),
  ]);
  if (exited === "timeout") {
    proc.kill();
    throw new Error(`${args.join(" ") || "CLI"} timed out after ${timeoutMs}ms`);
  }
  const [stdoutText, stderrText] = await Promise.all([stdout, stderr]);
  return { stdout: stdoutText, stderr: stderrText, exitCode: exited };
}

describe("CLI Commands", () => {
  test("--help shows all commands", async () => {
    const { stdout: result } = await runCli(["--help"]);
    expect(result).toContain("validate");
    expect(result).toContain("use");
    expect(result).toContain("doctor");
    expect(result).toContain("uninstall");
    expect(result).toContain("update");
    expect(result).toContain("setup");
    expect(result).toContain("route");
    expect(result).toContain("tokens");
    expect(result).toContain("optimize");
    expect(result).toContain("agent");
    expect(result).toContain("prompts");
    expect(result).toContain("plugin");
    expect(result).toContain("team");
    expect(result).toContain("memory");
    expect(result).toContain("dashboard");
    expect(result).toContain("fallback");
  });

  test("--version shows version", async () => {
    const result = await $`bun run src/index.ts --version`.text();
    expect(result.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.trim()).toBe(pkgVersion);
  });

  test("validate command runs without crash", async () => {
    const proc = await runCli(["validate"], 15000);
    // May exit 1 if no config deployed, but shouldn't crash
    expect([0, 1]).toContain(proc.exitCode as number);
  }, 20000);

  test("use --list runs without crash", async () => {
    const proc = await runCli(["use", "--list"]);
    expect([0, 1]).toContain(proc.exitCode as number);
  });

  test("route command runs without crash", async () => {
    const proc = await runCli(["route", "hello world"]);
    expect([0, 1]).toContain(proc.exitCode as number);
  });

  test("agent list runs", async () => {
    const proc = await runCli(["agent", "list"]);
    expect([0, 1]).toContain(proc.exitCode as number);
  });

  test("prompts list runs without crash", async () => {
    const proc = await runCli(["prompts", "list"]);
    expect([0, 1]).toContain(proc.exitCode as number);
  });
});
