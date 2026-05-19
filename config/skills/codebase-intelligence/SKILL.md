---
name: codebase-intelligence
description: Repository mapping, impact scanning, entry point discovery, and audit orientation. Use when working on codebase-intelligence tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Codebase Intelligence

Use this skill when auditing, onboarding into a repo, mapping impact, or changing unfamiliar code.

## Mapping Pass
- Identify entry points, config files, package manager, scripts, test runner, and generated/state folders.
- Locate changed files and nearby tests before editing.
- Separate source, tests, installers, generated artifacts, docs, and scratch files.
- Prefer focused search/read over broad file dumping.

## Impact Scan
- Trace public interfaces, call sites, persisted state, CLI commands, hooks, and installer paths.
- Identify risky side effects: version sync, lockfiles, global config writes, background state, and release tags.
- Capture project-specific rules as durable context when they affect future sessions.

## Output Expectations
- For audits: findings first, severity ordered, with file references and verification gaps.
- For changes: explain touched areas and why they were in scope.
