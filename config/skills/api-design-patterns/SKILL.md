---
name: api-design-patterns
description: REST maturity, GraphQL schema, gRPC, versioning, pagination, OpenAPI. Use when working on api-design-patterns tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: API Design Patterns
# Loaded on-demand when task involves REST, GraphQL, gRPC, API versioning, pagination, rate limiting, or OpenAPI

## Auto-Detect

Trigger this skill when:
- Task mentions: REST, GraphQL, gRPC, API design, pagination, rate limiting, OpenAPI
- Files: `openapi.yaml`, `*.proto`, `schema.graphql`, `routes/`, `resolvers/`
- `package.json` contains: `express`, `fastify`, `@nestjs/core`, `graphql`, `@grpc/grpc-js`

---

## Decision Tree: API Style

```
What are you building?
+-- Internal tool / full-stack app (same team)?
|   +-- tRPC (end-to-end type safety, zero codegen)
+-- Public API for third parties?
|   +-- REST + OpenAPI spec (universal, cacheable, well-understood)
+-- Complex nested data (social, e-commerce)?
|   +-- Clients need flexible queries? -> GraphQL
|   +-- Server controls queries? -> REST with includes/sparse fieldsets
+-- High-performance service-to-service?
|   +-- gRPC (binary protocol, streaming, code generation)
+-- Real-time bidirectional?
|   +-- WebSocket or gRPC bidirectional streaming
+-- One-way server push?
    +-- Server-Sent Events (SSE) — simpler than WebSocket
```

---

## API Versioning Strategies

```
Which versioning approach?
+-- Public API with many consumers?
|   +-- URL path versioning: /v1/users, /v2/users
|   +-- Most explicit, easiest to route, easiest to document
+-- Internal API, want clean URLs?
|   +-- Header versioning: Accept: application/vnd.api+json;version=2
|   +-- Clean URLs but harder to test/debug
+-- Evolving API without breaking changes?
|   +-- Additive changes only (no versioning needed)
|   +-- Add fields, never remove. Deprecate with sunset headers.
+-- GraphQL?
    +-- No versioning — evolve schema, deprecate fields
    +-- @deprecated directive + removal after sunset period

Rules:
- Only increment major version for BREAKING changes
- Support N-1 version minimum (current + previous)
- Deprecation timeline: announce 6 months, sunset 12 months
- Sunset header: Sunset: Sat, 01 Jan 2027 00:00:00 GMT
```

```typescript
// Version routing middleware
function versionRouter(req: Request, res: Response, next: NextFunction) {
  // URL path versioning (recommended for public APIs)
  const match = req.path.match(/^\/v(\d+)\//);
  if (match) {
    req.apiVersion = parseInt(match[1]);
    return next();
  }
  // Fallback: header versioning
  const headerVersion = req.headers['api-version'];
  req.apiVersion = headerVersion ? parseInt(headerVersion as string) : CURRENT_VERSION;
  next();
}

// Deprecation headers on old versions
function deprecationHeaders(req: Request, res: Response, next: NextFunction) {
  if (req.apiVersion < CURRENT_VERSION) {
    res.setHeader('Deprecation', 'true');
    res.setHeader('Sunset', 'Sat, 01 Jan 2027 00:00:00 GMT');
    res.setHeader('Link', '</v2/docs>; rel="successor-version"');
  }
  next();
}
```

---

## Pagination Patterns

### Decision Tree

```
+-- Small dataset (< 10K records)? -> Offset (simple, supports "jump to page")
+-- Large dataset, sequential access? -> Cursor (consistent, performant)
+-- Real-time feed (new items added)? -> Cursor (no duplicate/missing items)
+-- Need "page 47 of 200"? -> Offset (cursor can't jump)
+-- Sorted by non-unique field? -> Keyset with tiebreaker (id)
```

### Cursor-Based (Recommended)

```typescript
// Cursor pagination — consistent, performant, no skipping issues
interface CursorPage<T> {
  data: T[];
  pagination: { cursor: string | null; hasMore: boolean; limit: number };
}

async function cursorPaginate<T>(
  query: QueryBuilder,
  cursor: string | null,
  limit: number = 20
): Promise<CursorPage<T>> {
  const decoded = cursor
    ? JSON.parse(Buffer.from(cursor, 'base64url').toString())
    : null;

  const items = await query
    .where(decoded ? { id: { gt: decoded.id } } : {})
    .orderBy({ id: 'asc' })
    .limit(limit + 1) // Fetch one extra to check hasMore
    .execute();

  const hasMore = items.length > limit;
  const data = items.slice(0, limit);
  const nextCursor = hasMore
    ? Buffer.from(JSON.stringify({ id: data.at(-1)!.id })).toString('base64url')
    : null;

  return { data, pagination: { cursor: nextCursor, hasMore, limit } };
}
```

### Offset-Based (Simple)

```typescript
// Offset pagination — simple but degrades on large datasets
// GET /users?page=3&limit=20
interface OffsetPage<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

// WARNING: OFFSET 10000 LIMIT 20 scans 10020 rows. Use cursor for large datasets.
```

---

## Rate Limiting Implementation

```typescript
// Token bucket algorithm (Redis-backed, production-grade)
async function checkRateLimit(key: string, config: { max: number; windowSec: number }) {
  const result = await redis.eval(`
    local key = KEYS[1]
    local max = tonumber(ARGV[1])
    local window = tonumber(ARGV[2])
    local now = tonumber(ARGV[3])

    -- Sliding window counter
    redis.call('ZREMRANGEBYSCORE', key, 0, now - window * 1000)
    local count = redis.call('ZCARD', key)

    if count < max then
      redis.call('ZADD', key, now, now .. ':' .. math.random())
      redis.call('EXPIRE', key, window)
      return {1, max - count - 1, 0}
    else
      local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
      local retry = math.ceil((tonumber(oldest[2]) + window * 1000 - now) / 1000)
      return {0, 0, retry}
    end
  `, 1, `ratelimit:${key}`, config.max, config.windowSec, Date.now());

  const [allowed, remaining, retryAfter] = result as number[];
  return { allowed: allowed === 1, remaining, retryAfter };
}

// Middleware with tiered limits
function rateLimitMiddleware(tier: 'public' | 'authenticated' | 'premium') {
  const configs = {
    public: { max: 60, windowSec: 60 },       // 60/min per IP
    authenticated: { max: 300, windowSec: 60 }, // 300/min per user
    premium: { max: 3000, windowSec: 60 },      // 3000/min per user
  };
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.user?.id || req.ip;
    const result = await checkRateLimit(key, configs[tier]);
    res.setHeader('X-RateLimit-Limit', configs[tier].max);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    if (!result.allowed) {
      res.setHeader('Retry-After', result.retryAfter);
      return res.status(429).json({ error: 'Rate limit exceeded', retryAfter: result.retryAfter });
    }
    next();
  };
}
```

---

## Webhook Design

```typescript
// Webhook delivery best practices
interface WebhookEvent {
  id: string;           // Unique event ID (for idempotency)
  type: string;         // e.g., "order.completed"
  timestamp: string;    // ISO 8601
  data: unknown;        // Event payload
  apiVersion: string;   // API version that generated this event
}

// Signing webhooks (HMAC-SHA256)
function signWebhook(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// Delivery with retry (exponential backoff)
async function deliverWebhook(url: string, event: WebhookEvent, secret: string) {
  const body = JSON.stringify(event);
  const signature = signWebhook(body, secret);

  for (const attempt of [0, 1, 2, 3, 4]) { // 5 attempts
    const delay = attempt === 0 ? 0 : Math.pow(2, attempt) * 1000; // 0, 2s, 4s, 8s, 16s
    if (delay) await sleep(delay);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-ID': event.id,
        'X-Webhook-Timestamp': event.timestamp,
      },
      body,
      signal: AbortSignal.timeout(10_000), // 10s timeout
    });

    if (res.ok) return; // 2xx = success
    if (res.status >= 400 && res.status < 500 && res.status !== 429) return; // 4xx (not 429) = don't retry
  }
  // After 5 failures: mark endpoint as failing, notify customer
}

// Consumer verification
function verifyWebhook(req: Request, secret: string): boolean {
  const signature = req.headers['x-webhook-signature'] as string;
  const expected = `sha256=${signWebhook(JSON.stringify(req.body), secret)}`;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

---

## Idempotency Keys

```typescript
// Prevent duplicate operations on retry (payments, order creation)
async function idempotentHandler(req: Request, res: Response, handler: () => Promise<Response>) {
  const idempotencyKey = req.headers['idempotency-key'] as string;
  if (!idempotencyKey) return res.status(400).json({ error: 'Idempotency-Key header required' });

  // Check if we've already processed this key
  const cached = await redis.get(`idempotency:${idempotencyKey}`);
  if (cached) {
    const { statusCode, body } = JSON.parse(cached);
    return res.status(statusCode).json(body);
  }

  // Lock to prevent concurrent processing of same key
  const lock = await redis.set(`lock:${idempotencyKey}`, '1', 'EX', 30, 'NX');
  if (!lock) return res.status(409).json({ error: 'Request already in progress' });

  try {
    const result = await handler();
    // Cache response for 24 hours
    await redis.setex(`idempotency:${idempotencyKey}`, 86400,
      JSON.stringify({ statusCode: result.status, body: result.body }));
    return result;
  } finally {
    await redis.del(`lock:${idempotencyKey}`);
  }
}

// Client usage:
// POST /api/payments
// Idempotency-Key: pay_abc123_attempt1
// (safe to retry — same key returns same response)
```

---

## REST Best Practices

```typescript
// Resource naming
GET    /users                    // List (paginated)
POST   /users                    // Create
GET    /users/:id                // Read
PATCH  /users/:id                // Partial update
DELETE /users/:id                // Delete
GET    /users/:id/orders         // Sub-resource

// Status codes
200 OK           // GET, PUT, PATCH success
201 Created      // POST success (include Location header)
204 No Content   // DELETE success
400 Bad Request  // Malformed request
401 Unauthorized // Missing/invalid auth
403 Forbidden    // Authenticated but not authorized
404 Not Found    // Resource doesn't exist
409 Conflict     // Duplicate, version conflict
422 Unprocessable // Semantic validation error
429 Too Many Req // Rate limited (include Retry-After)

// Error format (RFC 9457 Problem Details)
{
  "type": "https://api.example.com/errors/validation",
  "title": "Validation Error",
  "status": 422,
  "detail": "The request body contains invalid fields",
  "errors": [
    { "field": "email", "message": "Must be valid email", "code": "INVALID_FORMAT" }
  ]
}
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| Verbs in URLs (`/getUsers`) | Not RESTful | HTTP methods: `GET /users` |
| No pagination on list endpoints | Returns 10K records, crashes clients | Always paginate (cursor preferred) |
| Exposing sequential IDs | Leaks data (user count, enumeration) | UUIDs or opaque IDs |
| No rate limiting | DDoS, abuse, runaway scripts | Token bucket per user/IP |
| Breaking changes without versioning | Clients break silently | Semantic versioning + sunset headers |
| No idempotency on mutations | Duplicate charges on retry | Idempotency-Key header |
| Webhooks without signatures | Spoofed events | HMAC-SHA256 signature verification |
| N+1 in GraphQL resolvers | 100 users = 100 DB queries | DataLoader for batching |

---

## Verification Checklist

- [ ] All endpoints follow consistent resource naming (nouns, not verbs)
- [ ] Pagination on every list endpoint (cursor-based for large datasets)
- [ ] Rate limiting with proper headers (X-RateLimit-*, Retry-After)
- [ ] Error responses use RFC 9457 Problem Details format
- [ ] Idempotency keys on non-idempotent mutations (POST payments, etc.)
- [ ] API versioning strategy defined and documented
- [ ] Webhooks signed with HMAC-SHA256, retried with exponential backoff
- [ ] OpenAPI spec generated and validated (if REST)
- [ ] Authentication on all non-public endpoints
- [ ] Input validation at API boundary (Zod/schema-based)
