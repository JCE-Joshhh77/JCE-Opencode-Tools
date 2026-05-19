---
name: platform-engineering
description: Kubernetes, Helm, ArgoCD, GitOps, Terraform, Pulumi, service mesh. Use when working on platform-engineering tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Platform Engineering

## Auto-Detect

Trigger this skill when:
- Task mentions: Kubernetes, k8s, Helm, ArgoCD, Flux, Terraform, Pulumi, Backstage, Crossplane
- Files: `*.tf`, `Pulumi.*`, `helmfile.yaml`, `Chart.yaml`, `kustomization.yaml`
- Patterns: internal developer platform, golden paths, GitOps, service mesh
- `package.json` contains: `@pulumi/*`, `cdk8s`

---

## Decision Tree: Platform Approach

```
What level of platform do you need?
├── Just deploy apps to k8s?
│   └── GitOps (ArgoCD/Flux) + Helm/Kustomize
├── Self-service infrastructure for dev teams?
│   └── Crossplane (k8s-native) or Terraform modules + automation
├── Developer portal + service catalog?
│   └── Backstage (catalog, templates, TechDocs, plugins)
├── Policy enforcement across clusters?
│   └── Kyverno (k8s-native YAML) or OPA/Gatekeeper (Rego)
└── Full internal developer platform (IDP)?
    └── Backstage + Crossplane + ArgoCD + Kyverno (the stack)
```

## Decision Tree: GitOps Tool

```
├── Simple, single cluster, Helm-heavy? → ArgoCD (UI, app-of-apps)
├── Multi-cluster, want pull-based? → Flux (lightweight, composable)
├── Need progressive delivery (canary/blue-green)? → Argo Rollouts + ArgoCD
├── Want image automation (auto-update on push)? → Flux Image Automation
└── Enterprise, need approval gates? → ArgoCD + ApplicationSets + notifications
```

---

## Backstage: Internal Developer Portal

```yaml
# catalog-info.yaml — register a service in Backstage
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: order-service
  description: Handles order lifecycle
  annotations:
    github.com/project-slug: myorg/order-service
    backstage.io/techdocs-ref: dir:.
    argocd/app-name: order-service-production
    prometheus.io/alert: order-service
  tags: [typescript, grpc, production]
  links:
    - url: https://grafana.internal/d/order-service
      title: Dashboard
spec:
  type: service
  lifecycle: production
  owner: team-commerce
  system: commerce-platform
  providesApis: [order-api]
  dependsOn:
    - component:payment-service
    - resource:orders-database
```

### Golden Path Templates

```yaml
# Backstage scaffolder template — standardized service creation
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: typescript-service
  title: TypeScript Microservice
  description: Production-ready service with CI/CD, observability, and GitOps
spec:
  owner: platform-team
  type: service
  parameters:
    - title: Service Info
      properties:
        name:
          type: string
          pattern: '^[a-z][a-z0-9-]*$'
        description:
          type: string
        owner:
          type: string
          ui:field: OwnerPicker
    - title: Infrastructure
      properties:
        database:
          type: string
          enum: [none, postgres, redis]
        queue:
          type: string
          enum: [none, kafka, rabbitmq]
  steps:
    - id: template
      action: fetch:template
      input:
        url: ./skeleton
        values:
          name: ${{ parameters.name }}
          owner: ${{ parameters.owner }}
    - id: publish
      action: publish:github
      input:
        repoUrl: github.com?owner=myorg&repo=${{ parameters.name }}
    - id: register
      action: catalog:register
      input:
        repoContentsUrl: ${{ steps.publish.output.repoContentsUrl }}
        catalogInfoPath: /catalog-info.yaml
    - id: argocd
      action: argocd:create-app
      input:
        appName: ${{ parameters.name }}
        repoUrl: ${{ steps.publish.output.remoteUrl }}
```

---

## Crossplane: Kubernetes-Native Infrastructure

```yaml
# Composite Resource Definition — abstract cloud resources
apiVersion: apiextensions.crossplane.io/v1
kind: CompositeResourceDefinition
metadata:
  name: xdatabases.platform.example.com
spec:
  group: platform.example.com
  names:
    kind: XDatabase
    plural: xdatabases
  versions:
    - name: v1alpha1
      served: true
      referenceable: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                size:
                  type: string
                  enum: [small, medium, large]
                engine:
                  type: string
                  enum: [postgres, mysql]
              required: [size, engine]
---
# Composition — maps abstract to concrete cloud resources
apiVersion: apiextensions.crossplane.io/v1
kind: Composition
metadata:
  name: xdatabase-aws
spec:
  compositeTypeRef:
    apiVersion: platform.example.com/v1alpha1
    kind: XDatabase
  resources:
    - name: rds-instance
      base:
        apiVersion: rds.aws.upbound.io/v1beta1
        kind: Instance
        spec:
          forProvider:
            engine: postgres
            instanceClass: db.t3.medium
            allocatedStorage: 20
            publiclyAccessible: false
      patches:
        - fromFieldPath: spec.size
          toFieldPath: spec.forProvider.instanceClass
          transforms:
            - type: map
              map:
                small: db.t3.small
                medium: db.t3.medium
                large: db.r6g.large
```

---

## Kyverno: Policy Enforcement

```yaml
# Require resource limits on all containers
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-resource-limits
spec:
  validationFailureAction: Enforce
  rules:
    - name: check-limits
      match:
        any:
          - resources:
              kinds: [Pod]
      validate:
        message: "All containers must have CPU and memory limits"
        pattern:
          spec:
            containers:
              - resources:
                  limits:
                    memory: "?*"
                    cpu: "?*"
---
# Auto-inject labels for all deployments
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: add-default-labels
spec:
  rules:
    - name: add-team-label
      match:
        any:
          - resources:
              kinds: [Deployment, StatefulSet]
      mutate:
        patchStrategicMerge:
          metadata:
            labels:
              platform.example.com/managed-by: "argocd"
---
# Block latest tag in production
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: disallow-latest-tag
spec:
  validationFailureAction: Enforce
  rules:
    - name: check-image-tag
      match:
        any:
          - resources:
              kinds: [Pod]
              namespaces: [production, staging]
      validate:
        message: "Images must use a specific tag, not :latest"
        pattern:
          spec:
            containers:
              - image: "!*:latest"
```

---

## GitOps with ArgoCD + ApplicationSets

```yaml
# ApplicationSet — generate apps from git directory structure
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: cluster-apps
  namespace: argocd
spec:
  generators:
    - git:
        repoURL: https://github.com/myorg/k8s-manifests.git
        revision: main
        directories:
          - path: apps/*/overlays/production
  template:
    metadata:
      name: '{{path[1]}}'
    spec:
      project: production
      source:
        repoURL: https://github.com/myorg/k8s-manifests.git
        targetRevision: main
        path: '{{path}}'
      destination:
        server: https://kubernetes.default.svc
        namespace: production
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
```

### GitOps Repository Layout

```
k8s-manifests/
├── apps/
│   ├── order-service/
│   │   ├── base/                    # Shared manifests
│   │   │   ├── deployment.yaml
│   │   │   ├── service.yaml
│   │   │   └── kustomization.yaml
│   │   └── overlays/
│   │       ├── dev/                 # Dev-specific patches
│   │       ├── staging/
│   │       └── production/
│   └── payment-service/
├── infrastructure/                   # Cluster-wide tooling
│   ├── cert-manager/
│   ├── kyverno/
│   ├── external-secrets/
│   └── prometheus-stack/
└── platform/                         # Crossplane XRDs + Compositions
    ├── compositions/
    └── xrds/
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| ClickOps (manual console changes) | Drift, no audit trail, not reproducible | Everything as code, GitOps reconciliation |
| No resource limits in production | Noisy neighbor, OOM kills, cluster instability | Kyverno policy to enforce limits |
| Snowflake clusters per environment | "Works on my cluster" syndrome | Same IaC, only config/secrets differ per env |
| Golden paths without escape hatches | Teams blocked when template doesn't fit | Allow overrides with review, don't force 100% |
| Platform team as bottleneck | Tickets for every infra change | Self-service via Crossplane claims + Backstage |
| No PodDisruptionBudget | Voluntary disruptions kill availability | PDB on every production workload |
| Secrets in git (even encrypted) | One leak exposes everything | External Secrets Operator + Vault/cloud SM |
| Helm values sprawl (500+ lines) | Nobody understands the config | Kustomize overlays or Crossplane abstractions |

---

## Verification Checklist

- [ ] All production workloads have resource requests AND limits
- [ ] PodDisruptionBudgets set for every stateless service (minAvailable >= 2)
- [ ] GitOps reconciliation enabled (selfHeal + prune)
- [ ] Kyverno/OPA policies enforce: no latest tag, resource limits, labels
- [ ] Secrets managed via External Secrets Operator (not in git)
- [ ] Health probes (liveness + readiness + startup) on all containers
- [ ] HPA configured with appropriate metrics (not just CPU)
- [ ] Topology spread constraints prevent single-zone failures
- [ ] Backstage catalog entries exist for all production services
- [ ] Golden path templates tested end-to-end (scaffold → deploy → observe)
