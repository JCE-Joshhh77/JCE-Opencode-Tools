---
name: context-preservation
description: Maintaining project context across sessions. Use when working on context-preservation tasks, related files, debugging, implementation, review, or verification workflows.
---

# Skill: Context Preservation

## Auto-Detect

Trigger this skill when:
- Task mentions: context, session, .opencode-context.md, cross-project, staleness
- Patterns: maintaining state between sessions, project memory, context file management
- Context: start of session, end of session, context audit, multi-project workflows

---

## Decision Tree: Context Action

```
What phase of the session?
+-- Starting a new session?
|   +-- MCP context-keeper available? -> Call context_read (auto-prunes)
|   +-- No MCP? -> Read .opencode-context.md manually, prune completed tasks
+-- Completed a task?
|   +-- MCP available? -> Call context_update with section + changes
|   +-- No MCP? -> Edit .opencode-context.md directly (append/update)
+-- Ending session / committing?
|   +-- MCP available? -> Call context_checkpoint (validates + archives)
|   +-- No MCP? -> Review file, ensure status is current
+-- File doesn't exist?
|   +-- Auto-create from template (detect stack from project files)
+-- File > 50 lines after prune?
|   +-- Archive old entries to .opencode-context-archive.md
+-- Need sibling project context?
    +-- MCP available? -> Call context_query_related
    +-- No MCP? -> Read sibling's .opencode-context.md directly
```

## Decision Tree: What to Record

```
Is this worth recording?
+-- Architecture decision (affects future work)? -> YES (## Architecture Decisions)
+-- New dependency added? -> YES (## Stack)
+-- Convention established? -> YES (## Conventions)
+-- Task completed? -> YES (mark [x] in ## Current Status)
+-- Critical bug found/fixed? -> YES (## Important Notes)
+-- Typo fix / minor rename? -> NO
+-- Implementation detail readable from code? -> NO
+-- Temporary debugging info? -> NO
```

---

## MCP Enforcement (context-keeper server)

```
Tool usage (MANDATORY when MCP available):

| When                    | Tool              | Purpose                              |
|-------------------------|-------------------|--------------------------------------|
| Session start           | context_read      | Load + auto-prune + enrich with git  |
| After task completion   | context_update    | Update specific section              |
| Before commit/end       | context_checkpoint| Validate, prune, archive if needed   |
| Debug context health    | context_history   | Check staleness, session count       |
| Cross-project reference | context_query_related | Read sibling project contexts   |
```

```typescript
// context_update usage examples:

// After completing a task:
context_update({
  section: 'Current Status',
  action: 'replace',
  lines: [
    '- [x] User authentication (JWT + refresh)',
    '- [x] Product CRUD + image upload',
    '- [ ] Shopping cart <- IN PROGRESS',
    '- [ ] Checkout + Stripe payment',
  ],
});

// After architecture decision:
context_update({
  section: 'Architecture Decisions',
  action: 'add',
  lines: ['- Cache: Redis with 5min TTL, invalidate on write'],
});

// After adding dependency:
context_update({
  section: 'Stack',
  action: 'add',
  lines: ['- Redis 7 (caching + session store)'],
});
```

---

## IRON RULE (Backup — when MCP unavailable)

```
Every time TodoWrite marks items as `completed`:
  -> MUST also update .opencode-context.md in the SAME response
  -> No exceptions. They are coupled operations.

This ensures context is never stale even without the MCP server.
```

---

## Session Flow (Automatic)

```
1. SESSION START:
   a. Check if .opencode-context.md exists in project root
   b. If NOT exists -> Create from template (auto-detect stack)
   c. If EXISTS -> Read it, then PRUNE:
      - Remove all [x] tasks from ## Current Status
      - Remove resolved notes from ## Important Notes
      - Condense old architecture decisions to 1 line
      - Target: <= 40 lines after prune

2. DURING SESSION:
   - Update on: architecture decision, dependency added, task done, convention set
   - Don't update on: typos, minor refactors, obvious-from-code details

3. SESSION END:
   - Ensure current status reflects actual state
   - Call context_checkpoint (or manually verify)

4. AUTO-ARCHIVE (if > 50 lines after prune):
   - Move old ## Architecture Decisions and ## Important Notes to archive
   - Add: "> Archived entries: see .opencode-context-archive.md"
   - Archive has no size limit (historical reference)
```

---

## File Template

```markdown
# Project Context
> Auto-maintained by AI. You can edit this file freely.
> Last updated: YYYY-MM-DD

## Stack
- [auto-detect from package.json, Cargo.toml, go.mod, etc.]

## Architecture Decisions
- (none yet)

## Conventions
- (none yet)

## Current Status
- [ ] (session start)

## Important Notes
- (none yet)

## Related Projects
- (none - add as: - ../path: "description")
```

---

## Writing Rules (Token-Efficient)

```
1. Max 40 lines (target) / 50 lines (hard limit before archive)
2. Bullet points only — no paragraphs, no prose
3. No duplication — check before adding
4. Symbols:
   - [x] = completed (pruned next session)
   - [ ] = pending
   - <- = in progress marker
   - !! = needs attention / warning
5. Date in header — know when last updated
6. One fact per line — scannable, greppable
```

---

## Cross-Project Context

```markdown
## Related Projects
- ../shared-lib: "Shared utilities used by this service"
- ../api-gateway: "Routes traffic to this service"
- ../mobile-app: "Consumes this API"
```

```typescript
// Query related project context (MCP tool)
context_query_related({ project: '../shared-lib' });

// Returns that project's .opencode-context.md content
// Useful for: understanding shared interfaces, avoiding breaking changes,
// coordinating migrations across projects
```

---

## Multi-Session Awareness (v2)

```
Features:
- Session counter: incremented on each context_read
- Staleness detection: warns if >7 days or >5 sessions without meaningful update
- Content hash: optimistic concurrency (prevents lost updates from parallel sessions)
- Auto-enrichment: context_read response includes git branch, uncommitted changes, deps

Staleness escalation:
- 3 sessions without update: gentle reminder
- 5 sessions without update: warning in context_read response
- 7+ days without update: strong warning, suggest review

Session metadata stored as HTML comment (invisible in rendered markdown):
<!-- session:5 last_update:2026-05-09 hash:abc123 -->
```

---

## Auto-Prune Strategy

```
On every session start, BEFORE adding new content:

1. ## Current Status:
   - Remove all [x] (completed) items
   - Keep [ ] (pending) and <- (in progress) items

2. ## Important Notes:
   - Remove notes about bugs that were fixed 2+ sessions ago
   - Remove temporary notes (debugging info, one-time reminders)
   - Keep: ongoing warnings, environment quirks, non-obvious gotchas

3. ## Architecture Decisions:
   - Condense old obvious decisions to 1 line
   - Example: "Auth: JWT + refresh (15min/7d)" instead of 3 lines explaining why

4. Verify total <= 40 lines
   - If > 50 lines: trigger auto-archive
```

---

## Archive Format

```markdown
# Context Archive — [Project Name]
> Historical decisions and notes. Reference only.

## Archived: 2026-05-09
- Auth: Switched from Sanctum to custom JWT (performance reasons)
- Redis connection pool: max 10 in production (tested under load)

## Archived: 2026-04-28
- Initial architecture: monolith with modular boundaries
- Database: PostgreSQL 16 chosen over MySQL (JSON support, CTEs)
```

```
Archive rules:
- Grouped by archive date
- No size limit (historical reference)
- AI reads archive only when historical context needed
- User can delete archive freely
```

---

## Integration with Memory MCP

```
If Memory MCP server is also active, split concerns:

| Info Type                | Store In                    |
|--------------------------|-----------------------------|
| Stack & architecture     | .opencode-context.md        |
| Current status & tasks   | .opencode-context.md        |
| Credentials location     | Memory MCP (persistent)     |
| User preferences         | Memory MCP (persistent)     |
| Deployment URLs          | Memory MCP (persistent)     |
| API key locations        | Memory MCP (persistent)     |

Rule: .opencode-context.md = project state (changes often)
      Memory MCP = permanent facts (rarely changes)
```

---

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|---|---|---|
| Never reading context at session start | Repeat work, lose decisions | ALWAYS read first, work second |
| Writing paragraphs instead of bullets | Wastes tokens, hard to scan | One fact per bullet, max 10 words |
| Never pruning completed tasks | File grows unbounded | Prune [x] items every session start |
| Duplicating info readable from code | Noise, goes stale | Only record non-obvious decisions |
| Overwriting entire file | Loses concurrent edits | Incremental updates (add/replace section) |
| No related projects defined | Miss cross-project impacts | Add sibling projects with descriptions |
| Ignoring staleness warnings | Context drifts from reality | Review and update when warned |
| Storing secrets in context file | Security risk (committed to git) | Use Memory MCP or reference by key name |

---

## Verification Checklist

- [ ] .opencode-context.md exists in project root
- [ ] File is <= 40 lines (50 max before archive)
- [ ] ## Stack reflects actual project dependencies
- [ ] No [x] completed tasks lingering (pruned at session start)
- [ ] Architecture decisions are current and concise
- [ ] Related projects listed (if any sibling projects exist)
- [ ] Last updated date is within 7 days
- [ ] No secrets or credentials in the file
- [ ] Archive file exists if main file was ever > 50 lines
- [ ] context_read called at session start (MCP enforcement)
