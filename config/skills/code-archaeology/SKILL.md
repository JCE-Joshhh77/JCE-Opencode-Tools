---
name: code-archaeology
description: Understanding legacy and unfamiliar code, git blame/history analysis, dependency archaeology, and reconstructing intent behind existing code. Use when working in unfamiliar codebases, investigating "why was this written this way", or before changing code you didn't write.
---

# Skill: Code Archaeology

Load this when you must understand existing code before changing it — legacy systems, unfamiliar repos, or mysterious code whose intent isn't obvious.

---

## Core Principle

**Code that looks wrong is often right for a reason you can't see yet.** Before "fixing" or refactoring unfamiliar code, excavate its history and intent. Chesterton's Fence: don't remove a fence until you know why it was built.

---

## 1. Orientation (First Contact with a Repo)

Before touching anything, build a map.

**Scan in this order:**
1. **Entry points** — `main`, `index`, route definitions, CLI commands.
2. **Build/config** — package.json, Cargo.toml, build.gradle, Makefile → reveals tooling, scripts, dependencies.
3. **Directory structure** — top-level layout reveals architecture (layered? feature-based? monorepo?).
4. **Tests** — test files reveal intended behavior and usage examples.
5. **README / docs / ADRs** — stated intent and decisions.
6. **Generated state** — lockfiles, build outputs, migrations (don't hand-edit these).

Delegate broad mapping to `explorer` for large repos; do targeted reads yourself for specific files.

---

## 2. Reading Intent from Code

When code's purpose is unclear:

- **Names first** — function/variable names encode intent. Trust them, then verify.
- **Trace the data** — follow a value from input to output. The transformations reveal purpose.
- **Find the callers** — who uses this? Usage reveals the contract better than the implementation.
- **Find the tests** — tests are executable documentation of intended behavior.
- **Look for comments explaining WHY** — those are gold. Comments explaining WHAT are less useful.

---

## 3. Git History Analysis

The commit history is a record of intent. Mine it.

```bash
# Why does this line exist? Who wrote it and in what commit?
git log -L <start>,<end>:<file>          # history of specific lines
git blame -w <file>                       # who/when, ignoring whitespace
git log --follow -p <file>                # full history incl. renames

# What was the commit's reasoning?
git show <commit>                         # full diff + message
git log --oneline --all -- <file>         # all commits touching file

# When did behavior change / break?
git bisect start / good / bad             # binary search for the breaking commit
```

**What to extract:**
- The commit message explaining WHY a change was made.
- The PR/issue reference (if present) for fuller context.
- Whether code was added deliberately or accreted accidentally.
- Whether a "weird" line was a deliberate bugfix (look for "fix" commits touching it).

---

## 4. Chesterton's Fence Protocol

Before removing or changing code that seems unnecessary:

```
1. Can I explain WHY this exists?
   NO  → investigate (git blame, find callers, check tests) before touching
   YES → proceed to step 2
2. Is the original reason still valid?
   YES → leave it (or change carefully, preserving the reason)
   NO  → safe to remove, but verify nothing depends on the side effect
3. Is there a test protecting it?
   NO  → add one before changing, so you catch breakage
```

Special caution for: empty catch blocks, magic numbers, sleep/delay calls, defensive null checks, "temporary" hacks, version-specific workarounds. These often encode hard-won bug fixes.

---

## 5. Dependency Archaeology

Understanding why a dependency exists and what relies on it.

- **Why is this dependency here?** — search the codebase for its imports. Unused? Maybe a transitive need or dead weight.
- **What version constraints?** — check lockfile vs declared range. Pinned versions often signal a known incompatibility.
- **Find the actual usage** — grep for import sites; a dependency may be used in one obscure spot that's easy to break.
- **Check for vendored/patched deps** — sometimes a dep is forked/patched; upgrading naively reverts the patch.

---

## 6. Reconstructing Undocumented Behavior

When there are no docs and no tests:

1. **Write a characterization test** — capture current behavior AS-IS (even if it seems buggy). This is your safety net.
2. **Run it** — confirm it passes against current code.
3. **Now you can refactor** — the test catches any behavior change.
4. **Only then** decide if the captured behavior is correct or a bug to fix (separately).

This is the safe path to changing code nobody understands.

---

## 7. Red Flags That Demand Investigation

| Pattern | Likely hidden reason |
|---------|---------------------|
| `// don't remove this` | Painful past lesson — investigate before ignoring |
| Oddly specific constant (`* 1.0001`) | Empirical fix for a real edge case |
| Retry/sleep with magic delay | Race condition workaround |
| Broad try/catch swallowing errors | Masking a known flaky path (fix root cause carefully) |
| Commented-out code | Either dead (delete) or a toggle (investigate) |
| Duplicate logic that "should" be shared | May have intentional divergence — verify before DRYing |

---

## Integration with AGENTS.md

Supports **Safe Edit Engine** and the Impact Scan step. Load before editing unfamiliar or legacy code, or when asked "why does this work this way."

## Anti-Patterns

| Don't | Do |
|-------|-----|
| "Fix" weird code without understanding it | Excavate intent first (Chesterton's Fence) |
| Delete code that looks unused | Find callers + git blame first |
| Refactor untested legacy directly | Write characterization test first |
| Assume a magic number is arbitrary | Check git history for its origin |
| Naively upgrade a patched dependency | Check for vendoring/patches first |
| Trust your assumption over the code | Read the code; code wins over memory |
