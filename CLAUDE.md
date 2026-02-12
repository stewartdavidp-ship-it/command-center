# CLAUDE.md — Command Center: Ideation Platform Steps 3-4

## What This App Is

Command Center (CC) is a single-file HTML application (~21,600 lines) deployed via GitHub Pages at `daveworld1.github.io/command-center/`. It manages app deployment, project planning, and session workflows. It uses React 18 (via CDN), Firebase Realtime Database for persistence, and GitHub API for repo operations. All code lives in `index.html`.

CC is evolving into an **AI ideation rigor platform** — a structured system for turning ideas into well-formed specifications using the ODRC (OPEN, DECISION, RULE, CONSTRAINT) concept framework.

## What Already Exists (Steps 1-2 — DO NOT REBUILD)

Steps 1-2 are already built and live in the codebase. Do not modify these unless fixing a bug:

**ConceptManager** (~150 lines, starts around line 4792):
- Firebase CRUD under `command-center/{uid}/concepts/{conceptId}`
- ODRC type constants: `ODRC_TYPES = ['OPEN', 'DECISION', 'RULE', 'CONSTRAINT']`
- Status constants: `CONCEPT_STATUSES = ['active', 'superseded', 'resolved', 'transitioned']`
- State machine: `ODRC_TRANSITIONS` — OPEN→DECISION/RULE/CONSTRAINT, DECISION→RULE, CONSTRAINT→DECISION/RULE, RULE→OPEN
- Methods: `create()`, `getAll()`, `getByIdea()`, `getActiveForApp()`, `update()`, `transition()`, `supersede()`, `resolve()`, `remove()`, `listen()`
- `_flagRelatedConcepts()` — flags active DECISIONs/RULEs sharing scope tags when a CONSTRAINT transitions

**IdeaManager** (~170 lines, starts around line 4995):
- Firebase CRUD under `command-center/{uid}/ideas/{ideaId}`
- App relationship index: `command-center/{uid}/appIdeas/{appId}` (array of idea IDs)
- Methods: `create()`, `getAll()`, `getByApp()`, `getActiveForApp()`, `update()`, `graduate()`, `archive()`, `remove()`, `listen()`, `listenAppIdeas()`
- Idea statuses: `active`, `graduated`, `archived`
- Idea types: `base`, `addon`

## Current Build Objective: Steps 3-4

### Step 3: ODRC Concepts View + Relationship Links

Build the UI for viewing, creating, editing, and managing ODRC concepts and Ideas.

**3A: Add global state for concepts and ideas**

Add to the App component's state declarations (near line 5487, alongside existing globals):
```javascript
const [globalConcepts, setGlobalConcepts] = React.useState([]);
const [globalIdeas, setGlobalIdeas] = React.useState([]);
```

Add listeners in the auth useEffect (near line 5520, following the existing pattern):
```javascript
unsubscribeConcepts = ConceptManager.listen(u.uid, setGlobalConcepts);
unsubscribeIdeas = IdeaManager.listen(u.uid, setGlobalIdeas);
```

Add cleanup in the auth signout block and the useEffect return. Follow the exact pattern of the existing listeners (e.g., `unsubscribeStreams`).

**3B: Add "Ideas" nav section**

Add a new nav entry to the navigation array (near line 7592):
```javascript
{ id: 'ideas', icon: '💡', label: 'Ideas', views: ['ideas'] }
```

Place it between 'sessions' and 'settings' in the nav order.

**3C: Build IdeasView component**

Create a new `IdeasView` function component. This is the primary UI for ODRC management. It has three modes:

**Mode 1: All Concepts (default)**
- Shows all ODRC concepts across all ideas, grouped by type (OPENs, DECISIONs, RULEs, CONSTRAINTs)
- Each group is collapsible with a count badge
- Each concept card shows:
  - Type badge (color-coded: OPEN=amber, DECISION=blue, RULE=red, CONSTRAINT=gray)
  - Status badge (active=green, resolved=green-outline, superseded=gray, transitioned=gray)
  - Content text (truncated to 2 lines, expandable on click)
  - Scope tags as small pills
  - Origin idea name (linked — clicking navigates to Mode 3 for that idea)
  - Actions: Edit, Transition (dropdown showing valid transitions), Resolve (for OPENs), Supersede, Delete
- Filter bar at top: filter by type, by status, by app, by idea
- "New Concept" button opens a creation modal

**Mode 2: App Aggregate View**
- Reached by clicking an app name in the filter, or via relationship link from another view
- Shows the "current truth" for one app: all active RULEs, active CONSTRAINTs, active DECISIONs (from current idea only), and unresolved OPENs across all ideas
- This is the view that represents what would go into a CLAUDE.md
- "Generate CLAUDE.md" button (Step 4) lives here
- Shows idea chain for this app as a timeline/breadcrumb at the top

**Mode 3: Idea Detail View**
- Reached by clicking an idea name anywhere, or from the idea chain in Mode 2
- Shows one idea with all its concepts
- Idea metadata: name, description, type (base/addon), status, app relationship, sequence
- Edit idea name/description inline
- Full concept list for this idea with all CRUD operations
- "Graduate" and "Archive" actions for the idea itself

**Concept Edit Modal:**
- Type selector (OPEN/DECISION/RULE/CONSTRAINT)
- Content textarea
- Scope tags input (comma-separated, converted to array)
- Idea selector (which idea this concept belongs to) — defaults to current idea if in Mode 3
- Save / Cancel

**Transition Confirmation Modal:**
- Shows current type → new type
- Explains what will happen: "This OPEN will become a DECISION. The original OPEN will be marked as transitioned."
- If transitioning a CONSTRAINT, warns: "This will flag X related concepts for review"
- Confirm / Cancel

**3D: Relationship links from existing views**

Add a small "concepts summary" card to the **DashboardView** app cards (the ones that show version, deploy status, etc.). Show counts: "3 RULEs · 2 OPENs · 1 DECISION". Clicking navigates to IdeasView Mode 2 for that app.

Add a "💡 Ideas" link to the **BacklogView** app headers. Clicking navigates to IdeasView Mode 2 for that app.

### Step 4: CLAUDE.md Generation

**4A: Generate CLAUDE.md from App Aggregate View**

Add a "Generate CLAUDE.md" button in IdeasView Mode 2 (App Aggregate). When clicked, it assembles a CLAUDE.md document from the app's active ODRC state:

```markdown
# CLAUDE.md — {App Name}

## What This App Is
{App description from config, or "No description set" if empty}

## Current Build Objective
{Latest active Idea name and description for this app}

## RULEs — Do not violate these.
{All active RULEs across all Ideas for this app}
{Each with "— from: {idea name}" attribution}

## CONSTRAINTs — External realities. Work within these.
{All active CONSTRAINTs across all Ideas for this app}
{Each with attribution}

## DECISIONs — Current direction for this phase.
{Active DECISIONs from the current/latest active Idea only}

## OPENs — Unresolved. Flag if you encounter these during build.
{All unresolved OPENs across all Ideas for this app}
{Each with attribution}

## Completion File Requirement
After completing any task, generate a completion file in `.cc/completions/`.
See the Completion File section below for format and requirements.
```

**4B: Output options**

After generation, show a preview panel with the assembled CLAUDE.md content. Two action buttons:
- **Copy to Clipboard** — copies the markdown text
- **Push to Repo** — uses the existing GitHub API (`github.pushFile()`) to write `CLAUDE.md` to the repo root. Use the app's configured repo (testRepo or prodRepo based on current environment). Show success/error toast.

**4C: Completion File section in generated CLAUDE.md**

Append this to every generated CLAUDE.md:

```markdown
## Completion File Requirement

RULE: After completing any task (bug fix, feature, refactor, exploration, or investigation), generate a completion file before ending the session or moving to the next task. Do not wait for the developer to ask.

- File location: .cc/completions/
- File name: YYYY-MM-DDTHH-MM-SS_task-slug.md (UTC timestamp, kebab-case slug, max 50 chars)
- One file per task. If a session covers multiple tasks, produce multiple files.
- Commit the completion file in a separate commit after the task's code commits.

### Completion File Format

Use markdown with YAML frontmatter:

    ---
    task: "Brief description — what was asked and what was done"
    status: complete | partial | blocked
    files:
      - path: "relative/path/to/file"
        action: created | modified | deleted
    commits:
      - sha: "abc1234"
        message: "Commit message"
    # Include when applicable:
    odrc:
      resolved_opens:
        - "Description of resolved OPEN"
      applied_decisions:
        - "Description of DECISION that guided this work"
      new_opens:
        - "New question or gap discovered"
    unexpected_findings:
      - "Things discovered that were not part of the original task"
    unresolved:
      - item: "Known issue not addressed"
        reason: "Why it was not addressed"
    ---

    ## Approach
    Describe the approach taken and why.

    ## Assumptions
    List assumptions made during the task.

    ## Notes
    Any additional context for the next session.
```

---

## RULEs — Do not violate these.

### Architecture Rules
- CC is a single-file HTML application. All new code goes in index.html. No separate files, no build system.
- CC uses React 18 via CDN (not JSX — use `React.createElement` or the htm tagged template if already present). Check the existing codebase for which pattern is used and follow it.
- All Firebase paths are under `command-center/{uid}/`. Do not create paths outside this namespace.

### State Management Rules
- All shared Firebase-backed data lives as top-level state in the App component with a `global` prefix (e.g., `globalConcepts`, `globalIdeas`).
- Firebase listeners are set up once in the App component's auth `useEffect`. Views never create their own listeners for shared data.
- Views own local UI state only (filters, modal open/close, form inputs, selected items). Views never own data that another view needs.
- Write to Firebase via service/manager methods, let the listener update state. Do not update local state optimistically — wait for the Firebase listener callback. This prevents local state and Firebase from diverging.

### Data Flow Rules
- Data flows down via props. Events flow up via callback props. No component reaches up or sideways for data.
- Service objects (ConceptManager, IdeaManager, etc.) are global singletons callable from any component. They are the write path to Firebase.
- One listener per collection per user. Never two listeners on the same Firebase path.
- Listener callbacks only call the state setter. They do not trigger side effects, other writes, or cascading state updates.
- All listener `useEffect` blocks must return a cleanup function. No orphaned listeners.

### Concurrency Rules
- If two operations could modify the same Firebase path, serialize them by design. If a modal is editing a concept, the list behind it must not allow deleting that concept simultaneously.
- Use Firebase multi-path updates (the `updates` object pattern already in ConceptManager.transition) when multiple writes must be atomic.

### UI Rules
- Follow the existing CC dark theme. Background: slate-800/900. Text: slate-100/300/400. Accent: indigo-600. Use the same Tailwind utility classes already in the codebase.
- All new UI must be consistent with existing patterns. Look at BacklogView and SessionLogView for reference — they are the most recent and best-structured views.
- Modals use the existing pattern: fixed overlay with centered card, dark backdrop, close on backdrop click or X button. Check existing modals (e.g., `WorkItemEditModal`) for the exact pattern.
- Toast notifications for success/error feedback. Use the existing `showAlert()` prop.
- Confirmation dialogs for destructive actions (delete, transition). Use the existing `showConfirm()` prop.

### Code Style Rules
- Console instrumentation with `[CC]` prefix for all new console.log statements.
- Descriptive variable names. No single-letter variables except loop counters.
- Comments for non-obvious logic. Section headers with `// ===` divider pattern matching existing code.

## CONSTRAINTs — External realities.

- CC runs entirely in the browser. No Node.js, no server-side code. External integrations via APIs only (GitHub REST API, Firebase JS SDK).
- React is loaded via CDN — no JSX compilation. Code uses either `React.createElement()` or the htm tagged template literal. Check which pattern the existing codebase uses and match it.
- Firebase Realtime Database (not Firestore). All data operations use the existing `firebaseDb.ref()` pattern.
- The App component prop list is already long (~25 props to DashboardView). Adding `globalConcepts` and `globalIdeas` is acceptable — it follows the established pattern. Do not introduce React Context or a state management library to solve this.
- The nav has 4 existing sections (Deploy, Plan, Sessions, Settings). Adding a 5th (Ideas) is acceptable. Do not reorganize or rename existing nav sections.
- Existing views and their functionality must not change. Do not modify DashboardView, BacklogView, SessionLogView, or any other existing view beyond adding the small relationship links specified in Step 3D.

## DECISIONs — Current direction.

- ConceptManager and IdeaManager are standalone JS objects placed between the GitHub API class and the Main App function. They are not React components. They are the data/service layer.
- `appIdeas/{appId}` is a denormalized Firebase index mapping apps to idea IDs. This is intentional for fast lookup. The source of truth for idea data is `ideas/{ideaId}`.
- `supersede()`, `resolve()`, and `transition()` are distinct operations on concepts. Supersede replaces content (same type). Resolve marks an OPEN as done. Transition changes the type following the state machine.
- The IdeasView is its own top-level view with its own nav entry. It is not nested inside another view. It has relationship links from App cards and Backlog headers.
- Top-level listeners for `globalConcepts` and `globalIdeas` in the App component, following the existing pattern for all other shared data.

## OPENs — Unresolved. Flag if you encounter these.

- Prop drilling is approaching its practical limit in the App component. If adding `globalConcepts` and `globalIdeas` as props to views feels unwieldy, note it in the completion file but do not refactor to Context — that's a future architectural decision.
- The `appIdeas` index could get out of sync with the ideas collection if writes fail partway. If you see a case where this could happen, note it but don't over-engineer a sync check.
- Line budget: the codebase is ~21,600 lines. This build should add 400-700 lines. If you're significantly exceeding that, you may be over-building. Flag it.
- The CLAUDE.md generation template is a first draft. If during implementation you see fields that should be added or removed, note it in the completion file.

## File Structure

All code lives in a single file:
```
command-center/
├── index.html          ← All CC code (this is what you edit)
└── .cc/
    └── completions/    ← Where completion files go (create this directory)
```

## Version

Bump the version in `<meta name="version" content="X.X.X">` (line 7). Current version is 8.55.2. Bump to 8.57.0 for this build (minor version bump for new feature).

## Where To Insert New Code

- **Global state + listeners**: In the `App()` function, near line 5487 (alongside existing `globalIssues`, `globalWorkItems`, etc.)
- **IdeasView component**: After the last existing view component and before the utility functions section. Look for a natural break point. The component should be ~400-600 lines.
- **Nav entry**: In the nav sections array near line 7592.
- **Relationship links**: Small additions (~10-20 lines each) inside DashboardView and BacklogView.
- **View routing**: In the main render block near line 7824 where `{view === 'dashboard' && ...}` pattern is used.

## Completion File Reminder

When you finish this build, create a completion file at `.cc/completions/` following the format specified above. This is the first completion file for this project — it is itself a test of the process. Include what you built, what decisions you made, any unexpected findings, and any OPENs that emerged.
