---
name: verification-discipline
description: Evidence-first verification planning, failure loops, test selection, and audit proof. Use when working on verification-discipline tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Verification Discipline

Use this skill when code, config, release, install, or behavior changes require proof.

## Evidence Rules
- Choose the smallest relevant command first, then broader verification proportional to risk.
- For TypeScript: run typecheck and focused/full tests depending on scope.
- For dependency/security changes: run audit after dependency changes.
- For CLI/install changes: run CLI integration tests and syntax/parser checks when practical.
- Read command output before reporting success.
- If a command cannot run, state exactly what is unverified and why.

## Failure Loop
- Parse exact error.
- Identify one root-cause hypothesis.
- Apply one focused fix.
- Rerun the smallest failing command.
- Escalate to architecture review after repeated failures.
