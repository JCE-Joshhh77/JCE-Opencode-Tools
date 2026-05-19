---
name: reliability-engineering
description: Chaos engineering, error budgets, incident response, load testing. Use when working on reliability-engineering tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Reliability Engineering

## Auto-Detect

Trigger this skill when:
- Task mentions: SRE, reliability, chaos engineering, load testing, incident, postmortem, error budget
- Files: `k6/`, `locust/`, `*.jmx`, `chaos-*.yaml`, `incident-*.md`
- Patterns: error budget, capacity planning, failover, disaster recovery, SLO
- `package.json` contains: `k6`, `artillery`, `@chaos-mesh/*`

---

## Decision Tree: SLO Definition

```
What type of service?
├── User-facing API?
│   ├── Availability SLI: successful requests / total requests
│   ├── Latency SLI: requests < threshold / total requests
│   └── Typical targets: 99.9% availability, p99 < 500ms
├── Data pipeline / batch?
│   ├── Freshness SLI: time since last successful run < threshold
│   ├── Correctness SLI: valid records / total records
│   └── Typical targets: 99.5% freshness (< 1hr stale), 99.9% correctness
├── Storage / database?
│   ├── Durability SLI: data loss events / time window
│   ├── Availability SLI: successful queries / total queries
│   └── Typical targets: 99.999% durability, 99.95% availability
└── Async worker / queue consumer?
    ├── Throughput SLI: processed within SLA / total messages
    ├── Error SLI: failed messages / total messages
    └── Typical targets: 99.9% processed < 30s, < 0.1% error rate
```

## Decision Tree: Error Budget Response

```
How much error budget remains?
├── > 50% remaining (healthy)
│   └── Ship features freely, run experiments, aggressive rollouts
├── 25-50% remaining (caution)
│   └── Normal deploys, moderate rollout speed, review recent incidents
├── 5-25% remaining (critical)
│   └── Reduced deploys (bug fixes + reliability only), no experiments
├── 0-5% remaining (frozen)
│   └── Emergency-only deploys, all hands on reliability
└── Budget exhausted (breach)
    └── Feature freeze, mandatory postmortem, architecture review
```

---

## SLO/SLI Implementation

```yaml
# slo-definitions.yaml
slos:
  - name: order-api-availability
    sli:
      type: availability
      good: 'sum(rate(http_requests_total{status_code!~"5.."}[5m]))'
      total: 'sum(rate(http_requests_total[5m]))'
    objective: 99.95
    window: 30d
    alerts:
      page_burn_rate: 14.4    # 2% budget in 1 hour
      ticket_burn_rate: 2.0   # 5% budget in 6 hours

  - name: order-api-latency
    sli:
      type: latency
      good: 'sum(rate(http_request_duration_seconds_bucket{le="0.5"}[5m]))'
      total: 'sum(rate(http_request_duration_seconds_count[5m]))'
    objective: 99.0
    window: 30d

  - name: payment-success-rate
    sli:
      type: quality
      good: 'sum(rate(payments_total{status="success"}[5m]))'
      total: 'sum(rate(payments_total[5m]))'
    objective: 99.9
    window: 7d
```

```typescript
// Error budget calculation
function calculateErrorBudget(slo: SLO, metrics: WindowMetrics): ErrorBudget {
  const budgetTotal = metrics.totalRequests * (1 - slo.objective / 100);
  const budgetConsumed = metrics.failedRequests;
  const budgetRemaining = Math.max(0, budgetTotal - budgetConsumed);
  const consumedPercent = (budgetConsumed / budgetTotal) * 100;

  // Burn rate: how fast are we consuming budget relative to window
  const elapsedRatio = metrics.elapsedDays / slo.windowDays;
  const expectedConsumption = elapsedRatio * 100;
  const burnRate = consumedPercent / expectedConsumption;

  return {
    budgetTotal: Math.round(budgetTotal),
    budgetRemaining: Math.round(budgetRemaining),
    consumedPercent: Math.round(consumedPercent * 100) / 100,
    burnRate: Math.round(burnRate * 100) / 100,
    minutesRemaining: burnRate > 0
      ? Math.round((budgetRemaining / (budgetConsumed / metrics.elapsedMinutes)))
      : Infinity,
  };
}
```

---

## Chaos Engineering with Litmus

```yaml
# LitmusChaos experiment — pod network latency
apiVersion: litmuschaos.io/v1alpha1
kind: ChaosEngine
metadata:
  name: order-service-network-chaos
  namespace: production
spec:
  appinfo:
    appns: production
    applabel: app=order-service
    appkind: deployment
  chaosServiceAccount: litmus-admin
  experiments:
    - name: pod-network-latency
      spec:
        components:
          env:
            - name: NETWORK_LATENCY
              value: "300"          # 300ms added latency
            - name: JITTER
              value: "100"          # +/- 100ms jitter
            - name: TOTAL_CHAOS_DURATION
              value: "300"          # 5 minutes
            - name: CONTAINER_RUNTIME
              value: containerd
        probe:
          - name: availability-check
            type: httpProbe
            httpProbe/inputs:
              url: http://order-service.production/healthz
              expectedResponseCode: "200"
            mode: Continuous
            runProperties:
              probeTimeout: 5s
              interval: 10s
              successThreshold: 1
              failureThreshold: 3
---
# Steady-state hypothesis validation
apiVersion: litmuschaos.io/v1alpha1
kind: ChaosEngine
metadata:
  name: db-failover-test
spec:
  experiments:
    - name: pod-delete
      spec:
        components:
          env:
            - name: TARGET_PODS
              value: "postgres-primary-0"
            - name: TOTAL_CHAOS_DURATION
              value: "60"
        probe:
          - name: error-rate-check
            type: promProbe
            promProbe/inputs:
              endpoint: http://prometheus:9090
              query: 'sum(rate(http_requests_total{status_code=~"5.."}[1m])) / sum(rate(http_requests_total[1m]))'
              comparator:
                type: float
                criteria: "<="
                value: "0.01"    # Error rate must stay below 1%
            mode: Continuous
```

### Chaos Experiment Progression

```
1. Start in staging (validate experiment works)
2. Run in production during business hours (team available)
3. Expand blast radius gradually:
   Single pod → Multiple pods → Entire AZ → Cross-region
4. Automate as recurring (weekly/monthly)
5. Graduate to GameDay (multi-failure scenarios)
```

---

## Incident Management

### Severity Classification

| Level | Criteria | Response | Example |
|-------|----------|----------|---------|
| SEV1 | Data loss, full outage, security breach | 5 min, all-hands | DB corruption, auth bypass |
| SEV2 | Major feature broken, >10% users affected | 15 min, on-call + team | Payments failing, 50% errors |
| SEV3 | Minor feature broken, workaround exists | 1 hour, on-call | Search degraded, export slow |
| SEV4 | Cosmetic, no user impact | Next business day | Dashboard typo, log noise |

### Incident Commander Workflow

```
TRIAGE (0-5 min):
  1. Acknowledge alert, claim IC role
  2. Assess severity → open incident channel
  3. Page relevant team (SEV1/2)
  4. Post: what we know, what we don't, who's looking

MITIGATE (5-60 min):
  1. Can we rollback? → Do it immediately
  2. Can we feature-flag it off? → Do it
  3. Can we scale past it? → Try
  4. None work → deep investigation, bring SMEs
  5. Update status page every 15 min

RESOLVE:
  1. Root cause identified and fixed
  2. Monitoring confirms recovery (wait 15 min)
  3. Notify affected users
  4. Declare resolved, schedule postmortem

FOLLOW-UP (within 48 hours):
  1. Write blameless postmortem
  2. Identify action items with owners + due dates
  3. Review in team meeting
  4. Track action items to completion
```

---

## Postmortem Template

```markdown
## Postmortem: [Title]
**Date:** YYYY-MM-DD | **Duration:** Xh Ym | **Severity:** SEV-N
**IC:** [Name] | **Author:** [Name]

### Summary
[2-3 sentences: what happened, who was affected, how it was resolved]

### Impact
- Users affected: [N / percentage]
- Error budget consumed: [X% of monthly budget]
- Revenue impact: [if applicable]

### Timeline (UTC)
| Time | Event |
|------|-------|
| 14:00 | Deployment v2.3.1 rolled out |
| 14:05 | Error rate spike detected |
| 14:08 | Alert fired, IC acknowledged |
| 14:20 | Rollback completed, recovery confirmed |

### Root Cause
[Technical explanation — what broke and why]

### Contributing Factors
- [Factor that made this possible or worse]

### What Went Well
- [Things that worked as designed]

### Action Items
| Action | Owner | Priority | Due |
|--------|-------|----------|-----|
| Add load test for new query | @alice | P1 | 2024-02-01 |
| Improve deploy canary checks | @bob | P2 | 2024-02-15 |
```

---

## Load Testing Strategy

```javascript
// k6 — graduated load test
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    // Baseline: normal traffic
    baseline: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 50,
    },
    // Stress: find breaking point
    stress: {
      executor: 'ramping-arrival-rate',
      startRate: 100,
      timeUnit: '1s',
      stages: [
        { target: 200, duration: '2m' },
        { target: 500, duration: '2m' },
        { target: 1000, duration: '2m' },
      ],
      preAllocatedVUs: 200,
      startTime: '6m',
    },
    // Spike: sudden surge
    spike: {
      executor: 'ramping-arrival-rate',
      startRate: 100,
      timeUnit: '1s',
      stages: [
        { target: 2000, duration: '10s' },
        { target: 2000, duration: '3m' },
        { target: 100, duration: '10s' },
      ],
      preAllocatedVUs: 300,
      startTime: '14m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
  },
};
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| No error budget policy | Teams argue reliability vs features endlessly | Define policy: what happens at each budget level |
| Chaos only in staging | Staging doesn't reflect production reality | Graduate to production with abort conditions |
| Heroic incident response | Burnout, knowledge silos, bus factor | Runbooks, rotation, blameless culture |
| Postmortem blame | People hide mistakes, no systemic learning | Blameless postmortems, focus on systems not people |
| Load testing only before launch | Performance degrades over time unnoticed | Load tests in CI, fail on regression |
| Over-engineering reliability | 99.999% when 99.9% is sufficient and cheaper | Match reliability investment to business value |
| No SLO for internal services | Platform teams have no accountability | Every service has SLOs, even internal ones |
| Manual scaling only | Can't respond to traffic spikes fast enough | HPA with custom metrics + capacity headroom |

---

## Verification Checklist

- [ ] SLOs defined for all production services (availability + latency minimum)
- [ ] Error budget dashboard visible to engineering and product
- [ ] Error budget policy documented and agreed with product team
- [ ] Chaos experiments run at least monthly in production
- [ ] Incident response process documented with severity levels
- [ ] Postmortem completed within 48 hours of SEV1/SEV2
- [ ] Load tests run in CI and fail on performance regression
- [ ] On-call rotation established with escalation paths
- [ ] Runbooks exist for every alert that pages
- [ ] Disaster recovery tested at least quarterly
