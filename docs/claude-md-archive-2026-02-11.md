<!-- cc-meta
appId: command-center
targetPath: CLAUDE.md
ideaId: ideation-platform-2026-02-11
generatedAt: 2026-02-11
-->

# CLAUDE.md — Command Center

## What This App Is

Command Center (CC) is a single-file HTML application (~31,700 lines) deployed via GitHub Pages. It is evolving from a deployment management tool into an **AI ideation rigor platform** — a structured system for turning vague ideas into well-formed, buildable specifications before code is written.

CC uses React (via CDN), Firebase Realtime Database for persistence, and GitHub API for repo operations. All state lives in Firebase under `command-center/{uid}/`.

## Current Build Objective

**Idea: CC Ideation Platform — Phase 1 (Add-on Idea to existing CC app)**

Build the foundational data model and management UI for the ODRC (OPEN, DECISION, RULE, CONSTRAINT) concept system and Idea lifecycle. This is the first phase of transforming CC into an ideation platform. The goal is to prove the flywheel: create Ideas, manage ODRC objects, and generate a CLAUDE.md from accumulated concepts.

### Build Scope — Steps 1 through 4

**Step 1: ODRC Data Model in Firebase**

Firebase path: `command-center/{uid}/concepts/{conceptId}`

```
concepts/{conceptId}/
├── id: string (auto-generated)
├── type: "OPEN" | "DECISION" | "RULE" | "CONSTRAINT"
├── content: string (the concept text)
├── ideaOrigin: string (idea ID that introduced this concept)
├── status: "active" | "superseded" | "resolved" | "transitioned"
├── resolvedBy: string | null (concept ID that resolved/replaced this)
├── transitionedFrom: string | null (concept ID this evolved from)
├── scopeTags: string[] (e.g., ["architecture", "data-model", "ux"])
├── createdAt: ISO timestamp
└── updatedAt: ISO timestamp
```

State machine transitions (validate these in code):
- OPEN → DECISION, RULE, or CONSTRAINT
- DECISION → RULE (hardening)
- CONSTRAINT → DECISION or RULE (when external reality changes)
- RULE → OPEN (destabilized, needs rethinking)

When a CONSTRAINT transitions, flag all active DECISIONs and RULEs that share any of its scope tags for user review.

**Step 2: Idea Object and App Relationship**

Firebase path: `command-center/{uid}/ideas/{ideaId}`

```
ideas/{ideaId}/
├── id: string (auto-generated)
├── name: string
├── description: string
├── type: "base" | "addon"
├── appId: string | null (linked App ID, null if pre-graduation)
├── parentIdeaId: string | null (for addon Ideas, the previous Idea in the chain)
├── sequence: number (ordering within an App's Idea history)
├── status: "active" | "graduated" | "archived"
├── createdAt: ISO timestamp
└── updatedAt: ISO timestamp
```

Relationship model:
- An App has many Ideas (one base, zero or more add-ons)
- Each Idea has many ODRC concepts (via `ideaOrigin` on concept objects)
- Ideas form a chain per App via `parentIdeaId` and `sequence`
- When an Idea graduates to an existing App, it becomes the latest add-on with the next sequence number

Add an `ideas` array or reference on the existing App config object to track the chain.

**Step 3: ODRC Management UI (Review & Curate)**

Build a new view accessible from the Projects/Apps section. When viewing an App, add an "Ideas" tab that shows:

1. **Idea History** — Timeline of all Ideas for this App, ordered by sequence. Each shows name, status, and count of concepts by type.

2. **Active Idea Detail** — When an Idea is selected, show all its ODRC concepts grouped by type (RULEs, DECISIONs, CONSTRAINTs, OPENs). Each concept shows:
   - Content text (editable inline)
   - Status badge
   - Scope tags (editable)
   - Provenance link (which Idea introduced it)
   - Transition controls (dropdown to change type, following valid state machine transitions)

3. **Add/Edit/Delete** — Full CRUD for concepts within an Idea. Adding a concept defaults to the current Idea as origin.

4. **Aggregate View** — Across all Ideas for an App, show the current active state: all active RULEs, all active CONSTRAINTs, all active DECISIONs, all unresolved OPENs. This is the "current truth" view that feeds CLAUDE.md generation.

**Step 4: CLAUDE.md Generation**

Add a "Generate CLAUDE.md" button on the App detail view. It assembles:

```markdown
# CLAUDE.md — {App Name}

## What This App Is
{App description from config}

## Current Build Objective
{Latest active Idea name and description}

## RULEs — Do not violate these.
{All active RULEs across all Ideas for this App, each with origin Idea name}

## CONSTRAINTs — External realities. Work within these.
{All active CONSTRAINTs}

## DECISIONs — Current direction for this phase.
{Active DECISIONs from the current Idea only}

## OPENs — Unresolved. Flag if you encounter these during build.
{All unresolved OPENs}
```

Output options:
- Copy to clipboard
- Push to repo via GitHub API (to repo root as CLAUDE.md)

---

## RULEs — Do not violate these.

- CC is the data layer. Claude is the decision layer. CC captures, organizes, and presents. It does not make decisions or contain hardcoded decision logic.
- CC is a single-file HTML application. All new features must be added to the existing index.html. No separate files, no build system.
- All session output must include an Idea tag so CC can route artifacts and concepts to the correct Idea object.
- Claude proposes, CC captures, user ratifies. No concept enters the system without user approval. All ODRC changes go through the Review & Curate UI.
- An App has a many-to-one relationship with Ideas. Ideas form a sequential chain per App. The Idea history is the app's decision archaeology.
- The lifecycle is iterative. Most Ideas don't create new apps — they define the next phase of an existing app.
- Concepts have provenance. Every ODRC object traces back to its origin Idea.
- Context flywheel: shape → challenge → capture → refine. Every feature must serve one of these verbs.

## CONSTRAINTs — External realities. Work within these.

- CC runs in a browser. No Node.js, no server-side code. Integration with external tools is via APIs (GitHub, Firebase).
- CC is a single-file HTML app deployed via GitHub Pages. Architecture must fit this model.
- Firebase Realtime Database is the persistence layer. All data under `command-center/{uid}/`.
- API keys stay in Firebase Secrets. Any API calls requiring keys go through Firebase Functions.
- CC Core target is ≤20,000 lines. Non-core features will move to satellites (separate files, hidden by default).

## DECISIONs — Current direction for this phase.

- ODRC entries are first-class objects with full state machine. Not text attributes.
- Build the ODRC data model, Idea objects, management UI, and CLAUDE.md generation as Phase 1. Skip concept extraction automation, artifact routing enhancements, and prompt templates for now.
- Use the existing CC navigation structure. Add an "Ideas" tab within the App detail view rather than creating a new top-level section.
- For CLAUDE.md generation, start with copy-to-clipboard. GitHub API push is secondary.

## OPENs — Unresolved. Flag if you encounter these during build.

- How should the ODRC management UI handle bulk import? (Needed for seeding existing concepts from documents like the ideation session output.)
- Should the Idea History timeline be a vertical list or a horizontal visual timeline?
- When generating CLAUDE.md, should the build scope section be manually written per Idea or auto-assembled from ODRC objects?
- How does the aggregate view handle concept conflicts (e.g., a RULE from Idea 1 contradicts a DECISION from Idea 3)?

## Technical Notes

- CC uses React via CDN (no JSX compilation — uses `React.createElement` or htm tagged templates)
- Firebase is initialized in the app — look for the existing Firebase config and auth patterns
- GitHub API integration exists — look for existing `githubApi` or fetch calls to `api.github.com`
- Follow existing code patterns for new views: function components, hooks for state, consistent with current UI styling (dark mode, existing color palette)
- The existing App config lives in Firebase under `command-center/{uid}/apps/{appId}` — extend this structure, don't replace it
