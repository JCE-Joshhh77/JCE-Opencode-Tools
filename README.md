<div align="center">

# OpenCode JCE

### AI-Powered Terminal Toolkit for OpenCode CLI

[![CI](https://github.com/JCETools-Petra/JCE-Opencode-Tools/actions/workflows/ci.yml/badge.svg)](https://github.com/JCETools-Petra/JCE-Opencode-Tools/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-2.0.1-green)]()
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-brightgreen)]()

**One command. Full setup. Zero hassle.**

Install, configure, and manage your entire AI coding environment — 42 agents, 19 model profiles, 50 advanced skills, 6 MCP tools, 28 LSP servers, and 17 CLI commands.

[Install](#-install) · [Features](#-features) · [CLI](#-cli-commands) · [Tutorial](#-installation-tutorial)

</div>

---

## Install

**Linux / macOS** (recommended: download first for interactive LSP selection):

```bash
curl -fsSL https://raw.githubusercontent.com/JCETools-Petra/JCE-Opencode-Tools/main/install.sh -o install.sh
chmod +x install.sh && ./install.sh
```

**Windows** (PowerShell as Admin):

```powershell
irm https://raw.githubusercontent.com/JCETools-Petra/JCE-Opencode-Tools/main/install.ps1 | iex
```

> Takes ~2 minutes. Existing tools (Git, Bun, OpenCode) are detected and skipped. Your current config is never overwritten.

---

## Features

### 42 AI Agents (All Advanced)

Every agent includes deep system prompts (4000-6000 chars), structured workflows, context-aware routing, multi-agent pipelines, and verification checklists.

**Every agent includes:**
- `systemPrompt` — deep methodology with decision trees, anti-patterns, and examples
- `workflow` — 10-12 step execution plan with gates
- `tools` — preferred MCP tools for the task
- `outputFormat` — structured response template with tables and code blocks
- `contextRules` — per-framework/technology specific checks
- `verification` — 8-10 item self-check before responding
- `routing` — auto-dispatch via file extensions, error patterns, project files
- `pipeline` — collaboration links (before/after/escalateTo/delegateTo)

<details>
<summary>View all agents</summary>

| Agent | Specialization |
|-------|---------------|
| `debugger` | Systematic fault isolation & root cause analysis |
| `reviewer` | Code review with severity-ranked feedback |
| `security` | OWASP Top 10, vulnerability scanning, threat modeling |
| `docs-researcher` | Real-time library documentation lookup |
| `architect` | System design, trade-off analysis, YAGNI |
| `refactorer` | Incremental code improvement without behavior change |
| `tester` | TDD, behavior-focused tests, edge case coverage |
| `devops` | CI/CD, Docker, infrastructure as code |
| `frontend` | Accessible, responsive, performant UIs |
| `backend` | Robust APIs, validation, error handling |
| `database` | Schema design, query optimization, migrations |
| `performance` | Data-driven profiling & optimization |
| `mentor` | Patient teaching with analogies & examples |
| `planner` | Task breakdown & dependency mapping |
| `api-designer` | REST/GraphQL API design, OpenAPI specs |
| `cloud-architect` | AWS/GCP/Azure, Terraform, scaling |
| `mobile-dev` | iOS, Android, React Native, Flutter |
| `ml-engineer` | ML pipelines, model training, data science |
| `technical-writer` | Clear documentation, API docs, changelogs |
| `git-expert` | Complex git workflows, merge conflicts |
| `shell-scripter` | Bash/PowerShell automation |
| `regex-master` | Pattern matching & text extraction |
| `accessibility` | WCAG compliance, inclusive design |
| `i18n-expert` | Internationalization & localization |
| `data-engineer` | ETL pipelines, data modeling, warehousing |
| `code-migrator` | Framework/language migrations |
| `dependency-manager` | Package updates, vulnerability fixes |
| `error-handler` | Resilience patterns, graceful degradation |
| `ui-designer` | Design systems, wireframes, user flows |
| `optimizer` | Bundle size, caching, Core Web Vitals |
| `monorepo` | Turborepo, Nx, pnpm workspaces |
| `distributed` | Microservices, event-driven, saga patterns |
| `realtime` | WebSocket, SSE, CRDT, real-time sync |
| `web3` | Blockchain, Solidity, smart contracts |
| `gamedev` | ECS, game loops, physics, rendering |
| `observability` | Monitoring, tracing, SLO/SLI, alerting |
| `auth-specialist` | OAuth2, OIDC, RBAC, zero-trust |
| `compliance` | GDPR, SOC2, audit trails, PII |
| `ai-engineer` | LLM integration, RAG, prompt engineering |
| `platform` | Kubernetes, Helm, GitOps, service mesh |
| `reliability` | SRE, chaos engineering, incident response |
| `design-system` | Design tokens, Storybook, component libraries |

</details>

---

### 19 Model Profiles

Switch between providers and models instantly.

| Profile | Provider | Best For |
|---------|----------|----------|
| `sonnet-4.6` | Anthropic | Balanced quality/speed |
| `opus-latest` | Anthropic | Maximum quality |
| `claude-haiku` | Anthropic | Fast & cheap |
| `gpt-4o` | OpenAI | All-rounder |
| `o3` | OpenAI | Deep reasoning |
| `gemini-2.5` | Google | 1M context window |
| `gemini-flash` | Google | Ultra fast |
| `deepseek-v3` | DeepSeek | Cost-effective |
| `deepseek-coder` | DeepSeek | Coding specialist |
| `grok-3` | xAI | Real-time knowledge |
| `mistral-large` | Mistral | GDPR-friendly |
| `codestral` | Mistral | Code-only |
| `hybrid-hemat` | Auto | Smart routing (saves 30-60%) |
| `speed` | Auto | Fastest available |
| `quality` | Auto | Best available |
| `budget` | Auto | Maximum savings |
| `local` | Ollama | Offline |
| `llama-70b` | Ollama | Local powerhouse |
| `qwen-coder` | Ollama | Local coding |

---

### Smart Routing

The `hybrid-hemat` profile auto-selects the optimal model based on prompt complexity:

```
Simple question     → cheap model      💰 $0.0001
Feature request     → balanced model   💰 $0.005
Architecture design → powerful model   💰 $0.05
```

Saves 30-60% on token costs without sacrificing quality.

---

### 50 Advanced Skills

Modular instruction files loaded on-demand. All skills include decision trees, code examples, anti-patterns, and real-world patterns (150-500 lines each).

| Category | Skills |
|----------|--------|
| **Core** | software-engineering, security, architecture, frontend, devops, developer-tooling, ai-optimization, advanced-patterns, sql-database, tailwind, context-preservation, testing-strategies, api-design-patterns |
| **Distributed & Platform** | distributed-systems, platform-engineering, reliability-engineering, observability, realtime-systems, monorepo-management |
| **Security & Compliance** | auth-identity, compliance-governance |
| **AI & Specialized** | ai-llm-engineering, blockchain-web3, game-development, design-systems |
| **Frontend** | react, vue, svelte, nextjs, angular |
| **Backend** | laravel, django-fastapi, express-nestjs, spring-boot, rails |
| **Mobile** | react-native, flutter-dart, swift-ios |
| **Languages** | typescript, python, rust, go, csharp, java-kotlin, php, ruby, cpp, shell-bash, elixir, scala |

Every skill includes:
- Auto-detect triggers (file extensions, project files)
- Decision trees for choosing approaches
- Production-ready code examples
- Anti-patterns with explanations
- Verification checklists

Skills are detected from context and work with prompts in any language including Bahasa Indonesia.

---

### 6 MCP Tools

Pre-configured Model Context Protocol servers that extend AI capabilities beyond text generation.

| Tool | Capability |
|------|-----------|
| **Context-Keeper** | Automatic context preservation across sessions (v2: session tracking, enrichment, semantic prune) |
| **Context7** | Search library documentation in real-time |
| **GitHub Search** | Find code across repositories |
| **Memory** | Persistent context across sessions |
| **Playwright** | Browser automation — E2E testing, scraping, screenshots, PDF |
| **Sequential Thinking** | Structured step-by-step reasoning for complex problems |

> Agents automatically use the right MCP tools based on their `tools` field. For example, `debugger` uses Sequential Thinking, `frontend` uses Playwright.

---

### 28 LSP Servers

Code intelligence (autocomplete, diagnostics, go-to-definition) for 28 languages. Selected interactively during installation.

<details>
<summary>View all supported languages</summary>

Python, TypeScript/JS, Rust, Go, Docker, SQL, Java, C/C++, PHP, Ruby, C#, Bash, YAML, HTML, CSS, Kotlin, Dart, Lua, Svelte, Vue, Terraform, Tailwind CSS, Zig, Markdown, TOML, GraphQL, Elixir, Scala

</details>

---

### Context Preservation (v2)

AI never loses project context between sessions. A `.opencode-context.md` file in your project root is automatically managed by the `context-keeper` MCP server.

**v2 Features:**
- **Multi-session tracking** — session counter, staleness detection (warns if >7 days or >5 sessions without update)
- **Auto-enrichment** — git branch, uncommitted changes, last commit, dependencies injected at session start
- **Semantic intelligence** — fuzzy deduplication (>60% word overlap merged), resolved-note auto-pruning
- **Cross-project context** — read related project contexts in monorepos/microservices
- **Optimistic concurrency** — content hash prevents lost updates from parallel sessions
- **Compliance enforcement** — staleness warnings, `context audit` command

```bash
opencode-jce context init      # Create context file in project
opencode-jce context show      # View current context + token estimate
opencode-jce context status    # Health check
opencode-jce context audit     # Compliance check — staleness, missing info
```

Cost: ~150-300 tokens per session. Far cheaper than re-explaining context.

---

### Cost Optimization

- **Token tracking** — usage per day/week/month
- **Cost breakdown** — by provider, agent, model
- **Smart suggestions** — "Switch debugger to Haiku, save ~$1.50/month"
- **Budget profiles** — aggressive summarization + context truncation

---

### Provider Fallback & Rate Limiting

- Auto-switch to backup provider when primary is down
- Exponential backoff on rate limits
- Configurable fallback chains

```bash
opencode-jce fallback status   # View current fallback state
opencode-jce fallback test     # Test provider availability
opencode-jce fallback reset    # Reset rate limit counters
```

---

### Safe & Secure

- API keys stored as environment variables (never in config files)
- Merge-based installer — never overwrites existing config
- `opencode-jce update` preserves existing `opencode.json` and adds only missing JCE-managed entries
- Plugin config activation preserves unrelated OpenCode settings and blocks MCP key collisions
- Malformed `opencode.json` is backed up and rebuilt automatically before safe merge
- Command injection prevention in LSP detection
- Atomic config file writes (no corruption on crash)

---

## CLI Commands

17 commands for managing your AI coding environment:

```bash
# Setup & Health
opencode-jce doctor              # Full health check
opencode-jce setup               # Interactive setup wizard
opencode-jce setup --merge-lsp   # Auto-detect & configure LSP servers
opencode-jce validate            # Validate all config files

# Model Management
opencode-jce use <profile>       # Switch active profile
opencode-jce use --list          # Show all profiles
opencode-jce route "prompt"      # Preview model selection

# Cost & Analytics
opencode-jce tokens              # Token usage & costs
opencode-jce tokens --period week
opencode-jce optimize            # Cost optimization suggestions
opencode-jce dashboard           # Terminal analytics dashboard

# Agents & Prompts
opencode-jce agent list          # List all agents
opencode-jce agent create        # Create custom agent
opencode-jce agent edit <id>     # Edit agent
opencode-jce agent remove <id>   # Remove agent
opencode-jce prompts list        # View prompt templates
opencode-jce prompts apply <template> <agent>

# Context & Memory
opencode-jce context init        # Create .opencode-context.md
opencode-jce context show        # View project context
opencode-jce context status      # Context health check
opencode-jce memory set <k> <v>  # Store persistent memory
opencode-jce memory search <q>   # Search memories
opencode-jce memory list         # List all memories

# Provider Fallback
opencode-jce fallback status     # View fallback state
opencode-jce fallback test       # Test providers
opencode-jce fallback reset      # Reset rate limits

# Extensions & Team
opencode-jce plugin install <url>  # Install plugin
opencode-jce plugin list           # List plugins
opencode-jce team init <repo>      # Setup team sync
opencode-jce team push             # Share config
opencode-jce team pull             # Pull latest

# Maintenance
opencode-jce update              # Update to latest
opencode-jce uninstall           # Clean removal (with backup)
```

---

## Installation Tutorial

<details>
<summary><b>Windows — Step by Step</b></summary>

### Requirements

- Windows 10/11
- PowerShell 5.1+
- Internet connection

### Steps

1. **Open PowerShell as Administrator** — `Win + X` → Terminal (Admin)

2. **Run installer:**
   ```powershell
   irm https://raw.githubusercontent.com/JCETools-Petra/JCE-Opencode-Tools/main/install.ps1 | iex
   ```

3. **Select LSP servers** when prompted (type numbers like `1,2,12` or `a` for all)

4. **Verify** in a new PowerShell window:
   ```powershell
   opencode-jce doctor
   ```

5. **Start coding:**
   ```powershell
   cd your-project
   opencode
   ```

### Config location

```
~/.config/opencode/  # Windows: C:\Users\<you>\.config\opencode\
├── opencode.json    # Main config (LSP, MCP, providers)
├── agents.json      # 42 AI agents
├── profiles\        # 19 model profiles
├── skills\          # 50 on-demand skill files
├── lsp.json         # LSP server definitions
├── mcp.json         # MCP server config
└── AGENTS.md        # Global AI instructions
```

### Troubleshooting

| Problem | Solution |
|---------|----------|
| `opencode` not found | Restart PowerShell |
| `bun` not found | Close and reopen PowerShell |
| LSP not working | `opencode-jce setup --merge-lsp` |
| Permission denied | Run as Administrator |
| `rust-analyzer` not found | Ensure `rustup` is installed, then: `rustup default stable && rustup component add rust-analyzer` |
| `lua-language-server` not found | Restart terminal after winget install; verify with `where lua-language-server` |

</details>

<details>
<summary><b>Linux / macOS — Step by Step</b></summary>

### Requirements

- Ubuntu 20.04+ / Debian 11+ / Fedora 36+ / Arch / macOS 12+
- `curl` installed
- Internet connection

### Steps

1. **Download and run** (not pipe, for interactive LSP selection):
   ```bash
   curl -fsSL https://raw.githubusercontent.com/JCETools-Petra/JCE-Opencode-Tools/main/install.sh -o install.sh
   chmod +x install.sh
   ./install.sh
   ```

2. **Select LSP servers** when prompted

3. **Reload shell and verify:**
   ```bash
   source ~/.bashrc  # or ~/.zshrc
   opencode-jce doctor
   ```

4. **Start coding:**
   ```bash
   cd your-project
   opencode
   ```

### VPS / headless (non-interactive)

```bash
curl -fsSL https://raw.githubusercontent.com/JCETools-Petra/JCE-Opencode-Tools/main/install.sh | bash
source ~/.bashrc
npm install -g typescript-language-server typescript pyright bash-language-server
opencode-jce setup --merge-lsp
```

### Config location

```
~/.config/opencode/
├── opencode.json    # Main config (LSP, MCP, providers)
├── agents.json      # 42 AI agents
├── profiles/        # 19 model profiles
├── skills/          # 50 on-demand skill files
├── lsp.json         # LSP server definitions
├── mcp.json         # MCP server config
└── AGENTS.md        # Global AI instructions
```

### Common LSP installs

```bash
npm install -g pyright                              # Python
npm install -g typescript-language-server typescript # TypeScript/JS
npm install -g bash-language-server                 # Bash
npm install -g vscode-langservers-extracted         # HTML + CSS + JSON
npm install -g @tailwindcss/language-server         # Tailwind
sudo apt-get install -y clangd                      # C/C++
go install golang.org/x/tools/gopls@latest          # Go
rustup default stable && rustup component add rust-analyzer  # Rust
```

### Troubleshooting

| Problem | Solution |
|---------|----------|
| `opencode` not found | `source ~/.bashrc` or restart terminal |
| LSP menu didn't appear | Piped install. Run `opencode-jce setup` |
| LSP not in opencode.json | `opencode-jce setup --merge-lsp` |
| `npm` not found | Install Node.js first |
| Script failed | Debug: `bash -x install.sh 2>&1 \| tee log.txt` |

</details>

<details>
<summary><b>Docker</b></summary>

```bash
docker build -t opencode-jce .
docker run -it opencode-jce doctor
```

</details>

---

## Architecture

```
opencode-jce/
├── src/                    # CLI tool (TypeScript + Bun)
│   ├── index.ts            # Entry point (17 commands)
│   ├── commands/           # Command implementations
│   └── lib/                # Shared libraries (config, router, memory, etc.)
├── config/                 # Pre-configured settings
│   ├── AGENTS.md           # Global AI instructions (v3.1.0)
│   ├── agents.json         # 42 AI agents
│   ├── profiles/           # 19 model profiles
│   ├── skills/             # 50 on-demand skill files
│   ├── mcp.json            # 6 MCP tools
│   ├── lsp.json            # 28 LSP servers
│   ├── prompts/            # 5 prompt templates
│   └── fallback.json       # Provider fallback config
├── schemas/                # JSON Schema validation
├── scripts/                # Config merge & offline bundle
├── tests/                  # 117 unit + integration tests
├── .github/workflows/      # CI pipeline (typecheck, test, lint, validate)
├── install.sh              # Linux/macOS installer
├── install.ps1             # Windows installer
└── Dockerfile              # Container support
```

---

## Requirements

| Requirement | Details |
|-------------|---------|
| OS | Linux, macOS, or Windows 10+ |
| Terminal | bash, zsh, or PowerShell 5.1+ |
| Internet | For installation & API calls |
| Permissions | sudo/admin only for system package installs |

---

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

---

## Changelog

### v1.9.0

- **feat(context):** Context Preservation v2 — complete rewrite of the context-keeper MCP server
- **feat(context):** Multi-session awareness — session counter, timestamp tracking, staleness detection
- **feat(context):** Auto-enrichment — git branch, uncommitted changes, last commit, dependencies injected in `context_read` response
- **feat(context):** Semantic intelligence — Jaccard similarity-based fuzzy deduplication, resolved-note auto-detection and pruning
- **feat(context):** Cross-project context — read and summarize `.opencode-context.md` from related projects (monorepos)
- **feat(context):** Optimistic concurrency — content hash-based conflict detection with section-level three-way merge
- **feat(context):** New MCP tools: `context_history` (health metrics), `context_query_related` (sibling project contexts)
- **feat(context):** New CLI command: `opencode-jce context audit` — compliance checking with staleness and section completeness
- **refactor(context):** Extracted section utilities to `context-sections.ts` to prevent circular dependencies
- **chore:** Version bump to 1.9.0 across all 8 locations

### v1.5.0

- **feat(context):** Auto-create `.opencode-context.md` at session start — no manual `context init` needed
- **feat(context):** Auto-prune at session start — removes completed tasks, stale notes, compresses old decisions (target ≤40 lines)
- **feat(context):** Auto-archive when file exceeds 50 lines — moves old entries to `.opencode-context-archive.md`
- **feat(context):** Auto-detect project stack from package.json, Cargo.toml, go.mod, etc.

### v1.4.3

- **fix(installer):** Rust LSP — added custom `Install-RustAnalyzer` handler that auto-installs `rustup` via winget, sets up stable toolchain, adds `~/.cargo/bin` to PATH, then installs `rust-analyzer` component
- **fix(installer):** Lua LSP — expanded path detection to search winget Packages & LinkPackages directories recursively, added PATH refresh from registry after install
- **fix(installer):** Added `~/.cargo/bin` to `Get-KnownCommandPath` candidate paths for Rust tooling discovery

---

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/my-feature`
3. Commit: `git commit -m 'feat(scope): description'`
4. Push: `git push origin feature/my-feature`
5. Open a Pull Request

---

## License

MIT © [JCETools-Petra](https://github.com/JCETools-Petra)

---

<div align="center">

**Built for the OpenCode community**

[Report Bug](https://github.com/JCETools-Petra/JCE-Opencode-Tools/issues) · [Request Feature](https://github.com/JCETools-Petra/JCE-Opencode-Tools/issues) · [Donate](https://paypal.me/Darkness0777)

</div>
