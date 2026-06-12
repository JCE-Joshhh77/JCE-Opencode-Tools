---
name: failure-recovery
description: Retry strategies, rollback protocols, circuit breakers for delegations, escalation chains, and failure budgets. Use when verification fails, a fix doesn't work, a sub-agent returns weak output, or you are stuck in a failure loop.
---

# Skill: Failure Recovery

Load this when something breaks: verification fails, a fix doesn't hold, a delegation returns garbage, or you sense a loop forming.

---

## Core Principle

**Failures are signal, not noise.** Every failure narrows the problem space. Track them, learn from them, and never stack blind patches.

---

## 1. Failure Budget

Hard limit on attempts before changing strategy.

```
Attempt 1: focused fix based on error → verify
Attempt 2: refined fix (one variable changed) → verify
Attempt 3: alternative approach → verify
─────────────────────────────────────────────
BUDGET EXHAUSTED → stop, summarize, escalate
```

**Rules:**
- Max **3 focused fix attempts** per distinct error.
- Each attempt must change exactly ONE hypothesis. No shotgun debugging.
- After budget exhausted: STOP. Do not try attempt 4. Summarize evidence and escalate.

---

## 2. Anti-Pattern Detection (Loop Breaking)

Recognize when you're stuck before wasting cycles.

**Signals you're in a loop:**
- Same error after 2 fixes → the root cause is elsewhere.
- Error message changes but problem persists → treating symptoms.
- Each fix creates a new error → structural/design problem.

**When detected:**
1. STOP patching immediately.
2. State explicitly: "I've tried X and Y. Root cause appears to be Z, not what I assumed."
3. Step back to design level — is the approach itself wrong?
4. Try a fundamentally different track OR escalate to oracle.

```
WRONG: error → tweak → error → tweak → error → tweak (stacking)
RIGHT: error → fix → same error → STOP → rethink root cause → different approach
```

---

## 3. Rollback Protocol

Before risky edits, prepare the undo. After failure, undo before retrying.

**Before risky edit:**
```
Rollback plan:
- Files to revert: src/auth.ts, src/session.ts
- Method: git checkout -- <files>  (or git stash)
- Or: keep original content snippets in memory for restore
- DB changes: prepared down-migration
```

**On failure:**
1. Execute rollback to clean state FIRST.
2. Then try the alternative approach from a known-good baseline.
3. Never layer a new fix on top of a failed, un-reverted change — it compounds confusion.

---

## 4. Retry Strategy for Delegations

When a sub-agent returns weak or incomplete output.

| Output Quality | Action |
|----------------|--------|
| Complete + evidence (HIGH) | Accept |
| Partial / missing sections (MEDIUM) | Retry once with refined, narrower prompt |
| Opinion only / no evidence (LOW) | Retry with explicit evidence requirement, or escalate |
| Failed / errored | Escalate to next agent in chain |

**Refined retry prompt must:**
- Narrow the scope (don't repeat the same broad ask).
- Specify exactly which section was missing.
- Provide additional context the first attempt lacked.

**Retry budget for delegations:** max 2 retries, then escalate.

---

## 5. Escalation Chain

```
explorer (find/map)  →  oracle (deep reasoning)  →  user (decision)
```

**When to escalate:**
- explorer → oracle: search complete but problem needs deep analysis/design judgment.
- oracle → user: technical analysis done but decision involves tradeoffs only user can make (scope, risk tolerance, business priority).

**Escalation must carry forward:**
- What was tried (all attempts).
- Evidence collected.
- Specific question or decision needed.

Never escalate empty-handed. Never escalate the same problem twice without new information.

---

## 6. Circuit Breaker for Delegations

Prevent cascade failures when a delegation target keeps failing.

```
3 consecutive delegation failures to same agent type
  → OPEN circuit → stop delegating there
  → fall back to direct execution or different agent
  → report the systemic issue
```

If explorer fails 3x on the same search, the problem isn't explorer — it's the query or the assumption. Change approach, don't keep calling.

---

## 7. Failure Pattern Memory

Record failures so future work avoids them.

**Format (to context index, bucket: `general` or project-specific):**
```
[failure-pattern]
- Signature: "Hilt @Inject fails with 'cannot be provided without an @Provides'"
- Root cause: missing @InstallIn module scope
- Fix category: add @Module @InstallIn(SingletonComponent::class)
- NOT: adding more dependencies (tried, failed)
```

**On new error:** check context for matching signatures first. Reuse known fixes. Avoid re-discovering the same root cause.

---

## Failure Report Template

When budget is exhausted and you must stop:

```
## Blocker
- Error: <exact message>
- Location: <file:function>

## Attempts (all failed)
1. <hypothesis> → <result>
2. <hypothesis> → <result>
3. <hypothesis> → <result>

## Evidence
- <what the logs/tests actually show>

## Assessment
- Likely root cause: <best current theory>
- Why patching isn't working: <structural reason>

## Options
- A: <approach + tradeoff>
- B: <approach + tradeoff>

## Recommendation
- <which option and why, or "need user decision on X">
```

---

## Integration with AGENTS.md

Expands **Failure Intelligence v1.0**. Load when verification fails or a loop is forming.

## Anti-Patterns

| Don't | Do |
|-------|-----|
| Try 6 fixes hoping one works | Budget 3, then escalate |
| Change 4 things per attempt | One hypothesis per attempt |
| Stack fix on failed unreverted change | Rollback to clean state first |
| Re-call failing agent endlessly | Circuit breaker after 3, change approach |
| Escalate with no context | Carry forward attempts + evidence |
| Re-discover same root cause each session | Check failure pattern memory first |
