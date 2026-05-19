---
name: release-engineering
description: Version sync, release verification, commits, pushes, tags, and changelog discipline. Use when working on release-engineering tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Release Engineering

Use this skill for version bumps, commits, tags, pushes, changelogs, installers, and release readiness.

## Release Checklist
- Sync version values across package metadata, installers, constants, generated references, and tests.
- Review git status and diff before staging.
- Exclude context files, local execution memory, scratch docs, secrets, and generated state unless explicitly requested.
- Run required verification before commit: typecheck, full tests, dependency audit, and release-specific checks.
- Commit only when explicitly requested.
- Push only when explicitly requested.
- Create and push tag only after the release commit is pushed.

## Changelog Contract
- Summarize user-facing changes, fixes, dependency/security changes, and verification evidence.
- Note residual risks and known environment limitations.
