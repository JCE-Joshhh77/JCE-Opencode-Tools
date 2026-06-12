---
name: multi-agent-coordination
description: Consensus protocols, conflict resolution between sub-agents, evidence merging, parallel evaluation, and delegation output grading. Use when coordinating multiple sub-agents, resolving contradictory findings, or making high-stakes decisions that warrant independent verification.
---

# Skill: Multi-Agent Coordination

Load this when orchestrating multiple sub-agents, especially when their outputs must be merged, compared, or trusted for an important decision.

---

## Core Principle

Sub-agents are specialists with fresh context. Their value is **independent perspective** — but independence means outputs can conflict, overlap, or vary in quality. Coordinate deliberately.

---

## 1. Output Grading (Confidence Scoring)

Every delegated result gets a grade before you act on it.

| Grade | Criteria | Action |
|-------|----------|--------|
| **HIGH** | Claims backed by file refs, command output, or cited sources | Trust and proceed |
| **MEDIUM** | Partial evidence, some gaps, reasonable but unverified | Verify the gap or retry narrowly |
| **LOW** | Opinion, no evidence, missing required sections | Reject — retry or escalate |

**Required sections in every delegation return:**
- Summary (what was done/found)
- Files (paths touched or examined)
- Verification (commands run + results, or sources)
- Risks (what could be wrong)

Missing any section → automatic MEDIUM or LOW. Do not upgrade on vibes.

---

## 2. When to Use Parallel Consensus

Don't get consensus for everything — it's expensive. Use it only when the cost of being wrong is high.

**Use consensus for:**
- Irreversible actions (schema migration, production deploy, bulk delete).
- Architecture decisions with long-term lock-in.
- Conflicting initial evidence.
- Security-critical changes.

**Skip consensus for:**
- Reversible, low-risk edits.
- Well-understood, routine work.
- When one specialist clearly owns the domain.

---

## 3. Parallel Consensus Protocol

```
1. Frame ONE precise question.
2. Dispatch 2 agents independently (don't let them see each other's work).
   - e.g., oracle (reasoning) + jce-researcher (evidence)
3. Collect both conclusions.
4. Compare:
   - Aligned → proceed with confidence.
   - Divergent → analyze why (see conflict resolution).
   - Both uncertain → escalate to user with both views.
```

**Independence matters:** if agents share context, you get groupthink, not consensus. Give each the same question and raw inputs, not each other's answers.

---

## 4. Conflict Resolution

When two agents disagree:

```
Step 1: Identify the disagreement type
  - Factual (one is wrong about a fact) → verify the fact directly
  - Interpretive (same facts, different conclusion) → examine reasoning
  - Scope (answering different questions) → re-frame, re-dispatch

Step 2: Weigh by evidence strength, not confidence tone
  - Agent with file refs / command output > agent with assertions
  - Recent/primary sources > general knowledge

Step 3: Resolve
  - Clear evidence winner → take it, note why
  - No clear winner → run a tie-breaker check yourself
  - Genuine tradeoff → escalate to user with both sides
```

Never average two answers. Pick based on evidence, or escalate.

---

## 5. Evidence Merging

When multiple agents return complementary (not conflicting) findings:

- **Deduplicate:** same finding from 2 agents = 1 finding (higher confidence).
- **Sequence:** order findings by dependency, not by which agent returned first.
- **Attribute:** keep track of which evidence came from where, for traceability.
- **Gap-check:** what did NEITHER agent cover? That's your blind spot — investigate.

---

## 6. Anti-Duplication Discipline

Once delegated, do NOT redo the work yourself.

- Trust the delegated result per its grade.
- If insufficient: send a **targeted follow-up** for the specific gap — don't re-run the whole task.
- Never run the same search/read an agent already did.
- Two agents should never be given identical overlapping scopes (unless deliberate consensus).

---

## 7. Delegation Prompt Quality (6-Section Contract)

Every delegation prompt includes:

```
1. TASK: one-sentence atomic goal
2. EXPECTED OUTCOME: concrete deliverables + success criteria
3. REQUIRED TOOLS: explicit whitelist (Read, Grep, Bash...)
4. MUST DO: exhaustive requirements
5. MUST NOT DO: forbidden actions (modify unrelated files, skip verification)
6. CONTEXT: file paths, patterns, constraints, prior findings
```

Vague prompts → LOW-grade output. Invest in the prompt to avoid retry cycles.

---

## 8. Agent Selection Map

| Need | Agent |
|------|-------|
| Find files, map references, trace call paths | `explorer` / `explore` |
| Docs, library versions, web/GitHub evidence | `jce-researcher` |
| Hard architecture, stubborn bug, deep tradeoffs | `oracle` |
| UI, components, responsive, accessibility, visual review | `frontend` |
| Native Android build/code/release | `android` |

Match the specialist to the work. Don't send a research question to explorer or a UI task to oracle.

---

## Integration with AGENTS.md

Expands **Delegation Intelligence v1.0**. Load when coordinating 2+ agents or resolving conflicting outputs.

## Anti-Patterns

| Don't | Do |
|-------|-----|
| Trust delegated output blindly | Grade it (HIGH/MEDIUM/LOW) first |
| Get consensus for trivial decisions | Reserve consensus for high-stakes/irreversible |
| Let consensus agents share context | Keep them independent |
| Average two conflicting answers | Resolve by evidence or escalate |
| Redo work an agent already did | Targeted follow-up for gaps only |
| Send vague 1-line delegation prompts | Use the 6-section contract |
