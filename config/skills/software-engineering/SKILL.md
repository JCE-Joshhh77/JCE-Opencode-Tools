---
name: software-engineering
description: Core coding, testing, debugging, refactoring, and code review patterns. Use when working on software-engineering tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Software Engineering
# Loaded on-demand when task involves coding, testing, debugging, or refactoring

---

## Decision Tree: Architecture Choices

```
Starting a new project or feature?
├── How many developers?
│   ├── Solo / small team (1-5)?
│   │   └── Monolith with clear module boundaries
│   ├── Multiple teams (5-20)?
│   │   └── Modular monolith with domain packages
│   └── Large org (20+)?
│       └── Consider microservices (only if team boundaries align)
├── What's the deployment target?
│   ├── Serverless (Lambda, Cloudflare Workers)?
│   │   └── Function-per-route, stateless, cold-start aware
│   ├── Containers (K8s, ECS)?
│   │   └── 12-factor app, health checks, graceful shutdown
│   └── Edge (Deno Deploy, Vercel Edge)?
│       └── Minimal dependencies, streaming responses, no Node APIs
├── Data consistency requirements?
│   ├── Strong consistency (financial, inventory)?
│   │   └── Single DB with transactions, SERIALIZABLE where needed
│   ├── Eventual consistency acceptable?
│   │   └── Event-driven, async processing, idempotent consumers
│   └── Mixed?
│       └── CQRS — strong writes, eventually consistent reads
└── Scale expectations?
    ├── < 1K req/s → Monolith + PostgreSQL (don't over-engineer)
    ├── 1K-50K req/s → Horizontal scaling + Redis cache + read replicas
    └── > 50K req/s → Service decomposition + message queues + CDN
```

---

## Modern Testing (Vitest + Playwright)

### Vitest Configuration (2026 Standard)

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node', // or 'happy-dom' for component tests
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 },
      exclude: ['**/*.d.ts', '**/*.test.ts', '**/mocks/**'],
    },
    typecheck: { enabled: true }, // type-level test assertions
    pool: 'forks', // isolation between test files
    setupFiles: ['./tests/setup.ts'],
  },
});
```

### Playwright E2E Pattern

```typescript
// tests/e2e/checkout.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Checkout flow', () => {
  test('completes purchase with valid card', async ({ page }) => {
    await page.goto('/products/widget-pro');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.getByRole('link', { name: 'Cart' }).click();
    await page.getByRole('button', { name: 'Checkout' }).click();

    // Fill payment form
    await page.getByLabel('Card number').fill('4242424242424242');
    await page.getByLabel('Expiry').fill('12/28');
    await page.getByLabel('CVC').fill('123');
    await page.getByRole('button', { name: 'Pay' }).click();

    await expect(page.getByText('Order confirmed')).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/orders\/[a-z0-9-]+/);
  });
});
```

### TDD for Bug Fixes (Always)

1. Write a failing test that reproduces the bug
2. Fix the bug with minimal change
3. Verify the test passes
4. Verify no other tests broke

### Test Quality Rules

- Tests must be deterministic — no flaky tests, no timing dependencies
- Tests must be independent — no shared mutable state between tests
- Test names describe the scenario: `should return empty array when no items match filter`
- Prefer real objects over mocks; mock only external services and I/O
- Use `vi.useFakeTimers()` for time-dependent logic, never `setTimeout` in tests

---

## AI-Assisted Development Workflow

```
AI-Assisted Development Loop:
├── 1. Spec → Write requirements as tests or acceptance criteria FIRST
├── 2. Generate → Use AI to produce implementation candidates
├── 3. Review → Apply same rigor as human-written code:
│   ├── Does it handle edge cases?
│   ├── Is it secure (no injection, no secrets)?
│   ├── Does it match project conventions?
│   └── Is it testable and maintainable?
├── 4. Verify → Run full test suite, typecheck, lint
├── 5. Refine → Iterate on specific sections, not wholesale regeneration
└── 6. Own → You are responsible for AI-generated code. Review it like a PR.
```

**Rules for AI-generated code:**
- Never commit without reading every line
- AI doesn't know your runtime constraints — verify performance
- AI may hallucinate APIs — check docs for actual signatures
- AI tends toward over-abstraction — simplify aggressively
- Always run the code before claiming it works

---

## Code Review Automation

```yaml
# .github/workflows/pr-checks.yml — automated review gates
quality-gates:
  - lint: eslint + prettier (formatting is not debatable)
  - typecheck: tsc --noEmit (catch type errors before review)
  - tests: vitest run --coverage (must pass, coverage must not drop)
  - bundle-size: bundlewatch (fail if bundle grows > 5%)
  - security: npm audit + Snyk (block on high/critical CVEs)
  - dead-code: knip (detect unused exports, files, dependencies)
  - complexity: eslint cognitive-complexity rule (max 15)
```

**Human review focuses on:**
- [ ] Does this solve the right problem?
- [ ] Are there edge cases the tests don't cover?
- [ ] Is the abstraction level appropriate?
- [ ] Would a new team member understand this?
- [ ] Are there security implications?
- [ ] Is this backward-compatible?
- [ ] What happens if this fails at 3 AM?

---

## Trunk-Based Development

```
Trunk-Based Development (recommended for teams with CI/CD):
├── Main branch is always deployable
├── Short-lived feature branches (< 2 days)
├── Feature flags for incomplete work (deploy dark)
├── No long-running branches (no develop, no release branches)
├── Merge to main multiple times per day
└── Automated rollback if deployment fails

Branch strategy:
  main ─────●────●────●────●────●────── (always green)
              \  /      \  /
  feat/x       ●        ●   (< 2 days, squash merge)

vs. GitFlow (avoid unless releasing packaged software):
  main ──────────────●──────────────●──── (releases only)
  develop ───●──●──●──●──●──●──●──●───── (integration)
  feat/x ─────●──●──/                    (long-lived = merge hell)
```

---

## Debugging Methodology

**Never guess. Always investigate systematically.**

1. **Read the error message** — completely, including stack traces
2. **Reproduce** — can you trigger it reliably? Minimal reproduction.
3. **Isolate** — what's the smallest change that causes/fixes it?
4. **Trace** — follow the data flow from input to error
5. **Hypothesize** — form ONE theory, test it minimally
6. **Fix** — address root cause, not symptoms
7. **Verify** — confirm the fix AND that nothing else broke
8. **Prevent** — add a test, add validation, improve error message

**After 3 failed fix attempts:** STOP. Rethink the architecture. The problem may be structural.

---

## Refactoring Principles

- **Never refactor and change behavior in the same commit**
- Refactor only code you're actively working in — no drive-by refactoring
- Extract when logic is duplicated 3+ times (Rule of Three)
- Inline when an abstraction adds complexity without value
- Rename aggressively — good names prevent bugs
- Keep functions under 40 lines, files under 400 lines as soft limits
- **Strangler Fig** for large rewrites — wrap old code, redirect incrementally

---

## Concurrency & Async Patterns

```typescript
// ❌ Race condition — two requests can read stale state
let balance = await getBalance(userId);
balance -= amount;
await setBalance(userId, balance);

// ✅ Atomic operation — database handles concurrency
await db.execute(
  `UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND balance >= $1`,
  [amount, userId]
);

// ✅ Structured concurrency with AbortController
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);
try {
  const result = await fetch(url, { signal: controller.signal });
} finally {
  clearTimeout(timeout);
}

// ✅ Promise.allSettled for independent parallel operations
const results = await Promise.allSettled([
  fetchUserProfile(id),
  fetchUserOrders(id),
  fetchUserPreferences(id),
]);
// Handle each result independently — one failure doesn't block others
```

**Patterns:**
- **Immutable data** — shared state that can't change can't race
- **Message queues** — serialize access to shared resources
- **Optimistic locking** — version field, retry on conflict
- **Idempotency keys** — safe to retry without duplicate side effects

---

## Design Patterns (Apply When They Solve a Real Problem)

| Pattern | When to Use | Example |
|---------|------------|---------|
| **Repository** | Abstract data access from business logic | `UserRepository.findById(id)` |
| **Strategy** | Multiple algorithms, selected at runtime | Payment processors |
| **Observer/EventEmitter** | Decouple producers from consumers | Pub/sub, webhooks |
| **Factory** | Complex object creation with variants | `createLogger("file")` |
| **Dependency Injection** | Testability, loose coupling | Constructor injection |
| **Middleware/Pipeline** | Cross-cutting concerns in sequence | Express middleware |
| **Circuit Breaker** | Prevent cascade failures | External service calls |
| **Saga** | Distributed transactions | Order → Payment → Ship |

---

## Data Validation

```typescript
import { z } from 'zod';

const CreateUserSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(100),
  age: z.number().int().min(13).max(150).optional(),
  role: z.enum(['user', 'admin']).default('user'),
});

type CreateUserInput = z.infer<typeof CreateUserSchema>;

function createUser(raw: unknown): User {
  const input = CreateUserSchema.parse(raw); // throws ZodError if invalid
  return db.users.create(input);
}
```

**Validation layers:**
1. **Transport** — request body shape, content-type, size limits
2. **Schema** — field types, formats, ranges (Zod, Valibot, ArkType)
3. **Business** — domain rules (email not taken, sufficient balance)
4. **Database** — constraints, unique indexes, foreign keys (last defense)

---

## Git Workflow

- **Branch naming**: `feat/description`, `fix/description`, `refactor/description`
- **Commit format**: `<type>(<scope>): <description>` — conventional commits
- **Never force-push to main/master** without explicit approval
- **Never commit secrets** — .env files, API keys, credentials
- **Squash merge** for feature branches — clean history on main
- **Signed commits** for security-sensitive repos
- **Pre-commit hooks**: lint-staged + husky for formatting/linting

---

## Anti-Patterns

| ❌ Don't | ✅ Do Instead |
|----------|---------------|
| Write code without tests | TDD for bugs, test-after for features |
| Guess at performance issues | Profile first (EXPLAIN, flamegraph), then optimize |
| Copy-paste > 3 times | Extract to shared function/module |
| Catch errors and swallow silently | Fail fast, log, re-throw or handle explicitly |
| Use `any` in TypeScript | Proper types, generics, or `unknown` + narrowing |
| Commit directly to main | Short-lived branch + PR + CI gates |
| Skip code review for "small changes" | Small changes cause big outages |
| Over-engineer for hypothetical scale | Build for today, design for tomorrow |
