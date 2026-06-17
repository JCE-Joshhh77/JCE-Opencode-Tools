import { existsSync } from "fs";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createInterface } from "readline";
import chalk from "chalk";
import { getConfigDir, loadConfigFile } from "./config.js";
import { commandExistsAsync } from "./utils.js";
import type { CheckResult, LspConfig } from "../types.js";
import { info } from "./ui.js";

// ─── Types ───────────────────────────────────────────────────

export interface FixResult {
  name: string;
  fixed: boolean;
  message: string;
}

// ─── Helpers ─────────────────────────────────────────────────

async function runCommand(command: string, args: string[]): Promise<{ success: boolean; output: string }> {
  try {
    const proc = Bun.spawn([command, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    // Read stdout and stderr concurrently to avoid deadlock
    const [output, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { success: exitCode === 0, output: output || stderr };
  } catch (err: any) {
    return { success: false, output: err.message };
  }
}

function preferredOutput(stdout: string, stderr: string): string {
  return [stderr.trim(), stdout.trim()].find(Boolean) ?? "";
}

function summarizeInstallFailure(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) return "Install failed";
  if (/EACCES/i.test(trimmed)) return "Install failed: permission denied writing global npm directory; user-space fallback also failed";
  if (/EBADENGINE|Unsupported engine/i.test(trimmed)) return "Install failed: package requires newer Node.js/npm engine";
  return `Install failed: ${trimmed.slice(0, 140)}`;
}

export function npmUserPrefixPaths(home = homedir()): { prefix: string; bin: string } {
  const prefix = join(home, ".opencode-jce", "npm-global");
  return { prefix, bin: join(prefix, "bin") };
}

async function runNpmInstallWithFallback(args: string[]): Promise<{ success: boolean; output: string; mode: "global" | "user-prefix" }> {
  const globalProc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [globalStdout, globalStderr] = await Promise.all([
    new Response(globalProc.stdout).text(),
    new Response(globalProc.stderr).text(),
  ]);
  const globalExit = await globalProc.exited;
  if (globalExit === 0) return { success: true, output: preferredOutput(globalStdout, globalStderr), mode: "global" };

  const globalOutput = preferredOutput(globalStdout, globalStderr);
  if (!/EACCES|permission denied/i.test(globalOutput)) {
    return { success: false, output: globalOutput, mode: "global" };
  }

  const { prefix, bin } = npmUserPrefixPaths();
  await mkdir(bin, { recursive: true });
  const userArgs = [...args.slice(0, 3), "--prefix", prefix, ...args.slice(3)];
  const userProc = Bun.spawn(userArgs, { stdout: "pipe", stderr: "pipe" });
  const [userStdout, userStderr] = await Promise.all([
    new Response(userProc.stdout).text(),
    new Response(userProc.stderr).text(),
  ]);
  const userExit = await userProc.exited;
  const userOutput = preferredOutput(userStdout, userStderr);
  if (userExit === 0) {
    const delimiter = process.platform === "win32" ? ";" : ":";
    const current = process.env.PATH ?? "";
    if (!current.split(delimiter).includes(bin)) process.env.PATH = `${bin}${delimiter}${current}`;
    return { success: true, output: userOutput, mode: "user-prefix" };
  }

  return { success: false, output: `${globalOutput}\n${userOutput}`.trim(), mode: "user-prefix" };
}

export function getSafeNpmInstallArgs(command: string): string[] | null {
  const parts = command.trim().split(/\s+/);
  if (parts.length < 4) return null;
  if (parts[0] !== "npm" || parts[1] !== "install" || parts[2] !== "-g") return null;

  const packages = parts.slice(3);
  const packagePattern = /^(?:@[a-z0-9._-]+\/[a-z0-9._-]+|[a-z0-9._-]+)(?:@[a-zA-Z0-9._~-]+)?$/;
  if (!packages.every((pkg) => packagePattern.test(pkg))) return null;

  return ["npm", "install", "-g", ...packages];
}

// ─── Fix: Missing Config Files ───────────────────────────────

export async function fixMissingConfigs(): Promise<FixResult[]> {
  const results: FixResult[] = [];
  const configDir = getConfigDir();

  // Ensure config directory exists
  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
    results.push({ name: "Config Directory", fixed: true, message: `Created: ${configDir}` });
  }

  // Ensure subdirectories exist
  const subdirs = ["profiles", "prompts", "skills"];
  for (const dir of subdirs) {
    const dirPath = join(configDir, dir);
    if (!existsSync(dirPath)) {
      await mkdir(dirPath, { recursive: true });
      results.push({ name: `${dir}/`, fixed: true, message: `Created directory` });
    }
  }

  // Check for missing main config files — try to restore from repo defaults
  const requiredFiles = ["agents.json", "mcp.json", "lsp.json"];
  for (const file of requiredFiles) {
    const filePath = join(configDir, file);
    if (!existsSync(filePath)) {
      // Try to download from GitHub
      try {
        const url = `https://raw.githubusercontent.com/JCETools-Petra/JCE-Opencode-Tools/main/config/${file}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (response.ok) {
          const content = await response.text();
          try { JSON.parse(content); } catch { continue; } // Skip non-JSON responses
          await writeFile(filePath, content, "utf-8");
          results.push({ name: file, fixed: true, message: "Downloaded from repository" });
        } else {
          results.push({ name: file, fixed: false, message: "Could not download — create manually" });
        }
      } catch {
        results.push({ name: file, fixed: false, message: "No internet — cannot restore" });
      }
    }
  }

  return results;
}

// ─── Fix: Missing LSP Servers ────────────────────────────────

interface MissingLsp {
  name: string;
  command: string;
  installCommand: string;
  autoFixable: boolean;
}

type PackageManager = "apt" | "dnf" | "pacman" | "brew" | "unknown";
type StrategyKind = "npm" | "rust" | "go" | "java" | "cpp" | "csharp" | "kotlin" | "dart" | "lua" | "markdown" | "toml" | "ruby" | "elixir" | "scala" | "system" | "manual";

interface AutoFixStrategy {
  kind: StrategyKind;
  label: string;
}

function currentPlatform(): "windows" | "macos" | "linux" {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

async function detectPackageManager(): Promise<PackageManager> {
  if (currentPlatform() === "macos") return "brew";
  if (await commandExistsAsync("apt-get")) return "apt";
  if (await commandExistsAsync("dnf")) return "dnf";
  if (await commandExistsAsync("pacman")) return "pacman";
  return "unknown";
}

function userBinDir(): string {
  return join(homedir(), ".opencode-jce", "bin");
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

function prependPath(path: string): void {
  const delimiter = process.platform === "win32" ? ";" : ":";
  const current = process.env.PATH ?? "";
  if (!current.split(delimiter).includes(path)) process.env.PATH = `${path}${delimiter}${current}`;
}

async function runShell(command: string): Promise<{ success: boolean; output: string }> {
  if (process.platform === "win32") return runCommand("powershell", ["-NoProfile", "-Command", command]);
  return runCommand("bash", ["-lc", command]);
}

async function ensureWingetPackage(id: string): Promise<{ success: boolean; output: string }> {
  return runCommand("winget", ["install", "-e", "--id", id, "--accept-package-agreements", "--accept-source-agreements"]);
}

async function installSystemPackages(packages: string[]): Promise<{ success: boolean; output: string }> {
  const pkgMgr = await detectPackageManager();
  if (pkgMgr === "apt") return runShell(`sudo apt-get update && sudo apt-get install -y ${packages.join(" ")}`);
  if (pkgMgr === "dnf") return runShell(`sudo dnf install -y ${packages.join(" ")}`);
  if (pkgMgr === "pacman") return runShell(`sudo pacman -S --noconfirm ${packages.join(" ")}`);
  if (pkgMgr === "brew") return runShell(`brew install ${packages.join(" ")}`);
  return { success: false, output: "No supported system package manager detected" };
}

async function downloadGithubReleaseAsset(repo: string, pattern: RegExp, destination: string): Promise<{ success: boolean; output: string }> {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { "User-Agent": "opencode-jce" }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) return { success: false, output: `GitHub API returned ${response.status}` };
    const data = await response.json() as { assets?: Array<{ browser_download_url: string; name: string }> };
    const asset = (data.assets ?? []).find((item) => pattern.test(item.name));
    if (!asset) return { success: false, output: `No release asset matched ${pattern}` };
    const file = await fetch(asset.browser_download_url, { headers: { "User-Agent": "opencode-jce" }, signal: AbortSignal.timeout(30000) });
    if (!file.ok) return { success: false, output: `Asset download returned ${file.status}` };
    const bytes = Buffer.from(await file.arrayBuffer());
    await Bun.write(destination, bytes);
    return { success: true, output: asset.browser_download_url };
  } catch (err: any) {
    return { success: false, output: err?.message ?? String(err) };
  }
}

export function classifyLspAutoFixStrategy(name: string, installCommand: string, platform = currentPlatform()): AutoFixStrategy {
  if (getSafeNpmInstallArgs(installCommand)) return { kind: "npm", label: "npm global install" };
  const lower = name.toLowerCase();
  if (lower === "rust") return { kind: "rust", label: platform === "windows" ? "rustup/winget" : "rustup/system package" };
  if (lower === "go") return { kind: "go", label: platform === "windows" ? "winget + go install" : "go install" };
  if (lower === "java") return { kind: "java", label: platform === "windows" ? "winget + jdtls shim" : "jdtls bootstrap" };
  if (lower === "c/c++") return { kind: "cpp", label: platform === "windows" ? "winget llvm" : "system package" };
  if (lower === "c#") return { kind: "csharp", label: "dotnet tool" };
  if (lower === "kotlin") return { kind: "kotlin", label: "GitHub release bootstrap" };
  if (lower === "dart") return { kind: "dart", label: platform === "windows" ? "winget dart sdk" : "dart sdk bootstrap" };
  if (lower === "lua") return { kind: "lua", label: platform === "windows" ? "winget lua-language-server" : "system package" };
  if (lower === "markdown") return { kind: "markdown", label: platform === "windows" ? "winget marksman" : "marksman bootstrap" };
  if (lower === "toml") return { kind: "toml", label: "cargo install" };
  if (lower === "ruby") return { kind: "ruby", label: "gem install" };
  if (lower === "elixir") return { kind: "elixir", label: platform === "windows" ? "npm next-ls" : "mix archive" };
  if (lower === "scala") return { kind: "scala", label: "coursier install" };
  if (/sudo apt-get|dnf install|pacman -S|brew install/.test(installCommand)) return { kind: "system", label: "system package manager" };
  return { kind: "manual", label: "manual" };
}

async function installRustAnalyzer(): Promise<{ success: boolean; output: string }> {
  if (currentPlatform() === "windows" && !(await commandExistsAsync("rustup"))) {
    const winget = await ensureWingetPackage("Rustlang.Rustup");
    if (!winget.success) return winget;
  }
  if (await commandExistsAsync("rustup")) return runCommand("rustup", ["component", "add", "rust-analyzer"]);
  return installSystemPackages(["rust-analyzer"]);
}

async function installGoLsp(): Promise<{ success: boolean; output: string }> {
  if (!(await commandExistsAsync("go"))) {
    if (currentPlatform() === "windows") {
      const winget = await ensureWingetPackage("GoLang.Go");
      if (!winget.success) return winget;
    } else {
      const pkg = await installSystemPackages(["golang-go"]);
      if (!pkg.success) return pkg;
    }
  }
  const result = await runCommand("go", ["install", "golang.org/x/tools/gopls@latest"]);
  if (result.success) prependPath(join(homedir(), "go", "bin"));
  return result;
}

async function installClangd(): Promise<{ success: boolean; output: string }> {
  if (currentPlatform() === "windows") {
    const winget = await ensureWingetPackage("LLVM.LLVM");
    if (winget.success) prependPath("C:\\Program Files\\LLVM\\bin");
    return winget;
  }
  return installSystemPackages(["clangd"]);
}

async function installCsharpLs(): Promise<{ success: boolean; output: string }> {
  if (!(await commandExistsAsync("dotnet"))) {
    if (currentPlatform() === "windows") {
      const winget = await ensureWingetPackage("Microsoft.DotNet.SDK.8");
      if (!winget.success) return winget;
    } else {
      const pkg = await installSystemPackages(["dotnet-sdk-8.0"]);
      if (!pkg.success) return pkg;
    }
  }
  let result = await runCommand("dotnet", ["tool", "install", "-g", "csharp-ls"]);
  if (!result.success) result = await runCommand("dotnet", ["tool", "update", "-g", "csharp-ls"]);
  if (result.success) prependPath(join(homedir(), ".dotnet", "tools"));
  return result;
}

async function installTaplo(): Promise<{ success: boolean; output: string }> {
  if (!(await commandExistsAsync("cargo"))) {
    const rust = await installRustAnalyzer();
    if (!rust.success && !(await commandExistsAsync("cargo"))) return { success: false, output: rust.output };
  }
  const result = await runCommand("cargo", ["install", "taplo-cli", "--features", "lsp"]);
  if (result.success) prependPath(join(homedir(), ".cargo", "bin"));
  return result;
}

async function installSolargraph(): Promise<{ success: boolean; output: string }> {
  if (!(await commandExistsAsync("gem"))) {
    const pkg = await installSystemPackages(["ruby", "ruby-dev"]);
    if (!pkg.success) return pkg;
  }
  return runCommand("gem", ["install", "solargraph"]);
}

async function installElixirLs(): Promise<{ success: boolean; output: string }> {
  if (currentPlatform() === "windows") return runNpmInstallWithFallback(["npm", "install", "-g", "@elixir-tools/next-ls"]);
  if (!(await commandExistsAsync("mix"))) {
    const pkg = await installSystemPackages(["elixir", "erlang"]);
    if (!pkg.success) return pkg;
  }
  let result = await runCommand("mix", ["local.hex", "--force"]);
  if (!result.success) return result;
  return runCommand("mix", ["archive.install", "hex", "elixir_ls", "--force"]);
}

async function ensureCoursier(): Promise<{ success: boolean; output: string }> {
  if (await commandExistsAsync("cs")) return { success: true, output: "coursier already installed" };
  const binDir = userBinDir();
  await ensureDir(binDir);
  const destination = join(binDir, process.platform === "win32" ? "cs.exe" : "cs");
  if (currentPlatform() === "windows") {
    const download = await downloadGithubReleaseAsset("coursier/launchers", /cs-x86_64-pc-win32\.zip$/i, join(binDir, "cs.zip"));
    if (!download.success) return download;
    const unzip = await runShell(`powershell -NoProfile -Command "Expand-Archive -Path '${join(binDir, "cs.zip")}' -DestinationPath '${binDir}' -Force"`);
    if (!unzip.success) return unzip;
  } else {
    const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
    const url = `https://github.com/coursier/launchers/raw/master/cs-${arch}-pc-linux.gz`;
    const result = await runShell(`curl -fsSL '${url}' -o '${destination}.gz' && gunzip -f '${destination}.gz' && chmod 755 '${destination}'`);
    if (!result.success) return result;
  }
  prependPath(binDir);
  return { success: true, output: destination };
}

async function installMetals(): Promise<{ success: boolean; output: string }> {
  const cs = await ensureCoursier();
  if (!cs.success) return cs;
  const result = await runCommand("cs", ["install", "metals"]);
  if (result.success) prependPath(currentPlatform() === "windows" ? join(homedir(), ".local", "share", "coursier", "bin") : join(homedir(), ".local", "share", "coursier", "bin"));
  return result;
}

async function installMarksman(): Promise<{ success: boolean; output: string }> {
  if (currentPlatform() === "windows") {
    const winget = await ensureWingetPackage("Artempyanykh.Marksman");
    if (winget.success) prependPath(join(homedir(), "AppData", "Local", "Microsoft", "WinGet", "Links"));
    return winget;
  }
  const binDir = userBinDir();
  await ensureDir(binDir);
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const download = await downloadGithubReleaseAsset("artempyanykh/marksman", new RegExp(`marksman-linux-${arch}$`, "i"), join(binDir, "marksman"));
  if (download.success) {
    await runShell(`chmod 755 '${join(binDir, "marksman")}'`);
    prependPath(binDir);
    return { success: true, output: join(binDir, "marksman") };
  }
  if (!(await commandExistsAsync("cargo"))) return download;
  const cargo = await runCommand("cargo", ["install", "marksman"]);
  if (cargo.success) prependPath(join(homedir(), ".cargo", "bin"));
  return cargo;
}

async function installJdtls(): Promise<{ success: boolean; output: string }> {
  const binDir = userBinDir();
  const lspDir = join(homedir(), ".opencode-jce", "lsp", "jdtls");
  await ensureDir(binDir);
  await ensureDir(lspDir);
  if (!(await commandExistsAsync("java"))) {
    const dep = currentPlatform() === "windows"
      ? await ensureWingetPackage("EclipseAdoptium.Temurin.21.JDK")
      : await installSystemPackages(["openjdk-21-jre-headless"]);
    if (!dep.success) return dep;
  }
  const archive = join(lspDir, currentPlatform() === "windows" ? "jdtls-latest.tar.gz" : "jdtls-latest.tar.gz");
  const downloaded = await runShell(`curl -fsSL 'https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz' -o '${archive}'`);
  if (!downloaded.success) return downloaded;
  const extracted = await runShell(currentPlatform() === "windows"
    ? `tar -xzf '${archive}' -C '${lspDir}'`
    : `tar -xzf '${archive}' -C '${lspDir}'`);
  if (!extracted.success) return extracted;
  const launcherPath = join(lspDir, "plugins");
  const shimPath = join(binDir, currentPlatform() === "windows" ? "jdtls.cmd" : "jdtls");
  if (currentPlatform() === "windows") {
    await Bun.write(shimPath, `@echo off\r\nsetlocal\r\nfor %%f in ("${launcherPath.replace(/\\/g, "\\\\")}\\org.eclipse.equinox.launcher_*.jar") do set JDTLS_LAUNCHER=%%f\r\njava -jar "%JDTLS_LAUNCHER%" -configuration "${join(lspDir, "config_win").replace(/\\/g, "\\\\")}" -data "%USERPROFILE%\\.jdtls-workspace" %*\r\n`);
  } else {
    await Bun.write(shimPath, `#!/usr/bin/env sh\nJDTLS_HOME='${lspDir}'\nJDTLS_LAUNCHER=$(find "$JDTLS_HOME/plugins" -name 'org.eclipse.equinox.launcher_*.jar' -print -quit)\nexec java -jar "$JDTLS_LAUNCHER" -configuration "$JDTLS_HOME/config_linux" -data "$HOME/.jdtls-workspace" "$@"\n`);
    await runShell(`chmod 755 '${shimPath}'`);
  }
  prependPath(binDir);
  return { success: true, output: shimPath };
}

async function installKotlinLanguageServer(): Promise<{ success: boolean; output: string }> {
  const binDir = userBinDir();
  const installDir = join(homedir(), ".opencode-jce", "lsp", "kotlin-language-server");
  await ensureDir(binDir);
  await ensureDir(installDir);
  const archive = join(installDir, "server.zip");
  const download = await downloadGithubReleaseAsset("fwcd/kotlin-language-server", /server\.zip$/i, archive);
  if (!download.success) return download;
  const unzipCommand = currentPlatform() === "windows"
    ? `powershell -NoProfile -Command "Expand-Archive -Path '${archive}' -DestinationPath '${installDir}' -Force"`
    : `unzip -qo '${archive}' -d '${installDir}'`;
  const unzip = await runShell(unzipCommand);
  if (!unzip.success) return unzip;
  const target = currentPlatform() === "windows"
    ? join(binDir, "kotlin-language-server.cmd")
    : join(binDir, "kotlin-language-server");
  if (currentPlatform() === "windows") {
    await Bun.write(target, `@echo off\r\n"${join(installDir, "server", "bin", "kotlin-language-server.bat")}" %*\r\n`);
  } else {
    const serverBin = join(installDir, "server", "bin", "kotlin-language-server");
    await runShell(`chmod 755 '${serverBin}' && ln -sf '${serverBin}' '${target}' && chmod 755 '${target}'`);
  }
  prependPath(binDir);
  return { success: true, output: target };
}

async function installDartSdk(): Promise<{ success: boolean; output: string }> {
  if (currentPlatform() === "windows") {
    const winget = await ensureWingetPackage("Google.DartSDK");
    if (winget.success) prependPath("C:\\tools\\dart-sdk\\bin");
    return winget;
  }
  const pkgMgr = await detectPackageManager();
  if (pkgMgr !== "apt") return installSystemPackages(["dart"]);
  return runShell("sudo apt-get update && sudo apt-get install -y apt-transport-https ca-certificates curl gnupg && sudo install -d -m 0755 /usr/share/keyrings && curl -fsSL https://dl-ssl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/dart.gpg && echo \"deb [signed-by=/usr/share/keyrings/dart.gpg arch=$(dpkg --print-architecture)] https://storage.googleapis.com/download.dartlang.org/linux/debian stable main\" | sudo tee /etc/apt/sources.list.d/dart_stable.list >/dev/null && sudo apt-get update && sudo apt-get install -y dart");
}

async function installLuaLanguageServer(): Promise<{ success: boolean; output: string }> {
  if (currentPlatform() === "windows") {
    const winget = await ensureWingetPackage("LuaLS.lua-language-server");
    if (winget.success) prependPath(join(homedir(), "AppData", "Local", "Microsoft", "WinGet", "Links"));
    return winget;
  }
  return installSystemPackages(["lua-language-server"]);
}

async function installViaStrategy(server: MissingLsp): Promise<{ success: boolean; output: string; mode: string }> {
  const strategy = classifyLspAutoFixStrategy(server.name, server.installCommand);
  switch (strategy.kind) {
    case "npm": {
      const result = await runNpmInstallWithFallback(getSafeNpmInstallArgs(server.installCommand)!);
      return { ...result, mode: result.mode };
    }
    case "rust": { const r = await installRustAnalyzer(); return { ...r, mode: strategy.label }; }
    case "go": { const r = await installGoLsp(); return { ...r, mode: strategy.label }; }
    case "java": { const r = await installJdtls(); return { ...r, mode: strategy.label }; }
    case "cpp": { const r = await installClangd(); return { ...r, mode: strategy.label }; }
    case "csharp": { const r = await installCsharpLs(); return { ...r, mode: strategy.label }; }
    case "kotlin": { const r = await installKotlinLanguageServer(); return { ...r, mode: strategy.label }; }
    case "dart": { const r = await installDartSdk(); return { ...r, mode: strategy.label }; }
    case "lua": { const r = await installLuaLanguageServer(); return { ...r, mode: strategy.label }; }
    case "markdown": { const r = await installMarksman(); return { ...r, mode: strategy.label }; }
    case "toml": { const r = await installTaplo(); return { ...r, mode: strategy.label }; }
    case "ruby": { const r = await installSolargraph(); return { ...r, mode: strategy.label }; }
    case "elixir": { const r = await installElixirLs(); return { ...r, mode: strategy.label }; }
    case "scala": { const r = await installMetals(); return { ...r, mode: strategy.label }; }
    case "system": { const r = await installSystemPackages([server.command]); return { ...r, mode: strategy.label }; }
    default:
      return { success: false, output: `Not auto-fixable. Run manually: ${server.installCommand}`, mode: strategy.label };
  }
}

async function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function fixMissingLsp(): Promise<FixResult[]> {
  const results: FixResult[] = [];

  let lspConfig: LspConfig;
  try {
    lspConfig = await loadConfigFile<LspConfig>("lsp.json");
  } catch {
    results.push({ name: "LSP Config", fixed: false, message: "Cannot load lsp.json — run fix for configs first" });
    return results;
  }

  // Find all missing LSP servers
  const servers = Object.entries(lspConfig.lsp);
  const missingServers: MissingLsp[] = [];

  for (const [name, entry] of servers) {
    const exists = await commandExistsAsync(entry.command);
    if (!exists) {
      missingServers.push({
        name,
        command: entry.command,
        installCommand: entry.installCommand,
        autoFixable: classifyLspAutoFixStrategy(name, entry.installCommand).kind !== "manual",
      });
    }
  }

  if (missingServers.length === 0) {
    return results;
  }

  // Display missing LSP servers with numbers
  console.log();
  console.log(chalk.white("  Missing LSP servers:"));
  console.log();

  missingServers.forEach((server, index) => {
    const num = String(index + 1).padStart(2);
    const tag = server.autoFixable ? chalk.green("[auto]") : chalk.yellow("[manual]");
    console.log(`  ${num}. ${server.name} ${tag} — ${chalk.dim(server.installCommand)}`);
  });

  console.log();
  console.log(chalk.yellow("  a = Install all fixable    s = Skip"));
  console.log(chalk.yellow("  Or enter numbers: 1,3,5"));
  console.log();

  const choice = await promptUser("  Your choice: ");

  // Parse selection
  let selected: MissingLsp[] = [];

  if (/^[aA]$/.test(choice)) {
    selected = missingServers.filter((s) => s.autoFixable);
    for (const server of missingServers.filter((s) => !s.autoFixable)) {
      results.push({
        name: `LSP: ${server.name}`,
        fixed: false,
        message: `Not auto-fixable. Run manually: ${server.installCommand}`,
      });
    }
  } else if (/^[sS]?$/.test(choice)) {
    info("Skipping LSP fix.");
    return results;
  } else {
    const nums = choice.split(",").map((n) => parseInt(n.trim(), 10)).filter((n) => !isNaN(n));
    for (const num of nums) {
      const server = missingServers[num - 1];
      if (server) {
        if (server.autoFixable) {
          selected.push(server);
        } else {
          results.push({
            name: `LSP: ${server.name}`,
            fixed: false,
            message: `Not auto-fixable. Run manually: ${server.installCommand}`,
          });
        }
      }
    }
  }

  if (selected.length === 0) {
    info("No auto-fixable LSP servers selected.");
    return results;
  }

  // Check if npm is available
  const hasNpm = await commandExistsAsync("npm");
  if (!hasNpm) {
    for (const server of selected) {
      results.push({
        name: `LSP: ${server.name}`,
        fixed: false,
        message: "npm not found — install Node.js first",
      });
    }
    return results;
  }

  // Install selected servers
  console.log();
  info(`Installing ${selected.length} LSP server(s)...`);
  console.log();

  for (const server of selected) {
    process.stdout.write(`  Installing ${server.name}... `);
    const result = await installViaStrategy(server);
    if (result.success) {
      console.log(chalk.green("[OK]"));
      const message = result.mode === "user-prefix"
        ? "Installed via npm user prefix (~/.opencode-jce/npm-global)"
        : `Installed via ${result.mode}`;
      results.push({ name: `LSP: ${server.name}`, fixed: true, message });
    } else {
      console.log(chalk.red("[FAIL]"));
      results.push({ name: `LSP: ${server.name}`, fixed: false, message: summarizeInstallFailure(result.output) });
    }
  }

  return results;
}

// ─── Fix: Missing Tools ──────────────────────────────────────

export async function fixMissingTools(allowGlobalInstall = false): Promise<FixResult[]> {
  const results: FixResult[] = [];

  // Check OpenCode CLI
  const hasOpencode = await commandExistsAsync("opencode");
  if (!hasOpencode) {
    if (!allowGlobalInstall) {
      results.push({ name: "OpenCode CLI", fixed: false, message: "Global install skipped. Re-run with --install-tools to install via bun." });
      return results;
    }

    const hasBun = await commandExistsAsync("bun");
    if (hasBun) {
      const result = await runCommand("bun", ["install", "-g", "opencode"]);
      if (result.success) {
        results.push({ name: "OpenCode CLI", fixed: true, message: "Installed via bun" });
      } else {
        results.push({ name: "OpenCode CLI", fixed: false, message: "bun install -g opencode failed" });
      }
    } else {
      results.push({ name: "OpenCode CLI", fixed: false, message: "Bun not installed — install Bun first" });
    }
  }

  return results;
}

// ─── Fix: Merge LSP to opencode.json ─────────────────────────

export async function fixLspConfig(): Promise<FixResult[]> {
  const results: FixResult[] = [];

  try {
    // Try multiple ways to find the CLI
    const configDir = getConfigDir();
    const cliPath = join(configDir, "cli", "src", "index.ts");
    const hasGlobalCli = await commandExistsAsync("opencode-jce");

    if (hasGlobalCli) {
      // Prefer globally installed CLI
      const result = await runCommand("opencode-jce", ["setup", "--merge-lsp"]);
      if (result.success) {
        results.push({ name: "opencode.json LSP", fixed: true, message: "LSP servers merged into opencode.json" });
      } else {
        results.push({ name: "opencode.json LSP", fixed: false, message: "Merge failed — run 'opencode-jce setup --merge-lsp' manually" });
      }
    } else if (existsSync(cliPath)) {
      // Fallback to local CLI in config dir
      const result = await runCommand("bun", ["run", cliPath, "setup", "--merge-lsp"]);
      if (result.success) {
        results.push({ name: "opencode.json LSP", fixed: true, message: "LSP servers merged into opencode.json" });
      } else {
        results.push({ name: "opencode.json LSP", fixed: false, message: "Merge failed — run 'opencode-jce setup --merge-lsp' manually" });
      }
    } else {
      results.push({ name: "opencode.json LSP", fixed: false, message: "CLI not found — reinstall opencode-jce" });
    }
  } catch {
    results.push({ name: "opencode.json LSP", fixed: false, message: "Unexpected error during LSP merge" });
  }

  return results;
}

// ─── Fix: Missing context-keeper MCP ─────────────────────────

export async function fixContextKeeper(): Promise<FixResult[]> {
  const results: FixResult[] = [];
  const configDir = getConfigDir();
  const opencodeJsonPath = join(configDir, "opencode.json");
  const contextKeeperPath = join(configDir, "cli", "src", "mcp", "context-keeper.ts");

  // Check if context-keeper.ts exists
  if (!existsSync(contextKeeperPath)) {
    results.push({
      name: "context-keeper file",
      fixed: false,
      message: `File missing: ${contextKeeperPath}. Run 'opencode-jce update' or reinstall.`,
    });
    return results;
  }

  if (!existsSync(opencodeJsonPath)) {
    const { buildDefaultOpenCodeJson } = await import("./opencode-json-template.js");
    const { buildAgentConfigs } = await import("../plugin/config.js");
    const template = buildDefaultOpenCodeJson(configDir, buildAgentConfigs());
    await writeFile(
      opencodeJsonPath,
      JSON.stringify(template, null, 2) + "\n",
      "utf-8"
    );
    results.push({
      name: "opencode.json",
      fixed: true,
      message: "Created OpenCode config with MCP servers pre-configured.",
    });
  }

  try {
    const content = await readFile(opencodeJsonPath, "utf-8");
    const config = JSON.parse(content);

    if (!config.mcp) config.mcp = {};

    if (config.mcp["context-keeper"]) {
      // Already registered — nothing to fix
      return results;
    }

    // Normalize path (forward slashes)
    const normalizedPath = contextKeeperPath.replace(/\\/g, "/");

    config.mcp["context-keeper"] = {
      type: "local",
      command: ["bun", "run", normalizedPath],
      env: { PROJECT_ROOT: "${PROJECT_ROOT}" },
      enabled: true,
    };

    await writeFile(opencodeJsonPath, JSON.stringify(config, null, 2) + "\n");
    results.push({
      name: "context-keeper",
      fixed: true,
      message: "Registered in opencode.json. Restart OpenCode to activate.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name: "context-keeper", fixed: false, message: `Failed: ${msg}` });
  }

  return results;
}

// ─── Master Fix Function ─────────────────────────────────────

export async function runAllFixes(failedChecks: CheckResult[], options: { installTools?: boolean } = {}): Promise<FixResult[]> {
  const allResults: FixResult[] = [];

  const hasConfigErrors = failedChecks.some(
    (r) => r.name.includes("Config") || r.name.includes(".json") || r.name.includes("profiles")
  );
  const hasLspErrors = failedChecks.some((r) => r.name.startsWith("LSP:"));
  const hasToolErrors = failedChecks.some(
    (r) => r.name === "OpenCode CLI" && r.status !== "pass"
  );
  const hasContextKeeperError = failedChecks.some(
    (r) => r.name.includes("context-keeper") && r.status !== "pass"
  );

  // Fix in order: configs → tools → context-keeper → LSP → merge
  if (hasConfigErrors) {
    info("Fixing missing configuration files...");
    const configResults = await fixMissingConfigs();
    allResults.push(...configResults);
  }

  if (hasToolErrors) {
    info("Fixing missing tools...");
    const toolResults = await fixMissingTools(options.installTools === true);
    allResults.push(...toolResults);
  }

  if (hasContextKeeperError) {
    info("Fixing context-keeper MCP registration...");
    const ckResults = await fixContextKeeper();
    allResults.push(...ckResults);
  }

  if (hasLspErrors) {
    info("Fixing missing LSP servers...");
    const lspResults = await fixMissingLsp();
    allResults.push(...lspResults);

    // After installing LSP servers, merge into opencode.json
    const hasNewLsp = lspResults.some((r) => r.fixed);
    if (hasNewLsp) {
      info("Merging new LSP servers into opencode.json...");
      const mergeResults = await fixLspConfig();
      allResults.push(...mergeResults);
    }
  }

  return allResults;
}
