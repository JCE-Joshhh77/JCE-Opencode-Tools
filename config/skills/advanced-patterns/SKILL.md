---
name: advanced-patterns
description: SOLID, 12-Factor, performance engineering, feature flags. Use when working on advanced-patterns tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Advanced Patterns & Principles

## Auto-Detect

Trigger this skill when:
- Task mentions: SOLID, 12-Factor, feature flags, performance budget, circuit breaker
- Patterns: architecture principles, progressive enhancement, graceful degradation
- Context: system design decisions, scaling patterns, operational excellence

---

## Decision Tree: Architecture Pattern

```
What problem are you solving?
+-- Need to decouple components?
|   +-- Event-driven (pub/sub) or Dependency Injection
+-- Need resilience against failures?
|   +-- Circuit breaker + retry + fallback
+-- Need gradual feature rollout?
|   +-- Feature flags (OpenFeature standard)
+-- Need to scale reads vs writes differently?
|   +-- CQRS (separate read/write models)
+-- Need to handle partial failures in distributed tx?
|   +-- Saga pattern (choreography or orchestration)
+-- Need to enforce performance budgets?
    +-- Performance gates in CI + monitoring
```

---

## SOLID in Practice (2026)

```typescript
// S — Single Responsibility
// BAD: UserService handles auth, profile, notifications, billing
// GOOD: Each concern is its own module

class AuthService {
  async authenticate(credentials: Credentials): Promise<AuthResult> { /* ... */ }
  async refreshToken(token: string): Promise<TokenPair> { /* ... */ }
}

class UserProfileService {
  async updateProfile(userId: string, data: ProfileUpdate): Promise<User> { /* ... */ }
}

// O — Open/Closed (extend without modifying)
// Use strategy pattern or plugin architecture

interface PaymentProcessor {
  charge(amount: Money, method: PaymentMethod): Promise<ChargeResult>;
  refund(chargeId: string, amount: Money): Promise<RefundResult>;
}

class PaymentService {
  constructor(private processors: Map<string, PaymentProcessor>) {}

  async charge(method: PaymentMethod, amount: Money): Promise<ChargeResult> {
    const processor = this.processors.get(method.type);
    if (!processor) throw new UnsupportedPaymentMethod(method.type);
    return processor.charge(amount, method);
  }
  // Adding new payment method = new processor class, no modification to PaymentService
}

// L — Liskov Substitution
// Subtypes must honor the contract of their parent
// If Square extends Rectangle, setWidth must not break setHeight expectations
// Prefer composition over inheritance to avoid LSP violations

// I — Interface Segregation
// BAD: interface Repository { find, findAll, create, update, delete, aggregate, stream }
// GOOD: Split by consumer need

interface ReadRepository<T> {
  findById(id: string): Promise<T | null>;
  findMany(filter: Filter): Promise<T[]>;
}

interface WriteRepository<T> {
  create(data: CreateInput<T>): Promise<T>;
  update(id: string, data: UpdateInput<T>): Promise<T>;
  delete(id: string): Promise<void>;
}

// D — Dependency Inversion
// High-level modules depend on abstractions, not concrete implementations

class OrderService {
  constructor(
    private readonly orders: WriteRepository<Order>,  // Abstract
    private readonly payments: PaymentProcessor,       // Abstract
    private readonly notifications: NotificationSender, // Abstract
  ) {}
  // Can swap implementations for testing, different environments, etc.
}
```

---

## 12-Factor App (2026 Edition)

```
 # | Factor              | Modern Implementation
---|---------------------|----------------------------------------------
 1 | Codebase            | One repo, many deploys (monorepo OK with proper boundaries)
 2 | Dependencies        | Lockfile committed, pinned versions, no implicit deps
 3 | Config              | Env vars via secrets manager (Vault, AWS SSM, Doppler)
 4 | Backing services    | Treat as attached resources (connection string in config)
 5 | Build/release/run   | Container image = immutable artifact, GitOps deploy
 6 | Processes           | Stateless containers, state in external stores
 7 | Port binding        | Container exposes port, service mesh handles routing
 8 | Concurrency         | Horizontal pod autoscaling, queue workers scale independently
 9 | Disposability       | < 5s startup, graceful shutdown (drain connections, finish jobs)
10 | Dev/prod parity     | Same container image, feature flags for differences
11 | Logs                | Structured JSON to stdout, collected by platform (Loki, CloudWatch)
12 | Admin processes     | One-off containers/jobs (Kubernetes Job, ECS task)

Beyond 12-Factor (2026 additions):
13 | Observability       | OpenTelemetry traces + metrics + logs from day one
14 | Security            | Zero-trust, mTLS between services, secrets rotation
15 | Feature management  | Feature flags for decoupling deploy from release
```

---

## Feature Flags (OpenFeature)

```typescript
import { OpenFeature } from '@openfeature/server-sdk';
import { LaunchDarklyProvider } from '@launchdarkly/openfeature-node-server';

// Initialize with provider (LaunchDarkly, Flagsmith, Unleash, etc.)
await OpenFeature.setProviderAndWait(new LaunchDarklyProvider(sdkKey));
const client = OpenFeature.getClient();

// Evaluation with context (user targeting)
async function getCheckoutFlow(userId: string, plan: string): Promise<'legacy' | 'new' | 'experimental'> {
  const context = { targetingKey: userId, plan, region: 'us-east' };
  return client.getStringValue('checkout-flow', 'legacy', context);
}

// Usage in application code
const flow = await getCheckoutFlow(user.id, user.plan);
switch (flow) {
  case 'new': return renderNewCheckout();
  case 'experimental': return renderExperimentalCheckout();
  default: return renderLegacyCheckout();
}

// Flag lifecycle (ENFORCE THIS):
// 1. Create flag (default: off)
// 2. Enable for team (internal testing)
// 3. Canary: 5% of users
// 4. Ramp: 25% → 50% → 100%
// 5. REMOVE flag + old code path (flag debt is tech debt)
//
// Rule: No flag older than 30 days at 100% — clean it up or revert
```

---

## Circuit Breaker

```typescript
enum CircuitState { CLOSED, OPEN, HALF_OPEN }

class CircuitBreaker {
  private state = CircuitState.CLOSED;
  private failures = 0;
  private lastFailureTime = 0;
  private successesInHalfOpen = 0;

  constructor(
    private readonly threshold: number = 5,       // Failures before opening
    private readonly timeout: number = 30_000,    // Time before half-open (ms)
    private readonly halfOpenMax: number = 3,     // Successes to close again
  ) {}

  async execute<T>(fn: () => Promise<T>, fallback?: () => T): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = CircuitState.HALF_OPEN;
        this.successesInHalfOpen = 0;
      } else {
        if (fallback) return fallback();
        throw new CircuitOpenError('Circuit is open');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      if (fallback) return fallback();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successesInHalfOpen++;
      if (this.successesInHalfOpen >= this.halfOpenMax) {
        this.state = CircuitState.CLOSED;
        this.failures = 0;
      }
    } else {
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.threshold) {
      this.state = CircuitState.OPEN;
    }
  }
}

// Usage
const paymentCircuit = new CircuitBreaker(3, 60_000);
const result = await paymentCircuit.execute(
  () => paymentGateway.charge(amount),
  () => ({ status: 'queued', message: 'Payment will be retried' }) // Fallback
);
```

---

## Performance Engineering

```typescript
// Performance budget definition (enforce in CI)
const performanceBudget = {
  web: {
    LCP: 2500,           // Largest Contentful Paint < 2.5s
    FID: 100,            // First Input Delay < 100ms
    CLS: 0.1,           // Cumulative Layout Shift < 0.1
    TTI: 3500,           // Time to Interactive < 3.5s
    bundleSize: 200_000, // Main bundle < 200KB gzipped
  },
  api: {
    p50: 100,            // 50th percentile < 100ms
    p95: 500,            // 95th percentile < 500ms
    p99: 1000,           // 99th percentile < 1s
    errorRate: 0.001,    // < 0.1% error rate
  },
};

// Common bottlenecks and fixes
// | Bottleneck              | Diagnosis                    | Fix                              |
// |-------------------------|------------------------------|----------------------------------|
// | N+1 queries             | Many DB calls per request    | DataLoader, JOINs, eager loading |
// | Memory leak             | Growing RSS over time        | Heap snapshot, weak references   |
// | CPU-bound               | High CPU, slow responses     | Worker threads, caching          |
// | Connection exhaustion   | Timeouts under load          | Connection pooling, backpressure |
// | Large payloads          | Slow transfers               | Pagination, compression          |
// | Cold starts             | First request slow           | Keep-alive, pre-warming          |

// Measure → Identify → Hypothesize → Fix → Measure again
// NEVER optimize without profiling first
```

---

## Progressive Enhancement

```typescript
// Build features that work at every capability level

// Level 1: Server-rendered HTML (works everywhere)
// Level 2: Enhanced with CSS (animations, transitions)
// Level 3: JavaScript interactivity (client-side validation, SPA navigation)
// Level 4: Advanced APIs (WebSocket, Service Worker, WebGL)

// Example: Form submission
// Level 1: <form action="/submit" method="POST"> (always works)
// Level 3: Intercept with JS, show loading state, handle errors inline
// Level 4: Optimistic UI, offline queue with Service Worker

// Feature detection (not browser detection)
if ('IntersectionObserver' in window) {
  // Use lazy loading
} else {
  // Load all images eagerly (still works, just slower)
}
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| SOLID dogmatism | Over-abstraction, 10 files for simple feature | Apply SOLID proportionally to complexity |
| Feature flags never cleaned up | Flag spaghetti, dead code paths | 30-day rule: at 100% → remove flag + old code |
| No circuit breaker on external calls | Cascade failures take down system | Circuit breaker + fallback for all external deps |
| Optimizing without measuring | Wasted effort on non-bottlenecks | Profile first, budget second, optimize third |
| Premature microservices | Distributed monolith, 10x complexity | Monolith first → modular → extract if proven need |
| No graceful degradation | One failure = total outage | Fallbacks at every integration point |
| Config in code | Rebuild to change behavior | Environment variables + feature flags |
| No performance gates in CI | Regressions ship silently | Lighthouse CI, bundle size checks, load tests |

---

## Verification Checklist

- [ ] SOLID principles applied proportionally (not dogmatically)
- [ ] All external service calls wrapped in circuit breaker
- [ ] Feature flags have owner + expiry date (no permanent flags)
- [ ] Performance budget defined and enforced in CI
- [ ] Graceful shutdown handles in-flight requests (SIGTERM handler)
- [ ] Config externalized (no hardcoded URLs, keys, or thresholds)
- [ ] Structured logging (JSON) with correlation IDs
- [ ] Health check endpoint returns dependency status
- [ ] Retry logic uses exponential backoff + jitter
- [ ] Progressive enhancement: core functionality works without JS
