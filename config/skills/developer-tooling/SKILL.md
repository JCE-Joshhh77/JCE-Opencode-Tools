---
name: developer-tooling
description: LSP, linting, formatting, project structure, code generation. Use when working on developer-tooling tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Developer Tooling

## Auto-Detect

Trigger this skill when:
- Task mentions: linting, formatting, Biome, ESLint, Prettier, Vite, bundler, LSP, codegen
- Files: `biome.json`, `.eslintrc.*`, `vite.config.*`, `tsconfig.json`, `Makefile`
- Patterns: project setup, toolchain configuration, build optimization, monorepo tooling
- Dependencies: `@biomejs/biome`, `eslint`, `vite`, `tsup`, `unbuild`, `bun`

---

## Decision Tree: Linter + Formatter

```
Starting a new project?
├── Want single tool (lint + format)? → Biome (fastest, zero config)
├── Need plugin ecosystem (React, a11y, import sorting)? → ESLint 9 + Prettier
├── Python project? → Ruff (lint + format, replaces flake8/black/isort)
├── Rust? → rustfmt + clippy (built-in, no choice needed)
├── Go? → gofmt + golangci-lint (standard)
└── Migrating from ESLint + Prettier?
    └── Biome (has migration command: biome migrate eslint)
```

## Decision Tree: Bundler

```
What are you building?
├── Library (npm package)?
│   ├── Simple, TypeScript only → tsup (esbuild-based, fast)
│   ├── Need tree-shaking + multiple formats → unbuild (Rollup-based)
│   └── Bun ecosystem → bun build (native, fastest)
├── Web application?
│   ├── Standard SPA/MPA → Vite 6 (default choice)
│   ├── Next.js/Nuxt → Framework handles it (Turbopack/Vite)
│   └── Need SSR + islands → Astro or Vite + framework
├── Full-stack (server + client)?
│   └── Vite 6 with Environment API (unified dev server)
└── Monorepo with many packages?
    └── tsup per package + Turborepo for orchestration
```

## Decision Tree: Runtime

```
├── Standard Node.js compatibility needed? → Node.js 22+ (stable)
├── Want faster startup + native TypeScript? → Bun (compatible with most npm)
├── Need edge deployment? → Bun or Node.js with edge adapter
└── Deno ecosystem? → Deno 2 (npm compatible now)
```

---

## Biome Configuration

```jsonc
// biome.json — single tool for lint + format
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": { "enabled": true },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "complexity": {
        "noExcessiveCognitiveComplexity": { "level": "warn", "options": { "maxAllowedComplexity": 15 } }
      },
      "correctness": {
        "noUnusedVariables": "error",
        "noUnusedImports": "error",
        "useExhaustiveDependencies": "warn"
      },
      "suspicious": {
        "noExplicitAny": "warn",
        "noConsoleLog": "warn"
      },
      "style": {
        "useConst": "error",
        "noNonNullAssertion": "warn"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "all",
      "semicolons": "always"
    }
  }
}
```

```bash
# Usage
biome check .              # Lint + format check
biome check --write .      # Auto-fix + format
biome ci .                 # CI mode (no writes, exit code)
biome migrate eslint       # Migrate from ESLint config
```

---

## Vite 6 Configuration

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    react(),           // SWC for fast JSX transform
    tsconfigPaths(),   // Resolve tsconfig paths
  ],
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          // Split large dependencies into separate chunks
        },
      },
    },
    sourcemap: true,
  },
  server: {
    port: 3000,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  // Vite 6: Environment API for SSR
  environments: {
    client: { build: { outDir: 'dist/client' } },
    ssr: { build: { outDir: 'dist/server' } },
  },
});
```

---

## Library Bundling (tsup)

```typescript
// tsup.config.ts — for npm packages
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],       // Dual format for compatibility
  dts: true,                     // Generate .d.ts
  splitting: true,               // Code splitting for ESM
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  external: ['react', 'react-dom'], // Peer deps not bundled
});
```

```jsonc
// package.json exports for dual format
{
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    },
    "./button": {
      "import": "./dist/button.mjs",
      "require": "./dist/button.cjs",
      "types": "./dist/button.d.ts"
    }
  },
  "files": ["dist"],
  "sideEffects": false
}
```

---

## Code Generation

```typescript
// OpenAPI → TypeScript client (openapi-typescript)
// npx openapi-typescript ./openapi.yaml -o ./src/api/schema.d.ts

// Prisma → Type-safe DB client
// npx prisma generate

// GraphQL Codegen
// codegen.ts
import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  schema: 'http://localhost:4000/graphql',
  documents: 'src/**/*.graphql',
  generates: {
    './src/gql/': {
      preset: 'client',
      plugins: [],
      config: { scalars: { DateTime: 'string', JSON: 'Record<string, unknown>' } },
    },
  },
};
export default config;

// Rules for generated code:
// 1. NEVER hand-edit generated files
// 2. Commit generated code if needed at runtime
// 3. Gitignore if regenerated during build
// 4. Add generation step to CI pipeline
```

---

## Project Structure

```
# Feature-based (scales well)
src/
  features/
    auth/
      components/
      hooks/
      api.ts
      types.ts
      __tests__/
    dashboard/
      ...
  shared/
    components/    # Reusable UI primitives
    hooks/         # Shared hooks
    lib/           # Utilities (cn, formatDate, etc.)
    types/         # Global type definitions

# Rules:
# - Flat over nested (max 3-4 levels)
# - Colocate tests next to source
# - Feature folders are self-contained
# - shared/ only for truly cross-feature code
# - Barrel exports (index.ts) at feature boundary only
```

---

## Pre-commit Hooks

```jsonc
// package.json — lint-staged + husky
{
  "scripts": {
    "prepare": "husky"
  },
  "lint-staged": {
    "*.{ts,tsx,js,jsx}": ["biome check --write"],
    "*.{json,md,yaml}": ["prettier --write"]
  }
}
```

```bash
# .husky/pre-commit
npx lint-staged
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| ESLint + Prettier + conflicts | Config hell, slow, rule conflicts | Biome (single tool) or proper integration |
| No pre-commit hooks | Unformatted code in PRs | lint-staged + husky (or lefthook) |
| Hand-editing generated code | Overwritten on next generate | Always regenerate, never hand-edit |
| Deep directory nesting (5+ levels) | Hard to navigate, long imports | Feature-based flat structure (max 3-4) |
| Layer-based structure at scale | 200 files in components/ | Feature-based with colocated files |
| No TypeScript strict mode | Misses entire classes of bugs | `strict: true` in tsconfig from day one |
| Barrel exports everywhere | Breaks tree-shaking, circular deps | Only at feature boundaries |
| No sourcemaps in production | Cannot debug production errors | Enable sourcemaps, upload to error tracker |

---

## Verification Checklist

- [ ] Biome (or ESLint) configured with strict rules, zero warnings in CI
- [ ] Formatter runs on save and in pre-commit hook
- [ ] TypeScript strict mode enabled (`strict: true`)
- [ ] Build produces ESM + CJS for libraries (tsup/unbuild)
- [ ] Vite dev server starts in < 1s (no heavy plugins)
- [ ] Code generation automated (OpenAPI/Prisma/GraphQL)
- [ ] Generated files clearly marked (header comment or .gitattributes)
- [ ] Project structure is feature-based (not layer-based)
- [ ] Pre-commit hooks enforce lint + format
- [ ] CI runs `biome ci .` (or equivalent) — fails on any violation
