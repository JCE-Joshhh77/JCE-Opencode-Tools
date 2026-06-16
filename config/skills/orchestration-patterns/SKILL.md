---
name: orchestration-patterns
description: Multi-phase workflows, state machines, DAG task execution, checkpoint/resume, and saga patterns for complex multi-step or multi-session work. Use when a task spans 5+ steps, multiple files, multiple sessions, or has irreversible phases.
---

# Skill: Orchestration Patterns

Load this when a task is too large for direct execution and needs structured, resumable, multi-phase coordination.

---

## When to Use

- Task spans **5+ distinct steps** or **multiple files** with dependencies.
- Work may **span sessions** (context could be lost mid-task).
- Some phases are **irreversible** (deploy, migration, delete) and need gates.
- Multiple independent units can run in **parallel** but converge later.

If the task is 1-3 simple steps, skip this — just execute directly.

---

## 1. Workflow State Machine

Model complex tasks as explicit phases with gates between them.

```
PLANNING → IMPLEMENTING → TESTING → STAGING → DONE
   │            │             │          │
   └ gate       └ gate        └ gate     └ gate
```

**Rules:**
- Each phase has an **entry condition**, **work**, and **exit gate** (verification evidence).
- Cannot advance past a gate without evidence. No "should work" advancement.
- On gate failure: rollback to last checkpoint, do NOT push forward with patches.

**Phase definitions:**

| Phase | Entry | Exit Gate |
|-------|-------|-----------|
| PLANNING | Requirements understood | Acceptance criteria written, impact scan done |
| IMPLEMENTING | Plan approved or safe direct-exec selected | Code compiles, no syntax errors |
| TESTING | Code complete | Relevant tests pass, focused verification green |
| STAGING | Tests pass | Wider verification + user gate if irreversible |
| DONE | Staged & verified | Final report with evidence |

---

## 2. Checkpoints

Before any risky or hard-to-reverse step, record a checkpoint.

**Format (write to context index or .opencode-context.md):**
```
[checkpoint:pre-migration]
- Phase: IMPLEMENTING → TESTING
- State: 3/5 files migrated (auth.ts, user.ts, session.ts done)
- Next: migrate order.ts, payment.ts
- Rollback: git stash / revert commits abc123..def456
- Verification so far: bun test auth passes
```

**Checkpoint discipline:**
- Checkpoint BEFORE: schema changes, bulk edits, deploys, deletes, dependency upgrades.
- Each checkpoint must capture: current phase, completed work, next step, rollback method, verification status.
- Keep last 2-3 checkpoints; prune older ones.

---

## 3. Cross-Session Resume

On session start, if an incomplete workflow exists:

1. Read context for the latest `[checkpoint:*]` entry.
2. Reconstruct phase position and completed work.
3. **Verify reality matches checkpoint** — re-read changed files, run a quick check. Code wins over stale memory.
4. Continue from the checkpoint, not from scratch.

Never restart a multi-phase task from zero if a checkpoint exists. Never assume the checkpoint is accurate without verifying against actual file state.

---

## 4. DAG-Based Parallel Execution

When work fans out into independent units, model dependencies as a DAG.

```
        ┌─ B (research API) ─┐
A (scan)┤                    ├─ D (integrate) ─ E (verify)
        └─ C (build schema) ─┘
```

**Execution rules:**
- Identify dependencies BEFORE dispatching. Draw the DAG mentally.
- Dispatch all nodes with satisfied dependencies in parallel (single message, multiple tool calls).
- A node runs only when ALL its inputs are complete.
- Convergence nodes (D) wait for all parents (B, C) before starting.

**Anti-pattern:** Sequential dispatch when units are independent. If B and C don't depend on each other, dispatch both at once.

---

## 5. Saga Pattern (Compensating Actions)

For multi-step operations where each step has side effects and any step can fail.

```
Step 1: create order        → compensate: cancel order
Step 2: charge payment      → compensate: refund payment
Step 3: reserve inventory   → compensate: release inventory
Step 4: schedule shipment   → compensate: cancel shipment
```

**Rules:**
- Each forward step pairs with a compensating (undo) action.
- If step N fails, execute compensations for steps N-1 ... 1 in reverse order.
- Make steps **idempotent** so retries are safe.
- Record which steps succeeded so compensation knows where to start.

Use this for code workflows too: "added migration → registered route → updated client" each needs an undo if a later step fails.

---

## 6. Phase Gate Checklist

Before advancing any phase, confirm:

- [ ] Exit gate evidence collected (command output, test results)
- [ ] No unresolved errors in current phase
- [ ] Checkpoint recorded if next phase is risky
- [ ] Rollback path known
- [ ] If irreversible or permission-boundary next: user gate passed

---

## Integration with AGENTS.md

This skill expands **Workflow Engine v1.0**. The AGENTS.md rules are the always-on summary; this skill is the detailed playbook. Load when the always-on rules signal a multi-phase task.

## Anti-Patterns

| Don't | Do |
|-------|-----|
| Run 8-step task with flat TodoWrite, no gates | Use state machine with phase gates |
| Advance phase on "looks done" | Require exit gate evidence |
| Restart multi-session task from scratch | Resume from last checkpoint (after verifying) |
| Dispatch independent units one at a time | Parallel dispatch via DAG |
| Multi-step side-effect op with no undo | Saga with compensating actions |
| Trust checkpoint blindly after resume | Verify file state matches checkpoint |
