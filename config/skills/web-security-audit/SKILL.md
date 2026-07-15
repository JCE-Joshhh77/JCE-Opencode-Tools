---
name: web-security-audit
description: Framework-agnostic website security audit and authorized pentest methodology (OWASP, red-team attacker mindset, white-hat reporting). Use for web pentest, vulnerability assessment, attack-surface review, bug bounty prep, or security audit of any web stack.
---

# Skill: Web Security Audit & Authorized Pentest

Professional dual-lens: **white-hat process** (scope, evidence, fix) + **attacker mindset** (how a skilled adversary chains issues).  
**Authorized targets only.** No illegal access, no unauthorized systems.

---

## Hard Gate (before any probe)

1. Confirm **written authorization** (scope letter / bug-bounty program / owner request).
2. Record: target URLs, environments (prod/stage), out-of-scope assets, rate limits, test windows, data-handling rules.
3. If authorization missing or target is third-party without program → **stop**. Ask for scope proof. Do not scan/attack.
4. Prefer **non-destructive** checks first. Destructive/DoS/brute only if explicitly in scope.
5. Never dump real secrets into chat/logs. Redact tokens/PII in reports.

---

## Auto-Detect

Trigger when task mentions:
- web pentest, penetration test, vulnerability assessment, security audit (website/app)
- OWASP, attack surface, red team, bug bounty, threat model (web)
- XSS, SQLi, SSRF, IDOR, CSRF, auth bypass, open redirect, RCE, LFI/RFI
- headers/CSP/CORS hardening, cookie flags, session fixation
- any stack: Next/React/Vue/Angular, Laravel/Django/Rails/Express/Nest, PHP, WordPress, SPA+API, BFF

Prefer this skill over generic `security` when the work is **website/web-app audit or pentest**, not app-code hardening alone.

---

## Dual Lens

| Lens | Goal | Output |
|------|------|--------|
| **White hat** | Prove risk safely, prioritize fix, give remediations | Severity, PoC steps in-scope, fix, retest criteria |
| **Attacker mindset** | Chain weak findings into impact | Abuse path, preconditions, blast radius, privilege path |

Attacker mindset ≠ crime. It means: think like adversary **inside authorized scope**.

---

## Phase 0 — Scope & Rules of Engagement

```
Scope checklist:
[ ] In-scope hosts/paths/APIs/mobile backends
[ ] Out-of-scope (3rd-party, payment, prod DB, other customers)
[ ] Auth levels available (anon / user / admin / multi-tenant)
[ ] Allowed techniques (active scan, auth testing, upload, brute?)
[ ] Rate limits & contact for emergencies
[ ] Data rules (no PII exfil, no real card tests)
```

If multi-tenant: treat **horizontal privilege** as first-class risk.

---

## Phase 1 — Recon & Attack Surface Map

Framework-agnostic. Map **what attacker can reach**, not folder names.

1. **Entry points**: public pages, APIs, GraphQL, WebSocket, webhooks, file upload, OAuth callbacks, admin, SSO, password reset, invite links, deep links.
2. **Trust boundaries**: browser ↔ edge ↔ app ↔ workers ↔ DB ↔ object storage ↔ 3rd-party.
3. **Identity surfaces**: login, register, MFA, magic link, session cookie/JWT, API keys, service accounts.
4. **Data classification**: PII, secrets, payment, multi-tenant IDs, internal admin.
5. **Tech fingerprint** (passive first): headers, cookies, JS bundles, error shapes, known CMS/frameworks — only to prioritize checks.

Deliverable:

```
## Attack Surface
- Hosts:
- Auth models:
- Critical assets:
- High-risk endpoints:
- Third parties:
```

---

## Phase 2 — Baseline Hardening (cheap, high signal)

Check before deep exploit hunting:

| Area | Look for |
|------|----------|
| Transport | HTTPS only, HSTS, mixed content |
| Cookies | `Secure`, `HttpOnly`, `SameSite`, scope/path |
| Headers | CSP, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, Referrer-Policy, Permissions-Policy |
| CORS | Reflect origin + credentials, `*`, null origin |
| Caching | private data in shared cache, CDN auth gaps |
| Errors | stack traces, SQL fragments, internal hosts in responses |
| Secrets | keys in frontend, source maps, public env files, git history, CI artifacts |
| Dependencies | known CVEs in runtime deps (lockfile / SCA) |

---

## Phase 3 — OWASP-aligned Deep Checks (any framework)

Work by **class of bug**, map to stack later.

### A. Access control
- IDOR / BOLA on object IDs
- Broken function-level auth (user → admin)
- Multi-tenant isolation (org A reads org B)
- Forced browsing to hidden admin/API routes
- Mass assignment / over-posting

### B. Auth & session
- Password reset / magic-link token entropy & reuse
- Session fixation, logout invalidation
- JWT: `none` alg, weak secret, missing `exp`/`aud`, algorithm confusion
- MFA bypass paths, backup codes, rate-limit on OTP
- OAuth/OIDC: redirect_uri open redirect, state CSRF, PKCE missing on public clients

### C. Injection
- SQL/NoSQL/ORM raw queries
- Command injection on shell/exec paths
- Template / SSTI
- LDAP/XML/XPath if present
- Header/log injection where logs drive automation

### D. XSS & client trust
- Reflected / stored / DOM XSS
- Unsafe `dangerouslySetInnerHTML` / `v-html` / `| raw` / unescaped templates
- CSP bypass via CDNs, JSONP, `unsafe-inline`
- PostMessage origin checks
- Redirector abuse → phishing / session cookie theft

### E. SSRF & server-side request
- URL fetchers, webhooks, preview generators, PDF/image processors
- Cloud metadata (`169.254.169.254`), internal admin ports
- DNS rebinding / redirect follow abuse

### F. Files & content
- Upload: content-type spoof, path traversal, executable/SVG XSS, zip slip
- Download: path traversal, signed URL over-permission
- Static hosting misconfig (directory listing, backup files)

### G. Business logic
- Race conditions (double spend, coupon reuse)
- Price/quantity tampering
- Workflow skip (pay without confirm)
- Rate limits missing on costly actions

### H. API-specific
- GraphQL: introspection, batching abuse, nested query DoS (if in scope)
- REST: verb tampering, content-type confusion
- Pagination/filter injection, bulk export of PII
- WebSocket auth on upgrade + message auth

### I. Supply chain / config
- Debug mode in prod, verbose GraphiQL
- Default creds, exposed actuator/metrics/admin
- Subdomain takeover, dangling DNS
- Misconfigured S3/GCS public buckets linked from app

---

## Phase 4 — Framework Adapter (quick map)

Use only as **priority hints**, not exclusive checklist.

| Stack signals | Extra focus |
|---------------|-------------|
| Next.js / SSR | RSC/data leaks, server actions auth, open redirects, middleware auth gaps |
| SPA + API | Token storage (localStorage XSS), CORS, CSRF on cookie sessions |
| Laravel | Mass assignment, Blade XSS, signed URLs, policy gaps |
| Django/DRF | CSRF middleware off, queryset scoping, debug toolbar |
| Rails | Strong params gaps, SSRF in ActiveStorage, CSRF |
| Express/Nest | Missing global validation pipes, prototype pollution, raw SQL |
| PHP/WordPress | Plugin CVEs, file include, privileged AJAX, upload |
| GraphQL | Auth on field resolvers, IDOR via global IDs |
| Mobile BFF | Device trust assumptions, certificate pinning bypass is out unless in scope |

---

## Phase 5 — Safe Verification Rules

- Prefer **read-only** or self-account PoCs.
- Use **own test accounts / own tenant data**.
- Cap rate; no resource exhaustion unless authorized.
- For injection: prove with benign markers (`1 OR 1=1` style only when safe; prefer parameterized negative tests + code review).
- For XSS: self-alerting payload on test page; do not phish real users.
- Stop at **proof of impact** — no lateral movement outside scope.
- Capture evidence: request/response snippets (redacted), timestamps, account used, steps.

**Code audit mode** (when repo available): trace trust boundaries in code first; runtime confirm only high-risk paths.  
**Black-box mode** (no code): surface map → baseline → auth/IDOR → injection → logic.

---

## Severity Model (report consistently)

| Severity | Rule of thumb |
|----------|----------------|
| Critical | RCE, auth bypass to admin, full tenant data access, secret key leak usable now |
| High | IDOR of sensitive data, stored XSS on privileged users, SSRF to internal metadata |
| Medium | CSRF state-changing, weak session flags, limited info disclosure |
| Low | Missing headers, verbose errors without direct abuse path |
| Info | Hardening suggestions, defense-in-depth |

Always state: **impact**, **likelihood**, **preconditions**, **exploitability**.

---

## Output Contract (always)

```markdown
## Engagement
- Target:
- Auth level tested:
- Scope / constraints:
- Method: white-box | gray-box | black-box
- Date / tester:

## Attack Surface Summary
...

## Findings (severity DESC)
### [C/H/M/L/I]-NN Title
- **Severity:**
- **Asset / endpoint:**
- **CWE / OWASP:**
- **Description:**
- **Attacker path (abuse chain):**
- **Evidence (redacted):**
- **Reproduction steps:**
- **Business impact:**
- **Remediation:**
- **Retest criteria:**
- **Status:** open | fixed | accepted risk

## Positive Controls Observed
...

## Residual Risk / Out of Scope
...

## Retest Plan
...
```

Findings first. No fluff. Separate **confirmed** vs **suspected**.

---

## Remediation Patterns (prefer these)

- AuthZ check **server-side** on every object (`resource.owner == actor` / policy).
- Parameterized queries / ORM; never string-build SQL.
- Output encode by context; CSP as defense-in-depth.
- Cookie session + CSRF for browser apps; careful CORS.
- SSRF: allowlist schemes/hosts; block link-local/metadata; no raw user URL fetch.
- Uploads: random storage keys, MIME sniff, size limits, no exec path.
- Secrets: vault/env; never in client bundles; rotate on leak.
- Rate-limit auth and costly endpoints; lockout/backoff.

---

## Anti-Patterns (skill behavior)

- Do **not** help attack systems without authorization.
- Do **not** provide weaponized malware, mass exploit kits, or credential stuffing lists for abuse.
- Do **not** pull real production data "to prove" impact — use minimal proof.
- Do **not** claim "secure" after scan alone — state residual risk.
- Do **not** mix speculative CVEs with confirmed findings without labels.

---

## Quick Decision Tree

```
Authorized?
├── No → stop, request RoE/scope
└── Yes
    ├── Have source? → white/gray-box: map trust boundaries in code + targeted runtime
    └── No source? → black-box: surface map → baseline → access control → auth → injection → logic
Then: severity-rank → remediate guidance → retest criteria
```

---

## Verification Evidence

When remediating in-repo:
- Add/adjust tests for the vuln class (authz, validation).
- Re-run relevant suite + any security linters project already uses (`npm audit`, Semgrep, etc.).
- Report commands + results; never claim fixed without retest notes.
