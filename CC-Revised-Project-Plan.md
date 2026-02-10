# Command Center — Revised Project Plan (Phases 1–4)

> Incorporates Project Scoper concepts, Starting Standards, and category-driven scoping into the orchestrator roadmap.
> Phase 0 (Foundation) is complete — data services, lifecycle metadata, token estimator, engine registry all in place as of v8.21.1.

---

## Key Design Principles (from this planning session)

These principles emerged from analyzing the Project Scoper proof-of-concept against CC's actual needs and the history of 19 apps built in this ecosystem.

### 1. Capture → Clarify → Enrich → Generate → Scaffold

The scoping flow is a **conversation**, not a one-shot generation. The tool draws decisions out of the developer through targeted questions, not by guessing from a single sentence. AI augments thinking — it doesn't replace it.

### 2. Describe, Don't Store Code

AI is fast at generating code from descriptions. The value isn't in storing template code blocks — it's in **describing what to build** precisely enough that any Claude session can execute against it. Starting standards are requirement statements, not code libraries.

### 3. Standards Profiles Over Boilerplate

Each app gets a **standards profile** — a structured set of requirement statements assembled from the developer's selections during scoping. This profile describes the v0.7 baseline (theming, menu, toasts, responsive layout, etc.) that the first Claude session builds against. The profile lives in CLAUDE_INSTRUCTIONS.md and travels with every Claude Prep package.

### 4. Category-Driven Question Sets

App categories (game, tool, dashboard, content, admin) each imply different concerns. Games need streaks, sharing, daily resets. Tools need CRUD, import/export, persistence strategy. The scoping flow asks targeted questions based on category — codified from experience building across all app types, not AI-generated.

### 5. Every Phase Delivers Standalone Value

If you stop after any phase, what you've built is useful on its own. No phase depends on completing all subsequent phases to be valuable.

---

## What Phase 0 Delivered (Complete)

| Version | What Was Built |
|---------|---------------|
| v8.20.0 | Data service layer: `WorkItemService`, `SessionService`, `TokenRegistryService`, `EngineRegistryService`. App lifecycle metadata on schema. |
| v8.21.0 | AI Engines settings UI (comparison table, default selector, session type recommendations). Token estimation integrated into Claude Prep (per-file counts, budget bar, over-budget recommendations, file manifest table). |
| v8.21.1 | Bug fixes and polish |

**Starting point for Phase 1:** All four data services exist. Token estimation works in Claude Prep. Engine registry has UI in Settings. Lifecycle metadata fields are on the app definition schema. WorkItemService has CRUD methods but no UI yet.

---

## Phase 1: Backlog + Project Scoping (3 sessions)

> Work tracking system AND the scoping flow that populates it. These are built together because the scoping output feeds directly into backlog items.

### Session 1.1: BacklogView + Work Item CRUD

**Goal:** First top-level view for tracking planned work across all apps.

**Build:**
- New top-level navigation tab: **Backlog**
- `BacklogView` component: list work items grouped by app, filtered by status/type/app
- `WorkItemEditModal`: create/edit work items with all fields from WorkItemService schema
  - Fields: title, description, type (feature/bugfix/enhancement/chore/research), priority (core/nice-to-have/out-of-scope), status, effort (quick/session/multi-session/epic), app assignment
  - Acceptance criteria list (add/remove/reorder)
  - Context fields: files affected, sections, dependencies, notes
- Status transitions: idea → ready → in-progress → done → deferred
- Work item `source` field: `manual` | `scoped` | `imported` | `promoted`
- `WorkItemService.createBatch(items)` method for bulk creation
- Dashboard integration: work item count badges on app cards

**Acceptance Criteria:**
- [ ] Backlog nav tab appears in main navigation
- [ ] Can create work items with all fields
- [ ] Can edit and change status of existing work items
- [ ] Items display grouped by app with status badges
- [ ] Filter by status, type, and app works
- [ ] Batch create method exists on WorkItemService
- [ ] Dashboard app cards show open work item count
- [ ] All existing functionality works identically

---

### Session 1.2: Project Scoping Flow

**Goal:** Category-driven scoping that produces structured requirements — the "capture → clarify" steps that replace the first 15 minutes of every Claude session.

**Build:**

#### A. Scoping Modal (`ProjectScopeModal`)

Accessible from two places:
1. Setup New App wizard (new step between Define and Check Repos)
2. Backlog view ("Scope New Work" action on any existing app)

**Step 1 — Describe** (capture)
- Free-text description field: "What does this app do? Who is it for?"
- App category selector: game | tool | dashboard | content | admin
- If launched from Setup Wizard, app name/icon/project already populated

**Step 2 — Clarify** (category-driven questions)

Dynamic question sets based on category selection. These are deterministic — no AI call needed.

| Category | Questions Asked |
|----------|----------------|
| **Game** | Daily reset mechanic? Difficulty modes? Scoring system? Share results? Multiplayer/social? Streaks? Achievements? |
| **Tool** | Data persistence strategy? Import/export formats? Print support? Multi-item management? Undo/redo? |
| **Dashboard** | Data sources? Refresh frequency? Card/grid vs table layout? Filtering/search? Export? |
| **Content** | Static or dynamic? CMS needs? SEO requirements? Media types? |
| **Admin** | Auth required? Role-based access? Audit logging? Bulk operations? |

Each question is a toggle, select, or short text — not open-ended. Answers pre-select starting standards and suggest features.

**Step 3 — Features & Priorities** (enrich)
- V1 Features list (add/remove/reorder) — pre-populated from category question answers
- Future Features list (V2+ ideas that inform architecture but aren't V1)
- Key Decisions list (things to resolve before or during Session 1)
- Each feature has: title, brief description, priority (core/nice-to-have), effort estimate
- Optional: "Suggest more features" button that calls AI to augment based on description + category + answers (requires Anthropic API key in Settings)

**Step 4 — Starting Standards** (scaffold spec)
- Assembled automatically from category + question answers
- Displayed as a reviewable checklist, developer can toggle items
- Grouped into sections:

**Universal (always on):**
- CSS variables with `:root` / `[data-theme]` pattern
- Dark mode default with light mode toggle
- Theme persistence in localStorage
- Mobile-first responsive, safe area support
- Toast notification system (no native alert/confirm)
- Hamburger menu with settings panel
- Meta tags (version, gs-app-id)
- Version display in settings

**Category-driven (pre-selected based on answers):**
- Share results (navigator.share → clipboard fallback)
- Tutorial/onboarding (welcome → guided steps → replay from menu)
- Streak tracking with daily reset (midnight UTC)
- Celebration effects on achievement
- Firebase auth flow (Google sign-in)
- Firebase RTDB read/write helpers
- PWA boilerplate (sw.js, manifest.json)
- Tab navigation pattern
- Print-friendly CSS

**Output:** Scope JSON stored on `app.lifecycle.scope`:
```javascript
scope: {
    description: "...",
    category: "game",
    categoryAnswers: { dailyReset: true, scoring: 'points', ... },
    v1Features: [{ title, description, priority, effort }],
    futureFeatures: [{ title, description }],
    keyDecisions: [{ title, description, resolved: false }],
    startingStandards: ['dark-light-toggle', 'toasts', 'share-results', ...],
    scopedAt: '2026-02-10T...',
    source: 'manual'  // or 'ai-assisted' if AI enrichment was used
}
```

#### B. Auto-Generate Work Items from Scope

When scope is saved:
- Each V1 feature → work item (type: feature, status: ready, priority from scope, source: 'scoped')
- Each future feature → work item (type: feature, status: idea, priority: nice-to-have, source: 'scoped')
- Each key decision → work item (type: research, status: ready, source: 'scoped')
- Uses `WorkItemService.createBatch()`

Developer reviews and can edit/delete before confirming.

**Acceptance Criteria:**
- [ ] Scoping modal accessible from Setup Wizard and Backlog view
- [ ] Category selection drives dynamic question set
- [ ] Feature lists are pre-populated from category answers
- [ ] Starting standards checklist assembled from selections
- [ ] Scope JSON stored on app.lifecycle.scope
- [ ] Work items auto-generated from scope (with review step)
- [ ] Scoping works fully without an API key (AI enrichment is optional)

---

### Session 1.3: CLAUDE_INSTRUCTIONS.md + Backlog Polish

**Goal:** The scope and standards profile become a living document that travels with every Claude Prep package. Plus backlog UX improvements.

**Build:**

#### A. CLAUDE_INSTRUCTIONS.md Generator

New function: `generateClaudeInstructions(app, config)` that produces a permanent AI briefing document from the app's scope and lifecycle metadata.

**Document structure:**
```
# {App Name} — AI Development Instructions

## Project Identity
{Description from scope, category, audience}

## Starting Standards
{Assembled from startingStandards selections — described as requirements, not code}
- Dark mode default with light mode toggle using data-theme attribute on <html>
- CSS variables for all colors (never hardcoded values)
- Mobile-first responsive design, minimum 44px touch targets
- Toast notifications for all user feedback (no native alert/confirm/prompt)
- [etc. — each standard is a requirement statement]

## V1 Feature Scope
{From v1Features — what to build and what NOT to build}

## Architecture Constraints
{From category answers + starting standards — e.g. "Single-file HTML, all inline"}

## Key Decisions
{Unresolved items from keyDecisions}

## Session Protocol
{Standard session start/end conventions from CLAUDE-PREP-STANDARD}

## Package Convention
{Standard deploy package structure}
```

This document:
- Is generated once during scoping, then maintained manually like CONTEXT.md
- Gets added to `CLAUDE_PREP_DOCS` list so Claude Prep includes it in packages
- Replaces the generic prompt from `generateClaudePrompt()` for new apps
- Can be regenerated from scope data if needed (but manual edits take precedence)

#### B. Issue → Work Item Promotion

- "Promote to Work Item" action on issues in IssuesView
- Pre-fills work item from issue data (title, description, app, source: 'promoted')
- Issue gets linked to resulting work item

#### C. Backlog UX Polish

- Work item search (title/description text search)
- Sort by: priority, status, created date, effort
- Backlog summary section on Dashboard (total items by status across all apps)
- Bulk status update (select multiple → change status)

**Acceptance Criteria:**
- [ ] `generateClaudeInstructions()` produces well-structured document from scope data
- [ ] CLAUDE_INSTRUCTIONS.md included in Claude Prep packages when present
- [ ] Issues can be promoted to work items
- [ ] Backlog has search, sort, and bulk actions
- [ ] Dashboard shows backlog summary

---

## Phase 2: Session Orchestrator (3 sessions)

> The AI-aware session planning and targeting system. Claude Prep evolves from "here's everything" to "here's exactly what you need for this task."

### Session 2.1: Session Types + Enhanced Brief Generator

**Goal:** Different types of work need different context. A bug fix session needs different files and framing than a design session.

**Build:**
- Session type definitions: Build | Design | Fix | Test | Research | Review | Polish | Document
- Each type has: description, suggested engine, context strategy (which files to include/skip), role frame for the AI, delivery requirements
- Rewrite `generateSessionBrief()` → `SessionBriefGenerator` module
- Session-type-aware brief generation:
  - Role frame: "You are working on a bug fix session" vs "You are designing a new feature"
  - Scope rules: "Fix ONLY the reported issue, do not refactor" vs "Design the full feature, defer implementation"
  - Delivery requirements: what the session must produce
- Auto-suggest session type from work item type (feature → Build, bugfix → Fix, etc.)

**Acceptance Criteria:**
- [ ] 8 session types defined with context strategies
- [ ] Brief generator produces type-aware output
- [ ] Session type auto-suggested from work item type
- [ ] Generated briefs include role frame, scope rules, and delivery requirements

---

### Session 2.2: Enhanced Claude Prep — Session Wizard

**Goal:** Transform Claude Prep from a one-click dump into a guided flow that produces targeted, right-sized packages.

**Build:**
- Transform `ClaudePrepModal` into multi-step `ClaudeSessionWizard`:
  - **Step 1: What are you working on?**
    - Select a work item from backlog (filtered to this app, status: ready or in-progress)
    - Or "General session" for exploratory/unstructured work
  - **Step 2: Session type**
    - Auto-suggested from work item type, overridable
    - Shows what this type means (role frame, scope rules, delivery)
  - **Step 3: Context budget review**
    - Token budget visualization with engine context limit
    - File list with per-file token counts
    - Session-type-aware file inclusion (Design sessions skip CHANGELOG, Fix sessions include issue details)
    - CLAUDE_INSTRUCTIONS.md included when present
    - Over-budget recommendations from existing `EngineRegistryService.checkBudget()`
  - **Step 4: Generate + download**
    - Package built with selected files
    - SESSION_BRIEF.md includes work item context (acceptance criteria, files affected, dependencies)
    - Maturity constraint in brief ("Build to {maturity} quality")
    - Download zip
- Work item status auto-transitions to "in-progress" when session package is generated

**Acceptance Criteria:**
- [ ] Full wizard flow from work item selection through download
- [ ] Session type drives file inclusion strategy
- [ ] Brief includes work item acceptance criteria and context
- [ ] Token budget preview accurate with session-type-aware file selection
- [ ] Work item transitions to in-progress on package generation

---

### Session 2.3: Session Tracking + Deploy Close-the-Loop

**Goal:** Close the cycle — CC knows when a session started (prep) and when it ended (deploy), and connects the dots.

**Build:**
- Session entity created when Claude Prep generates a package (SessionService)
  - Records: app, work items targeted, session type, engine used, token budget, timestamp
- In `handleDeploy()`, after successful deploy:
  - Detect in-progress work items for this app
  - Show completion dialog: "This deploy may complete WI-042: {title}. Mark done?"
  - If confirmed: update work item status to done, link to deploy record
- Deploy record enriched with: work items completed, session reference, release notes (from RELEASE_NOTES.txt if present in package)
- Session history tab (could be sub-tab on existing SessionLogView)
  - Shows: date, app, session type, work items, resulting deploy (if any)

**Acceptance Criteria:**
- [ ] Session record created on Claude Prep package generation
- [ ] Deploy triggers work item completion dialog
- [ ] Work item status updates on confirmation
- [ ] Deploy history shows linked work items
- [ ] Session history view shows prep → deploy connections

---

## Phase 3: Enhanced Setup Wizard (2 sessions)

> The setup wizard becomes the full project kickstart. Scoping (from Phase 1.2) feeds directly into smart generation.

### Session 3.1: Integrated Setup Flow

**Goal:** Merge the scoping flow into the setup wizard so new apps launch with full context from day one.

**Build:**
- Restructure `SetupNewAppView` steps:
  1. **Define** (existing: name, ID, icon, project, structure, PWA, admin)
  2. **Scope** (from Phase 1.2: describe → clarify → features → standards)
  3. **Check Repos** (existing: verify repo availability)
  4. **Create & Configure** (existing: create repos, enable Pages + NEW: generate enhanced artifacts)
  5. **Review & Launch** (new: review generated artifacts, confirm, deploy seed)
- Move scoping from standalone modal into wizard Step 2 (reuse same component)
- "Quick setup" option that skips scoping for simple/throwaway apps

**Acceptance Criteria:**
- [ ] Setup wizard has 5 steps with scoping integrated
- [ ] Scoping pre-populates lifecycle metadata, work items, and standards profile
- [ ] Quick setup option available for skipping scope
- [ ] All existing setup functionality preserved

---

### Session 3.2: Smart Artifact Generation

**Goal:** Generated artifacts start the project at v0.7 instead of v0.1.

**Build:**
- Enhanced `generateInitialHTML(app)`:
  - Uses scope + starting standards to describe what the seed should include
  - Seed is a **functional app shell** described by the standards profile, not a placeholder
  - Note: The seed itself is still generated by Claude in the first session — CC describes what to build, not how to build it. The seed HTML from CC is intentionally minimal; the CLAUDE_INSTRUCTIONS.md tells Claude how to evolve it.
- Enhanced `generateClaudeInstructions(app)`:
  - Full standards profile rendered as requirement statements
  - V1 feature scope with acceptance criteria
  - Category-specific conventions
  - Architecture constraints from selections
- Pre-populated `CONTEXT.md`:
  - Architecture section filled from category + tech selections (not TODO placeholders)
  - Data schema stubs from Firebase path selections
  - Deploy info populated from repo config
- Pre-populated `PROJECT_PLAN.md`:
  - Mission from scope description
  - Phase 1 features from V1 feature list
  - Architecture decisions from category answers
  - Open questions from unresolved key decisions
- Auto-create backlog items from V1 features (if not already created during scoping)
- Auto-deploy seed to test environment after generation
- All generated docs committed to repo via GitHub API

**Acceptance Criteria:**
- [ ] CLAUDE_INSTRUCTIONS.md generated with full standards profile and feature scope
- [ ] CONTEXT.md pre-populated (no TODO placeholders for captured fields)
- [ ] PROJECT_PLAN.md pre-populated with features and decisions
- [ ] Backlog items created from scope
- [ ] Seed deployed to test environment
- [ ] Docs committed to repo
- [ ] First Claude session can start building immediately from generated artifacts

---

## Phase 4: Analytics + Optimization (2 sessions)

> Visibility into the development process and environment optimization.

### Session 4.1: Portfolio View + Cost Tracking

**Goal:** See the big picture across all apps — maturity, velocity, costs.

**Build:**
- Portfolio dashboard (new view or Dashboard enhancement):
  - App maturity distribution (how many at each stage)
  - Backlog health (total items by status, aging items)
  - Session velocity (sessions per week, sessions per app)
  - Deploy frequency (deploys per week, by app)
- Per-session cost estimation (package tokens × engine pricing from EngineRegistryService)
- Cumulative cost tracking by app, session type, time period
- Maturity badges on Dashboard app cards (from lifecycle.currentMaturity)

**Acceptance Criteria:**
- [ ] Portfolio view shows maturity, backlog, velocity, and deploy metrics
- [ ] Cost estimates calculated per session
- [ ] Cumulative cost visible by app and time period
- [ ] Maturity badges on Dashboard

---

### Session 4.2: Environment Optimization Guide

**Goal:** Help configure Claude Projects and other external tools for maximum efficiency.

**Build:**
- Per-app Claude Project setup guide:
  - Which docs are "persistent" (rarely change → Project Knowledge): CONTEXT.md, CLAUDE_INSTRUCTIONS.md, ARCHITECTURE.md
  - Which docs are "session" (change often → upload each time): source files, SESSION_BRIEF.md, CHANGELOG.md
  - Token savings estimate ("Using a Project saves ~X tokens per session")
- Recommended Project Instructions (generated from CLAUDE_INSTRUCTIONS.md)
- Recommended Skills (based on app category and tech stack)
- Platform feature recommendations per session type

**Acceptance Criteria:**
- [ ] Per-app guide identifies persistent vs session docs
- [ ] Token savings estimate calculated
- [ ] Project Instructions recommendation generated
- [ ] Guide is actionable and accurate

---

## Summary

| Phase | Sessions | What You Get |
|-------|----------|-------------|
| **Phase 0: Foundation** | 3 ✅ | Data services, engine registry, token counting in Claude Prep |
| **Phase 1: Backlog + Scoping** | 3 | Work items, category-driven scoping, starting standards, CLAUDE_INSTRUCTIONS.md, auto-populated backlogs |
| **Phase 2: Session Orchestrator** | 3 | Session types, targeted Claude Prep wizard, deploy close-the-loop, session tracking |
| **Phase 3: Enhanced Setup** | 2 | Integrated scoping in setup wizard, smart artifact generation, v0.7 starting point |
| **Phase 4: Analytics** | 2 | Portfolio view, cost tracking, environment optimization guides |
| **Total remaining** | **10** | **CC as AI Development Orchestrator** |

## Sequencing Rationale

- **Phase 1 merges backlog + scoping** because the scoping output IS backlog items. Building them separately means building the backlog empty and backfilling later — wasteful. Building them together means the first time you use BacklogView, you can populate it from a 2-minute scoping flow.
- **Phase 1 includes CLAUDE_INSTRUCTIONS.md** because it's the primary consumer of the standards profile. Without it, the standards profile has no delivery mechanism to Claude sessions.
- **Phase 2 builds on Phase 1** — session types target work items, Claude Prep selects work items, deploy closes work items. The backlog must exist first.
- **Phase 3 integrates scoping into setup** — the scoping component from Phase 1.2 gets reused in the wizard. The smart generation uses scope data that the scoping flow already knows how to produce.
- **Phase 4 is retrospective** — needs session/deploy data accumulated from Phases 2-3 to be useful.

## What Changed From the Original Plan

| Original | Revised | Why |
|----------|---------|-----|
| Phase 1 was backlog only, scoping was Phase 3 | Scoping moved into Phase 1 | Scoping produces the data that populates the backlog — building them separately is backwards |
| Stored code template library for starting standards | Standards profile as requirement descriptions | AI generates code fast from descriptions; storing code adds maintenance burden without saving tokens |
| AI-generated scope from one sentence | Category-driven question sets (AI optional) | The conversation that draws out decisions is more valuable than AI guessing from a sentence |
| `generateClaudePrompt()` enhanced | CLAUDE_INSTRUCTIONS.md as new standard doc | A living document in the repo > a one-time prompt. Travels with every Claude Prep package. |
| Phase 1.3 had PROJECT_PLAN.md import | Replaced with Issue → Work Item promotion | Parsing markdown checkboxes is fragile; promoting tracked issues is cleaner |
| Milestones as separate session (1.2) | Deferred — maturity tracking sufficient for now | Milestones add complexity; maturity badges + backlog status provide enough structure initially |
| Context Budget Advisor as separate session (2.3) | Absorbed into Session Wizard (2.2) | The budget visualization already exists in Claude Prep; the wizard just needs to make it session-type-aware |
| 11-14 sessions total | 10 sessions remaining | Tighter scope per session, less feature sprawl |

## What We're NOT Doing

- Storing template code blocks (AI generates from descriptions)
- AI-powered scoping as the primary path (category-driven questions work without API key; AI enrichment is optional)
- Milestones as a formal entity (maturity levels + backlog status are sufficient)
- Full `generateInitialHTML()` rewrite to produce rich app shells (CLAUDE_INSTRUCTIONS.md tells Claude what to build; the seed stays intentionally minimal)
- Real-time AI API integration from CC (CC orchestrates; AI sessions happen elsewhere)
- Multi-user collaboration (CC is a single-developer tool)
