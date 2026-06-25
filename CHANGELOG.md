# Changelog

All notable changes to OpenCode JCE are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/), versioned with [Semantic Versioning](https://semver.org/).

---

## [3.8.10] - 2026-06-25

### Fixed
- **Factory Droid update setup**: `opencode-jce update` now exports the Factory Droid plugin package after config migration, so updated installs receive `factory-jce` without rerunning the full installer.
- **Factory Droid install guard**: install/update flows now check for the `droid` CLI before attempting Droid plugin registration. If Droid is missing, the Droid plugin install is cancelled and platform-specific install instructions are printed instead of failing later with marketplace-not-found errors.
- **Factory Droid registration prompt**: when Droid is available, install/update prompts before running `droid plugin marketplace add` and `droid plugin install`, so users can opt in without manual commands.

### Changed
- Release version synced to `3.8.10` across package metadata, installers, constants, MCP version, config version, README badge, changelog, and version tests.

### Verification
- `bun test tests/unit/update-process-cleanup.test.ts tests/unit/factory-droid.test.ts` exit 0 (6 pass / 0 fail).
- `bun run typecheck` exit 0.
- `C:\Program Files\Git\bin\bash.exe -n install.sh` exit 0.
- PowerShell parser validation for `install.ps1` exit 0.

---

## [3.8.9] - 2026-06-25

### Added
- **Factory Droid export support**: added `opencode-jce factory export` to generate a Factory-compatible plugin package from the existing JCE agent and skill pack.
- **Factory Droid package contents**: generated package includes `.factory-plugin/plugin.json`, six native JCE droids, copied skills, `/jce-review`, `/jce-android`, `/jce-release-check` commands, and MCP bridge config for shared context/tools.
- **Single-installer support**: Linux/macOS and Windows installers now preserve OpenCode setup and also export a Factory Droid package to `factory-jce` after CLI install.

### Fixed
- **Factory Droid audit fixes**: droid tool frontmatter now grants edit/execute tools only to agents that need them, keeps explorer read-only, uses the actual marketplace basename in install instructions, checks PowerShell export exit codes, and resolves the context-keeper MCP path through the installed CLI directory.

### Changed
- Release version synced to `3.8.9` across package metadata, installers, constants, MCP version, config version, README badge, changelog, and version tests.

### Verification
- `bun test tests/unit/factory-droid.test.ts tests/unit/plugin-agents.test.ts` exit 0 (25 pass / 0 fail).
- `bun run typecheck` exit 0.
- `bun ./src/index.ts validate` exit 0 (24 config files valid; skill startup audit pass).
- `C:\Program Files\Git\bin\bash.exe -n install.sh` exit 0.
- PowerShell parser validation for `install.ps1` exit 0.

---

## [3.8.8] - 2026-06-25

### Fixed
- **Agent list scope regression**: OpenCode agent registration is limited back to the JCE plugin's native agents only (`jce-worker`, `oracle`, `jce-researcher`, `explorer`, `frontend`, `android`). Legacy `agents.json` entries are no longer injected into OpenCode `config.agent`, preventing the UI from being flooded with unrelated agents.
- **Slash-command model scope**: `/jce-models` and `/jce-agent-model` now target only native JCE plugin agents. `agents.json`-only entries are rejected as unknown agents instead of appearing as configurable OpenCode agents.
- **Slash-command discoverability and output**: `/jce-models` and `/jce-agent-model` are now registered with the OpenCode TUI command palette, and selecting `/jce-models` opens a scrollable/filterable agent-model list instead of a clipped static message.
- **Dispatch scope**: the background `dispatch` tool is restricted back to the intended JCE subagents (`oracle`, `jce-researcher`, `explorer`, `frontend`, `android`) instead of accepting legacy `agents.json` IDs.

### Changed
- Release version synced to `3.8.8` across package metadata, installers, constants, MCP version, config version, README badge, changelog, and version tests.

### Verification
- `bun test tests/unit/plugin-integration.test.ts tests/unit/plugin-settings.test.ts tests/unit/plugin-tools.test.ts` exit 0 (87 pass / 0 fail).
- `bun test tests/unit/plugin-entry.test.ts` exit 0 (9 pass / 0 fail).
- `bun run typecheck` exit 0.

---

## [3.8.7] - 2026-06-25

### Added
- **Per-agent model controls inside OpenCode**: added `/jce-models` and `/jce-agent-model <agent> <provider/model|default>` slash commands. Users can list available OpenCode models, set model overrides per native or custom agent, and reset an agent back to the active OpenCode model without leaving OpenCode.
- **Live custom-agent activation**: custom agents from `agents.json` are now injected into OpenCode `config.agent` and can be called immediately. Slash-command model changes update live OpenCode config via `client.config.get/update`, so native and custom agent overrides take effect without restarting OpenCode.

### Fixed
- **Agent reachability gap**: the plugin config hook now registers every valid `agents.json` custom agent, and the `dispatch` tool now accepts all known agent IDs instead of a hardcoded native-only list.
- **Model-routing safety**: removed hardcoded category model hints so agents use the active OpenCode model by default unless a validated per-agent override is configured.
- **Audit hardening**: blocked unsafe unverified download paths by default, tightened local MCP trust gates, scoped cross-project context reads, hardened update rollback/shim cleanup, and validated JSON trust boundaries.

### Changed
- Release version synced to `3.8.7` across package metadata, installers, constants, config version, README badge, and changelog.

### Verification
- `bun run typecheck` exit 0.
- `bun audit` exit 0 (no vulnerabilities).
- `bun ./src/index.ts validate` exit 0 (24 config files valid; skill startup audit pass).
- `bun test` exit 0 (1306 pass / 0 fail).

---

## [3.8.6] - 2026-06-21

### Changed
- **Mandatory Root Cause Gate**: global AGENTS guidance and the `jce-worker` prompt now require exact error/log evidence or a feasible reproduction before bugfix edits. Error reports must be classified, Root Cause Evidence must exist before patching, fixes must stay minimal, and the smallest failing command must be rerun afterward.
- **Bugfix safety guardrails**: speculative fixes, broad refactors during bugfixes, and fixed/complete claims without fresh verification are now explicitly forbidden. After three failed focused attempts, agents must stop stacking patches and summarize evidence plus next options.
- Release version synced to `3.8.6` across package metadata, installers, constants, MCP version, config version, README badge, and version tests.

### Verification
- `bun test` exit 0 (1299 pass / 0 fail).
- `bun run typecheck` exit 0.
- `bun ./src/index.ts validate` exit 0 (24 config files valid; skill startup audit pass).
- `C:\Program Files\Git\bin\bash.exe -n install.sh` exit 0.
- `bun ./src/index.ts --version` exit 0 (`3.8.6`).

---

## [3.8.5] - 2026-06-17

### Fixed
- **VPS `read` stability**: direct `read` tool output is no longer passed through aggressive post-tool context-budget compression in the plugin hook. Large file-content payloads now flow through unchanged, reducing CPU/string-churn pressure that could terminate the worker on low-memory VPS environments with errors like "Failed to send prompt" and "Worker has been terminated".

### Changed
- Release version synced to `3.8.5` across package metadata, installers, constants, MCP version, config version, and version tests.

### Verification
- `bun test tests/unit/plugin-integration.test.ts` exit 0 (55 pass / 0 fail).
- `bun run typecheck` exit 0.

---

## [3.8.4] - 2026-06-17

### Fixed
- **Cross-platform `doctor --fix` LSP auto-installs expanded**: auto-fix now goes beyond npm-only installs and can bootstrap or install additional language servers across Ubuntu/Linux and Windows, including Rust, Go, Java/jdtls, clangd, csharp-ls, Kotlin language server, Dart SDK, Lua language server, Marksman, Taplo, Solargraph, Elixir LS, and Metals where safe package-manager or user-space installer paths exist.
- **Safer strategy routing per platform**: the doctor fixer now classifies each missing LSP into explicit install strategies instead of treating all non-npm commands as manual-only, improving Ubuntu VPS and Windows first-run experience while preserving fail-safe handling for truly manual cases.

### Changed
- Release version synced to `3.8.4` across package metadata, installers, constants, MCP version, config version, and version tests.

### Verification
- `bun test tests/unit/audit-fixes.test.ts` exit 0 (56 pass / 0 fail).
- `bun run typecheck` exit 0.

---

## [3.8.3] - 2026-06-17

### Fixed
- **Ubuntu/Linux `doctor --fix` npm LSP installs**: when `npm install -g` fails with `EACCES` on VPS or non-root shells, the fixer now retries automatically into user space under `~/.opencode-jce/npm-global`, prepends that `bin` directory to the current process `PATH`, and lets the follow-up LSP merge detect newly installed servers without requiring `sudo`.
- **Clearer auto-fix failures**: npm-based LSP install failures now distinguish global permission problems from Node/npm engine mismatches, so `doctor --fix` reports actionable root causes instead of clipped ambiguous output.
- **Generated asset edit guardrail**: workflow/tool-discipline now flags paths like `public/assets/*`, `dist/*`, `build/*`, minified files, and hashed assets as brittle for line-based patching, steering edits toward source files or exact string replacement after a fresh read.

### Changed
- Release version synced to `3.8.3` across package metadata, installers, constants, MCP version, config version, and version tests.

### Verification
- `bun test tests/unit/audit-fixes.test.ts` exit 0 (55 pass / 0 fail).
- `bun test tests/unit/plugin-tool-discipline.test.ts tests/unit/plugin-workflow-tool.test.ts` exit 0 (12 pass / 0 fail).
- `bun run typecheck` exit 0.

---

## [3.8.2] - 2026-06-17

### Changed
- **Lower over-confirmation friction**: JCE global guidance, `jce-worker` prompt rules, and orchestration blocker handling now continue on safest reasonable assumptions for normal reversible work instead of pausing for confirmation too early. Confirmation gates remain for irreversible actions, permission boundaries, unsafe conditions, or materially ambiguous choices.
- **Prompt/runtime alignment**: prompt wording now matches runtime behavior more closely for open-ended improvements, multi-step completion, and missing-info handling, reducing false stop-early behavior.
- Release version synced to `3.8.2` across package metadata, installers, constants, MCP version, config version, and version tests.

### Verification
- `bun run typecheck` exit 0.
- `bun test tests/unit/plugin-agents.test.ts tests/unit/orchestration-intelligence-upgrades.test.ts tests/unit/ui.test.ts tests/unit/plugin-workflow-tool.test.ts` exit 0 (55 pass / 0 fail).

---

## [3.8.0] - 2026-06-13

### Added
- **Skill security scanner** (`skill-security.ts`): supply-chain defense against malicious skills. Skill `.md` files are now scanned for data-exfiltration and prompt-injection patterns before they are injected into the system prompt. Detection is **combination/score-based** (not naive keyword matching) across four signal families — suspicious egress (network calls to non-trusted hosts), secret-sourcing (reads of `.env`/keys/credentials/env dumps), prompt-injection/stealth directives (e.g. "ignore previous instructions", "don't tell the user", "send to my server"), and obfuscation (base64/eval decoded-and-executed payloads). A lone signal stays low-risk so legitimate security docs are not flagged; combinations such as *read secret + external egress*, or any injection/exfiltration directive, escalate toward the block threshold (60). Calibrated against all 80 bundled skills for **zero false positives**.
- **Skill scanner enforcement at load** (`skill-loader.ts`): `resolveSkills()` now drops any skill whose content crosses the block threshold instead of injecting it, and records the block via `getLastBlockedSkills()`. The plugin's `system.transform` surfaces a visible **skill security alert** to the model (listing the blocked skill and reason) and emits a `skill_blocked` telemetry event. A blocked skill's instructions never reach the prompt.
- **`skills audit-security` CLI command**: scans installed skills (user config dir by default, `--repo` for the repo's `config/skills`, or `--dir <path>`) and reports flagged/blocked skills with per-signal evidence. Backed by `auditSkillSecurity()` which supports both the new (`name/SKILL.md`) and legacy (`name.md`) layouts.
- **New-session memory rehydration** (`index.ts`): the plugin factory runs once per OpenCode process, but many sessions can be created within it. Restored Project Memory injection now re-arms for each genuine **new top-level session** — the plugin rehydrates durable runtime + orchestration state from disk and resets transient per-session state, so session 2+ in the same project gets its memory injected (previously only the first session did, reading a stale process-init snapshot). New-session detection uses the `session.created` event (with a `sessionID` fallback in `system.transform`) and **explicitly skips sub-agent child sessions** (those carry a `parentID`) so a delegation never wipes parent memory.

### Changed
- Release version synced to `3.8.0` across package metadata, installers, constants, MCP version, config version, README badge, and version tests.

### Verification
- `tsc --noEmit` exit 0; full `bun test` suite green (1255 pass / 0 fail across 109 files), including new skill-security scanner tests (malicious-detection + no-false-positive regression over all bundled skills) and new-session memory rehydration regression tests.

---

## [3.7.9] - 2026-06-12

### Added
- **Restored Project Memory** (`project-memory-summary.ts`): at the start of each new session, JCE-Worker now injects a compact, token-bounded summary of what it already knows about the project — stack/scripts, last session's goal + status, open blockers, recently touched files, conventions, high-risk areas, top learnings, and verification commands. This stops the AI from re-scanning the project and re-deriving context every session (token savings). Injected **once per session** and hard line-capped to stay cheap; skipped entirely for brand-new projects with no durable memory. Works in all modes (TUI + headless).
- **Context-pressure signal** (auto-compaction hybrid #1): when context usage crosses the 83% threshold, a notice is injected into the system prompt telling the model to proactively preserve durable state (restate goal/files/blockers/verification, wrap up the current unit) before compaction. Complements the existing TUI toast and works in headless mode where toasts do not appear. Self-clearing when usage drops.

### Changed
- Release version synced to `3.7.9` across package metadata, installers, constants, MCP version, config version, README badge, and version tests.

### Verification
- `tsc --noEmit` exit 0; full `bun test` suite green (1242 pass / 0 fail across 108 files), including new project-memory and tests for both features.

---

## [3.7.8] - 2026-06-12

### Fixed
- **opencode.json BOM recovery** (the real-world cause): a leading UTF-8 Byte Order Mark (`\uFEFF`, charCode 65279) — commonly prepended by PowerShell/Windows editors — made `JSON.parse` fail with "Unrecognized token", causing the updater to refuse. The lossless tidy-repair now strips a leading BOM (in addition to trailing commas), so the file parses, **all user settings are preserved**, the original is backed up, and the file is rewritten clean and pretty-printed (2-space) — easy to read again. Genuinely malformed files still trigger the safe refusal unchanged.
- Corrects the v3.7.7 diagnosis, which addressed trailing commas; the actual failure for affected configs was a BOM.

### Changed
- Updater message now reports the recoverable cause as "BOM or trailing commas".
- Release version synced to `3.7.8` across package metadata, installers, constants, MCP version, config version, README badge, and version tests.

### Verification
- `tsc --noEmit` exit 0; full `bun test` suite green (1235 pass / 0 fail across 107 files), including BOM-recovery regression tests.

---

## [3.7.7] - 2026-06-12

### Added
- **Auto-compaction visible signal**: when context usage crosses 83%, a TUI toast (`client.tui.showToast`) now surfaces "JCE Auto-Compaction — Context N% full; durable checkpoint written" so the user can see the feature fire instead of it working invisibly. Fire-and-forget and error-guarded.

### Fixed
- **opencode.json lossless tidy-repair**: a recoverable syntax error (e.g. a trailing comma in an array/object) no longer causes the updater to refuse. The merge now strips structural trailing commas — never touching content inside strings — and, if the result parses, recovers the file with **every user setting preserved**, backs up the original to `opencode.json.invalid-<timestamp>`, and rewrites a clean formatted file. Genuinely malformed files (unrecoverable) still trigger the safe refusal unchanged.

### Changed
- Release version synced to `3.7.7` across package metadata, installers, constants, MCP version, config version, README badge, and version tests.

### Verification
- `tsc --noEmit` exit 0; full `bun test` suite green (1233 pass / 0 fail across 107 files).

---

## [3.7.6] - 2026-06-12

### Added
- **Auto-compaction monitor** (`context-window-monitor.ts`): provider-agnostic context-window tracking. Reads `model.limit.context` (with a conservative 128k fallback when unset) and assistant token usage; at **83%** usage it writes a durable checkpoint and, via the new `experimental.session.compacting` hook, enriches the native compaction prompt so goal/touched-files/blockers/verification are preserved across compaction. Fires once per upward threshold crossing.
- **Context debug instrument** (opt-in `OPENCODE_JCE_DEBUG_CONTEXT=1`): logs every assistant `message.updated` token observation to `.opencode-jce/context-debug.jsonl` to confirm live token-usage timing in a real session.

### Fixed
- **Skill routing**: the literal word "permission" no longer misroutes non-Android prompts to Android; framework detection moved out of the android `else-if` chain so React/Vue/etc. are no longer suppressed.
- **Stuck-graph deadlock**: `deriveGraphStatus` now detects when all remaining work is permanently stranded behind a failed dependency and marks the graph `failed` instead of hanging in `executing`.
- **Workflow templates**: `minComplexity` is now enforced (real complexity score passed), so trivial single-word goals no longer trigger full multi-phase templates.
- **Memory prune**: decision pruning can no longer exceed its limit via a negative slice; corrupt/NaN timestamps are now treated as expired instead of preventing pruning forever.
- **Completion gate**: an all-cancelled graph no longer falsely passes the completion gate; phase-gate violations now block completion instead of only warning.
- **Persistence dedup**: artifact/evidence dedup on persist was a no-op (duplicates accumulated each save); now correctly deduped by stable id.
- **todo-enforcer**: markdown checklists and `"status":"pending"` JSON inside fenced/inline code blocks no longer trigger false continuation enforcement.
- **Failure-pattern signatures** are now consistent across the record/query/success paths so the proactive retry warning actually fires and one failure maps to one pattern; recording is guarded so it cannot block the persist path.
- **Unbounded growth**: `nodeToGraphMap` is cleared on new single-graph plans and the strategy-telemetry dedup set is bounded.
- **applyDelta**: `removeEdges` is now applied (previously ignored); node adds are dependency-ordered and guarded so one bad node cannot abort the whole delta.

### Changed
- Removed dead code: redundant second BFS in `wouldCreateCycle` and an unused set in `identifyParallelGroups`.
- Unified the structured `FailurePattern`/`StrategyTelemetry` types to a single source of truth via type-only re-exports.
- Release version synced to `3.7.6` across package metadata, installers, constants, MCP version, config version, README badge, and version tests.

### Verification
- `tsc --noEmit` exit 0; full `bun test` suite green (1231 pass / 0 fail across 107 files).

---

## [3.7.5] - 2026-06-12

### Added
- **Advanced Orchestration v2.0 (AGENTS.md)**: four always-on brain modules — Workflow Engine (state machine, checkpoints, cross-session resume, phase gates), Delegation Intelligence (confidence scoring, retry budget, escalation chain, parallel consensus), Adaptive Strategy Selector (risk/complexity → strategy), and Failure Intelligence (pattern memory, anti-pattern detection, rollback, failure budget).
- **Six meta-orchestration skills** (74 → 80 total): `orchestration-patterns`, `failure-recovery`, `multi-agent-coordination`, `estimation-planning`, `code-archaeology`, `incident-response`. Routed via `manual_or_keyword` mode with keyword detection and five new orchestration skill bundles.
- **Workflow templates** (`workflow-templates.ts`): pre-built, phase-gated DAG templates for release, migration, security-audit, large-refactor, and incident-response, wired into the planner ahead of generic plans.
- **Phase-gate guard** and **adaptive complexity scorer** (`intelligence.ts`): ordered PLANNING → IMPLEMENTING → TESTING → STAGING gates with violation detection, and file/import-aware complexity → execution-strategy mapping.
- **Failure Pattern Store** (`failure-pattern-store.ts`): structured `signature → rootCause → fixCategory + badFixes` memory, wired into the live controller (records on failure, records winning fix on retry-success, injects proactive "do not repeat" warnings on retry dispatch).
- **Strategy Telemetry** (`strategy-telemetry.ts`): per-intent strategy→outcome tracking that biases future strategy selection only above a confidence threshold; recorded once per terminal graph.
- **Risk Heatmap** (`risk-heatmap.ts`): aggregates failure history by file and now populates the previously-empty `dangerousAreas` memory tier during persist.
- **Speculative pre-fetch** (`speculative-prefetch.ts`) and **delegation scenario presets** (`delegation-scenarios.ts`): read-only groundwork planner and six scenario presets that feed the existing delegation-envelope builder.
- **CI skill-routing health job** (`ci.yml`): startup audit, golden routing corpus, skills doctor JSON, and registry health gate.

### Fixed
- **Failure-pattern signature consistency**: the failure-record, retry-warning query, and success-after-retry paths now share a single stable key (excluding per-attempt reason), so the proactive retry warning can actually fire and a failure + its later fix update one pattern instead of two.
- **Persist-path resilience**: strategy-telemetry recording and risk-heatmap population in `persist()` are wrapped in error boundaries so they can never block the core state save.
- **Migration template false positive**: tightened the trigger so an incidental trailing noun (e.g. "verify migration") no longer hijacks a sequential plan.

### Changed
- Release version synced to `3.7.5` across package metadata, installers, constants, MCP version, config version, README badge, and version tests. Skill count references updated to 80 (README, CONTRIBUTING, installers, config test).

### Verification
- `tsc --noEmit` exit 0; full `bun test` suite green (1198 pass / 0 fail across 104 files).

---

## [3.7.4] - 2026-06-11

### Added
- **Concurrent multi-graph orchestration**: new shared-budget scheduler (`Scheduler.tickAll`) advances multiple task graphs at once with cross-graph per-agent limits and round-robin fairness. Controller gains a `GraphRegistry` plus `createConcurrentPlans`, `getNextDispatchAll`, and `collectResultForGraph`; the bridge exposes `planAndDispatchConcurrent`.
- **Conservative multi-workstream detector**: explicit numbered/bulleted action lists or "in parallel / secara paralel" framing spawn independent workstream graphs; plain sequential prose stays single (precision-first to avoid runaway spawning).
- **Structured delegated evidence/result channels**: sub-agents may emit fenced `jce-evidence` and `jce-result` blocks for deterministic parsing of verification, files, facts, and risks, with the existing free-text path retained as fallback.
- **Typed auto-activation decision** with confidence, reason, and signal telemetry, replacing the prior boolean-only gate.
- **Pre-final completion guard** injected into the system prompt for active workflows, reducing reliance on post-generation gating.

### Fixed
- **Final review gate now receives real changed files**: write/edit/`apply_patch` and `git status`/`git diff` output feed actual edit scope instead of an empty list.
- **Evidence confidence is gated**: failing runs and no-evidence results are capped, and evidence-required tasks without structured evidence are held to `partial` instead of `success`.
- **Fact extraction precision**: project facts are derived only from execution output (bash/sub-agent), not file contents that merely mention tool names.
- **Orchestration graph lifecycle**: stale `node→task` mappings are cleared on new plans and late/orphaned results are tolerated instead of injecting spurious blockers.
- **Installer banner** now reports the correct skill count (74).

### Changed
- Release version synced to `3.7.4` across package metadata, installers, constants, MCP version, README badge, and version tests.

### Verification
- `tsc --noEmit` exit 0; full `bun test` suite green (CLI integration timeouts are transient under load and pass in isolation).

### Known limitations
- Pre-send hard blocking of completion claims remains impossible: the OpenCode SDK exposes no pre-generation cancel hook, so gates flag/append rather than cancel.
- Concurrent workstream execution activates only on explicit multi-workstream signals; mixed prose stays single-graph by design.

---

## [3.7.3] - 2026-06-11

### Fixed
- **Installed self-update manifest resolution**: `opencode-jce update` now resolves the CLI payload manifest from both repo-style and installed-CLI layouts, fixing the second-stage handoff failure introduced in `3.7.2`.
- **Staged payload manifest validation**: `opencode-jce update` now validates the downloaded CLI source against the manifest inside the staged CLI payload instead of `process.cwd()`, fixing installed updates launched from directories such as `C:\Users\Joshhh`.

### Changed
- Release version synced to `3.7.3` across package metadata, installers, constants, MCP version, README badge, and version tests.

### Difference from previous release
- `3.7.2` unified installer/update payload verification on a single manifest.
- `3.7.3` is immediate hotfix so installed users can complete self-update without reinstalling, including runs launched outside the repository directory.

### Upgrade note for `3.7.2` users
- `3.7.2` runs its old payload validator before the `3.7.3` source is swapped in. If `opencode-jce update` still reports `Missing CLI payload manifest: C:\Users\Joshhh\config\cli-payload.txt`, run the installer once or bootstrap the manifest into the current directory, then rerun `opencode-jce update`.
- PowerShell bootstrap workaround:
  ```powershell
  New-Item -ItemType Directory -Force "$HOME\config"
  irm "https://raw.githubusercontent.com/JCE-Joshhh77/JCE-Opencode-Tools/v3.7.3/config/cli-payload.txt" -OutFile "$HOME\config\cli-payload.txt"
  opencode-jce update
  Remove-Item -Recurse -Force "$HOME\config"
  ```

### Verified
- `bun test`
- `bun test tests/unit/update-process-cleanup.test.ts tests/unit/install-payload-verification.test.ts`
- `bunx tsc --noEmit`
- `bun ./src/index.ts validate`
- `bun ./src/index.ts --version`

---

## [3.7.2] - 2026-06-11

### Fixed
- **Single-source install/update payload manifest**: New installs and self-update now verify the same shipped `config/cli-payload.txt` manifest, removing drift between updater, Unix installer, and PowerShell installer payload checks.

### Changed
- **Installer/update payload guarantees**: Runtime-critical JCE-Worker and orchestration files are now audited through one shared manifest reader instead of three separate hardcoded lists.
- Release version synced to `3.7.2` across package metadata, installers, constants, MCP version, README badge, and version tests.

### Difference from previous release
- `3.7.1` improved JCE-Worker explainability, planner visibility, analytics, and safe commit support.
- `3.7.2` is focused patch release to harden install/update delivery guarantees so new users and updating users receive the same verified runtime-critical payload.

### Verified
- `bun test`
- `bunx tsc --noEmit`
- `bun ./src/index.ts validate`
- `bun ./src/index.ts --version`

---

## [3.7.1] - 2026-06-11

### Added
- **Planner explainability CLI**: Added `jce-worker planner-explain` plus `status/report/trace --json` planner summaries so operator tooling can inspect why JCE-Worker chose fan-out or linear fallback.
- **Safe commit planning support**: `jce-worker commit-check` now supports `--plan` and `--json` to show machine-readable path discipline results and a safe staging summary before release commits.

### Changed
- **Final completion discipline**: JCE-Worker final-text completion claims now escalate to `FINAL REVIEW GATE` during active workflows when verification or workflow evidence is missing.
- **Planner decomposition**: Adaptive planner now fans out explicit independent implementation units into parallel code nodes, records linear fallback reasons when fan-out is skipped, and exposes planner rationale in status/report output.
- **Planner analytics and doctor**: Local analytics and JCE-Worker doctor now summarize planner fan-out vs linear fallback counts, recent planner trend entries, and warn when linear fallback dominates.
- Release version synced to `3.7.1` across package metadata, installers, constants, MCP version, README badge, and version tests.

### Fixed
- Reduced prompt/runtime mismatch by softening absolute parallel-delegation wording and exposing policy-vs-enforcement summaries through `jce-worker doctor --policy`.
- Improved operator auditability by recording planner explainability trace events during auto-plan creation.

### Difference from previous release
- `3.7.0` introduced broader orchestration upgrades, release policy gates, and autonomy/failure-memory improvements.
- `3.7.1` focuses on JCE-Worker explainability, safer release support, and stronger completion/decomposition transparency on top of the `3.7.0` orchestration base.

### Verified
- `bun test`
- `bunx tsc --noEmit`
- `bun ./src/index.ts validate`
- `bun ./src/index.ts --version`

---

## [3.7.0] - 2026-06-11

### Added
- **Workflow summary intelligence**: `jce_workflow summary` now reports inferred changed areas and suggested verification checks so the next action is explicit instead of only descriptive.
- **Release delta report**: Added `release_delta` workflow action to summarize changed subsystems, likely user-visible changes, migration notes, and risk notes between previous and target versions.
- **Failure memory foundation**: Runtime state now persists structured `failureMemories` entries, and the operator report surfaces recent failure patterns with root-cause and fix-note context.
- **Autonomy hard guard**: Explicit “continue until done” requests now persist an autonomous execution session and append an `AUTONOMY GUARD` if output tries to stop early while in-scope work remains.

### Changed
- **Release readiness gate** now separates `Hard Blockers` from `Warnings` and scores evidence strength as `weak`, `medium`, or `strong` based on release verification coverage.
- **Skill routing doctor** now flags low-confidence sample prompts and sample prompts that fail to select their expected skill.
- **Routing fallback** now uses a safer low-signal heuristic so ambiguous prompts prefer a minimal safe fallback set instead of over-routing.
- Release version synced to `3.7.0` across package metadata, installers, constants, MCP version, README badge, and version tests.

### Fixed
- **Annotated-tag updater compatibility** remains protected by the v3.6.1 integrity fix while v3.7.0 expands orchestration and runtime safety around release and completion behavior.
- Reduced repeated “continue?” interruptions by tightening JCE-Worker autonomous completion rules after explicit continue-until-done requests.

### Difference from previous release
- `3.6.1` was a focused self-update hotfix for annotated tag integrity mismatches.
- `3.7.0` upgrades JCE-Worker into a more advanced orchestration runtime with smarter workflow summaries, stronger release policy gating, explainable release delta reporting, failure memory, safer routing fallbacks, and autonomous-completion enforcement.

### Verified
- `bun test` — 1042 pass, 0 fail
- `rtk tsc --noEmit`
- `bun ./src/index.ts validate`

---

## [3.6.1] - 2026-06-10

### Fixed
- **Self-update integrity for annotated tags**: `opencode-jce update` now requests peeled tag refs (`refs/tags/<tag>^{}`) and resolves commit SHAs in safe order, preventing false integrity failures when release tags are annotated.

### Changed
- Release version synced to `3.6.1` across package metadata, installers, constants, MCP version, README badge, and version tests.

### Difference from previous release
- `3.6.0` shipped runtime/session-store migration and release flow cleanup.
- `3.6.1` is focused hotfix release for CLI self-update so tagged releases can install without falling back to manual reinstall.

### Verified
- `rtk tsc --noEmit`
- `bun test tests/unit/update-integrity.test.ts`
- `bun test tests/unit/update-process-cleanup.test.ts tests/unit/update-config-hardening.test.ts`

---

## [3.6.0] - 2026-06-10

### Added
- **Runtime state layer**: Added `runtime-state.ts` as dedicated home for JCE-Worker runtime persistence and bounded runtime snapshots.
- **Session-store facade**: Added `session-store.ts` to persist runtime state separately from orchestration memory while keeping single-call session load/save behavior.
- **Legacy shadow projection**: Added `legacy-shadow.ts` to project runtime state into legacy-compatible shapes during migration.
- **Legacy runtime bootstrap bridge**: `execution-memory-v2` can now read legacy `jce-worker-execution.json` when seeding orchestration memory v2.

### Changed
- JCE-Worker plugin runtime persistence now uses `session-store` instead of direct `execution-memory` reads/writes.
- Background manager, reports, memory queries, project brain, token savings UI, open-work gate, and CLI helpers now consume `runtime-state` directly.
- Runtime helper/test naming now reflects `runtime state` instead of legacy `execution memory` where safe.
- Release version synced to `3.6.0` across package metadata, installers, constants, MCP version, README badge, and version tests.

### Removed
- Removed legacy runtime shim `src/plugin/lib/execution-memory.ts` after all internal source and tests migrated off it.

### Fixed
- Preserved orchestration memory while clearing or updating runtime-only state paths.
- Kept token savings sidebar reading current runtime state via session facade.
- Preserved workflow runtime fields across load/save and session idle persistence after migration.

### Difference from previous release
- `3.5.5` focused on routing registry, telemetry learning, and skill-health CI.
- `3.6.0` focuses on persistence architecture: splitting runtime state from orchestration memory, removing legacy runtime shim, and making release/runtime paths cleaner for future work.

### Verified
- `rtk tsc --noEmit`
- `bun test` — 1032 pass, 0 fail

---

## [3.5.4] - 2026-06-06

### Added
- **Automatic human frontend flow**: JCE-Worker now applies human UI design workflow automatically for frontend/UI/design/page/component tasks without requiring users to run a separate command.
- **Frontend design intake**: JCE-Worker asks up to three concise direction questions when target user, visual feel, or must-avoid style is unclear, then proceeds by inference if the user skips answers.
- **Design Taste Gate**: Frontend work now defines visual thesis, density, hierarchy, content model, signature motif, and explicit anti-patterns before implementation.
- **Generic AI Risk Gate**: Frontend handoffs now include a 1-5 generic-AI risk score and require one revision pass when risk is 3 or higher.
- **Anti-AI frontend scanner findings**: Web scanner now flags generic SaaS copy, decorative gradient risk, and oversoft card styling with remediation guidance.

### Changed
- Strengthened `human-ui-design` skill with automatic JCE-Worker mode, max-three-question intake, signature motif guidance, no-placeholder final rule, and Generic AI Risk scoring.
- Updated frontend scanner guidance to prefer automatic intake, taste review, backend state mapping, and visual QA without creating a new user-facing command.

### Verified
- `bun test tests/unit/plugin-agents.test.ts tests/unit/advanced-flow-scanners.test.ts`
- `bun run typecheck`
- `bun test` — 984 pass, 0 fail
- `bun ./src/index.ts validate`
- `bun audit` — no vulnerabilities found
- `bun ./src/index.ts --version` — 3.5.4
- `bun ./src/index.ts flow frontend --root . --json`
- `install.ps1` PowerShell parser check

---

## [3.5.3] - 2026-06-06

### Added
- **Human UI design guardrails**: Added `human-ui-design` skill to keep generated frontend work domain-specific, backend-aware, accessible, and visually non-generic.
- **UI pattern catalog**: Added `ui-pattern-library` with product patterns for enterprise SaaS/admin, developer tools, fintech/billing, ecommerce/marketplace, healthcare/wellness, AI products, landing pages, data dashboards, forms/onboarding, and settings/preferences.
- **Visual QA rubric**: Added `visual-qa-rubric` for screenshot/browser review, responsive checks, anti-AI-smell scoring, accessibility review, and visual readiness verdicts.
- **Frontend flow scanner**: Added `opencode-jce flow frontend` alias with pattern recommendations, visual QA evidence requirements, and frontend handoff guidance.
- **JCE-Worker frontend ownership**: Added Frontend Product Design Brain so JCE-Worker is the single front door for frontend/product UI work while keeping the frontend agent as an internal specialist.

### Changed
- Upgraded bundled `frontend` agent with safe public inspiration rules, backend contract mapping, Human UI Review, visual QA output, and screenshot/browser review workflow.
- Extended skill routing so UI, dashboard, landing page, visual QA, screenshot, and product design prompts auto-load advanced frontend skills without requiring manual agent switching.
- Updated web scanner to reduce false positives, ignore test/runtime folders, detect UI patterns from route/form signals, and require browser screenshot evidence for UI completion claims.
- Hardened config/update paths with deeper JSON serialization, safer malformed config backup behavior, unique atomic temp writes, context read error handling, larger command buffers, and safer Android logcat device validation.

### Fixed
- CI validation script handling for GitHub Actions `shell: bash` with implicit `set -eo pipefail`.

### Verified
- `bun test tests/unit/plugin-agents.test.ts tests/unit/plugin-skill-loader.test.ts tests/unit/config.test.ts`
- `bun test tests/unit/config.test.ts tests/unit/plugin-skill-loader.test.ts tests/unit/advanced-flow-scanners.test.ts tests/unit/install-payload-verification.test.ts tests/unit/plugin-skill-sync.test.ts tests/unit/jce-intelligence-priorities.test.ts`
- `bun run typecheck`
- `bun ./src/index.ts validate`

---

## [3.5.2] - 2026-06-03

### Fixed
- **Installer version sync**: `install.sh` and `install.ps1` version strings now match the release version.
- **Android logcat input validation**: `packageName` argument is now validated against `[a-zA-Z0-9._]+` before passing to `adb shell pidof`, preventing potential command injection via shell metacharacters.

### Changed
- Bumped all version references to `3.5.2`.

---

## [3.5.1] - 2026-06-03

### Security
- **CLI update integrity**: `opencode-jce update` now verifies cloned commit SHA against `git ls-remote` before applying update, preventing TOCTOU attacks between ref fetch and git clone.
- **MCP env sanitization**: Plugin MCP config now rejects env values containing shell expansion patterns (`${...}`, backticks, `$VAR`) to prevent command injection via malicious plugins.
- **MCP remote URL validation**: Remote MCP URLs now require valid HTTPS hostname (no localhost/loopback, no embedded credentials, must contain a dot), preventing SSRF and injection vectors.
- **Config backup on parse error**: `loadOpenCodeConfig` now backs up corrupted `opencode.json` before auto-creating from template, preventing silent data loss when config has invalid JSON.

### Fixed
- **Update rollback coverage**: `opencode-jce update` now backs up and restores `agents.json`, `mcp.json`, `lsp.json`, `fallback.json` alongside `opencode.json` and `tui.json` on fetch failure.
- **Context update race condition**: `context_update` MCP tool now reads file once and computes hash from that read instead of double-read pattern, reducing window for concurrent write conflicts.
- **Router hardcoded profile IDs**: `routeToProfile` no longer depends on hardcoded profile IDs (`"speed"`, `"budget"`, etc.). Now ranks profiles by `maxTokens` and selects based on complexity tier.
- **listingFailed false positive**: `mergeDirectory` now uses HTTP HEAD check to distinguish genuine empty directories from fetch failures, instead of assuming empty = failure.
- **Log rotation overflow**: Logger now keeps up to 5 rotated backups (`.log.1` through `.log.5`) instead of overwriting `.log.1` on every rotation.

### Changed
- SECURITY.md version table updated from `1.1.x` to `3.5.x` to match actual supported version.

---

## [3.5.0] - 2026-06-02

### Fixed
- Fixed context index deduplication: was comparing full entry string (including timestamp) so duplicates were never detected. Now compares summary text per bucket.
- Fixed `pruneContextIndexNotes` using `endsWith` instead of `includes` for note filename matching, so pruning actually finds notes.
- Fixed bucket inference scoring: summary matches now get proper weight instead of being treated as weak signals.

### Added
- Notes pruning: `pruneContextIndexNotes(bucket, { maxAge?, maxNotes?, dryRun? })` deletes old notes by age or count, with index entry cleanup.
- MCP tools: `context_index_prune` (prune old notes/entries) and `context_index_stats` (show bucket/note/entry counts).
- Search/filter on `context_index_read`: optional `since`, `agent`, `keyword` params to filter bucket entries.
- In-memory cache for session and index content, invalidated on write. Reduces IO for repeated reads.
- Noise filter: `writeContextIndex` skips writes without meaningful summary (>10 chars) or verification/blockers/nextSteps/android.
- Auto `.gitignore` entry: `ensureContextIndex` adds `.opencode-jce/context/` to `.gitignore` if not present.
- Configurable bucket descriptions via `.opencode-jce/context-config.json`.
- Weighted bucket inference scoring: file-path signals get 3x weight, summary matches get 2x.
- `context_read` response now includes index stats (total notes, total entries).
- Comprehensive test coverage: dedup, pruning, stats, search/filter, noise filter, bucket inference scoring, dryRun.

### Changed
- `readContextIndex` now takes `ContextIndexReadOptions` object instead of plain string for bucket parameter.
- Bumped project, installer, config, MCP, README, and release workflow test versions to `3.5.0`.

### Verified
- `bun run typecheck` (pass)
- `bun test` (`979 pass`, `0 fail`)

---

## [3.4.2] - 2026-06-02

### Fixed
- Replaced synchronous `existsSync` calls in `context-index.ts` with async `stat` checks to avoid blocking the event loop during context index reads and writes.
- Applied atomic writes (`tmp + rename`) to session master index, bucket indexes, and note files so partial writes cannot corrupt runtime context state.

### Changed
- Note filenames now include seconds and milliseconds (`YYYY-MM-DD-HHMMSS-mmm`) and auto-suffix (`-1`, `-2`, ...) to eliminate collision when multiple context updates happen within the same minute.
- Added bucket name sanitization and duplicate-summary collision tests for context index write path.

### Verified
- `bun test tests/unit/context-index.test.ts tests/unit/context-keeper.test.ts tests/unit/context-autocapture.test.ts` (`46 pass`, `0 fail`)
- `bun run typecheck`

---

## [3.4.1] - 2026-06-02

### Added
- Added zero-config workflow skills: `grill-with-docs`, `to-prd`, `to-issues`, `triage`, `prototype`, `write-a-skill`, and `git-guardrails`.
- Added automatic routing for PRDs, GitHub issue slicing, triage, prototypes, skill authoring, git safety, and ADR/context plan reviews.

### Fixed
- Tightened `triage` skill activation so generic `priority` wording no longer triggers issue triage accidentally.
- Ensured fresh installers carry `config/` into CLI staging so local update paths can refresh bundled skills without relying on the GitHub API fallback.
- Added payload verification for `config/AGENTS.md` and all new workflow skill files in PowerShell, Unix, and TypeScript update flows.
- Added a `qs@^6.15.2` override to resolve a moderate transitive audit finding from the MCP SDK Express stack.

### Changed
- Updated skill inventory in `config/AGENTS.md` to list 71 bundled skills and include examples for PRD/issues and ADR/git guardrail workflows.
- Bumped project, installer, config, MCP, README, and release workflow test versions to `3.4.1`.

### Verified
- `bun test tests/unit/install-payload-verification.test.ts tests/unit/config.test.ts tests/unit/plugin-skill-loader.test.ts tests/unit/plugin-skill-sync.test.ts`
- `bun run typecheck`
- `bun audit`
- `bun test` (`965 pass`, `0 fail`)

---

## [3.4.0] - 2026-06-02

### Added
- Added native JCE advanced context index under `.opencode-jce/context/` with master index, bucket indexes, and detailed handoff notes.
- Added `context_index_read` and `context_index_update` MCP tools for focused release, agent, config, Android, testing, security, frontend, and general memory buckets.
- Integrated context indexing with `context_read`, `context_autocapture`, and `context_session_summary` so `.opencode-context.md` stays compact while detailed notes remain discoverable.

### Fixed
- Fixed context index note links so bucket entries resolve from `indexes/*.md` to `../notes/*.md` correctly.
- Added `src/lib/context-index.ts` to install, reinstall, and update payload verification so releases cannot omit the new context runtime dependency.
- Created the context index during first `context_read` bootstrap so the template's detailed handoff pointer is valid for new projects.

### Changed
- Bumped project, installer, config, MCP, README, and release workflow test versions to `3.4.0`.
- Updated JCE-Worker instructions to use advanced context index when available with safe fallback to existing context tools.

### Verified
- `bun test tests/unit/context-index.test.ts tests/unit/context-keeper.test.ts tests/unit/context-autocapture.test.ts tests/unit/install-payload-verification.test.ts tests/unit/plugin-workflow-tool.test.ts tests/unit/ui.test.ts`
- `bun run typecheck`
- `bun test` (`962 pass`, `0 fail`) with `safe.directory` env for this workspace ownership.

---

## [3.3.6] - 2026-06-02

### Changed
- Updated Playwright MCP installer/config defaults from pinned `@playwright/mcp@0.0.28` to `@playwright/mcp@latest` so new installs use the current browser automation server.
- Bumped project, installer, config, MCP, README, and release workflow test versions to `3.3.6`.

### Verified
- `bun test tests/unit/audit-fixes.test.ts tests/unit/plugin-workflow-tool.test.ts tests/unit/ui.test.ts`
- `bun test` (`959 pass`, `0 fail`) with `safe.directory` env for this workspace ownership.
- `bun run typecheck`

---

## [3.3.5] - 2026-05-19

### Fixed
- Hardened `opencode.json` preservation: install, reinstall, and update now refuse to automatically rebuild a non-empty malformed `opencode.json`, preserving the user's original file unchanged instead of replacing it with defaults.
- Update migrations now fail soft with warnings instead of aborting after a preserved malformed config is detected.

### Changed
- Bumped project, installer, config, MCP, README, and release workflow test versions to `3.3.5`.

### Verified
- `bun test tests/unit/opencode-config-merge.test.ts tests/unit/install-merge-config.test.ts tests/unit/update-config-hardening.test.ts tests/unit/audit-fixes.test.ts tests/unit/plugin-workflow-tool.test.ts tests/unit/ui.test.ts`
- `bun run typecheck`

---

## [3.3.4] - 2026-05-19

### Fixed
- Added `src/lib/context-template.ts` to install, reinstall, and update payload verification so the plugin-side `.opencode-context.md` bootstrap dependency is explicitly required before CLI source swaps.

### Changed
- Bumped project, installer, config, MCP, README, and release workflow test versions to `3.3.4`.

### Verified
- `bun test tests/unit/install-payload-verification.test.ts tests/unit/plugin-integration.test.ts tests/unit/plugin-workflow-tool.test.ts tests/unit/ui.test.ts`
- `bun run typecheck`

---

## [3.3.3] - 2026-05-19

### Fixed
- Added plugin-side project context bootstrapping so `.opencode-context.md` is created on the first chat message in a new project even when the model skips the `context_read` MCP tool.
- Preserved MCP `context_read` behavior while adding a runtime fallback that writes the standard context template directly into the active project root.
- Configured Fish shell PATH during Unix install so Bun global binaries such as `opencode-jce` are available in Fish sessions.

### Changed
- Bumped project, installer, config, MCP, README, and release workflow test versions to `3.3.3`.

### Verified
- `bun test tests/unit/plugin-integration.test.ts tests/unit/context-keeper.test.ts tests/unit/plugin-workflow-tool.test.ts tests/unit/ui.test.ts tests/unit/install-payload-verification.test.ts`
- `bun run typecheck`
- `bun test` (`958 pass`, `0 fail`)

---

## [3.3.2] - 2026-05-19

### Fixed
- Added a post-compaction no-task guard to prevent greeting-only sessions from entering repeated Build/Compaction cycles when context is full, especially with Sonnet 4.5 via 9router.
- Disabled compaction autocontinue for compacted summaries that only say the assistant is awaiting the user's task/question.
- Prevented greeting/no-op turns from auto-activating orchestration plans.
- Added installer, reinstall, and update payload verification for `src/plugin/lib/compaction-loop-guard.ts` so the fix is not omitted during CLI source swaps.

### Changed
- Bumped project, installer, config, MCP, README, and release workflow test versions to `3.3.2`.

### Verified
- `bun test tests/unit/compaction-loop-guard.test.ts tests/unit/plugin-integration.test.ts`
- `bun test tests/unit/install-payload-verification.test.ts tests/unit/plugin-workflow-tool.test.ts tests/unit/ui.test.ts`
- `bun run typecheck`

---

## [3.3.1] - 2026-05-19

### Fixed
- Hardened install, reinstall, and update payload verification so JCE intelligence commands and Web/API/DevOps/Security flow modules are explicitly required before CLI source swaps.
- Added update-path payload validation in `opencode-jce update`, matching installer safety checks.
- Stopped stale OpenCode/plugin processes after install, reinstall, and update so macOS/Linux sessions do not keep running the old plugin/CLI payload.
- Hardened JCE-Worker stop-early behavior so pending/in-progress TodoWrite items, confirmation prompts, Indonesian stop phrases, review-route completions, and orchestration continuation failures block premature stopping.
- Added installer/update payload checks for JCE-Worker hook files so install, reinstall, and update deliver the stop-early guard implementation.

### Changed
- Bumped project, installer, config, MCP, README, and release workflow test versions to `3.3.1`.

### Verified
- `bun test tests/unit/install-payload-verification.test.ts` (`3 pass`, `0 fail`)
- `bun test tests/unit/update-process-cleanup.test.ts` (`2 pass`, `0 fail`)
- `bun test tests/unit/plugin-guard.test.ts tests/unit/todo-enforcer.test.ts tests/unit/plugin-integration.test.ts tests/unit/plugin-final-review-gate.test.ts tests/unit/plugin-execution-policy.test.ts` (`98 pass`, `0 fail`)
- `bun run typecheck`
- `bun test` (`946 pass`, `0 fail`)

---

## [3.3.0] - 2026-05-19

### Added
- Added JCE intelligence capabilities: skill quality audit/scoring, skill conflict resolution, capability registry, local evidence store, docs generator, and analytics CLI.
- Added new CLI surfaces: `skills`, `capabilities`, `evidence`, `docs`, `analytics`, and `flow`.
- Added JCE-Worker doctor intelligence checks for agent, skill, capability, and context-keeper alignment.
- Added Web/Next.js/React, API, DevOps/CI, and Security advanced flow packs with filesystem scanners and verification recommendations.
- Added security findings with severity, evidence, remediation, and candidate-risk reporting.
- Added regression tests for JCE intelligence priorities and advanced flow filesystem scanners.

### Changed
- Bumped project, installer, config, MCP, README, and release workflow test versions to `3.3.0`.

### Verified
- `bun run typecheck`
- `bun test tests/unit/advanced-flow-scanners.test.ts tests/unit/jce-intelligence-priorities.test.ts` (`11 pass`, `0 fail`)
- `bun test` (`938 pass`, `0 fail`)
- `bun run src/index.ts capabilities list --json`
- `bun run src/index.ts skills resolve frontend,nextjs,react,typescript --json`
- `bun run src/index.ts flow security --json`

---

## [3.2.0] - 2026-05-18

### Added
- Added Android Advanced Flow Pack with profile generation, flow templates, environment findings, failure-aware next actions, and persistent context hints.
- Added Android Phase A-E modules: environment probe, command planner, evidence gate, compatibility matrix, security auditor, release readiness gate, build optimizer, device crash flow planner, and orchestration plan builder.
- Added Flutter Advanced Flow Pack with project scanning, environment probing, failure classification, verification recipes, command/evidence gates, flow templates, and release readiness.
- Added regression tests for Android advanced flows, Phase A-E capabilities, and installer payload verification.

### Changed
- Installers now verify required Android and Flutter advanced TypeScript payload files in staging before swapping the installed CLI, protecting first install, update, and reinstall from incomplete payloads.
- Bumped project, installer, config, MCP, README, and release workflow test versions to `3.2.0`.

### Verified
- `bun test tests/unit/install-payload-verification.test.ts tests/unit/android-phase-a-e.test.ts tests/unit/android-advanced-flow.test.ts` (`8 pass`, `0 fail`)
- `bun run typecheck`
- `bun test` (`927 pass`, `0 fail`)

---

## [3.1.0] - 2026-05-18

### Added
- Added native Android specialist agent with Gradle/AGP/KSP, Kotlin/Java Android, Jetpack Compose, adb/logcat, APK/AAB, R8/ProGuard, and release diagnostics guidance.
- Added Android skills: `android-kotlin`, `android-gradle`, `android-testing`, `android-release`, `android-compose`, and `android-security`.
- Added Android intelligence libraries for verification recipes, project scanning, and failure classification.
- Added `android_logcat` plugin tool for automatic adb logcat collection, package/PID filtering, and crash/ANR/native failure classification.
- Added context continuity tools: `context_autocapture`, `context_session_summary`, and `context_compact`.
- Added structured project facts storage at `.opencode-jce/project-facts.json` for durable session continuity.

### Changed
- JCE-Worker now routes native Android work to the Android specialist and uses Android-specific verification guidance.
- `opencode-jce update` now refreshes existing bundled skills with timestamped `SKILL.md.backup.*` files so skill updates are realized without losing local edits.
- Native OpenCode template now exposes the bundled Android agent after restart.
- Bumped project, installer, config, MCP, README, and release workflow test versions to `3.1.0`.

### Verified
- `bun run typecheck`
- `bun ./src/index.ts validate` (`24` config files valid)
- `bun test` (`916 pass`, `0 fail`)

---

## [2.0.16] - 2026-05-08

### Fixed
- Registered Token Savings as an OpenCode TUI plugin via `tui.json` so fresh installs load the sidebar widget on OpenCode 1.14.34.
- Split `opencode-jce` server plugin and `opencode-jce-token-savings` TUI plugin exports to match OpenCode plugin loader requirements.

### Changed
- Converted Token Savings sidebar source to `src/plugin/tui.tsx` using OpenTUI Solid JSX.
- Bumped project, installer, config, MCP, README, and release workflow test versions to `2.0.16`.

### Verified
- `bun run typecheck`
- `bun test` (`700 pass`, `0 fail`)

---

## [2.0.15] - 2026-05-08

### Added
- Added TUI sidebar Token Savings display between MCP and LSP sections.
- Persisted aggregate context budget telemetry so TUI can show saved percentage and compressed/original chars.

### Changed
- Hardened `opencode-jce update` directory fetch accounting, CLI staging rollback, and stale context-keeper command refresh.
- Bumped project, installer, config, MCP, README, and release workflow test versions to `2.0.15`.

### Verified
- `bun run typecheck`
- `bun test` (`698 pass`, `0 fail`)

---

## [2.0.13] - 2026-05-08

### Fixed
- Linux LSP installer now installs missing prerequisites before installing dependent language servers.
- Added automatic prerequisite setup for Go, Rust/Cargo, RubyGems, .NET SDK, Elixir/Mix, and Coursier.
- Fixed Linux LSP commands for gopls, Solargraph, Taplo, ElixirLS, Metals, and csharp-ls so they no longer fail silently when toolchains are missing.
- Added regression coverage for Linux LSP prerequisite installers and removed stale direct install-command expectations.

### Changed
- Removed generated docs from the repository and kept `docs/` ignored.
- Bumped project, installer, config, MCP, README, and release workflow test versions to `2.0.13`.

### Verified
- `bash -n install.sh`
- `bun run typecheck`
- `bun test` (`688 pass`, `0 fail`)
- `bun ./src/index.ts --version` (`2.0.13`)

---

## [2.0.12] - 2026-05-08

### Fixed
- Hardened plugin audit follow-ups while leaving the explicitly skipped fallback endpoint issue untouched.
- Protected team profile resolution from path traversal and pinned team config writes to the expected config path.
- Added manifest and MCP validation plus safer registry writes for plugin installation flows.
- Required verification evidence for empty workflow completion paths.
- Expired stale background tasks during status reads and freed concurrency slots.
- Hardened Linux installer tarball fallback by validating extracted repository layout before use.
- Added OpenCode model discovery caching to reduce repeated settings lookups.

### Changed
- Added release context checkpoint for `2.0.12`.
- Preserved Windows installer behavior while Linux installer hardening continued separately in later release work.

### Verified
- `bash -n install.sh`
- PowerShell parser validation for `install.ps1`
- `bun run typecheck`
- `bun test`
- `bun ./src/index.ts --version` (`2.0.12`)

---

## [1.2.0] — 2026-05-01

### Added
- **35 on-demand skill files** — modular AI instructions loaded based on task context
  - Core: software-engineering, security, architecture, frontend, devops, developer-tooling, ai-optimization, advanced-patterns, sql-database, tailwind
  - Frontend frameworks: React, Vue, Svelte, Next.js, Angular
  - Backend frameworks: Laravel, Django/FastAPI, Express/NestJS, Spring Boot, Rails
  - Mobile: React Native, Flutter/Dart, Swift/iOS
  - Languages: TypeScript, Python, Rust, Go, C#, Java/Kotlin, PHP, Ruby, C/C++, Shell/Bash, Elixir, Scala
- **AGENTS.md v3.0** — compact router (97 lines) that auto-loads relevant skills
- **28 LSP servers** — expanded from 10 to 28 (added C#, Bash, YAML, HTML, CSS, Kotlin, Dart, Lua, Svelte, Vue, Terraform, Tailwind, Zig, Markdown, TOML, GraphQL, Elixir, Scala)
- **fallback.schema.json** — schema validation for provider fallback config
- **`src/lib/constants.ts`** — centralized version, GitHub URL, model pricing
- **Shared `formatCost()` helper** in `ui.ts` — removed duplicates from dashboard and tokens
- **CI: `bun test` job** — tests now actually run in CI
- **CI: schema validation** — AJV validates all configs against schemas
- **CI: Bun caching** — faster CI runs with dependency caching
- LICENSE, SECURITY.md, CONTRIBUTING.md, CHANGELOG.md

### Fixed
- **Security: command injection** in `plugins.ts` — replaced `execSync` with `Bun.spawn` array form
- **Security: path traversal** in `prompts.ts` — validate resolved path stays within prompts directory
- **Security: filesystem MCP root access** — restricted from `/` to `./` (current directory only)
- **CI: `bun.lockb` → `bun.lock`** — cache key referenced wrong lockfile name
- **CI: `--frozen-lockfile` removed** — caused failures due to Bun version mismatch
- **CI: Windows compatibility** — explicit `bun run ./src/index.ts` for cross-platform
- **Windows installer: winget exit code 43** — "already installed" now treated as success
- **Windows installer: gopls build** — stderr progress no longer treated as failure
- **Windows installer: correct winget IDs** — fixed LLVM, Lua, Dart, Terraform, Elixir, Marksman
- **Windows installer: C# LSP** — switched from broken `omnisharp` to `csharp-ls v0.15.0`
- **Windows installer: Java LSP** — downloads Eclipse JDTLS binary instead of non-existent npm package
- **Unguarded `JSON.parse`** — added try/catch in agents, fallback, plugins, schema, merge-config (6 files)
- **Version mismatch** — synchronized `1.1.0` across `install.sh`, `install.ps1`, `ui.ts`, `index.ts`
- **`install.sh` summary counts** — corrected from "14 agents/8 profiles" to "30/20"
- **README inaccuracies** — MCP count 6→5, removed Brave Search, fixed provider labels

### Changed
- **AGENTS.md** — rewritten from monolithic 1333-line file to 97-line router + 35 modular skill files
- **Hardcoded values extracted** — version, GitHub URL, model pricing moved to `constants.ts`
- **`Invoke-Expression` replaced** — Windows installer uses safer `cmd /c` for LSP installs

---

## [1.1.0] — 2026-04-30

### Added
- Interactive LSP server selection during install
- MCP package pre-caching to prevent timeout
- Dead feature wiring and Windows compatibility fixes

### Fixed
- Removed paid Brave Search MCP
- Doctor shows MCP exit 143 as OK
- Profile schema supports all providers
- Removed API key setup (managed by OpenCode CLI)
- Windows global CLI install fixes (.cmd wrapper)
- PowerShell installer ASCII-only for `irm|iex` compatibility

---

## [1.0.0] — 2026-04-28

### Added
- 16 CLI commands (validate, use, doctor, setup, update, uninstall, route, tokens, optimize, agent, prompts, plugin, team, memory, dashboard, fallback)
- 30 AI agents with specialized system prompts
- 20 model profiles (Anthropic, OpenAI, Google, DeepSeek, xAI, Mistral, Ollama)
- 5 MCP servers (Context7, GitHub Search, Web Fetch, Filesystem, Memory)
- 10 LSP server configurations
- Smart routing engine for automatic model selection
- Token usage tracking with cost breakdown
- Multi-provider fallback with health checks
- Rate limit handler with exponential backoff
- Cost optimizer with usage pattern analysis
- Custom agent builder (CRUD)
- Prompt template library
- Community plugin system
- Team config sharing via Git
- Persistent context memory
- Analytics dashboard
- Docker support
- Offline bundle support
- GitHub Actions CI pipeline
- Cross-platform installers (Bash + PowerShell)
- JSON Schema validation for all configs
