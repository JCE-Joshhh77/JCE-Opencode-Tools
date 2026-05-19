---
name: architecture
description: API design, databases, system design, caching, resilience. Use when working on architecture tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Architecture Advanced
# Loaded on-demand when task involves system design, API design, database selection, caching, scaling, or error handling

## Auto-Detect

Trigger this skill when:
- Task mentions: API design, system design, database choice, scaling, microservices
- Files: `docker-compose.yml`, `schema.prisma`, `*.proto`, `openapi.yaml`
- Patterns: service boundaries, data modeling, caching strategy, queue setup
- `package.json` contains: `@trpc/server`, `graphql`, `@nestjs/microservices`, `bullmq`

---

## Decision Tree: Event-Driven Architecture

```
Should you use event-driven architecture?
├── Need to decouple services (producer doesn't care who consumes)?
│   └── YES — publish events, consumers subscribe independently
├── Need async processing (email, PDF generation, analytics)?
│   └── YES — command queue (BullMQ, SQS) for task processing
├── Need audit trail / event sourcing?
│   └── YES — append-only event log (Kafka, EventStoreDB)
├── Need real-time reactions across services?
│   └── YES — event bus (NATS, RabbitMQ, Kafka)
├── Simple CRUD with < 3 services?
│   └── NO — direct API calls are simpler, event-driven adds complexity
└── Need exactly-once processing?
    └── CAREFUL — use idempotency keys + at-least-once delivery

Event patterns:
├── Event Notification — "something happened" (minimal payload)
│   └── { type: "order.created", orderId: "abc-123" }
├── Event-Carried State Transfer — full entity in event
│   └── { type: "order.created", order: { id, items, total, ... } }
├── Event Sourcing — events ARE the source of truth
│   └── Rebuild state by replaying events. Complex but powerful.
└── CQRS — separate write model (commands) from read model (queries)
    └── Write: normalized, consistent. Read: denormalized, fast.
```

---

## Database Selection Matrix

```
What's your data shape?
├── Structured, relational, needs ACID?
│   ├── General purpose → PostgreSQL (always the safe default)
│   ├── Embedded/edge/mobile → SQLite (libSQL/Turso for distributed)
│   └── MySQL ecosystem required → MySQL 8+ / PlanetScale
├── Document-oriented, flexible schema?
│   └── MongoDB (but ask: do you REALLY need schemaless?)
├── Key-value, high throughput, caching?
│   └── Redis 7+ / Valkey / DragonflyDB
├── Time-series (metrics, IoT, logs)?
│   └── TimescaleDB (Postgres extension) or ClickHouse (analytics)
├── Full-text search?
│   └── PostgreSQL FTS (simple) or Meilisearch/Typesense (complex)
├── Graph relationships (social, recommendations)?
│   └── Neo4j or PostgreSQL recursive CTEs (if relationships are secondary)
├── Vector embeddings (AI/ML, semantic search)?
│   └── pgvector (Postgres) or dedicated: Qdrant, Pinecone, Weaviate
└── Wide-column, massive scale (> 1TB, > 100K writes/s)?
    └── ScyllaDB, DynamoDB, or Cassandra
```

| Requirement | Best Choice | Why |
|-------------|-------------|-----|
| Default for any project | PostgreSQL | ACID, JSON, FTS, vectors, extensions |
| Caching + pub/sub | Redis/Valkey | Sub-ms latency, data structures |
| Analytics/OLAP | ClickHouse | Column-oriented, 100x faster aggregations |
| Search | Meilisearch | Typo-tolerant, instant, easy to deploy |
| AI embeddings | pgvector | Stays in Postgres, good enough for < 10M vectors |

---

## Caching Strategies

### Decision Tree

```
Should you cache this?
├── Data changes rarely, read often? → Cache with long TTL (1h+)
├── Data changes often but stale OK for seconds? → Short TTL (30s-5min)
├── Data MUST be fresh? → No cache, or cache-aside with event invalidation
├── Expensive computation? → Cache result with TTL
├── Per-user data? → Cache with user-scoped key
└── Static assets? → CDN with immutable hashes in filenames
```

### Redis Patterns

```typescript
// Cache-aside (most common)
async function getUser(id: string): Promise<User> {
  const cached = await redis.get(`user:${id}`);
  if (cached) return JSON.parse(cached);
  const user = await db.user.findUnique({ where: { id } });
  if (user) await redis.setex(`user:${id}`, 300, JSON.stringify(user));
  return user;
}

// Write-through (cache always consistent)
async function updateUser(id: string, data: Partial<User>) {
  const user = await db.user.update({ where: { id }, data });
  await redis.setex(`user:${id}`, 300, JSON.stringify(user)); // Update cache
  return user;
}

// Cache stampede prevention (singleflight pattern)
async function getExpensiveData(key: string): Promise<Data> {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  // Use Redis lock to prevent thundering herd
  const lockKey = `lock:${key}`;
  const acquired = await redis.set(lockKey, '1', 'EX', 10, 'NX');
  if (!acquired) {
    await sleep(100); // Wait for other process to populate
    return getExpensiveData(key); // Retry
  }
  const data = await computeExpensiveData();
  await redis.setex(key, 600, JSON.stringify(data));
  await redis.del(lockKey);
  return data;
}
```

### CDN Strategy

```
CDN caching layers:
├── Immutable assets (JS, CSS with hash) → Cache-Control: public, max-age=31536000, immutable
├── HTML pages → Cache-Control: public, s-maxage=60, stale-while-revalidate=300
├── API responses (public) → Cache-Control: public, s-maxage=10, stale-while-revalidate=30
├── API responses (private) → Cache-Control: private, no-store
└── Images → CDN with automatic format conversion (WebP/AVIF) + resize
```

---

## API Gateway Patterns

```
When do you need an API gateway?
├── Multiple backend services exposed to clients?
│   └── Gateway aggregates, routes, and simplifies client interface
├── Cross-cutting concerns (auth, rate limiting, logging)?
│   └── Gateway handles once, backends stay focused on business logic
├── Need request/response transformation?
│   └── Gateway adapts between client format and service format
└── BFF (Backend for Frontend) pattern?
    └── Separate gateway per client type (web, mobile, third-party)

Gateway options (2026):
├── Cloud-native: AWS API Gateway, GCP Apigee, Azure APIM
├── Self-hosted: Kong, Traefik, Envoy (via Istio)
├── Code-based: tRPC (type-safe), GraphQL gateway (Apollo Federation)
└── Edge: Cloudflare Workers, Vercel Edge Middleware
```

---

## Service Mesh

```
Do you need a service mesh?
├── > 10 microservices with complex networking? → Probably yes
├── Need mTLS between all services? → Service mesh or simpler cert management
├── Need traffic splitting (canary, A/B)? → Service mesh or ingress controller
├── < 5 services? → Overkill. Use direct service discovery.
└── Running on Kubernetes? → Istio (full-featured) or Linkerd (lightweight)

Service mesh provides:
├── mTLS (automatic encryption between services)
├── Traffic management (retries, timeouts, circuit breaking)
├── Observability (distributed tracing without code changes)
├── Traffic splitting (canary deployments at network level)
└── Access policies (service A can call B but not C)
```

---

## Error Handling Patterns

```typescript
// Typed application errors
class AppError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
  static notFound(resource: string, id: string) {
    return new AppError('NOT_FOUND', 404, `${resource} ${id} not found`);
  }
  static conflict(message: string) {
    return new AppError('CONFLICT', 409, message);
  }
  static validation(details: Record<string, string>) {
    return new AppError('VALIDATION_ERROR', 422, 'Validation failed', details);
  }
}

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details }
    });
  }
  logger.error('Unhandled error', { err, path: req.path, traceId: req.id });
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
});
```

---

## Scaling Decision Tree

```
Performance problem identified?
├── Reads are slow?
│   ├── Add indexes (EXPLAIN ANALYZE first) → solves 90% of cases
│   ├── Add caching layer (Redis) → frequently accessed, rarely changed
│   ├── Read replicas → read-heavy workload
│   └── CDN → static/semi-static content
├── Writes are slow?
│   ├── Batch writes → bulk inserts
│   ├── Async processing (queue) → non-critical writes
│   ├── Connection pooling → pool exhaustion
│   └── Vertical scaling → bigger machine (cheapest fix)
├── Single service overloaded?
│   ├── Horizontal scaling (stateless) → add instances
│   ├── Extract hot path to separate service → targeted scaling
│   └── Rate limiting → protect from abuse
└── Database is the bottleneck?
    ├── Query optimization → always first
    ├── CQRS → separate read/write models
    ├── Sharding → last resort (massive complexity)
    └── Polyglot persistence → right DB for each use case
```

---

## Anti-Patterns

| ❌ Don't | ✅ Do Instead |
|----------|---------------|
| Microservices from day one | Monolith → modular monolith → extract when needed |
| Shared database between services | Each service owns its data, communicate via events |
| N+1 queries in loops | Batch loading, DataLoader, eager loading |
| Caching without invalidation strategy | Define TTL + invalidation triggers before caching |
| Synchronous calls for non-critical paths | Queue/event for emails, notifications, analytics |
| Premature optimization | Measure first (EXPLAIN, profiler), optimize bottlenecks |
| God services (does everything) | Single responsibility, bounded contexts |
| Distributed transactions across services | Saga pattern with compensating actions |
| Ignoring backpressure | Rate limiting, circuit breakers, queue depth limits |
| Event sourcing for simple CRUD | Only when audit trail or temporal queries are required |

---

## Verification Checklist

- [ ] API endpoints follow consistent naming and HTTP method conventions
- [ ] All endpoints have input validation (schema-based)
- [ ] Error responses are structured and typed (code + message + details)
- [ ] Database queries are optimized (EXPLAIN ANALYZE on critical paths)
- [ ] Caching strategy defined with clear invalidation rules
- [ ] Rate limiting on public endpoints
- [ ] Health check endpoint exists (`/health` or `/healthz`)
- [ ] Graceful shutdown handles in-flight requests
- [ ] Idempotency keys for non-idempotent operations
- [ ] Pagination on all list endpoints (cursor-based preferred)
- [ ] Logging is structured (JSON) with correlation/trace IDs
- [ ] Circuit breakers on external service calls
