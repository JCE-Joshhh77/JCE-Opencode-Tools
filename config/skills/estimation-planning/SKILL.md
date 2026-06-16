---
name: estimation-planning
description: Critical path identification, risk-adjusted effort sizing, complexity detection, and execution strategy selection. Use when scoping a task, deciding direct-vs-planned execution, breaking down large work, or assessing how many steps something really needs.
---

# Skill: Estimation & Planning

Load this when you need to size work, detect hidden complexity, or choose the right execution strategy before diving in.

---

## Core Principle

Most failures come from **underestimating scope**, not from bad code. A "simple" change that touches 8 files isn't simple. Detect real complexity before committing to an approach.

---

## 1. Complexity Detection

Before choosing a strategy, measure the actual blast radius.

**Signals to count:**
- **Files affected** — how many files need editing?
- **Cross-module imports** — does the change cross package/layer boundaries?
- **Call sites** — how many places call the thing you're changing?
- **Test coverage** — is the area tested? (untested = higher risk)
- **Public contract** — does it change an API/interface others depend on?
- **Data/state** — does it touch persisted data, migrations, or shared state?

**Quick scoring:**
```
LOW:    1 file, no contract change, reversible, tested area
MEDIUM: 2-5 files, single module, reversible
HIGH:   5+ files, cross-module, OR contract/data/state change
CRITICAL: irreversible (deploy, delete, migration) at any size
```

---

## 2. Strategy Selection

Map complexity → execution strategy (mirrors Adaptive Strategy Selector v1.0).

| Complexity | Strategy | What it means |
|------------|----------|---------------|
| LOW | **Direct exec** | Edit + verify immediately, no ceremony |
| MEDIUM | **Plan-then-exec** | State plan, execute, verify |
| HIGH | **Multi-phase** | State machine + checkpoints per phase |
| CRITICAL | **User gate** | Present plan + evidence, wait for approval only for irreversible or permission-boundary actions |
| Unknown territory | **Spike first** | Time-boxed investigation before committing |

**Auto-upgrade rule:** if you start LOW but verification fails or scope grows, upgrade to the next level. Don't stubbornly stay direct on a task that revealed itself as complex.

---

## 3. Critical Path Identification

For multi-step work, find the longest dependency chain — that's your critical path.

```
A(2) → B(3) → D(2)        Critical path: A→B→D→E = 9 units
        C(1) → D            (C is not on critical path; B is)
              D → E(2)
```

**Rules:**
- The critical path determines minimum completion time.
- Parallelize off-critical-path work (C) alongside critical work (B).
- Optimize the critical path first — speeding up C does nothing.
- A blocker on the critical path blocks everything; flag it immediately.

---

## 4. Step Decomposition

Break work into steps that are each:
- **Independently verifiable** — has a clear "done" check.
- **Single-responsibility** — one concept per step.
- **Ordered by dependency** — prerequisites first.
- **Right-sized** — not "build the app" (too big), not "add semicolon" (too small).

**Decomposition test:** if you can't state the verification for a step, it's not well-defined yet. Split or clarify it.

---

## 5. Risk-Adjusted Effort

Effort isn't just lines of code. Adjust for:

| Factor | Multiplier effect |
|--------|-------------------|
| Unfamiliar codebase/tech | Add investigation time up front |
| No existing tests | Add test-writing + higher verification cost |
| External dependencies | Add integration uncertainty |
| Irreversible operations | Add review + user-gate overhead; reversible code/config work should continue once scope is clear |
| Legacy/undocumented code | Add archaeology time (see code-archaeology) |

State the riskiest assumption explicitly. The plan should de-risk the unknown first ("verify the API actually returns X before building on it").

---

## 6. Acceptance Criteria (Not Effort)

Define done by **observable outcomes**, not by effort spent.

```
BAD:  "Refactor the auth module" (no done condition)
GOOD: "Auth module: all existing tests pass, login/logout/refresh
       work, no public API change, no new lint errors"
```

Every plan needs acceptance criteria written BEFORE implementation. They are the exit gate.

---

## 7. Planning Output Template

For non-trivial work, produce:

```
## Goal
<one sentence>

## Complexity: LOW | MEDIUM | HIGH | CRITICAL
- Files: <count/list>
- Risk factors: <list>

## Strategy: <direct | plan-then-exec | multi-phase | user-gate>

## Steps (ordered by dependency)
1. <step> → verify: <check>
2. <step> → verify: <check>
...

## Critical path: <which steps>
## Riskiest assumption: <what to de-risk first>

## Acceptance Criteria
- [ ] <observable outcome>
- [ ] <observable outcome>
```

---

## Integration with AGENTS.md

Expands **Adaptive Strategy Selector v1.0**. Load when scoping work or unsure whether to execute directly or plan first.

## Anti-Patterns

| Don't | Do |
|-------|-----|
| Call a multi-file change "quick" | Count files/imports first |
| Use same strategy for all tasks | Match strategy to complexity |
| Optimize off-critical-path work | Optimize the critical path |
| Define done by effort ("refactored") | Define done by observable outcome |
| Build on unverified assumptions | De-risk the riskiest assumption first |
| Steps with no verification | Every step has a done-check |
