---
name: monorepo-management
description: Turborepo, Nx, pnpm workspaces, affected builds, task caching. Use when working on monorepo-management tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Monorepo Management

## Auto-Detect

Trigger this skill when:
- Task mentions: monorepo, workspace, turborepo, nx, pnpm workspaces, lerna, changesets
- Files: `turbo.json`, `nx.json`, `pnpm-workspace.yaml`, `lerna.json`
- Patterns: shared packages, dependency graph, affected builds, task caching
- Root `package.json` contains: `workspaces` field or `turbo`/`nx` dependency

---

## Decision Tree: Monorepo Tool

```
What do you need?
├── Task orchestration + caching (minimal config)?
│   └── Turborepo 2 (fast, convention-based, any package manager)
├── Full-featured: generators, plugins, module boundaries?
│   └── Nx 20 (project graph, code generation, enforce boundaries)
├── Just workspace linking (no orchestration)?
│   └── pnpm workspaces / npm workspaces / yarn workspaces
├── Publishing packages to npm?
│   └── Changesets (versioning + changelogs + publish automation)
└── Need both orchestration AND publishing?
    └── Turborepo/Nx + Changesets (complementary tools)

Package manager:
├── Best dependency isolation + speed? → pnpm (strict, disk-efficient)
├── Broad ecosystem compatibility? → npm/yarn
└── Bun ecosystem? → Bun workspaces (fast, less mature)
```

## Decision Tree: Internal Package Strategy

```
How should internal packages be consumed?
├── Apps consume packages (Next.js, Vite)?
│   └── Just-in-Time Transpilation (no build step)
│       ├── next.config: transpilePackages: ['@acme/ui']
│       ├── Fastest DX, instant changes
│       └── Package exports point to source: "./src/index.ts"
├── External consumers (npm publish)?
│   └── Pre-built with tsup/unbuild
│       ├── Build CJS + ESM + .d.ts
│       └── Use Changesets for versioning
└── Large codebase, slow type checking?
    └── TypeScript project references (tsc --build)
        └── Incremental compilation, composite projects
```

---

## Turborepo 2 Configuration

```jsonc
// turbo.json — Turborepo 2 syntax
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local"],
  "globalEnv": ["NODE_ENV", "CI"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"],
      "env": ["DATABASE_URL", "NEXT_PUBLIC_*"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"],
      "env": ["CI"]
    },
    "lint": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "deploy": {
      "dependsOn": ["build", "test", "lint"],
      "cache": false
    }
  }
}
```

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
  - "tooling/*"
```

### Turborepo Filter Syntax

```bash
# Affected since main (CI optimization)
turbo run build --filter="...[origin/main]"

# Package and its dependencies (build what it needs)
turbo run build --filter="@acme/web..."

# Package and its dependents (what depends on it)
turbo run build --filter="...@acme/ui"

# Exclude a package
turbo run build --filter="!@acme/mobile"

# Directory-based filter
turbo run build --filter="./apps/*"

# Combine filters
turbo run build --filter="@acme/web..." --filter="@acme/api..."
```

---

## Remote Caching

```bash
# Vercel Remote Cache (managed)
npx turbo login
npx turbo link

# Self-hosted remote cache (Docker)
# docker run -p 3000:3000 ducktors/turborepo-remote-cache

# CI configuration
# env:
#   TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
#   TURBO_TEAM: ${{ vars.TURBO_TEAM }}
```

```bash
# Debug cache misses
turbo run build --dry=json          # Shows what would run
turbo run build --summarize         # Shows cache hit/miss reasons
turbo run build --verbosity=2       # Detailed hash inputs
```

---

## Affected Builds in CI

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
    branches: [main]

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history for affected detection

      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      # Only build/test/lint what changed
      - name: Build affected
        run: pnpm turbo run build test lint typecheck --filter="...[origin/main]"
        env:
          TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
          TURBO_TEAM: ${{ vars.TURBO_TEAM }}

  # Conditional deploy based on what changed
  deploy-web:
    needs: build-and-test
    if: contains(github.event.pull_request.labels.*.name, 'deploy-web')
    runs-on: ubuntu-latest
    steps:
      - run: echo "Deploy web"
```

---

## Nx 20 Configuration

```jsonc
// nx.json
{
  "targetDefaults": {
    "build": {
      "dependsOn": ["^build"],
      "cache": true,
      "inputs": ["production", "^production"]
    },
    "test": {
      "cache": true,
      "inputs": ["default", "^production"]
    },
    "lint": {
      "cache": true,
      "inputs": ["default", "{workspaceRoot}/.eslintrc.json"]
    }
  },
  "namedInputs": {
    "default": ["{projectRoot}/**/*", "sharedGlobals"],
    "production": ["default", "!{projectRoot}/**/*.spec.ts"],
    "sharedGlobals": ["{workspaceRoot}/tsconfig.base.json"]
  },
  "plugins": ["@nx/vite/plugin", "@nx/eslint/plugin"]
}
```

```bash
# Nx affected commands
nx affected -t build          # Build only affected projects
nx affected -t test --base=main
nx graph                      # Visualize dependency graph
nx run-many -t build --all    # Build everything (rare)

# Module boundary enforcement
# In .eslintrc.json:
# "@nx/enforce-module-boundaries": ["error", {
#   "depConstraints": [
#     { "sourceTag": "scope:app", "onlyDependOnLibsWithTags": ["scope:shared", "scope:feature"] },
#     { "sourceTag": "scope:feature", "onlyDependOnLibsWithTags": ["scope:shared"] }
#   ]
# }]
```

---

## Changesets (Versioning + Publishing)

```jsonc
// .changeset/config.json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": ["@changesets/changelog-github", { "repo": "acme/monorepo" }],
  "commit": false,
  "fixed": [],
  "linked": [["@acme/ui", "@acme/shared"]],
  "access": "restricted",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": ["@acme/web", "@acme/api"]
}
```

```bash
# Developer workflow
pnpm changeset                # Create changeset (interactive — pick packages + semver bump)
pnpm changeset version        # Consume changesets → bump versions + update CHANGELOGs
pnpm changeset publish        # Publish to npm registry

# CI automation (GitHub Action)
# uses: changesets/action@v1
# with:
#   publish: pnpm changeset publish
#   version: pnpm changeset version
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| Everything in one package.json | No isolation, version conflicts, slow installs | Proper workspace packages with clear boundaries |
| Circular dependencies | Build failures, infinite loops | Strict direction: apps → features → shared |
| No task caching | CI takes 30+ minutes on every PR | Turborepo/Nx with remote caching |
| Building everything on every PR | Wasted CI time and money | Affected/filtered builds based on git diff |
| Phantom dependencies (hoisting) | Works locally, fails in CI or other packages | pnpm strict mode (no hoisting) |
| No internal package boundaries | Spaghetti imports across packages | Nx module boundaries or eslint-plugin-import |
| Publishing internal packages to npm | Unnecessary complexity for private code | Use `workspace:*` protocol for internal deps |
| Monolithic CI pipeline | One failure blocks all deploys | Parallel jobs per package/app |

---

## Verification Checklist

- [ ] `pnpm-workspace.yaml` (or equivalent) defines all package locations
- [ ] `turbo.json` / `nx.json` defines task pipeline with correct `dependsOn`
- [ ] Remote caching configured and working (check hit rate in CI)
- [ ] CI uses affected/filter builds (not building everything)
- [ ] Internal packages use `workspace:*` protocol
- [ ] No circular dependencies (run `turbo run build --graph` to verify)
- [ ] Shared configs (tsconfig, eslint, prettier) extracted to packages
- [ ] Changesets configured for publishable packages
- [ ] Package exports defined correctly (source for JIT, dist for published)
- [ ] CI cache restored between runs (node_modules + turbo cache)
