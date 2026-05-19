---
name: auth-identity
description: OAuth2, OIDC, JWT, RBAC/ABAC, MFA, zero-trust, secrets rotation. Use when working on auth-identity tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Auth & Identity

## Auto-Detect

Trigger this skill when:
- Task mentions: OAuth, OIDC, JWT, authentication, authorization, RBAC, ABAC, MFA, SSO, passkeys
- Files: `auth/`, `middleware/auth.*`, `*.guard.ts`, `policies/`
- Patterns: login flow, token refresh, permission check, role management, WebAuthn
- `package.json` contains: `passport`, `next-auth`, `@auth/*`, `jose`, `@simplewebauthn/*`

---

## Decision Tree: Auth Architecture

```
What type of application?
├── Server-rendered web app (Next.js, Rails, Laravel)?
│   └── Session-based auth (httpOnly cookies, server-side session store)
├── SPA + API (React/Vue + separate backend)?
│   ├── Same domain? → httpOnly cookie with CSRF token
│   └── Cross-domain? → OAuth2 Authorization Code + PKCE
├── Mobile app?
│   └── OAuth2 Authorization Code + PKCE (no client secret)
├── Machine-to-machine (service accounts)?
│   └── OAuth2 Client Credentials + mTLS (DPoP for extra binding)
├── Third-party integrations?
│   └── OAuth2 Authorization Code (standard)
└── Microservices internal?
    └── mTLS + JWT propagation (service mesh handles mTLS)
```

## Decision Tree: RBAC vs ABAC

```
How complex are your access rules?
├── Simple role hierarchy (admin > editor > viewer)?
│   └── RBAC — roles with permission sets
│       └── Pro: Simple, auditable, easy to understand
├── Need resource ownership checks (user can edit THEIR posts)?
│   └── RBAC + ownership condition (hybrid)
│       └── Check role permission AND resource.ownerId === user.id
├── Rules depend on context (time, location, department, risk)?
│   └── ABAC — attribute-based policies
│       └── Pro: Fine-grained, dynamic, context-aware
│       └── Con: Complex to audit, harder to reason about
├── Multi-tenant with per-tenant roles?
│   └── RBAC scoped to tenant (tenant_id + role)
└── Regulatory requirements (HIPAA, SOX)?
    └── ABAC with mandatory access controls + audit logging
```

---

## Passkeys / WebAuthn

```typescript
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

const rpName = 'My App';
const rpID = 'example.com';
const origin = 'https://example.com';

class PasskeyService {
  // Registration: create a new passkey
  async startRegistration(user: User): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const existingKeys = await this.db.credentials.findMany({ where: { userId: user.id } });

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new TextEncoder().encode(user.id),
      userName: user.email,
      userDisplayName: user.name,
      excludeCredentials: existingKeys.map((k) => ({
        id: k.credentialId,
        transports: k.transports,
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    // Store challenge for verification
    await this.cache.set(`webauthn:${user.id}:challenge`, options.challenge, 300);
    return options;
  }

  async finishRegistration(user: User, response: RegistrationResponseJSON): Promise<void> {
    const expectedChallenge = await this.cache.get(`webauthn:${user.id}:challenge`);

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new AuthError('Registration verification failed');
    }

    const { credential } = verification.registrationInfo;
    await this.db.credentials.create({
      data: {
        userId: user.id,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: response.response.transports,
      },
    });
  }

  // Authentication: verify a passkey
  async startAuthentication(email?: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const allowCredentials = email
      ? (await this.db.credentials.findMany({
          where: { user: { email } },
        })).map((k) => ({ id: k.credentialId, transports: k.transports }))
      : []; // Empty = discoverable credential (passkey)

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials,
      userVerification: 'preferred',
    });

    await this.cache.set(`webauthn:auth:${options.challenge}`, 'pending', 300);
    return options;
  }

  async finishAuthentication(response: AuthenticationResponseJSON): Promise<User> {
    const credential = await this.db.credentials.findUnique({
      where: { credentialId: response.id },
      include: { user: true },
    });
    if (!credential) throw new AuthError('Unknown credential');

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: response.clientDataJSON, // Retrieved from cache in real impl
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credential.credentialId,
        publicKey: credential.publicKey,
        counter: credential.counter,
      },
    });

    if (!verification.verified) throw new AuthError('Authentication failed');

    // Update counter (replay protection)
    await this.db.credentials.update({
      where: { id: credential.id },
      data: { counter: verification.authenticationInfo.newCounter },
    });

    return credential.user;
  }
}
```

---

## OAuth 2.1 + DPoP Tokens

```typescript
// DPoP (Demonstrating Proof-of-Possession) — binds token to client key pair
// Prevents token theft: stolen token is useless without the private key

import { SignJWT, importJWK, generateKeyPair } from 'jose';

class DPoPClient {
  private privateKey: CryptoKey;
  private publicJwk: JsonWebKey;

  async init(): Promise<void> {
    const { privateKey, publicKey } = await generateKeyPair('ES256');
    this.privateKey = privateKey;
    this.publicJwk = await exportJWK(publicKey);
  }

  // Create DPoP proof for each request
  async createProof(method: string, url: string, accessToken?: string): Promise<string> {
    const builder = new SignJWT({
      htm: method,           // HTTP method
      htu: url,              // HTTP URL
      iat: Math.floor(Date.now() / 1000),
      jti: crypto.randomUUID(),
      ...(accessToken && { ath: await this.hashToken(accessToken) }), // Token binding
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: this.publicJwk })
      .setIssuedAt()
      .setExpirationTime('5m');

    return builder.sign(this.privateKey);
  }

  // Token request with DPoP
  async requestToken(code: string): Promise<TokenResponse> {
    const tokenUrl = 'https://auth.example.com/token';
    const dpopProof = await this.createProof('POST', tokenUrl);

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'DPoP': dpopProof,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: this.clientId,
        code_verifier: this.codeVerifier,
      }),
    });

    return res.json(); // Returns token_type: 'DPoP' (not 'Bearer')
  }

  // API call with DPoP-bound access token
  async apiCall(method: string, url: string, accessToken: string): Promise<Response> {
    const dpopProof = await this.createProof(method, url, accessToken);
    return fetch(url, {
      method,
      headers: {
        'Authorization': `DPoP ${accessToken}`,
        'DPoP': dpopProof,
      },
    });
  }
}
```

---

## Session Management

```typescript
const sessionConfig = {
  name: '__Host-session',       // __Host- prefix enforces secure + same-origin
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,   // 'strict' for sensitive apps
    maxAge: 3600_000,           // 1 hour
    path: '/',
  },
  store: new RedisStore({
    client: redisClient,
    prefix: 'sess:',
    ttl: 3600,
  }),
  rolling: true,                // Reset expiry on activity
};

// Session fixation prevention
app.post('/login', async (req, res) => {
  const user = await authenticate(req.body);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  // CRITICAL: regenerate session ID after authentication
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.userId = user.id;
    req.session.createdAt = Date.now();
    req.session.ip = req.ip;
    res.json({ success: true });
  });
});

// Absolute session timeout (even with activity)
function enforceAbsoluteTimeout(req, res, next) {
  if (req.session.createdAt && Date.now() - req.session.createdAt > 8 * 3600_000) {
    req.session.destroy(() => res.status(401).json({ error: 'Session expired' }));
    return;
  }
  next();
}
```

---

## RBAC with Conditions (Hybrid RBAC/ABAC)

```typescript
interface Permission {
  resource: string;
  actions: ('create' | 'read' | 'update' | 'delete' | 'manage')[];
  conditions?: { type: 'ownership' | 'department' | 'time'; value?: string }[];
}

class AuthzService {
  can(user: User, action: string, resource: string, context?: Record<string, unknown>): boolean {
    const permissions = this.resolvePermissions(user.roles);

    return permissions.some((p) => {
      if (p.resource !== resource && p.resource !== '*') return false;
      if (!p.actions.includes(action as any) && !p.actions.includes('manage')) return false;
      if (!p.conditions) return true;

      return p.conditions.every((c) => {
        switch (c.type) {
          case 'ownership': return context?.ownerId === user.id;
          case 'department': return user.department === c.value;
          case 'time': return this.isWithinSchedule(c.value!);
          default: return false;
        }
      });
    });
  }

  private resolvePermissions(roles: string[]): Permission[] {
    return roles.flatMap((role) => {
      const def = this.roleDefinitions.get(role);
      if (!def) return [];
      const inherited = def.inherits?.flatMap((r) => this.resolvePermissions([r])) ?? [];
      return [...inherited, ...def.permissions];
    });
  }
}

// Middleware
function authorize(resource: string, action: string) {
  return (req, res, next) => {
    const context = { ownerId: req.params.userId ?? req.body?.userId };
    if (!authz.can(req.user, action, resource, context)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| JWT as long-lived session | Can't revoke, grows stale | Short-lived JWT (15m) + refresh token rotation |
| Storing JWT in localStorage | XSS can steal tokens | httpOnly cookie or in-memory only |
| Symmetric JWT across services | Every service can forge tokens | Asymmetric (ES256), only auth service signs |
| No DPoP/mTLS for sensitive APIs | Stolen token = full access | Bind tokens to client key (DPoP) |
| Password-only auth in 2025 | Phishing, credential stuffing | Passkeys as primary, password as fallback |
| No refresh token rotation | Stolen refresh token = permanent access | Rotate on use, detect reuse (revoke family) |
| Role checks scattered in handlers | Inconsistent, easy to miss | Centralized middleware + declarative policies |
| No rate limit on auth endpoints | Brute force, credential stuffing | Rate limit + lockout + CAPTCHA after N failures |

---

## Verification Checklist

- [ ] Passkeys/WebAuthn offered as primary auth method
- [ ] OAuth2 uses PKCE for all public clients (SPA, mobile)
- [ ] Access tokens short-lived (5-15 min), refresh tokens rotated
- [ ] Sessions use httpOnly + secure + sameSite cookies
- [ ] Session ID regenerated after authentication (fixation prevention)
- [ ] DPoP or mTLS used for high-value API access
- [ ] RBAC/ABAC enforced server-side (never trust client-side checks)
- [ ] Rate limiting on login/register/password-reset endpoints
- [ ] Refresh token reuse detection triggers family revocation
- [ ] All auth events logged to audit trail (login, failed, MFA, role change)
