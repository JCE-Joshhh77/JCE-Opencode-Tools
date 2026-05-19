---
name: testing-strategies
description: Property-based, mutation, contract, visual regression, load testing. Use when working on testing-strategies tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Testing Strategies
# Loaded on-demand when task involves advanced testing patterns beyond basic unit/integration tests

## Auto-Detect

Trigger this skill when:
- Task mentions: property-based, mutation testing, contract testing, visual regression, load testing
- Files: `*.test.ts`, `*.spec.ts`, `*.pact.ts`, `k6/`, `*.stories.tsx`
- `package.json` contains: `fast-check`, `@pact-foundation/pact`, `stryker-mutator`, `@chromatic-com/storybook`

---

## Decision Tree: Testing Strategy

```
What are you testing?
+-- Pure business logic (no I/O)?
|   +-- Unit tests + property-based tests (fast-check)
+-- API endpoints?
|   +-- Integration tests (real DB via testcontainers)
|   +-- Contract tests (if consumed by other services)
+-- UI components?
|   +-- Component tests (Testing Library)
|   +-- Visual regression (Chromatic/Playwright screenshots)
|   +-- Interaction tests (Storybook play functions)
+-- Service-to-service communication?
|   +-- Contract tests (Pact)
+-- Performance requirements?
|   +-- Load tests (k6) in CI, fail on regression
+-- Confidence in test suite quality?
|   +-- Mutation testing (Stryker) on critical paths
+-- AI-generated code?
    +-- Property-based tests (verify invariants AI might miss)
    +-- Mutation testing (verify tests actually catch bugs)
```

## Testing Pyramid (Practical 2026)

```
        /   E2E    \         Few (5-10): Critical user journeys
       /  Visual    \        Per component: Catch CSS regressions
      / Integration  \       Per feature: Real DB, real HTTP
     /  Component     \      Per component: Render + interact
    / Unit + Property   \    Many: Pure logic, edge cases, invariants
   /____________________\

Budget: 70% unit/property | 20% integration | 10% E2E
Speed:  < 1s per unit | < 5s per integration | < 30s per E2E
```

---

## AI-Assisted Testing

```typescript
// Use property-based tests to verify AI-generated code
// AI often misses edge cases — properties catch them systematically

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// AI generated a sorting function — verify its PROPERTIES
describe('AI-generated sort', () => {
  it('output is same length as input', () => {
    fc.assert(fc.property(fc.array(fc.integer()), (arr) => {
      expect(sort(arr)).toHaveLength(arr.length);
    }));
  });

  it('output is ordered', () => {
    fc.assert(fc.property(fc.array(fc.integer()), (arr) => {
      const sorted = sort(arr);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]).toBeGreaterThanOrEqual(sorted[i - 1]);
      }
    }));
  });

  it('output contains same elements as input', () => {
    fc.assert(fc.property(fc.array(fc.integer()), (arr) => {
      expect([...sort(arr)].sort()).toEqual([...arr].sort());
    }));
  });
});

// AI-assisted test generation workflow:
// 1. Write the function (or have AI write it)
// 2. Identify invariants (properties that must ALWAYS hold)
// 3. Write property-based tests for those invariants
// 4. Run mutation testing to verify test quality
// 5. Add specific edge case tests for known tricky inputs
```

---

## Property-Based Testing (fast-check)

```typescript
import fc from 'fast-check';

// Business rule invariants
describe('pricing engine', () => {
  it('discount never exceeds original price', () => {
    fc.assert(fc.property(
      fc.float({ min: 0.01, max: 10000, noNaN: true }),
      fc.float({ min: 0, max: 100, noNaN: true }),
      (price, discountPercent) => {
        const result = applyDiscount(price, discountPercent);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(price);
      }
    ));
  });

  it('total equals sum of line items', () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        price: fc.float({ min: 0.01, max: 1000, noNaN: true }),
        quantity: fc.integer({ min: 1, max: 100 }),
      }), { minLength: 1, maxLength: 50 }),
      (items) => {
        const order = createOrder(items);
        const expected = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
        expect(order.total).toBeCloseTo(expected, 2);
      }
    ));
  });
});

// Roundtrip properties (encode/decode, serialize/deserialize)
it('JSON roundtrip preserves data', () => {
  fc.assert(fc.property(fc.anything(), (value) => {
    // Only test JSON-safe values
    const json = JSON.stringify(value);
    if (json !== undefined) {
      expect(JSON.parse(json)).toEqual(value);
    }
  }));
});
```

---

## Snapshot Testing Best Practices

```typescript
// DO: Snapshot serializable output formats
it('generates correct API response shape', () => {
  const response = formatUserResponse(mockUser);
  expect(response).toMatchInlineSnapshot(`
    {
      "id": "user-123",
      "name": "Alice",
      "email": "alice@example.com",
      "role": "admin",
    }
  `);
});

// DO: Snapshot error messages for consistency
it('produces helpful validation errors', () => {
  const result = validateInput({ email: 'invalid' });
  expect(result.errors).toMatchSnapshot();
});

// DON'T: Snapshot entire component trees (too brittle)
// DON'T: Snapshot timestamps, random IDs, or non-deterministic output
// DON'T: Auto-update snapshots without reviewing the diff

// RULE: If you can't explain WHY a snapshot changed, don't update it
```

---

## Contract Testing (Pact)

```typescript
// CONSUMER SIDE — defines expectations
import { PactV3, MatchersV3 } from '@pact-foundation/pact';
const { like, eachLike, string, datetime } = MatchersV3;

const provider = new PactV3({ consumer: 'WebApp', provider: 'OrderAPI' });

describe('Order API Contract', () => {
  it('returns user orders', async () => {
    await provider
      .given('user has orders')
      .uponReceiving('a request for user orders')
      .withRequest({ method: 'GET', path: '/api/orders', headers: { Authorization: string() } })
      .willRespondWith({
        status: 200,
        body: {
          data: eachLike({
            id: string('ord-123'),
            status: string('active'),
            total: like(99.99),
            createdAt: datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"),
          }),
          pagination: { cursor: string(), hasMore: like(true) },
        },
      });

    await provider.executeTest(async (mockServer) => {
      const client = new OrderClient(mockServer.url);
      const result = await client.getOrders();
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toHaveProperty('id');
    });
  });
});

// PROVIDER SIDE — verifies contract
import { Verifier } from '@pact-foundation/pact';

it('satisfies WebApp contract', async () => {
  await new Verifier({
    providerBaseUrl: 'http://localhost:3000',
    pactBrokerUrl: process.env.PACT_BROKER_URL,
    providerVersion: process.env.GIT_SHA,
    publishVerificationResult: true,
    stateHandlers: {
      'user has orders': async () => { await seedTestOrders(); },
    },
  }).verifyProvider();
});
```

---

## Visual Regression (Chromatic + Playwright)

```typescript
// Chromatic (Storybook-based) — component-level visual testing
// CI: npx chromatic --project-token=$CHROMATIC_TOKEN --exit-zero-on-changes

// Playwright — full page visual regression
import { test, expect } from '@playwright/test';

test('dashboard visual regression', async ({ page }) => {
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('dashboard.png', {
    maxDiffPixelRatio: 0.01,
    animations: 'disabled',
  });
});

// Responsive visual testing
test('responsive layouts', async ({ page }) => {
  for (const vp of [
    { width: 375, height: 667, name: 'mobile' },
    { width: 768, height: 1024, name: 'tablet' },
    { width: 1440, height: 900, name: 'desktop' },
  ]) {
    await page.setViewportSize(vp);
    await page.goto('/');
    await expect(page).toHaveScreenshot(`home-${vp.name}.png`);
  }
});

// Best practices:
// - Freeze animations and transitions
// - Mock dynamic data (dates, avatars) for determinism
// - Use threshold (1% pixel diff) to avoid false positives
// - Review visual diffs in PR, don't auto-approve
```

---

## Load Testing (k6)

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

// Soak test: sustained load (find memory leaks, connection exhaustion)
export const options = {
  stages: [
    { duration: '5m', target: 50 },
    { duration: '4h', target: 50 },
    { duration: '5m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const res = http.get('https://api.example.com/products');
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
  sleep(1);
}

// Spike test: sudden traffic surge
export const spikeOptions = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '10s', target: 1000 },  // Spike!
    { duration: '3m', target: 1000 },
    { duration: '10s', target: 50 },    // Recovery
    { duration: '3m', target: 50 },
  ],
};

// CI integration: run on every deploy, fail if thresholds breached
// k6 run --out json=results.json load-test.js
```

---

## Mutation Testing (Stryker)

```javascript
// stryker.config.mjs
export default {
  testRunner: 'vitest',
  mutate: ['src/**/*.ts', '!src/**/*.test.ts'],
  reporters: ['html', 'clear-text', 'progress'],
  thresholds: { high: 80, low: 60, break: 50 },
  coverageAnalysis: 'perTest',
  // Focus on critical business logic, not utilities
  mutate: ['src/domain/**/*.ts', 'src/services/**/*.ts'],
};

// What Stryker does:
// 1. Creates mutants: a > b -> a >= b, + -> -, if(x) -> if(!x)
// 2. Runs tests against each mutant
// 3. Reports: Killed (good), Survived (weak test), No Coverage
//
// Mutation Score = killed / (killed + survived)
// Target: > 80% for critical business logic
// Focus effort on survived mutants in payment, auth, data integrity code
```

---

## Test Architecture: Factories & Fixtures

```typescript
import { faker } from '@faker-js/faker';

class UserFactory {
  static build(overrides: Partial<User> = {}): User {
    return {
      id: faker.string.uuid(),
      email: faker.internet.email(),
      name: faker.person.fullName(),
      role: 'user',
      createdAt: faker.date.past(),
      ...overrides,
    };
  }

  static async create(overrides: Partial<User> = {}): Promise<User> {
    return db.users.create({ data: this.build(overrides) });
  }
}

// Test doubles decision:
// Stub: returns canned data (no verification)
// Mock: verifies interactions (use sparingly)
// Spy: wraps real implementation, records calls
// Fake: working in-memory implementation (best for repositories)
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| Testing implementation details | Tests break on refactor | Test behavior/outcomes |
| Excessive mocking | Tests pass but code is broken | Integration tests with real deps |
| No test isolation | Tests depend on order | Each test owns its setup/teardown |
| Snapshot everything | Approved without review | Snapshots only for serializable output |
| Flaky tests ignored | Erode trust in suite | Fix or quarantine immediately |
| 100% coverage target | Tests for trivial code | Focus on mutation score for critical paths |
| No contract tests | Services break each other | Pact for service boundaries |
| Load testing only pre-launch | Performance degrades over time | Load tests in CI |
| AI-generated tests without review | Tests that don't test anything | Verify with mutation testing |
