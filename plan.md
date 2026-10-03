# JCE-Worker Advanced Roadmap

Status: proposed
Scope: JCE-Worker skill system, routing, telemetry, explainability, CI safety

---

## Goal

Evolve JCE-Worker from strong rule-based skill router into advanced, data-driven execution system with:

- single source-of-truth skill metadata
- weighted routing engine
- explainable decisions
- adaptive sub-agent skill profiles
- telemetry-based learning
- regression-safe CI gates

---

## 1. Skill system jadi data-driven penuh

### Objective
Replace scattered routing knowledge with one structured registry used by runtime, tests, docs, and analytics.

### Deliverables
- One canonical skill registry for all real skills
- Registry fields cover routing, verification, ownership, and examples
- Runtime reads routing data from registry instead of mixed hardcoded logic

### Registry shape
```json
{
  "developer-tooling": {
    "routingMode": "auto",
    "priority": 40,
    "intents": ["config", "refactor"],
    "signals": ["eslint", "prettier", "tsconfig", "lsp"],
    "files": ["tsconfig.json", ".eslintrc.*"],
    "preferredAgents": ["oracle"],
    "conflictsWith": ["frontend"],
    "preferredOver": ["software-engineering"],
    "samplePrompts": ["Fix ESLint + Prettier drift in tsconfig project"]
  }
}
```

### Acceptance Criteria
- All 74 real skills exist in registry
- Runtime routing can be derived from registry without missing skill metadata
- Tests can validate registry completeness automatically

---

## 2. Routing naik dari regex ke weighted scoring engine

### Objective
Move from priority-heavy selection to score-based routing using multiple evidence sources.

### Scoring inputs
- intent score
- regex score
- file match score
- directory/path score
- git diff score
- agent preference score
- historical success score

### Deliverables
- Weighted scoring function per skill
- Ranking output for all candidate skills
- Confidence score for final selection

### Acceptance Criteria
- Selected skills come from weighted ranking, not ad-hoc list ordering alone
- Resolver trace shows per-skill score contributions
- Existing routing tests remain green or get stronger replacements

---

## 3. Telemetry jadi learning loop beneran

### Objective
Capture enough routing outcome data to improve future prioritization.

### Telemetry fields per task
- intent
- selectedSkills
- suppressedSkills
- finalUsedSkills
- verificationPassed
- delegationAccepted
- followupNeeded
- userCorrection
- taskOutcome

### Deliverables
- Persist richer telemetry events
- Aggregate usefulness and failure summaries by skill
- Add recommendation/report output for routing quality

### Acceptance Criteria
- Telemetry can answer: useful skill, noisy skill, over-selected skill, failed-task skill
- Analytics output exposes per-skill outcome summaries

---

## 4. Tambah negative routing

### Objective
Prevent false positives by explicitly defining when similar-looking signals should not trigger a skill.

### Examples
- `api-design-patterns` should not win when “design” means visual design
- `frontend` should not trigger for Go `interface`
- `security` should not override `auth-identity` on auth-heavy prompts
- `human-ui-design` should not trigger from generic backend “responsive” wording alone

### Deliverables
- Negative routing rules in registry or resolver
- Tests for adversarial/ambiguous prompts

### Acceptance Criteria
- False-positive regression suite covers major collision pairs
- Resolver trace explains negative suppression reason

---

## 5. Tambah multi-skill bundle templates

### Objective
Define stable skill bundles for recurring task families.

### Candidate bundles
- Android build bug -> `android-kotlin`, `android-gradle`, `verification-discipline`
- Delegation review -> `delegation-quality`, `verification-discipline`, `codebase-intelligence`
- UI polish -> `human-ui-design`, `visual-qa-rubric`, `ui-pattern-library`

### Deliverables
- Bundle definitions
- Bundle-aware routing boost
- Tests showing bundle selection consistency

### Acceptance Criteria
- Known task clusters produce stable, expected bundles
- Bundles reduce inconsistent skill selection across similar prompts

---

## 6. Sub-agent routing naik ke adaptive profile

### Objective
Make sub-agent skill injection depend on role, intent, files, and history instead of static lists only.

### Desired behavior
- `jce-researcher` prefers `ai-optimization` for token/model/prompt research
- `oracle` prefers `developer-tooling` for config/tooling-heavy work
- `frontend` prefers framework skill + visual/design bundle
- `android` prioritizes exact Android subtype from prompt/files

### Deliverables
- Adaptive profile resolver for each eligible sub-agent
- Agent-specific scoring preferences

### Acceptance Criteria
- Each sub-agent profile has deterministic tests
- Profiles bias toward domain-correct skills without injecting irrelevant coding skills

---

## 7. Tambah golden routing corpus

### Objective
Create a stable benchmark set for routing correctness.

### Corpus requirements
- 200–500 prompts
- English, Bahasa Indonesia, mixed language
- typo/noisy prompts
- ambiguous prompts
- adversarial prompts

### Expected data per case
- selected skills
- rejected skills
- preferred agent
- expected trace notes

### Deliverables
- Golden corpus file(s)
- Test runner that validates router output against corpus

### Acceptance Criteria
- Routing changes are benchmarked before merge
- Corpus catches drift in skill selection and agent hinting

---

## 8. Tambah explainability report / doctor

### Objective
Expose routing internals for fast debugging.

### Commands
```bash
opencode-jce skills doctor
opencode-jce skills explain "Fix ESLint + Prettier drift in tsconfig"
```

### Output should include
- detected intent
- raw candidates
- scoring table
- selected skills
- rejected skills
- conflict eliminations
- max-cap eliminations
- sub-agent profile influence
- telemetry influence

### Acceptance Criteria
- Operator can explain any routing decision from CLI output
- Doctor can flag missing metadata, weak prompts, and low-confidence routes

---

## 9. Skill file jadi machine-readable juga

### Objective
Move routing metadata closer to each skill so markdown is both human doc and machine config.

### Frontmatter target
```yaml
routingMode: auto
intents: [bugfix, config]
signals:
  - eslint
  - prettier
files:
  - tsconfig.json
preferredAgents:
  - oracle
samplePrompts:
  - Fix ESLint + Prettier drift in tsconfig project
```

### Deliverables
- Frontmatter schema for skills
- Loader/parser support
- Validation that frontmatter and generated registry stay in sync

### Acceptance Criteria
- Skill metadata can be sourced from SKILL.md frontmatter
- Drift between docs and routing config is test-detectable

---

## 10. Tambah feedback loop dari user

### Objective
Learn from direct user correction about wrong route choices.

### Example corrections
- “jangan load skill X”
- “pakai skill Y”
- “itu salah route”
- “harusnya researcher bukan oracle”

### Deliverables
- Correction telemetry events
- Lightweight preference memory or session-level override

### Acceptance Criteria
- User correction is recorded
- Repeated corrections can influence future routing suggestions

---

## 11. Tambah confidence threshold & fallback mode

### Objective
Avoid overconfident routing on ambiguous prompts.

### Fallback behavior
- load 1 core skill + 1 safest domain skill
- or ask 1 clarifying question
- or prefer `codebase-intelligence` first

### Deliverables
- Confidence scoring threshold
- Safe fallback policy

### Acceptance Criteria
- Ambiguous prompts do not produce noisy over-routing
- Resolver reports low-confidence state explicitly

---

## 12. Tambah release-grade CI gates

### Objective
Make routing regressions block merges.

### CI should fail on
- skill count drift
- missing capability matrix entry
- missing sample prompt coverage
- missing routing mode
- prompt coverage failure
- low-confidence routing on golden corpus
- false-positive regression

### Deliverables
- CI job for skill system health
- machine-readable audit output

### Acceptance Criteria
- Routing drift is caught before release
- CI output points directly to missing or broken skill metadata

---

## Priority roadmap

### Tier 1 — highest impact
1. single source-of-truth metadata
2. weighted routing engine
3. golden routing corpus
4. telemetry learning loop

### Tier 2 — high leverage
5. negative routing
6. adaptive sub-agent profiles
7. explainability doctor/CLI

### Tier 3 — polish and hardening
8. machine-readable skill frontmatter
9. user correction learning
10. release-grade CI gates

---

## Suggested execution order

### Phase A — foundation
- build full canonical registry
- move runtime reads to registry
- add routing modes and metadata validation

### Phase B — smarter routing
- implement weighted scoring
- add negative routing
- deepen agent profile selection

### Phase C — evidence and learning
- upgrade telemetry schema
- add analytics reports
- add correction learning

### Phase D — regression safety
- build golden routing corpus
- add CI gates
- add doctor/explain CLI

---

## Definition of Done

This roadmap is complete when:

- all real skills are registry-defined
- router decisions are score-based and explainable
- telemetry can rank skill usefulness and noise
- sub-agent skill injection is adaptive
- golden corpus protects routing behavior
- CI blocks metadata/routing drift
- user corrections can influence future routes
