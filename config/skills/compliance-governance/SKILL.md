---
name: compliance-governance
description: GDPR, SOC2, audit logging, PII handling, privacy by design. Use when working on compliance-governance tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Compliance & Governance

## Auto-Detect

Trigger this skill when:
- Task mentions: GDPR, SOC2, compliance, audit, PII, data retention, consent, privacy
- Files: `audit/`, `compliance/`, `privacy-policy.*`, `data-retention.*`
- Patterns: personal data handling, consent management, right to deletion
- `package.json` contains: `audit-log`, `@casl/ability`, data masking libraries

---

## Decision Tree: Compliance Requirements

```
What regulations apply?
├── Handling EU/UK citizen data?
│   └── GDPR — consent, right to erasure, DPA, 72hr breach notification
├── US healthcare data?
│   └── HIPAA — PHI encryption, access controls, audit trails, BAA
├── Payment card data?
│   └── PCI-DSS — tokenize cards, network segmentation, quarterly scans
├── SaaS selling to enterprises?
│   └── SOC2 Type II — security, availability, confidentiality controls
├── California residents?
│   └── CCPA/CPRA — opt-out of sale, right to know, right to delete
└── Children's data (under 13/16)?
    └── COPPA (US) / UK Age Code — parental consent, data minimization
```

## Decision Tree: PII Detection

```
Is this field PII?
├── Directly identifies a person?
│   ├── Name, email, phone, SSN, passport → YES (PII)
│   ├── Photo, biometric data → YES (Sensitive PII)
│   └── Government ID numbers → YES (Sensitive PII)
├── Indirectly identifies when combined?
│   ├── IP address, device ID, cookie ID → YES (PII under GDPR)
│   ├── Location data, browsing history → YES (PII under GDPR)
│   └── Job title + company + city → MAYBE (combination risk)
├── Health, religion, ethnicity, politics?
│   └── YES (Special Category — requires explicit consent under GDPR)
└── Aggregated/anonymized (cannot re-identify)?
    └── NO (not PII — but verify k-anonymity)
```

---

## GDPR Implementation Patterns

### Consent Management

```typescript
interface ConsentRecord {
  userId: string;
  purpose: string;        // 'marketing', 'analytics', 'third_party_sharing'
  granted: boolean;
  grantedAt: Date;
  revokedAt?: Date;
  source: string;         // 'signup_form', 'cookie_banner', 'settings'
  policyVersion: string;  // Privacy policy version at time of consent
  proof: { ip: string; userAgent: string }; // Evidence of consent
}

class ConsentService {
  async grant(userId: string, purpose: string, source: string): Promise<void> {
    await this.db.consent.create({
      data: {
        userId,
        purpose,
        granted: true,
        grantedAt: new Date(),
        source,
        policyVersion: await this.getCurrentPolicyVersion(),
        proof: { ip: this.req.ip, userAgent: this.req.headers['user-agent'] },
      },
    });
    await this.audit.log('consent.granted', { userId, purpose, source });
  }

  async revoke(userId: string, purpose: string): Promise<void> {
    await this.db.consent.updateMany({
      where: { userId, purpose, granted: true, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // Trigger downstream cleanup (stop processing, delete data if no other basis)
    await this.events.publish('consent.revoked', { userId, purpose });
    await this.audit.log('consent.revoked', { userId, purpose });
  }

  async hasConsent(userId: string, purpose: string): Promise<boolean> {
    const latest = await this.db.consent.findFirst({
      where: { userId, purpose },
      orderBy: { grantedAt: 'desc' },
    });
    return latest?.granted === true && !latest.revokedAt;
  }

  // GDPR requires: consent must be as easy to withdraw as to give
  async revokeAll(userId: string): Promise<void> {
    const active = await this.db.consent.findMany({
      where: { userId, granted: true, revokedAt: null },
    });
    for (const consent of active) {
      await this.revoke(userId, consent.purpose);
    }
  }
}
```

### Data Subject Access Request (DSAR)

```typescript
class DSARService {
  // Must respond within 30 days (GDPR Article 15)
  async handleAccessRequest(userId: string): Promise<DataExport> {
    const systems = this.dataInventory.getSystemsContaining(userId);
    const export_: DataExport = { requestedAt: new Date(), data: {} };

    for (const system of systems) {
      export_.data[system.name] = await system.exportUserData(userId);
    }

    await this.audit.log('dsar.access', { userId, systemCount: systems.length });
    return export_; // Provide in machine-readable format (JSON)
  }

  // Right to Erasure (Article 17) — 30 day deadline
  async handleErasureRequest(userId: string): Promise<ErasureReport> {
    const systems = this.dataInventory.getSystemsContaining(userId);
    const report: ErasureReport = { systems: [] };

    for (const system of systems) {
      const canDelete = await this.checkLegalHolds(userId, system);
      if (canDelete) {
        await system.deleteUserData(userId);
        report.systems.push({ name: system.name, action: 'deleted' });
      } else {
        await system.anonymizeUserData(userId);
        report.systems.push({ name: system.name, action: 'anonymized', reason: 'legal_hold' });
      }
    }

    // Notify third-party processors (Article 17.2)
    await this.notifyProcessors(userId);

    // Audit the erasure (keep minimal record — not the PII itself)
    await this.audit.log('dsar.erasure', {
      requestId: crypto.randomUUID(),
      systemCount: report.systems.length,
    });

    return report;
  }
}
```

---

## Data Retention Automation

```typescript
class RetentionService {
  private policies: RetentionPolicy[] = [
    { dataType: 'session_logs', retentionDays: 90, action: 'delete' },
    { dataType: 'audit_logs', retentionDays: 2555, action: 'archive' },   // 7 years (SOC2/SOX)
    { dataType: 'user_analytics', retentionDays: 365, action: 'anonymize' },
    { dataType: 'ip_addresses', retentionDays: 90, action: 'delete' },
    { dataType: 'payment_records', retentionDays: 2555, action: 'archive' }, // Tax law
    { dataType: 'support_tickets', retentionDays: 730, action: 'delete' },
  ];

  // Run daily via cron job
  async enforce(): Promise<RetentionReport> {
    const results: RetentionResult[] = [];

    for (const policy of this.policies) {
      const cutoff = new Date(Date.now() - policy.retentionDays * 86400_000);
      try {
        const affected = await this.applyPolicy(policy, cutoff);
        results.push({ ...policy, affected, status: 'success' });
      } catch (err) {
        results.push({ ...policy, affected: 0, status: 'failed', error: err.message });
      }
    }

    await this.audit.log('retention.enforced', {
      totalAffected: results.reduce((sum, r) => sum + r.affected, 0),
      failures: results.filter((r) => r.status === 'failed').length,
    });

    return { executedAt: new Date(), results };
  }
}
```

---

## Audit Logging

```typescript
interface AuditEntry {
  id: string;
  timestamp: Date;
  actor: { id: string; type: 'user' | 'system' | 'admin'; ip?: string };
  action: string;
  resource: { type: string; id: string };
  changes?: { field: string; old: unknown; new: unknown }[];
  outcome: 'success' | 'failure' | 'denied';
  metadata?: { requestId?: string; sessionId?: string };
}

class AuditLogger {
  // APPEND-ONLY — never update or delete audit entries
  async log(action: string, details: Partial<AuditEntry>): Promise<void> {
    const entry: AuditEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      action,
      actor: details.actor ?? this.getCurrentActor(),
      resource: details.resource ?? { type: 'unknown', id: 'unknown' },
      outcome: details.outcome ?? 'success',
      changes: details.changes?.map((c) => ({
        field: c.field,
        old: this.maskPII(c.field, c.old),
        new: this.maskPII(c.field, c.new),
      })),
      metadata: details.metadata,
    };

    // Write to append-only store (separate from app DB)
    await this.auditStore.append(entry);

    // Security events also go to SIEM
    if (this.isSecurityEvent(action)) {
      await this.siem.ingest(entry);
    }
  }

  private maskPII(field: string, value: unknown): unknown {
    const piiFields = new Set(['email', 'phone', 'ssn', 'name', 'address']);
    if (piiFields.has(field) && typeof value === 'string') {
      return `${value.slice(0, 2)}***${value.slice(-2)}`;
    }
    return value;
  }

  private isSecurityEvent(action: string): boolean {
    return /^(user\.login|user\.password|admin\.|api_key\.|data\.export|data\.erasure)/.test(action);
  }
}
```

---

## PII Detection Middleware

```typescript
function piiProtection() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Block PII in query parameters (logged by proxies/browsers)
    const sensitiveParams = ['email', 'phone', 'ssn', 'token', 'password'];
    for (const param of sensitiveParams) {
      if (req.query[param]) {
        logger.warn({ param, path: req.path }, 'PII in query parameter — compliance risk');
        return res.status(400).json({ error: `${param} must not be sent as query parameter` });
      }
    }

    // Prevent caching of PII responses
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');

    next();
  };
}

// Automated PII scanning for logs (CI check)
function scanForPII(logLine: string): string[] {
  const patterns: [string, RegExp][] = [
    ['email', /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g],
    ['phone', /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g],
    ['ssn', /\b\d{3}-\d{2}-\d{4}\b/g],
    ['credit_card', /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g],
  ];

  return patterns
    .filter(([, regex]) => regex.test(logLine))
    .map(([name]) => name);
}
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| PII in URLs/query params | Logged by proxies, browsers, analytics | POST body or headers for PII, block in middleware |
| Audit logs in main database | Can be modified, no separation of concerns | Append-only store, separate from app DB |
| Consent assumed by default | GDPR violation, fines up to 4% revenue | Explicit opt-in, granular per purpose |
| No data inventory | Cannot respond to DSAR within 30 days | Maintain map of all PII locations per system |
| Soft-delete only for erasure | Data still exists, not truly erased | Hard delete or cryptographic erasure |
| Same retention for all data | Over-retention or premature deletion | Per-data-type policies based on legal basis |
| Logging PII for debugging | Compliance violation, breach risk | Structured logging with field-level redaction |
| Manual compliance checks | Drift, human error, audit failures | Automated verification in CI pipeline |

---

## Verification Checklist

- [ ] Data inventory documents all PII fields, legal basis, and retention period
- [ ] Consent records stored with proof (timestamp, IP, policy version)
- [ ] Consent withdrawal is as easy as granting (same number of clicks)
- [ ] DSAR (access + erasure) can be fulfilled within 30 days
- [ ] Retention policies automated and running daily
- [ ] Audit log is append-only, separate from application database
- [ ] PII redacted from all logs (structured logging with allowlists)
- [ ] PII blocked from query parameters (middleware enforcement)
- [ ] Third-party processors notified on erasure (Article 17.2)
- [ ] Breach notification process documented (72-hour GDPR deadline)
- [ ] SOC2 controls mapped: access reviews, change management, encryption
- [ ] Privacy impact assessment completed for new features handling PII
