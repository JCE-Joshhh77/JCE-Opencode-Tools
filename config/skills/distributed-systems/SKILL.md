---
name: distributed-systems
description: Event-driven, saga, CQRS, Kafka, RabbitMQ, circuit breakers. Use when working on distributed-systems tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Distributed Systems

## Auto-Detect

Trigger this skill when:
- Task mentions: event-driven, saga, CQRS, message queue, Kafka, RabbitMQ, idempotency, outbox
- Files: `docker-compose.yml` with queue services, `*.proto`, event handler files
- Patterns: service-to-service communication, eventual consistency, distributed transactions
- `package.json` contains: `kafkajs`, `amqplib`, `bullmq`, `@nestjs/microservices`, `temporal-sdk`

---

## Decision Tree: Saga Pattern

```
Need distributed transaction coordination?
├── Central orchestrator controls flow?
│   └── Orchestration Saga
│       ├── Pro: Clear flow, easy to debug, single point of visibility
│       ├── Con: Orchestrator is single point of failure, coupling
│       └── Use: Complex workflows, many steps, need timeout handling
├── Services react to events independently?
│   └── Choreography Saga
│       ├── Pro: Loose coupling, no single point of failure
│       ├── Con: Hard to track flow, implicit dependencies
│       └── Use: Simple flows (2-4 steps), high autonomy needed
└── Long-running with human interaction?
    └── Workflow Engine (Temporal/Step Functions)
        └── Use: Multi-day processes, retries, timers, human approval
```

## Decision Tree: Delivery Guarantees

```
What delivery semantics do you need?
├── At-most-once (fire and forget)?
│   └── UDP, basic publish without ack
│   └── Use: Metrics, logs, non-critical notifications
├── At-least-once (may duplicate)?
│   └── Kafka default, RabbitMQ with ack
│   └── Use: Most cases — combine with idempotent consumers
└── Exactly-once (no loss, no duplicates)?
    └── Kafka transactional producer + consumer read_committed
    └── OR: Outbox pattern + idempotent consumer + dedup table
    └── Use: Financial transactions, inventory, billing
```

---

## Outbox Pattern

```typescript
// Guarantees event publication even if message broker is down
// Write event to DB in same transaction as state change

class OrderService {
  async createOrder(input: CreateOrderInput): Promise<Order> {
    return this.db.$transaction(async (tx) => {
      // 1. Write business state
      const order = await tx.orders.create({ data: input });

      // 2. Write event to outbox (same transaction = atomic)
      await tx.outbox.create({
        data: {
          id: crypto.randomUUID(),
          aggregateType: 'Order',
          aggregateId: order.id,
          eventType: 'OrderCreated',
          payload: JSON.stringify({ orderId: order.id, items: input.items, total: input.total }),
          createdAt: new Date(),
          publishedAt: null, // Null = not yet published
        },
      });

      return order;
    });
  }
}

// Outbox relay — polls and publishes (separate process)
class OutboxRelay {
  async poll(): Promise<void> {
    const unpublished = await this.db.outbox.findMany({
      where: { publishedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    for (const event of unpublished) {
      try {
        await this.broker.publish(event.eventType, event.payload, {
          headers: { 'idempotency-key': event.id },
        });
        await this.db.outbox.update({
          where: { id: event.id },
          data: { publishedAt: new Date() },
        });
      } catch (err) {
        // Will retry on next poll — at-least-once delivery
        this.logger.error({ err, eventId: event.id }, 'Outbox publish failed');
      }
    }
  }
}
```

---

## Event Sourcing

```typescript
// Store events as source of truth, derive state by replaying

interface DomainEvent {
  eventId: string;
  aggregateId: string;
  eventType: string;
  version: number;        // Optimistic concurrency
  payload: unknown;
  metadata: { correlationId: string; causationId: string; timestamp: Date };
}

class EventStore {
  async append(aggregateId: string, events: DomainEvent[], expectedVersion: number): Promise<void> {
    // Optimistic concurrency — reject if version mismatch
    const current = await this.db.events.aggregate({
      where: { aggregateId },
      _max: { version: true },
    });

    if ((current._max.version ?? 0) !== expectedVersion) {
      throw new ConcurrencyError(aggregateId, expectedVersion, current._max.version);
    }

    await this.db.events.createMany({ data: events });
  }

  async loadAggregate<T>(aggregateId: string, reducer: (state: T, event: DomainEvent) => T, initial: T): Promise<T> {
    const events = await this.db.events.findMany({
      where: { aggregateId },
      orderBy: { version: 'asc' },
    });
    return events.reduce(reducer, initial);
  }
}

// Snapshot optimization for aggregates with many events
class SnapshotStore {
  async loadWithSnapshot<T>(aggregateId: string, reducer: (s: T, e: DomainEvent) => T, initial: T): Promise<T> {
    const snapshot = await this.db.snapshots.findFirst({
      where: { aggregateId },
      orderBy: { version: 'desc' },
    });

    const fromVersion = snapshot?.version ?? 0;
    const state = snapshot ? (JSON.parse(snapshot.state) as T) : initial;

    const events = await this.db.events.findMany({
      where: { aggregateId, version: { gt: fromVersion } },
      orderBy: { version: 'asc' },
    });

    return events.reduce(reducer, state);
  }
}
```

---

## CQRS with Projections

```typescript
// Command side — validates and persists events
class OrderCommandHandler {
  async handle(cmd: CreateOrderCommand): Promise<void> {
    const order = Order.create(cmd.payload);
    const events = order.getUncommittedEvents();
    await this.eventStore.append(order.id, events, order.version);
    await this.eventBus.publishAll(events);
  }
}

// Query side — denormalized read model, optimized for queries
class OrderProjection {
  @OnEvent('OrderCreated')
  async onCreated(event: OrderCreatedEvent): Promise<void> {
    await this.readDb.upsert('order_summaries', {
      id: event.aggregateId,
      status: 'created',
      total: event.payload.total,
      itemCount: event.payload.items.length,
      createdAt: event.timestamp,
    });
  }

  @OnEvent('OrderShipped')
  async onShipped(event: OrderShippedEvent): Promise<void> {
    await this.readDb.update('order_summaries', event.aggregateId, {
      status: 'shipped',
      shippedAt: event.timestamp,
      trackingNumber: event.payload.trackingNumber,
    });
  }
}
```

---

## Dead Letter Queue Handling

```typescript
class DeadLetterProcessor {
  // Messages land here after N failed attempts
  async processDeadLetter(message: DeadLetterMessage): Promise<void> {
    await this.db.deadLetters.create({
      data: {
        originalQueue: message.headers['x-original-queue'],
        eventType: message.headers['event-type'],
        payload: message.body,
        failureReason: message.headers['x-failure-reason'],
        failureCount: parseInt(message.headers['x-retry-count'] ?? '0'),
        receivedAt: new Date(),
        status: 'pending_review',
      },
    });

    // Alert if DLQ depth exceeds threshold
    const depth = await this.getQueueDepth('dead-letter');
    if (depth > 100) {
      await this.alerting.fire('dlq_depth_high', { depth, queue: message.headers['x-original-queue'] });
    }
  }

  // Manual or automated replay
  async replay(deadLetterId: string): Promise<void> {
    const dl = await this.db.deadLetters.findUniqueOrThrow({ where: { id: deadLetterId } });
    await this.broker.publish(dl.originalQueue, dl.payload, {
      headers: { 'x-replayed-from-dlq': 'true', 'x-original-failure': dl.failureReason },
    });
    await this.db.deadLetters.update({ where: { id: deadLetterId }, data: { status: 'replayed' } });
  }
}
```

---

## Idempotent Consumer

```typescript
class IdempotentConsumer {
  async handle(event: IncomingEvent, processor: (e: IncomingEvent) => Promise<void>): Promise<void> {
    // Deduplication check — single atomic operation
    const inserted = await this.db.$executeRaw`
      INSERT INTO processed_events (event_id, received_at)
      VALUES (${event.id}, NOW())
      ON CONFLICT (event_id) DO NOTHING
      RETURNING event_id
    `;

    if (inserted === 0) {
      this.logger.info({ eventId: event.id }, 'Duplicate event skipped');
      return; // Already processed
    }

    try {
      await processor(event);
    } catch (err) {
      // Remove dedup record so retry can succeed
      await this.db.$executeRaw`DELETE FROM processed_events WHERE event_id = ${event.id}`;
      throw err;
    }
  }
}
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| Two-phase commit across services | Blocks resources, doesn't scale | Saga pattern with compensating transactions |
| Shared database between services | Coupling, schema conflicts, deploy lock | Each service owns its data, sync via events |
| No outbox pattern | Events lost if broker is down after DB commit | Transactional outbox + relay process |
| Unbounded retries | Cascading failures, resource exhaustion | Exponential backoff + circuit breaker + DLQ |
| Fat events with full entity | Coupling, bandwidth waste, schema drift | Thin events (IDs + delta), query back if needed |
| No idempotency on consumers | Duplicate processing on retry/redelivery | Deduplication table + idempotency keys |
| Ignoring DLQ | Poison messages silently lost | Monitor DLQ depth, alert, provide replay tooling |
| Event ordering assumptions | Race conditions across partitions | Partition by aggregate ID, design for out-of-order |

---

## Verification Checklist

- [ ] Every state change publishes an event (outbox or transactional publish)
- [ ] All consumers are idempotent (dedup table or natural idempotency)
- [ ] Dead letter queues configured with alerting on depth
- [ ] Saga compensations tested (what happens when step 3 of 5 fails?)
- [ ] Event schemas versioned (Avro/Protobuf registry or JSON Schema)
- [ ] Correlation IDs threaded through all messages for tracing
- [ ] Partition keys chosen to ensure ordering within an aggregate
- [ ] Circuit breakers on all synchronous cross-service calls
- [ ] Retry policies have max attempts + exponential backoff
- [ ] Read models can be rebuilt from event store (projection replay tested)
