---
name: sql-database
description: SQL queries, schema design, indexing, migrations, PostgreSQL/MySQL. Use when working on sql-database tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: SQL & Database
# Loaded on-demand when working with SQL, database design, migrations, queries, or performance

## Auto-Detect

Trigger this skill when:
- Files: `*.sql`, `schema.prisma`, `migrations/`, `drizzle.config.ts`, `knexfile.*`
- Task mentions: query, index, migration, database, schema, PostgreSQL, MySQL
- `package.json` contains: `prisma`, `drizzle-orm`, `knex`, `pg`, `mysql2`, `typeorm`

---

## Decision Tree: Index Strategy

```
Query is slow (EXPLAIN ANALYZE shows Seq Scan)?
+-- WHERE clause on single column?
|   +-- Equality (=)? -> B-tree index on that column
|   +-- Range (>, <, BETWEEN)? -> B-tree index
|   +-- Pattern (LIKE 'prefix%')? -> B-tree (prefix only) or trigram GIN
|   +-- Full-text search? -> GIN index on tsvector column
|   +-- JSON field? -> GIN index on JSONB column
+-- WHERE clause on multiple columns?
|   +-- Always queried together? -> Composite index (most selective first)
|   +-- Sometimes queried individually? -> Separate indexes (PG can bitmap combine)
|   +-- One column is always equality, other is range?
|       +-- Composite: equality column FIRST, then range column
+-- ORDER BY without matching index?
|   +-- Add index matching ORDER BY columns (include WHERE columns first)
+-- JOIN is slow?
|   +-- Index on foreign key column (should already exist!)
+-- Only a subset of rows matter?
|   +-- Partial index: CREATE INDEX ... WHERE status = 'active'
+-- Querying computed expression?
    +-- Expression index: CREATE INDEX ... ON (lower(email))

Golden rules:
- Index columns you filter/sort on, not every column
- Composite index order: equality columns first, then range, then sort
- Partial indexes for queries that always filter on a condition
- Don't over-index: each index slows writes and uses disk
- Monitor with pg_stat_user_indexes (unused indexes waste resources)
```

---

## Query Optimization Patterns

```sql
-- ALWAYS check query plans before and after optimization
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT p.title, u.name
FROM posts p
JOIN users u ON u.id = p.author_id
WHERE p.status = 'published'
ORDER BY p.published_at DESC
LIMIT 20;

-- Red flags in EXPLAIN output:
-- Seq Scan on large table -> needs index
-- Nested Loop with high rows -> consider Hash/Merge Join
-- Sort with high cost -> add index matching ORDER BY
-- Buffers shared read (high) -> data not in cache, consider more RAM
```

### Common Optimization Patterns

```sql
-- N+1 problem: fetch related data in one query
-- BAD: SELECT * FROM orders WHERE user_id = $1 (called per user in a loop)
-- GOOD: batch fetch
SELECT o.* FROM orders o
WHERE o.user_id = ANY($1::bigint[])  -- Pass array of user IDs
ORDER BY o.user_id, o.created_at DESC;

-- Pagination: use keyset instead of OFFSET for large tables
-- BAD (scans skipped rows):
SELECT * FROM posts ORDER BY created_at DESC OFFSET 10000 LIMIT 20;
-- GOOD (index seek):
SELECT * FROM posts
WHERE created_at < $1  -- cursor from previous page's last item
ORDER BY created_at DESC
LIMIT 20;

-- Covering index (index-only scan, no table lookup)
CREATE INDEX idx_posts_list ON posts(status, published_at DESC)
  INCLUDE (title, author_id);  -- PG11+: include non-key columns

-- Avoid SELECT * — fetch only needed columns
-- Especially important with JSONB columns or large TEXT fields

-- Use EXISTS instead of IN for correlated subqueries
-- BAD:  WHERE id IN (SELECT user_id FROM orders WHERE total > 100)
-- GOOD: WHERE EXISTS (SELECT 1 FROM orders WHERE user_id = users.id AND total > 100)

-- Window functions for analytics without self-joins
SELECT
  title,
  published_at,
  ROW_NUMBER() OVER (ORDER BY published_at DESC) AS rank,
  SUM(views) OVER (ORDER BY published_at ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS rolling_7d
FROM posts
WHERE status = 'published';
```

---

## Schema Design

```sql
-- Use BIGINT for PKs (INT maxes out at 2.1B — happens faster than you think)
CREATE TABLE users (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email       TEXT NOT NULL,
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_users_email UNIQUE (email)
);

CREATE TABLE posts (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    author_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    body         TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'published', 'archived')),
    published_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Always index foreign keys (PG doesn't auto-create them)
CREATE INDEX idx_posts_author ON posts(author_id);

-- Prefer TIMESTAMPTZ over TIMESTAMP (always store timezone-aware)
-- Prefer TEXT over VARCHAR(n) in PostgreSQL (no performance difference)
-- Use CHECK constraints for enums (or actual ENUM type)
```

---

## Migration Best Practices (Zero-Downtime)

```
Expand-Contract pattern for safe migrations:
+-- Phase 1: EXPAND (backward compatible)
|   +-- Add new column (nullable or with default)
|   +-- Add new table
|   +-- Add new index CONCURRENTLY
+-- Phase 2: MIGRATE
|   +-- Deploy code that writes to BOTH old and new
|   +-- Backfill data in batches (not one giant UPDATE)
+-- Phase 3: CONTRACT (after all code uses new schema)
    +-- Drop old column/table
    +-- Remove dual-write code
```

```sql
-- Safe: add nullable column (instant, no lock)
ALTER TABLE users ADD COLUMN display_name TEXT;

-- Safe: add column with default (PG11+ is instant)
ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;

-- Safe: create index without blocking writes
CREATE INDEX CONCURRENTLY idx_posts_status ON posts(status);

-- Safe: add constraint without blocking (validate later)
ALTER TABLE users ADD CONSTRAINT chk_email_format
  CHECK (email ~ '^.+@.+\..+$') NOT VALID;
-- Later (non-blocking scan):
ALTER TABLE users VALIDATE CONSTRAINT chk_email_format;

-- DANGEROUS: avoid in production on large tables
-- ALTER TABLE big_table ADD COLUMN x INT NOT NULL; (pre-PG11: full table rewrite)
-- DROP COLUMN (marks as invisible, space reclaimed on VACUUM)
-- RENAME COLUMN (breaks running queries)

-- Backfill in batches to avoid long locks
DO $$
DECLARE batch_size INT := 10000;
BEGIN
  LOOP
    UPDATE users SET display_name = name
    WHERE display_name IS NULL AND id IN (
      SELECT id FROM users WHERE display_name IS NULL LIMIT batch_size
    );
    EXIT WHEN NOT FOUND;
    COMMIT;
    PERFORM pg_sleep(0.1); -- Brief pause to reduce load
  END LOOP;
END $$;
```

---

## Connection Pooling

```
Why pool connections?
- PostgreSQL forks a process per connection (~10MB RAM each)
- 100 connections = 1GB RAM just for connection overhead
- Most apps need far fewer active connections than total requests

Architecture:
  App (100 workers) -> PgBouncer (25 pool) -> PostgreSQL (30 max_connections)

Pool modes:
+-- Transaction pooling (recommended)
|   +-- Connection returned to pool after each transaction
|   +-- Cannot use session-level features (prepared statements, SET)
+-- Session pooling
|   +-- Connection held for entire client session
|   +-- Supports all PG features but less efficient
+-- Statement pooling
    +-- Connection returned after each statement
    +-- Most efficient but no multi-statement transactions
```

```typescript
// Application-level pooling (if no PgBouncer)
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,                    // Max connections in pool
  idleTimeoutMillis: 30000,   // Close idle connections after 30s
  connectionTimeoutMillis: 5000, // Fail fast if can't connect in 5s
  allowExitOnIdle: true,      // Don't keep process alive for idle connections
});

// Always release connections (use pool.query for simple queries)
const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);

// For transactions, get a client and release in finally
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [amount, from]);
  await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [amount, to]);
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release(); // ALWAYS release back to pool
}
```

---

## Read Replicas

```
When to use read replicas?
+-- Read-heavy workload (> 80% reads)?
+-- Reporting/analytics queries that shouldn't impact production?
+-- Geographic distribution (replica closer to users)?
+-- Need to scale reads independently of writes?

Routing pattern:
+-- Writes -> Primary (always)
+-- Reads that need consistency -> Primary
+-- Reads that tolerate slight lag (< 1s) -> Replica
+-- Analytics/reporting -> Dedicated replica

Replication lag considerations:
- Async replication: typically < 100ms lag, but can spike
- After a write, read from primary for that user's next request
- Use "read-your-writes" consistency: route user to primary for N seconds after write
```

```typescript
// Simple read/write routing
class DatabaseRouter {
  constructor(
    private primary: Pool,    // Writes + consistent reads
    private replica: Pool,    // Eventually consistent reads
  ) {}

  async query(sql: string, params: unknown[], opts?: { consistency: 'strong' | 'eventual' }) {
    const pool = opts?.consistency === 'strong' ? this.primary : this.replica;
    return pool.query(sql, params);
  }

  async transaction(fn: (client: PoolClient) => Promise<void>) {
    const client = await this.primary.connect(); // Transactions always on primary
    try {
      await client.query('BEGIN');
      await fn(client);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
```

---

## Partitioning

```sql
-- Partition large tables (> 100M rows or time-series data)
-- PostgreSQL declarative partitioning

-- Range partitioning (time-series, logs, events)
CREATE TABLE events (
    id         BIGINT GENERATED ALWAYS AS IDENTITY,
    type       TEXT NOT NULL,
    data       JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

-- Create monthly partitions
CREATE TABLE events_2026_01 PARTITION OF events
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE events_2026_02 PARTITION OF events
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

-- Automate partition creation (pg_partman extension or cron job)
-- Benefits: fast deletes (DROP partition), parallel scans, smaller indexes

-- List partitioning (by category, region, tenant)
CREATE TABLE orders (
    id        BIGINT GENERATED ALWAYS AS IDENTITY,
    region    TEXT NOT NULL,
    total     NUMERIC NOT NULL
) PARTITION BY LIST (region);

CREATE TABLE orders_us PARTITION OF orders FOR VALUES IN ('us-east', 'us-west');
CREATE TABLE orders_eu PARTITION OF orders FOR VALUES IN ('eu-west', 'eu-central');

-- Hash partitioning (even distribution when no natural partition key)
CREATE TABLE sessions (id UUID PRIMARY KEY, data JSONB)
  PARTITION BY HASH (id);
CREATE TABLE sessions_0 PARTITION OF sessions FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE sessions_1 PARTITION OF sessions FOR VALUES WITH (MODULUS 4, REMAINDER 1);
```

---

## PostgreSQL-Specific Features

```sql
-- JSONB with GIN index
CREATE INDEX idx_events_data ON events USING GIN (data);
SELECT * FROM events WHERE data @> '{"type": "signup"}';

-- Full-text search
ALTER TABLE posts ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || body)) STORED;
CREATE INDEX idx_posts_search ON posts USING GIN (search_vector);

-- Find slow queries
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;

-- Find unused indexes (candidates for removal)
SELECT indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes WHERE idx_scan = 0 AND indexrelname NOT LIKE '%pkey%';

-- Advisory locks for application-level locking
SELECT pg_advisory_xact_lock(hashtext('process-order-' || $1));
-- Lock released automatically at end of transaction
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| SELECT * everywhere | Fetches unnecessary data, breaks on schema change | Explicit column list |
| No indexes on foreign keys | Slow JOINs and CASCADE deletes | Always index FKs |
| OFFSET for deep pagination | Scans all skipped rows | Keyset/cursor pagination |
| Large transactions | Lock contention, replication lag | Keep transactions short |
| No connection pooling | Connection exhaustion under load | PgBouncer or app-level pool |
| Migrations with table locks | Downtime on large tables | CONCURRENTLY, NOT VALID + VALIDATE |
| Storing files in DB | Bloats DB, slow backups | Object storage (S3) + URL in DB |
| No query monitoring | Slow queries go unnoticed | pg_stat_statements + alerts |
| Over-indexing | Slow writes, wasted disk | Index based on actual query patterns |
| UUID v4 as primary key | Random inserts fragment B-tree | UUIDv7 (time-ordered) or BIGINT |

---

## Verification Checklist

- [ ] All queries on critical paths have EXPLAIN ANALYZE reviewed
- [ ] Indexes exist for all WHERE, JOIN, and ORDER BY columns used in production
- [ ] Foreign keys have indexes (PG doesn't auto-create them)
- [ ] Migrations are backward-compatible (expand-contract pattern)
- [ ] Connection pooling configured (PgBouncer or app-level)
- [ ] pg_stat_statements enabled for query monitoring
- [ ] Backups tested (can you actually restore?)
- [ ] Large tables partitioned if > 100M rows or time-series
- [ ] No N+1 queries (batch fetch with ANY() or DataLoader)
- [ ] TIMESTAMPTZ used for all time columns (not TIMESTAMP)
- [ ] Primary keys are BIGINT or UUIDv7 (not INT or UUIDv4)
