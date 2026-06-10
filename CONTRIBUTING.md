# Contributing to OpenCode JCE

Thank you for your interest in contributing! This guide will help you get started.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/JCETools-Petra/JCE-Opencode-Tools.git
cd JCE-Opencode-Tools

# Install dependencies
bun install

# Run the CLI locally
bun run src/index.ts --help

# Run tests
bun test

# Type check
bun run typecheck
```

## Development Workflow

1. **Fork** the repository
2. **Create a branch** from `main`: `git checkout -b feat/your-feature`
3. **Make changes** following the conventions below
4. **Test** your changes: `bun test && bun run typecheck`
5. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/)
6. **Push** and open a Pull Request

## Commit Convention

```
<type>(<scope>): <description>

Types:
  feat     — New feature
  fix      — Bug fix
  docs     — Documentation only
  style    — Formatting, no code change
  refactor — Code change that neither fixes a bug nor adds a feature
  perf     — Performance improvement
  test     — Adding or updating tests
  chore    — Build process, dependencies, tooling
  ci       — CI/CD changes
```

Examples:
```
feat(agents): add kubernetes-expert agent
fix(installer): handle spaces in Windows paths
docs(readme): update LSP server count
test(router): add unit tests for prompt classification
```

## Project Structure

```
src/
  index.ts          — CLI entry point (Commander.js)
  commands/         — One file per CLI command
  lib/              — Shared libraries (business logic)
  types.ts          — TypeScript type definitions

config/
  agents.json       — 30 AI agent definitions
  profiles/         — 20 model profile JSON files
  mcp.json          — MCP server configuration
  lsp.json          — 28 LSP server definitions
  fallback.json     — Provider fallback config
  prompts/          — Prompt template files
  skills/           — 74 on-demand skill files
  AGENTS.md         — Global AI instructions (router)

schemas/            — JSON Schema validation files
tests/              — Test files (bun test)
scripts/            — Build and merge scripts
```

## Adding a New Command

1. Create `src/commands/your-command.ts`
2. Export a `Command` instance
3. Register it in `src/index.ts`
4. Add tests in `tests/`

## Adding a New Agent

Edit `config/agents.json` and add an entry following the existing pattern:
```json
{
  "id": "your-agent",
  "name": "Your Agent",
  "role": "Description of what it does",
  "systemPrompt": "Detailed system prompt...",
  "preferredProfile": "sonnet-4.6",
  "maxTokens": 4096,
  "tools": ["read", "grep", "bash"]
}
```

Validate with: `bun run src/index.ts validate`

## Adding a New Skill

Create a file in `config/skills/your-skill.md`:
```markdown
# Skill: Your Skill Name
# Loaded on-demand when working with <context>

## Section 1
...
```

Then add it to the routing table in `config/AGENTS.md`.

## Adding a New LSP Server

Edit `config/lsp.json` and add an entry:
```json
"language-name": {
  "server": "server-name",
  "command": "executable-name",
  "args": ["--stdio"],
  "filetypes": ["ext1", "ext2"],
  "installCommand": "npm install -g package-name"
}
```

Also add the server to both `install.sh` and `install.ps1` LSP arrays.

## Code Quality

- **TypeScript strict mode** — `tsconfig.json` has `strict: true`
- **No `any` types** — use `unknown` and narrow
- **Error handling** — wrap `JSON.parse` in try/catch, validate inputs
- **Tests required** for new features and bug fixes

## Running Tests

```bash
# All tests
bun test

# Type checking
bun run typecheck

# Validate configs
bun run src/index.ts validate

# Full CI check (what GitHub Actions runs)
bun run typecheck && bun test && bun run src/index.ts validate
```

## Questions?

- Open a [GitHub Issue](https://github.com/JCETools-Petra/JCE-Opencode-Tools/issues)
- Check existing issues before creating a new one

Thank you for contributing! 🎉
