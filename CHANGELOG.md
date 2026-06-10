# Changelog

All notable changes to OpenCode JCE are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/), versioned with [Semantic Versioning](https://semver.org/).

---

## [3.5.5] - 2026-06-10

### Added
- **Data-driven skill registry**: Single source-of-truth `SKILL_REGISTRY` for all 74 skills covering routing mode, priority, intents, signals, files, preferred agents, verification, and sample prompts.
- **Weighted routing engine**: Skill selection now uses multi-signal scoring (priority, intent, regex, file, agent, history, negative) with explainable per-skill contribution traces instead of ad-hoc ordering.
- **Negative routing**: Explicit suppression rules for common collision pairs (visual design vs API design, Go `interface` vs frontend, auth-heavy vs generic security, backend-only vs visual UI).
- **Multi-skill bundles**: Five stable bundle templates (android-build-bug, delegation-review, ui-polish, api-contract, release-prep) with routing boost for recurring task families.
- **Telemetry learning loop**: New `routing_decision` and `task_outcome` events; analytics now ranks useful/noisy/over-selected/failed-task skills and feeds history/bias back into the router.
- **User-correction loop**: Parses explicit corrections ("jangan load X", "pakai Y", "harusnya researcher bukan oracle") into session-level skill override and dispatch agent override, persisted to execution memory.
- **Adaptive sub-agent profiles**: Sub-agent skill injection now biases toward telemetry-useful skills and away from noisy ones per role.
- **Golden routing corpus**: 54-case EN/ID/mixed regression corpus with a test runner guarding routing behavior.
- **`skills explain` / `skills doctor` CLI**: Inspect weighted routing decisions (intent, candidate scores, selected/rejected, confidence) and registry metadata health from the CLI.
- **Machine-readable skill frontmatter**: Parser for routing frontmatter plus registry-vs-frontmatter drift validation.
- **Confidence threshold + fallback mode**: Low-confidence prompts fall back to one core plus one safest domain skill.

### Changed
- Capability matrix and startup audit now hydrate exclusively from `SKILL_REGISTRY`; removed scattered fallback inference helpers.
- `analytics --json` now returns a `routingQuality` summary.

### Fixed
- Orchestration stale cross-session graph leak (C1) and workflow seeded from tool output instead of user intent (C2).
- Case-insensitive tool-name matching so completion gates stop leaking onto read/bash/grep (L1).
- Completion-claim detection hardened to per-sentence with negation and leading-conditional guards.

### CI
- New `skill-routing-health` job: skill startup audit, golden corpus, `skills doctor --json`, and registry health (count drift, metadata gaps, frontmatter drift).

### Verified
- `bun run typecheck`
- `bun test` — 1029 pass, 0 fail
- Registry health gate — `Status: pass` (74 folders / 74 entries, no drift)
- `bun ./src/index.ts skills explain ... --json`
- `bun ./src/index.ts skills doctor --json`

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
