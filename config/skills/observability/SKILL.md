---
name: observability
description: OpenTelemetry, Prometheus, Grafana, tracing, SLO/SLI, alerting. Use when working on observability tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Observability

## Auto-Detect

Trigger this skill when:
- Task mentions: monitoring, logging, tracing, metrics, Prometheus, Grafana, OpenTelemetry
- Files: `otel-config.yaml`, `prometheus.yml`, `grafana/`, `*.dashboard.json`
- Patterns: structured logging, distributed tracing, alerting, SLO definition
- `package.json` contains: `@opentelemetry/*`, `prom-client`, `winston`, `pino`

---

## Decision Tree: Observability Signal

```
What do you need to understand?
├── What happened? (discrete events)
│   └── LOGS — structured JSON, contextual, searchable
│       └── Tool: Pino/Winston → Loki/Elasticsearch
├── How much / how fast? (aggregated measurements)
│   └── METRICS — counters, gauges, histograms
│       └── Tool: prom-client / OTel Metrics → Prometheus → Grafana
├── Where did time go? (request flow across services)
│   └── TRACES — spans with parent-child relationships
│       └── Tool: OTel SDK → Jaeger/Tempo
└── Correlate all three?
    └── OpenTelemetry (unified SDK, trace_id links everything)
```

## Decision Tree: Alerting Strategy

```
Should this alert page someone?
├── Does it require immediate human action? → Yes, page
├── Can it wait until business hours? → Ticket (not page)
├── Is it informational only? → Dashboard/log (no alert)
├── Is it based on symptoms (user impact)? → Good alert
├── Is it based on causes (CPU high)? → Usually bad alert
└── Does it have a runbook? → Required for any page-level alert
```

---

## OpenTelemetry SDK Setup

```typescript
// instrumentation.ts — load BEFORE any other imports
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const resource = new Resource({
  [ATTR_SERVICE_NAME]: process.env.SERVICE_NAME ?? 'unknown',
  [ATTR_SERVICE_VERSION]: process.env.SERVICE_VERSION ?? '0.0.0',
  'deployment.environment': process.env.NODE_ENV ?? 'development',
});

const sdk = new NodeSDK({
  resource,
  traceExporter: new OTLPTraceExporter({
    url: `${process.env.OTEL_ENDPOINT}/v1/traces`,
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${process.env.OTEL_ENDPOINT}/v1/metrics`,
    }),
    exportIntervalMillis: 15_000,
  }),
  logRecordProcessor: new BatchLogRecordProcessor(
    new OTLPLogExporter({ url: `${process.env.OTEL_ENDPOINT}/v1/logs` })
  ),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingPaths: ['/healthz', '/readyz', '/metrics'],
      },
    }),
  ],
});

sdk.start();
process.on('SIGTERM', () => sdk.shutdown());
```

---

## Distributed Tracing: Custom Spans

```typescript
import { trace, SpanKind, SpanStatusCode, context, propagation } from '@opentelemetry/api';

const tracer = trace.getTracer('order-service', '1.0.0');

async function processOrder(order: Order): Promise<void> {
  return tracer.startActiveSpan('processOrder', {
    kind: SpanKind.INTERNAL,
    attributes: {
      'order.id': order.id,
      'order.item_count': order.items.length,
      'order.total_cents': Math.round(order.total * 100),
    },
  }, async (span) => {
    try {
      // Child span for external call
      const result = await tracer.startActiveSpan('payment.charge', {
        kind: SpanKind.CLIENT,
        attributes: { 'payment.method': order.paymentMethod },
      }, async (paymentSpan) => {
        const res = await paymentService.charge(order);
        paymentSpan.setAttribute('payment.transaction_id', res.txId);
        paymentSpan.setStatus({ code: SpanStatusCode.OK });
        paymentSpan.end();
        return res;
      });

      span.addEvent('payment_completed', { 'transaction.id': result.txId });
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
}

// Propagate context to async workers (e.g., queue messages)
function injectTraceContext(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier; // Add as message headers
}
```

---

## Log Correlation

```typescript
import pino from 'pino';
import { trace, context } from '@opentelemetry/api';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  mixin() {
    // Auto-inject trace context into every log line
    const span = trace.getSpan(context.active());
    if (span) {
      const ctx = span.spanContext();
      return { traceId: ctx.traceId, spanId: ctx.spanId };
    }
    return {};
  },
  redact: ['req.headers.authorization', 'body.password', 'body.creditCard'],
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Usage — structured fields, not string interpolation
logger.info({ orderId, itemCount: items.length, total }, 'Order created');
logger.error({ err, orderId, retryCount }, 'Payment processing failed');

// NEVER: logger.info(`Order ${orderId} created`) — unsearchable, no correlation
```

---

## Custom Metrics

```typescript
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('order-service', '1.0.0');

// Counter — monotonically increasing (requests, errors, events)
const ordersCreated = meter.createCounter('orders.created', {
  description: 'Total orders created',
  unit: '1',
});

// Histogram — distribution of values (latency, sizes)
const orderProcessingDuration = meter.createHistogram('orders.processing_duration', {
  description: 'Time to process an order',
  unit: 'ms',
  advice: { explicitBucketBoundaries: [10, 50, 100, 250, 500, 1000, 2500, 5000] },
});

// Gauge — point-in-time value (queue depth, connections, temperature)
const queueDepth = meter.createObservableGauge('queue.depth', {
  description: 'Current messages in queue',
});
queueDepth.addCallback((result) => {
  result.observe(getQueueDepth(), { queue: 'orders' });
});

// Usage in business logic
async function createOrder(input: OrderInput): Promise<Order> {
  const start = performance.now();
  try {
    const order = await db.orders.create({ data: input });
    ordersCreated.add(1, { payment_method: input.paymentMethod, region: input.region });
    return order;
  } finally {
    orderProcessingDuration.record(performance.now() - start, { status: 'success' });
  }
}
```

---

## Alerting: Multi-Window Burn Rate

```yaml
# Prometheus alerting rules — Google SRE burn rate approach
groups:
  - name: slo-burn-rate
    rules:
      # PAGE: 2% budget consumed in 1 hour (14.4x burn rate)
      - alert: HighBurnRate_Page
        expr: |
          (
            sum(rate(http_requests_total{status_code=~"5.."}[1h]))
            / sum(rate(http_requests_total[1h]))
          ) > (14.4 * 0.0005)
          AND
          (
            sum(rate(http_requests_total{status_code=~"5.."}[5m]))
            / sum(rate(http_requests_total[5m]))
          ) > (14.4 * 0.0005)
        for: 2m
        labels:
          severity: page
        annotations:
          summary: "High error burn rate — budget exhausts in ~2.5 days"
          runbook: "https://wiki.internal/runbooks/high-error-rate"

      # TICKET: 5% budget consumed in 6 hours (2x burn rate)
      - alert: HighBurnRate_Ticket
        expr: |
          (
            sum(rate(http_requests_total{status_code=~"5.."}[6h]))
            / sum(rate(http_requests_total[6h]))
          ) > (2 * 0.0005)
        for: 30m
        labels:
          severity: ticket
        annotations:
          summary: "Elevated error rate — investigate within business hours"
```

---

## Dashboard Design Principles

```
RED method (for services):
  - Rate: requests per second
  - Errors: error rate (5xx / total)
  - Duration: latency percentiles (p50, p95, p99)

USE method (for resources):
  - Utilization: % of capacity used (CPU, memory, disk)
  - Saturation: queue depth, thread pool exhaustion
  - Errors: hardware/resource errors

Dashboard layout (top to bottom):
  1. SLO status (budget remaining, burn rate) — the "so what"
  2. RED metrics — service health at a glance
  3. USE metrics — resource health
  4. Deployment markers — correlate changes with impact
  5. Dependency health — downstream service status
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| High-cardinality metric labels | Prometheus OOM, slow queries | Never use userId/requestId as label; use traces |
| Alert on every error | Alert fatigue, ignored pages | Alert on SLO burn rate, not individual errors |
| No trace-log correlation | Can't connect log entry to request flow | Inject traceId into every log line via mixin |
| 100% trace sampling in prod | Storage costs explode | Head-based 1-10%, tail-based for errors/slow |
| Dashboard without runbook | Alert fires, nobody knows what to do | Every page-level alert links to a runbook |
| String-based log parsing | Fragile, slow, breaks on format change | Structured JSON logging from day one |
| Monitoring only happy path | Blind to degradation | Monitor error paths, timeouts, retries, DLQ |
| Logging PII/secrets | Compliance violation, breach risk | Redact at logger level with allowlists |

---

## Verification Checklist

- [ ] OTel SDK initialized before all other imports
- [ ] All services emit traces, metrics, and structured logs
- [ ] Trace context propagated across HTTP, gRPC, and message queues
- [ ] Log lines include traceId and spanId for correlation
- [ ] RED metrics (rate, errors, duration) exposed for every service
- [ ] SLO burn-rate alerts configured (page + ticket severity)
- [ ] Every page-level alert has a linked runbook
- [ ] No high-cardinality labels in metrics (userId, requestId, etc.)
- [ ] PII redacted from logs (authorization headers, passwords, PII fields)
- [ ] Dashboards follow RED/USE layout with deployment markers
