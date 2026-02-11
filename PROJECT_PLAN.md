# Command Center — Project Plan

## Mission

Single-file web application for managing deployment, monitoring, and configuration of the Game Shelf ecosystem and related projects.

---

## Completed Features

### Core Deployment (v8.0–8.3)
- [x] Drag-and-drop file deploy to GitHub Pages via API
- [x] Version detection from `<meta name="version">` tags
- [x] Auto-detect which app a file belongs to (regex patterns)
- [x] Deploy history with timestamps, versions, rollback support
- [x] Batch deploy from gs-active zip archives (Smart Deploy)
- [x] Multi-environment support (test, prod)
- [x] Test → Prod promotion workflow
- [x] GitHub Pages enable/force rebuild
- [x] Git tags on deploy
- [x] Quick rollback snapshots

### App Management (v8.3–8.7)
- [x] App categories (public/internal/other)
- [x] Repo auto-mapping from GitHub API
- [x] App edit modal with detection patterns, repo patterns
- [x] SubPath support for apps in subdirectories
- [x] ConfigManager v3 with migration and backward compatibility

### Monitoring (v8.4–8.7)
- [x] Firebase RTDB connection status
- [x] User stats from Firebase (player counts, activity)
- [x] Beta program management (testers, invites, referrals)
- [x] Integration status checks
- [x] Issue tracker linked to app versions

### Infrastructure (v8.5–8.7)
- [x] Session logging with activity tracking
- [x] Repo file browser
- [x] Orphan file cleanup detection
- [x] gs-active archive management
- [x] GitHub API wrapper (repos, files, pages, tags, contents)

### Project System (v8.7.7–8.8.0)
- [x] Setup New App wizard (4-step: define → check → create → prompt)
- [x] Project-based grouping (replaces category-based)
- [x] 5 default projects with colors and ordering
- [x] Dashboard collapsible project cards with auto-expand on deploy
- [x] Standalone Projects & Apps view
- [x] Project state (active/hidden) with Dashboard filtering
- [x] Timestamp tracking (createdAt/updatedAt) on all apps
- [x] Claude project prompt generation

### Claude Prep — Push Docs & Extras (v8.13.1.x)
- [x] Push Docs to Repo — drop .md/.txt or .zip, push to GitHub via API
- [x] Zip extraction — extracts all .md/.txt from zip packages, deduplicates
- [x] Existing file detection — checks repo SHA for update vs create
- [x] Progress UI — staging → animated pushing → completion/error banners
- [x] Extra docs scanning — Claude Prep scans repo for additional .md files beyond standard set
- [x] Dynamic app detection — configurable patterns from app config scored by specificity
- [x] `window.__CC_APPS` exposure for detection function access

### Unified Package Validation (v8.36.0)
- [x] `getValidationIntent()` — intent detection from selected files (quick-deploy, targeted-update, deploy-package, full-package, docs-only)
- [x] `validatePackage()` — single unified validator replacing 4 separate mechanisms
- [x] Inline validation panel — three-tier severity (grey/amber/red) in deploy controls
- [x] Version bump in CC — code-only deploys get patch bump button + custom version input
- [x] `generateClaudeFixPrompt()` — contextual Claude fix prompt for full packages
- [x] Deploy button state machine — disabled on errors, amber on warnings, override checkbox for force deploy
- [x] Removed: `validateDocPackage()`, extraction-time showAlerts, deploy-time confirms, VersionWarningModal trigger, per-file doc indicators

### App Configuration Improvements (v8.13.0.4–0.8)
- [x] Sub Path field in AppEditModal for subdirectory apps
- [x] Repository Assignment dropdowns — select from real GitHub repos
- [x] Shared vs Available repo grouping with app usage labels
- [x] Preview path display (repo + subPath → target file)
- [x] Manual entry toggle for advanced pattern editing
- [x] Projects promoted to main navigation (5 tabs)
- [x] Emoji picker on App and Project edit modals
- [x] Auto-generated detection patterns from app name (title, kebab, camel, upper)
- [x] Race condition fix for auto-generate (single handleNameChange function)

### Claude Prep — Session Prep per App (v8.13.0)
- [x] `ClaudePrepModal` — fetch source + docs from repo, generate session brief, bundle zip
- [x] 🤖 button on each app row in ProjectsTab
- [x] Doc detection: standalone repos (root) vs consolidated repos ({subPath}/docs/)
- [x] Bootstrap missing docs: generate skeleton CONTEXT.md, PROJECT_PLAN.md, CHANGELOG.md, RELEASE_NOTES.txt
- [x] Auto-generated SESSION_BRIEF.md with versions, recent deploys, open issues, app config
- [x] JSZip integration for in-browser zip creation and download
- [x] Progress modal with log, file manifest, and download button

### Projects as Stored Data (v8.12.0)
- [x] `config.projects` in ConfigManager — projects stored alongside apps in `cc_config_v3`
- [x] Migration from `DEFAULT_PROJECTS` → `SEED_PROJECTS`, `_standalone` → `other`
- [x] ProjectEditModal — create/edit/delete with name, icon, color picker, description, order
- [x] `getProjectsWithApps()` reads from `config.projects`
- [x] `AppEditModal` and `SetupNewAppView` dropdowns read from stored projects
- [x] ConfigManager CRUD: `addProject()`, `updateProject()`, `removeProject()`, `getProjectAppCount()`
- [x] Project state persisted in config (replaces `cc_projectStates` localStorage)

### Firebase Admin (v8.9.0)
- [x] Service account JSON key storage in localStorage
- [x] JWT signing using Web Crypto API (RS256)
- [x] Google OAuth2 token exchange with 55-minute caching
- [x] Admin API methods: getRules, putRules, listFunctions, getLogs
- [x] FirebaseAdminSettings UI in Settings view
- [x] 3-point connection test (token, rules, functions)

### Firebase Rules Manager — Phase 2 (v8.10.0)
- [x] FirebaseView refactored to tabbed layout (Data Browser + Rules)
- [x] FirebaseDataBrowser extracted from original FirebaseView
- [x] Fetch & display rules — calls `firebaseAdmin.getRules()`, renders as formatted JSON
- [x] Inline editor with Tab support, real-time JSON validation, Format button
- [x] Validate before deploy — checks JSON syntax and requires top-level `rules` key
- [x] Deploy rules — calls `firebaseAdmin.putRules()` with confirmation dialog
- [x] Rules history — auto-snapshot before each deploy to localStorage (`cc_rulesHistory`, 20 max)
- [x] Manual snapshot button for saving current state
- [x] Snapshot viewer with raw JSON and line-by-line diff against current rules
- [x] Rollback — restore any snapshot to editor, then deploy

### Orchestrator Phase 0: Foundation (v8.20.0–8.21.1)
- [x] WorkItemService — Firebase CRUD for backlog work items
- [x] SessionService — Claude session tracking
- [x] TokenRegistryService — Heuristic token estimation
- [x] EngineRegistryService — AI engine profiles, session type recommendations
- [x] App lifecycle metadata on schema
- [x] AI Engines settings UI (comparison table, default selector)
- [x] Token estimation + context budget bar in Claude Prep

### Orchestrator Phase 1.1: Backlog View (v8.22.0)
- [x] BacklogView — top-level nav, work item list with grouping/filtering/search/sort
- [x] WorkItemEditModal — full CRUD with all fields, acceptance criteria, tags, context
- [x] Status transitions — idea → ready → in-progress → done → deferred with quick buttons
- [x] Bulk operations — multi-select + bulk status update
- [x] Dashboard integration — work item badges on app cards, backlog summary widget
- [x] WorkItemService.createBatch() — bulk create for scoping flow
- [x] WorkItemService.delete() — individual item deletion
- [x] Copy for Claude — formatted context generation per work item
- [x] source field — manual | scoped | imported | promoted

### Orchestrator Phase 2.2: Claude Session Wizard (v8.26.0)
- [x] 4-step wizard flow: Work Items → Session Type → Context Budget → Generate+Download
- [x] Visual step indicator with clickable completed steps
- [x] Context budget preview — pre-build file inclusion strategy by session type
- [x] Work item auto-transition to in-progress on package generation
- [x] Session record creation via SessionService
- [x] Session-type-aware file filtering (skip/include per context strategy)
- [x] Quick skip path for fast builds

### Orchestrator Phase 2.3: Session Tracking + Deploy Close-the-Loop (v8.27.0)
- [x] Deploy triggers work item completion dialog for in-progress items
- [x] Session → deploy linking with status transition (prep → completed)
- [x] Deploy records enriched with sessionId, sessionType, workItemsCompleted
- [x] Session History panel with stats, filters, expandable cards
- [x] globalSessions state with SessionService.listen()

### Phase 3.1: Integrated Setup Flow (v8.28.0)
- [x] Setup wizard Step 5 renamed to "Review & Launch"
- [x] Scoping pre-populates lifecycle metadata on app config (maturity, complexity, scope)
- [x] Auto-create work items from scope via WorkItemService.createBatch()
- [x] Review & Launch step with summary grid, work items table, Claude instructions
- [x] Quick setup option preserved (skip scope)

### Orchestrator Phase 4.1: Portfolio View + Cost Tracking (v8.30.0)
- [x] PortfolioView — maturity distribution, backlog health, session velocity, deploy frequency
- [x] Cost estimation — per-session cost from package tokens × engine pricing (input + 30% output)
- [x] Cost breakdown table by app with sessions, tokens, cost columns
- [x] Time range filter (7d/30d/90d/All Time) on Portfolio view
- [x] Maturity badges on Dashboard app cards (colored by stage)

### Orchestrator Phase 4.2: Environment Optimization Guide (v8.31.0)
- [x] EnvironmentOptimizationView — per-app Claude Project setup guides
- [x] Doc classification — persistent (Project Knowledge) vs session (upload each time)
- [x] Token savings calculator — per-session and monthly savings estimates
- [x] Project Instructions generator — copy-paste-ready Custom Instructions from app metadata
- [x] Skills recommendations — category-driven with relevance badges
- [x] Platform feature recommendations with status badges
- [x] Session type quick reference table
- [x] 6-step setup checklist per app

### Unified Plan Phase 1: Clean (v8.37.0)
- [x] Removed scoping Step 4 (Standards checkboxes) — auto-assembled silently
- [x] Merged session wizard Step 3 into Step 2 as collapsible "What Claude will see"
- [x] Hidden implementation details (drives text, token bar, file manifest)
- [x] Quick Build bypass for 0 work items
- [x] "Your Name" field in Settings with `createdBy` on records

### Unified Plan Phase 2: Rewrite PM-First Language (v8.38.0)
- [x] All 5 category scoping questions rewritten as PM intent
- [x] Jargon relabeled (V1→Launch, Core→Must have, Environment Optimization→Setup Guide)
- [x] Outcome statements on wizard steps
- [x] Redundant questions removed/merged
- [x] Acceptance criteria coaching

### Unified Plan Phase 3: Close the Loop (v8.39.0–v8.40.0)
- [x] Post-Session Review Flow — 4-step guided inline review (v8.39.0)
- [x] Session-Deploy-WorkItem linking — enriched deploy records (v8.27.0)
- [x] Activity Logging — ActivityLogService audit trail (v8.39.0)
- [x] Work Item Lifecycle Automation — `review` status, Idea→Ready auto-suggest, In-Progress→Review on session review, stale detection badges (v8.40.0)

### Unified Plan Phase 4.1–4.3: Dashboard Polish (v8.41.0)
- [x] Product Health dashboard — Features Shipped, Pipeline count, Session-Ready apps, Cost per Feature metrics
- [x] Smart Quick Actions — Start Session (most-ready app), Add Idea, Review Session, Smart Deploy
- [x] Header Quick Actions realigned — Add Idea, Smart Deploy, Portfolio; Deploy Staged conditional
- [x] Pipeline Health panel — horizontal status bar with active work items list
- [x] Recent Activity feed — chronological events from ActivityLogService in sidebar
- [x] Progressive disclosure — App Pipeline/Issues/Shipped collapsed into `<details>` elements
- [x] Portfolio View — Features Shipped added to top stats row (5 columns)
- [x] Demoted below fold — maturity distribution, session mix, deploy counts per Unified Plan spec

---

## In Progress

_(Unified Plan Phases 1–3 complete, Phase 4.1–4.3 complete — Phase 4.4–4.5: Release Coordination + Test Checklist next)_

---

## Planned Features

### Near Term — Push Docs Improvements
- [ ] **Preserve folder structure** from zip uploads (e.g. `reference/DATA_MODEL.md` → pushed to `reference/` in repo)
- [ ] **Consolidated repo doc push** — respect `{subPath}/docs/` convention when pushing to shared repos
- [ ] **Batch commit** — push all docs in a single commit instead of one per file

### Near Term — Priority 2: Consolidate App Creation into Projects View
- [ ] **Refactor wizard** — Extract `SetupNewAppView` steps into a reusable modal/flow component
- [ ] **Wire "Add App" in ProjectsTab** — Launch full wizard pre-filled with the parent project
- [ ] **Remove standalone nav entry** — Remove Configure → Setup New App from navigation
- [ ] **Keep `AppEditModal`** — Retain for editing existing apps (different use case from creation)

### Near Term — Priority 3: Firebase-per-App Metadata
- [ ] **`firebasePaths` field** — New array field on app definitions: `['users/{uid}/quotle', 'gameshelf-public/quotle']`
- [ ] **Path editor in AppEditModal** — UI to add/remove Firebase paths per app
- [ ] **Path display in ProjectsTab** — Show Firebase paths in app detail view
- [ ] **Cross-reference in FirebaseView** — When browsing a path, show which app owns it

### ~~Near Term — Firebase Admin Phase 2: Security Rules Manager~~ ✅ COMPLETED (v8.10.0)
- [ ] **Rules tab in FirebaseView** — Add "Rules" tab alongside existing data browser in Monitor → Firebase
- [ ] **Fetch & display rules** — Call `firebaseAdmin.getRules()`, render as formatted/highlighted JSON
- [ ] **Edit rules** — Editable textarea or code editor for modifying rules JSON
- [ ] **Validate before deploy** — Parse JSON, show syntax errors before allowing deploy
- [ ] **Deploy rules** — Call `firebaseAdmin.putRules()` with confirmation dialog
- [ ] **Rules history** — Snapshot current rules to localStorage (`cc_rulesHistory`) before each deploy
- [ ] **Rollback** — Select previous snapshot and re-deploy it

### ~~Near Term — Firebase Admin Phase 3: Functions & Error Monitoring~~ ✅ COMPLETED (v8.11.0)
- [x] **Functions table** — Call `firebaseAdmin.listFunctions()`, show name, status badge, runtime, memory, last deploy
- [x] **Function health ping** — Call each function's HTTPS endpoint, show response time or error
- [x] **Error count per function** — Call `firebaseAdmin.getLogs({filter: 'severity>=ERROR'})`, last 24h grouped by function
- [x] **Log viewer** — Searchable/filterable with severity color coding, auto-refresh
- [x] **At-a-glance summary cards** — Active/total functions, errors in 24h, last deploy time
- [x] **Placement** — New tabs in FirebaseView (⚡ Functions and 📋 Logs)

### Medium Term — Firebase Admin Phase 4: Project Alias / Multi-project
- [ ] **firebaseConfig field on project schema** — Optional `{ projectId, databaseURL, functionsRegion, alias }`
- [ ] **Display alias** — Show "Game Shelf" instead of "word-boxing" in UI
- [ ] **Multi-project FirebaseAdmin** — Support multiple SA keys keyed by project ID
- [ ] **Project selector in FirebaseView** — Dropdown to switch Firebase projects
- [ ] **Project-level stats** — Total deploys, last deploy date, health indicators

### Medium Term — Other
- [ ] **Doc migration: LabelKeeper** — Restructure to standard: README.md→CONTEXT.md, PROJECT-PLAN.md→PROJECT_PLAN.md, FIXES.md→CHANGELOG.md
- [ ] **Doc migration: Quotle.info** — Split PROJECT_FOUNDATION.md into CONTEXT.md + PROJECT_PLAN.md, add CHANGELOG.md + RELEASE_NOTES.txt
- [ ] **Doc commit from Claude Prep** — Option to commit generated skeleton docs back to the repo via GitHub API
- [ ] **Config export/import** — Share config between machines/browsers
- [ ] **Deployment diff** — Show what changed between versions before deploy
- [ ] **Automated version bump** — Auto-increment version in HTML before deploy

### Long Term
- [ ] **Command Center self-update** — Detect new version, deploy itself
- [ ] **Multi-user support** — Multiple operators with different permissions
- [ ] **Webhook integration** — Trigger deploys from external events
- [ ] **Performance dashboard** — Page load times, Core Web Vitals from deployed apps

---

## Architecture Decisions

### Why Single HTML File?
Command Center deploys the same way as the apps it manages — a single index.html pushed to a GitHub Pages repo. This dogfoods the deployment pipeline and keeps things simple.

### Why React via CDN?
No build step means the file works from file:// for local development and from GitHub Pages for production. CDN React is cached after first load.

### Why LocalStorage for Config?
Config is per-machine by design. Different operators might have different GitHub tokens and preferences. The ConfigManager handles migration across versions.

### Why Projects Instead of Categories?
Categories (public/internal/other) were flat and didn't scale. Projects provide hierarchical organization that maps to real work.

### Why Service Account for Firebase Admin? (v8.9.0)
Firebase admin APIs (rules, functions, logging) require Google OAuth2 with service account scope — Firebase user auth alone can't access these management endpoints. The JWT→OAuth2 flow runs entirely in-browser using Web Crypto API, with no server-side dependency. The service account key is stored in localStorage alongside other credentials (GitHub PAT). This is acceptable for an internal tool with a small security surface.

---

## File Structure — Project Package

```
cc-project-vX.X.X.zip
└── command-center/
    ├── index.html              ← The application (~790KB single-file)
    ├── CONTEXT.md              ← READ FIRST — current version, schemas, nav, recent changes
    ├── CHANGELOG.md            ← Structured version history (Added/Changed/Removed)
    ├── PROJECT_PLAN.md         ← This file — roadmap, completed features, decisions
    ├── ARCHITECTURE.md         ← Component map, data flow, code locations
    └── RELEASE_NOTES.txt       ← Human-readable release notes per version
```

**All 5 docs must be updated when producing a project package.** See CONTEXT.md § Project Package Convention for the full session workflow.
