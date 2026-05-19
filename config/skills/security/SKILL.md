---
name: security
description: Auth, input validation, secrets, vulnerabilities, CORS/CSP. Use when working on security tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Security Advanced
# Loaded on-demand when task involves auth, input validation, secrets, vulnerabilities, CORS, CSP, or security review

## Auto-Detect

Trigger this skill when:
- Files: `auth.ts`, `middleware.ts`, `*.guard.ts`, `cors.ts`, `helmet.*`
- `package.json` contains: `bcrypt`, `jsonwebtoken`, `passport`, `helmet`, `cors`, `express-rate-limit`
- Code patterns: `jwt.sign`, `jwt.verify`, `hash`, `encrypt`, `sanitize`, `csrf`
- Task mentions: security audit, penetration test, vulnerability, hardening, OWASP

---

## Decision Tree: Authentication Strategy

```
What type of application?
├── Consumer-facing web app (2026)?
│   └── Passkeys (WebAuthn) as primary — passwords as fallback
│       └── Store public key credential, verify assertion server-side
├── SPA + API (same domain)?
│   └── HTTP-only secure cookies with session ID
│       └── Store session in Redis/DB, not memory
├── SPA + API (cross-domain)?
│   └── OAuth2 Authorization Code + PKCE
│       └── Access token in memory, refresh via HTTP-only cookie
├── Mobile app?
│   └── OAuth2 + PKCE with secure storage (Keychain/Keystore)
├── Server-to-server?
│   └── mTLS or API keys with automatic rotation
├── Third-party integrations?
│   └── OAuth2 with scoped permissions + token exchange
└── Microservices internal?
    └── Short-lived JWT (< 5 min) + service mesh mTLS
```

## Decision Tree: Secrets Management

```
Where do secrets live?
├── Local development?
│   └── .env files (NEVER committed) + .env.example as template
├── CI/CD pipelines?
│   └── Platform secrets (GitHub Secrets, GitLab CI vars) — masked in logs
├── Production (small team)?
│   └── SOPS (encrypted in git) or Doppler/Infisical (SaaS)
├── Production (enterprise)?
│   └── HashiCorp Vault or AWS Secrets Manager
│       ├── Dynamic secrets (DB creds generated on-demand, auto-expire)
│       ├── Automatic rotation (90 days max, 30 days preferred)
│       └── Audit log for every secret access
└── Kubernetes?
    └── External Secrets Operator → syncs from Vault/AWS to K8s Secrets
```

---

## Passkeys (WebAuthn) — Modern Auth (2026)

```typescript
// Registration — server generates challenge, client creates credential
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';

async function startRegistration(user: User) {
  const options = await generateRegistrationOptions({
    rpName: 'My App',
    rpID: 'example.com',
    userID: user.id,
    userName: user.email,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });
  await redis.setex(`webauthn:reg:${user.id}`, 300, JSON.stringify(options));
  return options;
}

// Authentication — passwordless login
import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';

async function startAuthentication() {
  return generateAuthenticationOptions({
    rpID: 'example.com',
    userVerification: 'preferred',
  });
}
```

---

## Supply Chain Security

```
Supply chain attack vectors:
├── Dependency confusion (private package name squatting on public registry)
│   └── Fix: .npmrc with registry scoping, package-lock.json integrity
├── Typosquatting (lodas instead of lodash)
│   └── Fix: lockfile-lint, Socket.dev in CI
├── Compromised maintainer (event-stream incident)
│   └── Fix: pin exact versions, audit new deps, use lockfiles
├── Build pipeline injection (malicious GitHub Action)
│   └── Fix: pin actions to SHA, not tags. Verify provenance.
└── Malicious post-install scripts
    └── Fix: --ignore-scripts for untrusted packages, audit scripts
```

```jsonc
// package.json — supply chain hardening
{
  "overrides": {}, // force specific versions of transitive deps
  "scripts": {
    "preinstall": "npx only-allow pnpm", // enforce package manager
    "audit": "npm audit --audit-level=moderate && npx socket-security/cli scan"
  }
}
```

### SBOM (Software Bill of Materials)

```bash
# Generate SBOM in CycloneDX format (required for compliance)
npx @cyclonedx/cyclonedx-npm --output-file sbom.json --spec-version 1.5
# Or with Syft (language-agnostic)
syft . -o cyclonedx-json > sbom.json
# Scan SBOM for known vulnerabilities
grype sbom:sbom.json --fail-on high
```

---

## Container Security

```dockerfile
# ✅ Secure Dockerfile patterns
FROM node:22-alpine AS builder
# ... build steps ...

FROM gcr.io/distroless/nodejs22-debian12 AS runtime
# Distroless: no shell, no package manager, minimal attack surface
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/node_modules /app/node_modules
USER nonroot:nonroot
CMD ["dist/index.js"]
```

```yaml
# CI container scanning
- name: Scan image with Trivy
  run: |
    trivy image --severity HIGH,CRITICAL --exit-code 1 \
      --ignore-unfixed myapp:${{ github.sha }}

# Runtime security policies (Kubernetes)
apiVersion: v1
kind: Pod
spec:
  securityContext:
    runAsNonRoot: true
    readOnlyRootFilesystem: true
    allowPrivilegeEscalation: false
    seccompProfile: { type: RuntimeDefault }
  containers:
    - name: app
      securityContext:
        capabilities: { drop: [ALL] }
```

---

## Input Validation & Injection Prevention

```typescript
import { z } from 'zod';

// Validate ALL external input at the boundary
const CreateUserInput = z.object({
  email: z.string().email().max(254).toLowerCase(),
  name: z.string().min(1).max(100).trim(),
  password: z.string().min(12).regex(/[A-Z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/),
});

// SQL Injection — ALWAYS parameterize
// ❌ `SELECT * FROM users WHERE id = '${userId}'`
// ✅ db.query('SELECT * FROM users WHERE id = $1', [userId])
// ✅ prisma.user.findUnique({ where: { id: userId } })

// XSS — Content Security Policy is the strongest defense
const csp = [
  "default-src 'self'",
  "script-src 'self' 'nonce-{RANDOM}'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join('; ');
```

---

## CORS Configuration

```typescript
import cors from 'cors';

// ✅ Production — explicit origins only
app.use(cors({
  origin: (origin, callback) => {
    const allowed = ['https://app.example.com', 'https://admin.example.com'];
    if (!origin || allowed.includes(origin)) callback(null, true);
    else callback(new Error('CORS blocked'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
}));

// ❌ NEVER: cors({ origin: '*' }) with credentials
// ❌ NEVER: cors({ origin: /.*\.example\.com/ }) — regex bypass risk
```

---

## Rate Limiting & API Security

```typescript
import rateLimit from 'express-rate-limit';

// Tiered rate limiting
app.use(rateLimit({ windowMs: 60_000, max: 100 })); // Global: 100/min

app.use('/api/auth', rateLimit({
  windowMs: 15 * 60_000, max: 5,  // Auth: 5 attempts per 15 min
  keyGenerator: (req) => `${req.ip}:${req.body?.email}`,
  standardHeaders: true,
}));

app.use('/api/ai', rateLimit({
  windowMs: 60_000, max: 10,  // Expensive endpoints: 10/min
  keyGenerator: (req) => req.user?.id || req.ip,
}));
```

---

## Secrets Management with SOPS

```yaml
# .sops.yaml — encryption rules
creation_rules:
  - path_regex: secrets/.*\.enc\.yaml$
    age: age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p
    # Or KMS: kms: arn:aws:kms:us-east-1:123:key/abc-123

# Encrypt: sops --encrypt secrets/prod.yaml > secrets/prod.enc.yaml
# Decrypt at deploy: sops --decrypt secrets/prod.enc.yaml | kubectl apply -f -
# Edit in-place: sops secrets/prod.enc.yaml
```

---

## Security Headers

```typescript
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: { directives: { /* see CSP above */ } },
  strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  frameguard: { action: 'deny' },
}));

app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
```

---

## OWASP Top 10 (2025 Update)

| # | Risk | Prevention |
|---|------|-----------|
| 1 | Broken Access Control | Deny by default, resource-level checks, RBAC |
| 2 | Cryptographic Failures | AES-256-GCM, TLS 1.3, no MD5/SHA1 for security |
| 3 | Injection | Parameterized queries, ORM, input validation |
| 4 | Insecure Design | Threat modeling, abuse cases, rate limiting |
| 5 | Security Misconfiguration | Automated scanning, minimal permissions, no defaults |
| 6 | Vulnerable Components | SBOM, Snyk/Socket in CI, pin versions |
| 7 | Auth Failures | Passkeys, MFA, brute-force protection |
| 8 | Data Integrity Failures | Signed commits, artifact verification, SLSA |
| 9 | Logging Failures | Structured logs, SIEM, auth event monitoring |
| 10 | SSRF | Allowlist domains, block RFC1918 IPs, validate URLs |

---

## Anti-Patterns

| ❌ Don't | ✅ Do Instead |
|----------|---------------|
| Store JWT in localStorage | HTTP-only secure cookie or memory |
| `cors({ origin: '*' })` with credentials | Explicit origin allowlist |
| MD5/SHA1 for passwords | argon2id (preferred) or bcrypt (cost ≥ 12) |
| Roll your own crypto | libsodium, Web Crypto API, established libraries |
| Trust client-side validation alone | Always validate server-side |
| Hardcode secrets in code | SOPS, Vault, or platform secret manager |
| `npm install` without lockfile | `npm ci` with integrity checks |
| Skip container scanning | Trivy/Grype in CI, fail on HIGH+ |
| Single long-lived API key | Short-lived tokens + automatic rotation |
| Passwords only (no MFA) | Passkeys primary, TOTP as fallback |

---

## Verification Checklist

- [ ] All inputs validated with schema (Zod) at API boundary
- [ ] SQL queries parameterized — zero string concatenation
- [ ] Auth checks on every protected endpoint (middleware)
- [ ] Passwords hashed with argon2id or bcrypt (cost ≥ 12)
- [ ] CORS configured with explicit origins (no wildcards)
- [ ] Security headers set (CSP, HSTS, X-Frame-Options)
- [ ] Secrets in env vars or secret manager — `.env` in `.gitignore`
- [ ] Rate limiting on auth and expensive endpoints
- [ ] Dependencies audited (npm audit + Socket/Snyk in CI)
- [ ] Container images scanned (Trivy) and run as non-root
- [ ] SBOM generated for compliance
- [ ] No sensitive data in JWT payload or logs
