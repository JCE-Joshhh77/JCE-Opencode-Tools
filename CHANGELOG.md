# Changelog

All notable changes to OpenCode JCE are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/), versioned with [Semantic Versioning](https://semver.org/).

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
