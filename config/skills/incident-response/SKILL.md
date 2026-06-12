---
name: incident-response
description: Production incident triage, rollback procedures, blast radius assessment, severity classification, and post-mortem templates. Use when production is down, a deploy broke something, users are impacted, or you need to stabilize before fixing root cause.
---

# Skill: Incident Response

Load this when something is broken in production or a live environment and the priority is **stabilize first, root-cause later**.

---

## Core Principle

**Stop the bleeding before diagnosing the wound.** In an incident, restoring service beats finding the perfect fix. Mitigate, then investigate. Resist the urge to debug a live outage in place.

---

## 1. Triage (First 5 Minutes)

```
1. CONFIRM: Is it real? (reproduce / check monitoring, not just one report)
2. SCOPE: Who/what is affected? (all users? one feature? one region?)
3. SEVERITY: classify (see table)
4. COMMUNICATE: acknowledge the incident
5. MITIGATE: fastest path to stable (often rollback, not fix)
```

Do NOT start writing a fix before completing triage. Knowing scope and severity determines the right response.

---

## 2. Severity Classification

| Sev | Definition | Response |
|-----|------------|----------|
| **SEV1** | Full outage / data loss / security breach | All hands, immediate rollback, notify stakeholders |
| **SEV2** | Major feature down, many users impacted | Urgent mitigation, rollback candidate |
| **SEV3** | Minor feature degraded, workaround exists | Scheduled fix, monitor |
| **SEV4** | Cosmetic / low impact | Normal backlog |

Severity drives urgency and who gets involved. Don't treat a SEV4 like a SEV1 or vice versa.

---

## 3. Blast Radius Assessment

Before ANY mitigation action, understand its reach.

**Questions:**
- What does this change/rollback affect beyond the immediate target?
- Are there dependent services that assume the current state?
- Does rollback risk data inconsistency (e.g., new-schema data on old code)?
- Is the action reversible if it makes things worse?

**Rule:** prefer the mitigation with the **smallest blast radius** that restores service. A feature flag toggle beats a full rollback if it works.

---

## 4. Mitigation Strategies (Fastest to Slowest)

| Strategy | When | Risk |
|----------|------|------|
| **Feature flag off** | Bad code behind a flag | Lowest — instant, targeted |
| **Rollback deploy** | Recent deploy caused it | Low — but watch for schema/data drift |
| **Scale up** | Capacity/load issue | Low — buys time |
| **Traffic reroute** | Regional/instance issue | Medium |
| **Hotfix forward** | Can't rollback (e.g., migration ran) | Higher — needs fast verification |

**Prefer rollback over forward-fix during an active incident** unless rollback is unsafe (irreversible migration already applied).

---

## 5. Rollback Safety

Rollback isn't always safe. Check before executing:

```
- Did a DB migration run? → rolling back code on new schema may break.
  → Need a down-migration OR forward-compatible code.
- Are there in-flight transactions / queued jobs assuming new behavior?
- Did the deploy change external contracts (API responses other services consume)?
- Is there a clean previous version to roll back TO?
```

If rollback is unsafe, forward-hotfix with extreme verification discipline.

---

## 6. During the Incident

- **One commander** — someone owns the decision, avoids chaos.
- **Narrate actions** — every mitigation action logged with timestamp (for post-mortem timeline).
- **Don't speculate publicly** — state what's confirmed, not theories.
- **Verify each mitigation** — confirm it actually helped before declaring stable.
- **Resist scope creep** — fix the incident, not unrelated tech debt you notice.

---

## 7. Post-Incident: Verify Recovery

Before declaring resolved:
- [ ] Symptom gone (confirmed via monitoring, not assumption).
- [ ] No new errors introduced by the mitigation.
- [ ] Affected users/features confirmed working.
- [ ] System stable for a sustained window, not just a momentary blip.

---

## 8. Blameless Post-Mortem

After stabilization, document — focus on systems, not people.

```
## Incident Summary
- Severity: SEVx
- Duration: <start> → <resolved>
- Impact: <who/what, how many, how long>

## Timeline
- HH:MM detected (how?)
- HH:MM mitigated (what action?)
- HH:MM resolved

## Root Cause
- <the actual underlying cause, traced — not the symptom>

## What Went Well
- <fast detection? good rollback?>

## What Went Wrong
- <gaps in monitoring, slow response, missing safeguard>

## Action Items (preventive)
- [ ] <add alert / add test / add guard rail / fix root cause>
- [ ] <owner + concrete change>
```

**Blameless:** "the deploy process allowed an untested migration" not "X broke it." Fix the system that let it happen.

---

## 9. Connect to Failure Recovery

Once stabilized, the actual root-cause fix follows normal discipline:
- Reproduce in a safe environment.
- Apply `failure-recovery.md` budgets and rollback protocols.
- Add a regression test so it can't recur.
- Add monitoring/alerting if detection was slow.

---

## Integration with AGENTS.md

Complements **Failure Intelligence v1.0** for the production/live-impact case. Load when an outage or live regression needs stabilization before root-cause work.

## Anti-Patterns

| Don't | Do |
|-------|-----|
| Debug root cause during active outage | Mitigate first, diagnose after |
| Rollback without checking migrations | Verify rollback safety first |
| Pick biggest-hammer mitigation | Smallest blast radius that restores service |
| Declare resolved on first green signal | Confirm sustained stability |
| Blame a person in the post-mortem | Blameless — fix the system |
| Fix unrelated tech debt mid-incident | Stay scoped to the incident |
