<div align="center">

# OpenCode JCE

### A practical agent toolkit for OpenCode CLI

[![CI](https://github.com/JCETools-Petra/JCE-Opencode-Tools/actions/workflows/ci.yml/badge.svg)](https://github.com/JCETools-Petra/JCE-Opencode-Tools/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-3.8.34-green)]()
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-brightgreen)]()

**Install once. Get structured agents, workflows, orchestration, MCP tools, LSP config, and safer updates.**

[Install](#install) · [Agents](#agents) · [Commands](#commands) · [Donate](#donate--buy-me-a-coffee)

</div>

---

## What Is This?

OpenCode JCE is a plugin and installer for the OpenCode CLI. It adds structured agent workflows, orchestration, config tools, MCP integrations, LSP setup, and maintenance commands, so OpenCode works more like a complete coding environment for daily engineering work.

## How JCE-Worker Works

`jce-worker` is the main execution coordinator. It behaves like a disciplined engineering lead rather than a single general chatbot:

```text
User request
  -> Understand intent
  -> Plan the work
  -> Execute directly or delegate to specialist agents
  -> Review the result
  -> Verify with evidence
  -> Report completion or blockers
```

Core rule:

```text
Plan -> Execute -> Review -> Verify -> Report
```

If evidence is missing, JCE-Worker reports that explicitly instead of claiming the task is done.

Specialist routing:

- `explorer` → fast codebase mapping and file discovery
- `jce-researcher` → docs, library behavior, GitHub and web research
- `oracle` → hard debugging, architecture, and trade-off analysis
- `frontend` → UI, styling, accessibility, and responsive work
- `android` → native Android Gradle/Kotlin/Compose/logcat/release diagnostics

## Install

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/JCETools-Petra/JCE-Opencode-Tools/main/install.sh | bash
```

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/JCETools-Petra/JCE-Opencode-Tools/main/install.ps1 | iex
```

After install:

```bash
opencode-jce --version
opencode-jce doctor
```

Install path:

```text
Linux/macOS: ~/.bun/bin/opencode-jce
Windows:     %USERPROFILE%\.bun\bin\opencode-jce.cmd
```

## What Gets Installed

- JCE-Worker orchestration workflow with planning, delegation, review, and verification gates
- 42 AI agent definitions for routing and task specialization
- 81 skill/workflow files, including orchestration and native Android skills
- 19 model profiles
- 6 MCP tools
- 28 LSP server configs
- Token Savings TUI sidebar plugin for OpenCode
- Safe config merge and repair helpers
- `opencode-jce` maintenance CLI

Existing OpenCode config is preserved. Missing JCE-managed entries are merged in. A malformed `opencode.json` is backed up before repair.

## Agents

OpenCode JCE does not replace the default OpenCode experience. The built-in `Build` agent stays your normal starting point. JCE adds specialized agents for tasks that need stronger process, delegation, or domain focus.

| Agent | Purpose | Use When |
|-------|---------|----------|
| `Build` | OpenCode's default general coding agent. | You want normal coding flow without JCE orchestration. |
| `jce-worker` | Main JCE orchestration agent. Plans, executes, delegates, reviews, verifies. | You want end-to-end work handled with stronger discipline and completion checks. |
| `oracle` | Architecture and deep debugging specialist. | You need root-cause analysis, hard trade-offs, or design guidance. |
| `jce-researcher` | Documentation and code research specialist. | You need official docs, library behavior, examples, or repo research. |
| `explorer` | Fast codebase mapping agent. | You need quick file discovery, references, line numbers, and facts. |
| `frontend` | UI/UX implementation specialist. | You work on React, Vue, Svelte, CSS, Tailwind, accessibility, or responsive layout. |
| `android` | Native Android specialist. | You work on Gradle/AGP/KSP, Kotlin/Java Android, Jetpack Compose, adb/logcat, APK/AAB, R8/ProGuard, or Android release diagnostics. |

`jce-worker` is the coordinator. It routes work to specialist agents when useful, then checks their output before claiming completion:

```text
User request -> JCE-Worker -> Explorer / Researcher / Oracle / Frontend / Android -> Review -> Verification -> Final answer
```

### JCE-Worker States

The workflow normally moves through these states:

```text
intake -> planning -> executing -> delegating -> verifying -> completed
```

If something cannot be completed safely, it moves to `blocked` instead of pretending the task is done.

## Core Features

- **Safer Updates**: `opencode-jce update` refreshes the CLI copy, updates config files, backs up user files, and avoids overwriting custom config.
- **Config Hardening**, the installer preserves your keys, providers, plugins, MCP, LSP, and custom settings. A malformed `opencode.json` is backed up and rebuilt with safe defaults.
- **Context Keeper**, keeps a small project memory file so long-running work continues across sessions. Tools include `context_autocapture` (session facts, touched files, verification, blockers, next steps), `context_session_summary` (compact handoff), and `context_compact` (dedupe and compact). Structured facts live in `.opencode-jce/project-facts.json` while `.opencode-context.md` stays concise.
- **Native Android**, an `android` agent plus skills (`android-kotlin`, `android-gradle`, `android-testing`, `android-release`, `android-compose`, `android-security`) and an `android_logcat` tool that reads `adb logcat` from an authorized device/emulator, filters by package/PID, and classifies crashes/ANRs/native failures.
- **Skill Routing Engine**, data-driven, explainable skill selection. A single registry feeds a weighted scoring engine using intent, keyword signals, file hints, agent preference, telemetry history, and negative routing rules. Low-confidence prompts fall back to one core plus one safest domain skill. User corrections adjust routing for the session.
- **Token Savings Sidebar**, a TUI-only widget showing estimated token savings from context-budget compression and delegated work. Installed via `tui.json`, separate from the main server plugin.
- **LSP Setup**, configures language servers for TypeScript, Python, Rust, Go, Java, C#, PHP, Ruby, Bash, YAML, HTML, CSS, Vue, Svelte, Tailwind, and more.

## Commands

```bash
opencode-jce --version
opencode-jce doctor
opencode-jce update
opencode-jce validate
opencode-jce setup
opencode-jce skills explain "<prompt>"
opencode-jce skills doctor
opencode-jce analytics --json
```

JCE-Worker inspection commands:

```bash
opencode-jce jce-worker status --json
opencode-jce jce-worker report --json
opencode-jce jce-worker trace --json
opencode-jce jce-worker planner-explain
opencode-jce analytics --json
```

- `status` / `report --json` - include planner rationale summary.
- `trace --json` - recent runtime trace events plus planner snapshot.
- `planner-explain` - fan-out vs linear fallback reasoning.
- `analytics --json` - planner fan-out vs linear fallback counts and recent trend events.

## Requirements

| Requirement | Details |
|-------------|---------|
| OS | Linux, macOS, or Windows 10+ |
| Runtime | Bun |
| Terminal | bash, zsh, Git Bash, or PowerShell 5.1+ |
| Internet | Required for install and updates |
| Permissions | sudo/admin only when installing system packages |

## Troubleshooting

If an old global npm shim is used instead of the JCE shim, remove the stale shim and reinstall.

Linux/macOS:

```bash
npm_bin="$(npm bin -g 2>/dev/null || true)"
[ -n "$npm_bin" ] && rm -f "$npm_bin/opencode-jce" "$npm_bin/opencode-jce.cmd" "$npm_bin/opencode-jce.exe" "$npm_bin/opencode-jce.bunx"
hash -r
opencode-jce --version
```

Windows PowerShell:

```powershell
Remove-Item "$env:APPDATA\npm\opencode-jce" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:APPDATA\npm\opencode-jce.cmd" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:APPDATA\npm\opencode-jce.ps1" -Force -ErrorAction SilentlyContinue
opencode-jce --version
```

## Donate / Buy Me a Coffee

If this tool saves you time and money, consider supporting the project:

<div align="center">

<a href="https://paypal.me/Darkness0777">
  <img src="https://img.shields.io/badge/PayPal-Donate-0070ba?style=for-the-badge&logo=paypal&logoColor=white" alt="Donate via PayPal" />
</a>
<a href="https://paypal.me/Darkness0777">
  <img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-Support-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me a Coffee" />
</a>

</div>

Every donation helps keep this project maintained, updated, and free for everyone.

## Contributing

Pull requests are welcome. Keep changes focused, run tests before submitting, and use this commit style:

```text
<type>(<scope>): <description>
```

Examples:

```text
fix(install): remove stale npm shims
feat(plugin): add agent workflow guard
docs(readme): simplify project overview
```

## License

MIT © [JCETools-Petra](https://github.com/JCETools-Petra)

---

<div align="center">

**Built for the OpenCode community**

[Report Bug](https://github.com/JCETools-Petra/JCE-Opencode-Tools/issues) · [Request Feature](https://github.com/JCETools-Petra/JCE-Opencode-Tools/issues) · [Donate](https://paypal.me/Darkness0777)

</div>
