---
name: devops
description: Docker, CI/CD, deployment, monitoring, infrastructure. Use when working on devops tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: DevOps Advanced
# Loaded on-demand when task involves Docker, CI/CD, deployment, monitoring, or infrastructure

## Auto-Detect

Trigger this skill when:
- Files: `Dockerfile`, `docker-compose.yml`, `.github/workflows/*.yml`, `Jenkinsfile`
- Files: `.gitlab-ci.yml`, `fly.toml`, `terraform/*.tf`, `pulumi/*`, `cdk/*`
- Task mentions: deploy, container, pipeline, monitoring, infrastructure, scaling
- `package.json` scripts: `docker:*`, `deploy:*`, `ci:*`

---

## Decision Tree: Deployment Strategy

```
What's your risk tolerance and infrastructure?
+-- Zero-downtime required, instant rollback?
|   +-- Blue-Green deployment
|       +-- Two identical environments (blue = current, green = new)
|       +-- Deploy to green, test, switch traffic atomically
|       +-- Rollback = switch back to blue (instant)
+-- Gradual rollout, test with real traffic?
|   +-- Canary deployment
|       +-- Route 1-5% traffic to new version
|       +-- Monitor error rates, latency, business metrics
|       +-- Gradually increase (10% -> 25% -> 50% -> 100%)
|       +-- Rollback = route all traffic back to old version
+-- Simple app, can tolerate brief mixed versions?
|   +-- Rolling deployment (Kubernetes default)
|       +-- Replace instances one at a time
|       +-- Rollback = kubectl rollout undo
+-- Feature needs testing with specific users?
|   +-- Feature flags (LaunchDarkly, Unleash, custom)
|       +-- Deploy code dark (disabled), enable per-user/percentage
|       +-- Rollback = disable flag (instant, no deploy)
+-- Database migration involved?
    +-- Expand-Contract pattern
        +-- Phase 1: Add new column/table (backward compatible)
        +-- Phase 2: Migrate data, update code
        +-- Phase 3: Remove old column/table
```

---

## GitOps Workflow

```
GitOps Principles:
+-- Git is the single source of truth for infrastructure state
+-- All changes via pull request (auditable, reviewable)
+-- Automated reconciliation (desired state -> actual state)
+-- Drift detection and self-healing

GitOps Flow:
  Developer -> PR to config repo -> Merge -> ArgoCD/Flux detects change
  -> Applies to cluster -> Monitors health -> Rollback if unhealthy

Tools:
+-- ArgoCD — Kubernetes-native, UI, multi-cluster, App of Apps pattern
+-- Flux v2 — Lightweight, GitOps Toolkit, Kustomize-native
+-- Crossplane — GitOps for cloud infrastructure (not just K8s workloads)
```

```yaml
# ArgoCD Application manifest
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/org/k8s-manifests.git
    targetRevision: main
    path: apps/my-app/overlays/production
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
    retry:
      limit: 3
      backoff: { duration: 5s, factor: 2, maxDuration: 3m }
```

---

## IaC Comparison: Terraform vs Pulumi vs CDK

```
Which IaC tool?
+-- Multi-cloud, large team, established workflows?
|   +-- Terraform (HCL) — largest ecosystem, most hiring, state management mature
+-- Want real programming language (TypeScript, Python, Go)?
|   +-- Pulumi — same languages as app code, better abstractions, testing
+-- AWS-only, want tight integration?
|   +-- AWS CDK — TypeScript/Python, generates CloudFormation, L2/L3 constructs
+-- Simple infrastructure, few resources?
|   +-- SST (built on Pulumi) — optimized for serverless/full-stack apps
+-- Kubernetes-focused?
    +-- Helm + Kustomize (manifests) or cdk8s (programmatic)
```

| Feature | Terraform | Pulumi | AWS CDK |
|---------|-----------|--------|---------|
| Language | HCL (DSL) | TS, Python, Go, C# | TS, Python, Java, C# |
| State | Remote (S3, TFC) | Pulumi Cloud or self-managed | CloudFormation |
| Multi-cloud | Excellent | Excellent | AWS only |
| Testing | `terraform test` (limited) | Unit tests in any framework | CDK assertions |
| Ecosystem | Largest provider library | Growing, Terraform bridge | AWS-focused |
| Learning curve | Low (HCL is simple) | Low (if you know the language) | Medium (CFN concepts) |
| Drift detection | `terraform plan` | `pulumi preview` | CFN drift detection |

```typescript
// Pulumi example — type-safe infrastructure
import * as aws from '@pulumi/aws';

const bucket = new aws.s3.Bucket('app-assets', {
  website: { indexDocument: 'index.html' },
  forceDestroy: true,
});

const cdn = new aws.cloudfront.Distribution('cdn', {
  origins: [{ domainName: bucket.websiteEndpoint, originId: 'S3' }],
  defaultCacheBehavior: {
    viewerProtocolPolicy: 'redirect-to-https',
    allowedMethods: ['GET', 'HEAD'],
    cachedMethods: ['GET', 'HEAD'],
    targetOriginId: 'S3',
    forwardedValues: { queryString: false, cookies: { forward: 'none' } },
  },
  enabled: true,
});

export const cdnUrl = cdn.domainName;
```

---

## Container Security Scanning

```yaml
# GitHub Actions — scan on every build
- name: Build image
  run: docker build -t myapp:${{ github.sha }} .

- name: Scan with Trivy
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: myapp:${{ github.sha }}
    format: sarif
    output: trivy-results.sarif
    severity: CRITICAL,HIGH
    exit-code: 1  # Fail pipeline on HIGH/CRITICAL

- name: Scan with Grype (alternative)
  run: |
    grype myapp:${{ github.sha }} --fail-on high --output table

# Runtime scanning in Kubernetes
# Deploy Falco for runtime threat detection
# Deploy Kyverno/OPA Gatekeeper for admission policies
```

### Secure Dockerfile Pattern

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && pnpm run build

FROM gcr.io/distroless/nodejs22-debian12 AS runtime
COPY --from=builder /app/dist /app/dist
COPY --from=deps /app/node_modules /app/node_modules
WORKDIR /app
USER nonroot:nonroot
CMD ["dist/index.js"]
```

---

## CI/CD Pipeline (GitHub Actions)

```yaml
name: CI/CD
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: corepack enable && pnpm install --frozen-lockfile
      - run: pnpm lint && pnpm typecheck
      - run: pnpm test --coverage
      - run: pnpm audit --audit-level=moderate

  build:
    needs: quality
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: ${{ github.ref == 'refs/heads/main' }}
          tags: ghcr.io/${{ github.repository }}:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - name: Scan image
        if: github.ref == 'refs/heads/main'
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ghcr.io/${{ github.repository }}:${{ github.sha }}
          exit-code: 1
          severity: CRITICAL,HIGH

  deploy:
    if: github.ref == 'refs/heads/main'
    needs: build
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Deploy via GitOps
        run: |
          # Update image tag in GitOps repo, ArgoCD auto-syncs
          gh api repos/org/k8s-manifests/dispatches \
            -f event_type=deploy \
            -f client_payload[image]="ghcr.io/${{ github.repository }}:${{ github.sha }}"
```

---

## Cost Optimization

```
Cloud cost reduction strategies:
+-- Compute
|   +-- Right-size instances (monitor actual CPU/memory usage)
|   +-- Spot/preemptible instances for stateless workloads (60-90% savings)
|   +-- Auto-scaling with scale-to-zero for dev/staging
|   +-- ARM instances (Graviton, Ampere) — 20-40% cheaper, same performance
+-- Storage
|   +-- Lifecycle policies (move to cold storage after 30 days)
|   +-- Delete unused EBS volumes, old snapshots
|   +-- S3 Intelligent-Tiering for unpredictable access patterns
+-- Networking
|   +-- CDN for static assets (reduce origin traffic)
|   +-- VPC endpoints for AWS service traffic (avoid NAT gateway costs)
|   +-- Compress responses (Brotli > gzip)
+-- Database
|   +-- Reserved instances for predictable workloads (30-60% savings)
|   +-- Serverless DB for variable workloads (Aurora Serverless, Neon)
|   +-- Read replicas only if read-heavy (don't over-provision)
+-- Monitoring
    +-- Set billing alerts at 50%, 80%, 100% of budget
    +-- Weekly cost review (tag resources by team/service)
    +-- Use Infracost in CI to estimate cost of IaC changes
```

---

## Monitoring & Observability

### Four Golden Signals

| Signal | Measure | Alert When |
|--------|---------|------------|
| **Latency** | p50, p95, p99 response time | p95 > 500ms for 5 min |
| **Traffic** | Requests/sec | Unusual spike or drop (> 2 stddev) |
| **Errors** | 5xx rate | Error rate > 1% for 2 min |
| **Saturation** | CPU, memory, connections | > 80% sustained for 5 min |

### Health Check

```typescript
app.get('/health', async (req, res) => {
  const checks = {
    database: await checkDb().catch(() => false),
    redis: await checkRedis().catch(() => false),
    uptime: process.uptime(),
  };
  const healthy = checks.database && checks.redis;
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', checks });
});
```

---

## Anti-Patterns

| Don't | Do Instead |
|-------|------------|
| Run as root in container | `USER nonroot` or distroless |
| Use `latest` tag in production | Pin specific version/SHA |
| Manual deployments | Automated CI/CD + GitOps |
| Alert on every metric | Alert on symptoms (error rate), not causes (CPU) |
| SSH into production containers | Immutable infrastructure, redeploy |
| Shared credentials across environments | Per-environment secrets with rotation |
| Skip health checks | HEALTHCHECK + readiness/liveness probes |
| Monolithic CI pipeline (30+ min) | Parallel jobs, caching, affected-only |
| No cost monitoring | Billing alerts + weekly review + Infracost |
| Terraform without remote state locking | S3 + DynamoDB lock or Terraform Cloud |

---

## Verification Checklist

- [ ] Dockerfile uses multi-stage build with non-root user
- [ ] Container images scanned for vulnerabilities (Trivy/Grype)
- [ ] CI pipeline: lint, typecheck, test, security scan, build
- [ ] Deployment is automated (GitOps or CI/CD)
- [ ] Rollback procedure documented and tested
- [ ] Secrets managed via platform secret manager (not in code/image)
- [ ] Monitoring covers four golden signals
- [ ] Alerts are actionable with runbook links
- [ ] Graceful shutdown handles SIGTERM
- [ ] Database migrations are backward-compatible
- [ ] Cost alerts configured at budget thresholds
- [ ] IaC changes reviewed in PR with plan/preview output
