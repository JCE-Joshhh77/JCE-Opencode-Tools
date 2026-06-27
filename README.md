<div align="center">

# OpenCode JCE

### A practical agent toolkit for OpenCode CLI

[![CI](https://github.com/JCETools-Petra/JCE-Opencode-Tools/actions/workflows/ci.yml/badge.svg)](https://github.com/JCETools-Petra/JCE-Opencode-Tools/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-3.8.23-green)]()
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-brightgreen)]()

**Install once. Get structured agents, workflows, orchestration, MCP tools, LSP config, and safer updates.**

[Install](#install) · [Agents](#agents) · [Commands](#commands) · [Donate](#donate--buy-me-a-coffee)

</div>

---

## What Is This?

OpenCode JCE is a plugin and installer for OpenCode CLI. It adds a focused set of agent workflows, orchestration helpers, config tools, MCP integrations, LSP setup, and maintenance commands so OpenCode works more like a complete coding environment.

It is designed for daily engineering work: building features, fixing bugs, reviewing code, researching libraries, improving UI, and keeping project context across sessions.

## How JCE-Worker Works

`jce-worker` is the main execution coordinator. It is designed to behave more like a disciplined engineering lead than a single general chatbot.

Simple workflow:

```text
User request
  -> Understand intent
  -> Plan the work
  -> Execute directly or delegate to specialist agents
  -> Review the result
  -> Verify with evidence
  -> Report completion or blockers
```

That means JCE-Worker does not stop at "I changed the code". It is expected to carry work through planning, execution, review, and verification before claiming completion.

Typical specialist routing:

- `explorer` -> fast codebase mapping and file discovery
- `jce-researcher` -> docs, library behavior, GitHub and web research
- `oracle` -> hard debugging, architecture, and trade-off analysis
- `frontend` -> UI, styling, accessibility, and responsive work
- `android` -> native Android Gradle/Kotlin/Compose/logcat/release diagnostics

Core rule:

```text
Plan -> Execute -> Review -> Verify -> Report
```

If evidence is missing, JCE-Worker should report that explicitly instead of claiming the task is done.

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

## What Gets Installed

- JCE OpenCode plugin agents
- JCE-Worker orchestration workflow with planning, delegation, review, and verification gates
- 42 AI agent definitions for global routing and task specialization
- 80 skill/workflow files, including advanced orchestration and native Android Gradle/testing/release/Compose/security skills
- 19 model profiles
- 6 MCP tools
- 28 LSP server configs
- Token Savings TUI sidebar plugin for OpenCode
- Safe config merge and repair helpers
- `opencode-jce` maintenance CLI

Existing OpenCode config is preserved. Missing JCE-managed entries are merged in. Malformed `opencode.json` is backed up before repair.

## Agents

OpenCode JCE does not replace the default OpenCode experience. The built-in `Build` agent can remain your normal starting point. JCE adds specialized agents for tasks that need stronger process, delegation, or domain focus.

| Agent | Purpose | Use When |
|-------|---------|----------|
| `Build` | OpenCode's default general coding agent. | You want normal coding flow without JCE orchestration. |
| `jce-worker` | Main JCE orchestration agent. Plans, executes, delegates, reviews, and verifies. | You want end-to-end work handled with stronger discipline and completion checks. |
| `oracle` | Architecture and deep debugging specialist. | You need root-cause analysis, hard trade-offs, or design guidance. |
| `jce-researcher` | Documentation and code research specialist. | You need official docs, library behavior, examples, or repo research. |
| `explorer` | Fast codebase mapping agent. | You need quick file discovery, references, line numbers, and facts. |
| `frontend` | UI/UX implementation specialist. | You work on React, Vue, Svelte, CSS, Tailwind, accessibility, or responsive layout. |
| `android` | Native Android specialist. | You work on Gradle/AGP/KSP, Kotlin/Java Android, Jetpack Compose, adb/logcat, APK/AAB, R8/ProGuard, or Android release diagnostics. |

### How They Work Together

`jce-worker` is the coordinator. It can route work to other agents when useful, then checks their output before claiming completion.

Typical flow:

```text
User request -> JCE-Worker -> Explorer / Researcher / Oracle / Frontend / Android -> Review -> Verification -> Final answer
```

This keeps complex work organized without forcing every task into the same mode.

### JCE-Worker States

The workflow normally moves through these states:

```text
intake -> planning -> executing -> delegating -> verifying -> completed
```

If something cannot be completed safely, it moves to `blocked` instead of pretending the task is done.

## Core Features

### Safer Updates

`opencode-jce update` updates the local CLI copy, refreshes config files, backs up user files, and avoids overwriting custom config.

```bash
opencode-jce update
```

### Config Hardening

The installer and update command preserve user keys, providers, plugins, MCP entries, LSP entries, and custom OpenCode settings. If `opencode.json` is malformed, it is backed up and rebuilt with safe defaults.

### Context Keeper

The bundled context keeper keeps a small project memory file so long-running work can continue across sessions without losing decisions, stack details, or current status.

New continuity tools help future sessions resume without rescanning the whole repository:

- `context_autocapture` stores high-confidence session facts, touched files, verification, blockers, next steps, and Android facts.
- `context_session_summary` writes a compact handoff summary for the next session.
- `context_compact` deduplicates and compacts verbose context entries.
- Structured facts are preserved in `.opencode-jce/project-facts.json` while `.opencode-context.md` stays concise.

### Native Android Support

OpenCode JCE now includes a native Android specialist workflow:

- `android` agent for Gradle/AGP/KSP, Kotlin/Java Android, Jetpack Compose, Room, Hilt, WorkManager, R8/ProGuard, APK/AAB, and release diagnostics.
- Android skills: `android-kotlin`, `android-gradle`, `android-testing`, `android-release`, `android-compose`, and `android-security`.
- Android intelligence helpers classify build/runtime failures, scan Android project/module configuration, and recommend verification commands.
- `android_logcat` tool can read `adb logcat` from an authorized device/emulator, filter by package/PID when available, and classify crashes/ANRs/native failures.

For one authorized device/emulator, `android_logcat` selects it automatically. Pass `packageName` for cleaner app-focused diagnostics.

### Skill Routing Engine

Skill selection is data-driven and explainable. A single skill registry feeds a weighted scoring engine that ranks candidate skills using intent, keyword signals, file hints, agent preference, telemetry history, and negative routing rules.

- Weighted scoring with per-skill contribution traces instead of fixed ordering.
- Negative routing suppresses common false positives (visual design vs API design, Go `interface` vs frontend, auth-heavy prompts vs generic security).
- Multi-skill bundles keep recurring task families consistent (Android build, delegation review, UI polish, API contract, release prep).
- Low-confidence prompts fall back to one core plus one safest domain skill.
- User corrections ("jangan load X", "pakai Y", "harusnya researcher bukan oracle") adjust routing for the session.
- Local non-PII telemetry ranks useful, noisy, and over-selected skills and feeds the ranking back into future routing.

Inspect routing decisions from the CLI:

```bash
opencode-jce skills explain "Fix Android Gradle duplicate class in build.gradle.kts"
opencode-jce skills doctor
opencode-jce analytics --json
```

### Token Savings Sidebar

OpenCode JCE also registers a TUI-only sidebar widget that displays estimated token savings from context-budget compression and delegated work. The widget is installed through `tui.json` and is separate from the main server plugin.

### LSP Setup

The installer can configure common language servers for TypeScript, Python, Rust, Go, Java, C#, PHP, Ruby, Bash, YAML, HTML, CSS, Vue, Svelte, Tailwind, Terraform, GraphQL, and more.

## Commands

```bash
opencode-jce --version
opencode-jce doctor
opencode-jce update
opencode-jce validate
opencode-jce setup
opencode-jce plugin configure
opencode-jce jce-worker status
opencode-jce jce-worker status --json
opencode-jce jce-worker report
opencode-jce jce-worker report --json
opencode-jce jce-worker trace
opencode-jce jce-worker trace --json
opencode-jce jce-worker planner-explain
opencode-jce jce-worker planner-explain --json
opencode-jce jce-worker commit-check src/commands/jce-worker.ts README.md --plan
opencode-jce jce-worker commit-check src/commands/jce-worker.ts README.md --json
opencode-jce skills explain "<prompt>"
opencode-jce skills doctor
opencode-jce analytics --json
```

### JCE-Worker Explainability Commands

Use these when you need to inspect why JCE-Worker planned work in a certain way:

```bash
opencode-jce jce-worker status --json
opencode-jce jce-worker report --json
opencode-jce jce-worker trace --json
opencode-jce jce-worker planner-explain
opencode-jce jce-worker planner-explain --json
opencode-jce analytics --json
```

- `status/report --json` include planner rationale summary.
- `trace --json` includes recent runtime trace events plus planner snapshot.
- `planner-explain` focuses on fan-out vs linear fallback reasoning.
- `analytics` now summarizes planner fan-out vs linear fallback counts and recent planner trend events.
- `commit-check --plan` prints safe staging guidance; `commit-check --json` returns machine-readable issues plus safe commit plan text.

Useful checks:

```bash
which opencode-jce
opencode-jce --version
opencode-jce doctor
```

Expected install path:

```text
Linux/macOS: ~/.bun/bin/opencode-jce
Windows:     %USERPROFILE%\.bun\bin\opencode-jce.cmd
```

## Requirements

| Requirement | Details |
|-------------|---------|
| OS | Linux, macOS, or Windows 10+ |
| Runtime | Bun |
| Terminal | bash, zsh, Git Bash, or PowerShell 5.1+ |
| Internet | Required for install and updates |
| Permissions | sudo/admin only when installing system packages |

## Troubleshooting

If an old global npm shim is used instead of the JCE shim, reinstall or remove stale shims.

Linux/macOS:

```bash
npm_bin="$(npm bin -g 2>/dev/null || true)"
[ -n "$npm_bin" ] && rm -f "$npm_bin/opencode-jce" "$npm_bin/opencode-jce.cmd" "$npm_bin/opencode-jce.exe" "$npm_bin/opencode-jce.bunx"
hash -r
which opencode-jce
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

<br/><br/>

<a href="https://paypal.me/Darkness0777">
  <img src="https://www.paypalobjects.com/webstatic/mktg/logo/pp_cc_mark_111x69.jpg" alt="PayPal" width="120" />
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
