# Command Center — Changelog

All notable changes to Command Center are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [8.23.0] — 2026-02-09

### Added
- **ProjectScopeModal** — 4-step scoping wizard (Describe → Clarify → Features → Standards) that captures project intent through category-driven questions and produces structured scope data, auto-generated work items, and assembled starting standards
- **Category-driven question sets** — Static question definitions for 5 categories (Game, Tool, Dashboard, Content, Admin) with toggles, selects, multi-selects, and text inputs. Each question includes default values and "drives" descriptions
- **Feature pre-population** — `generateFeaturesFromScope()` auto-generates V1 feature list from category + question answers (different generators per category)
- **Starting standards assembly** — `assembleStartingStandards()` combines 12 universal standards with 24 conditional category-driven standards based on scoping answers
- **Scope → Work Items** — On scope save, auto-generates work items from V1 features (status: ready), future features (status: idea), and key decisions (type: research) via `WorkItemService.createBatch()`
- **Firebase scope storage** — Scope data stored at `command-center/{uid}/appScopes/{appId}` path
- **BacklogView "Scope Work" button** — Dropdown in header with per-app scope initiation
- **SetupNewAppView Step 2 (Scope)** — New scoping step inserted between Define and Check Repos in setup wizard (now 5 steps total), with "quick setup" option to skip scoping
- **Orchestrator Phase 1.2** — Project Scoping Flow

### Changed
- **SetupNewAppView** — Expanded from 4-step to 5-step wizard: Define → Scope → Check Repos → Create & Configure → Claude Prompt

---

## [8.22.0] — 2026-02-09

### Added
- **BacklogView** — New top-level navigation tab (📋 Backlog) with full work item management: create, edit, delete, status transitions, grouping by app/status/type, filtering by status/type/app, search, sort, bulk select + bulk status update
- **WorkItemEditModal** — Full-featured create/edit modal with app selector, title, description, type (feature/bugfix/enhancement/chore/research), priority (core/nice-to-have/out-of-scope), status, effort, acceptance criteria list (add/remove), tags (add/remove), and collapsible context section (files affected, sections, dependencies, notes)
- **Dashboard Backlog summary widget** — Status distribution grid (ideas/ready/in-progress/done) + recent active items list with "View All →" link
- **Dashboard work item badges** — App cards show 📋 N badge with count of active work items per app
- **WorkItemService.createBatch(uid, items)** — Bulk create work items via single Firebase update (for future scoping flow)
- **WorkItemService.delete(uid, itemId)** — Delete individual work items
- **`source` field on work items** — manual | scoped | imported | promoted, added to both create() and createBatch()
- **Global work items state** — App component subscribes to WorkItemService (globalWorkItems), passed to DashboardView for badges and summary widget
- **Copy for Claude** — Each work item has a "Copy for Claude" action generating formatted context with acceptance criteria, files affected, and notes
- **Quick status transitions** — Context-aware status buttons on each item (e.g., idea shows →Ready, →Deferred; in-progress shows →Done, →Ready, →Deferred)
- **Orchestrator Phase 1.1** — Backlog View + Work Item CRUD

### Changed
- **Navigation** — Added 'backlog' as single-view section between Projects and Monitor in consolidated nav
- **DashboardView props** — Now receives globalWorkItems for badge and summary rendering

---

## [8.21.1] — 2026-02-09

### Added
- **AI Engines settings section** — New "🤖 AI Engines" card in Settings with default engine selector (persists to localStorage) and full engine comparison table showing name, tier, context window, extended context, input/output cost per MTok, Projects support, and Skills support
- **Engine comparison table** — All 5 engines displayed with tier badges (fast/balanced/flagship), default engine highlighted with ★ and indigo tint
- **Session type → engine recommendations** — Expandable details showing build→Sonnet, design→Opus, fix→Sonnet, research→Haiku, etc.
- **Token estimation in Claude Prep** — Every file in the package now includes heuristic token count via `TokenRegistryService.estimateTokens()`, using content-type-aware ratios
- **Context budget bar in Claude Prep** — After package generation, color-coded progress bar (green→emerald→amber→orange→red) shows tokens vs default engine's usable context limit (80% of total, 20% reserved for conversation)
- **Over-budget recommendations** — When package exceeds engine capacity, displays specific recommendations from `EngineRegistryService.checkBudget()`: switch to extended context, use architecture summary, section extraction, skip changelog, or switch engines
- **File manifest table in Claude Prep** — Expandable `<details>` showing all package files sorted by token count descending, with File, Size (KB), Tokens, and % columns; files consuming 50%+ highlighted in amber
- **Token column in SESSION_BRIEF.md** — The file manifest written into the session brief now includes a Tokens column
- **Orchestrator Phase 0.3** — Engine Registry UI + Token Integration in Claude Prep

### Changed
- **ClaudePrepModal stats row** — Now shows 🧮 token count alongside existing 📦 file count and 💾 size
- **ClaudePrepModal log** — Now logs token estimate and budget percentage on package completion

---

## [8.20.0] — 2026-02-09

### Added
- **WorkItemService** — Firebase-backed CRUD for backlog work items with status transitions (idea→ready→in-progress→done→deferred), milestone filtering, and deploy close-the-loop support
- **SessionService** — Firebase-backed Claude session tracking (prep→active→completed→abandoned lifecycle), deploy linking, per-app session history
- **TokenRegistryService** — Heuristic token estimation (code: 0.37, markdown: 0.35, prose: 0.33, json: 0.40 tokens/char), content type detection, localStorage caching, budget calculations
- **EngineRegistryService** — Static AI engine profiles (Claude Sonnet/Haiku/Opus 4.5, GPT-4.1, Gemini 2.5 Pro) with context windows, costs, session type recommendations, budget checking with over-budget recommendations
- **App Lifecycle metadata** — `app.lifecycle` object in ConfigManager: category (game/tool/dashboard/content/admin), currentMaturity, maturityTarget, problemStatement, targetAudience, userGoal, successMetric, stack, maturityCriteria
- **AppEditModal Lifecycle tab** — New ⚙️ General | 📊 Lifecycle tab navigation; lifecycle tab has category, maturity, problem/audience/goal/metric fields, visual maturity progress bar
- **Orchestrator Phase 0.2** — Foundation services for AI Development Orchestrator

### Changed
- `ConfigManager.mergeWithDefaults()` — ensures lifecycle fields exist on all stored apps (schema migration)
- `ConfigManager.addApp()` — includes lifecycle metadata in new app definitions
- `AppEditModal` — tabbed interface (general + lifecycle), save handler includes lifecycle data

### Architecture
- Four new service objects follow established Phase 0.1 pattern (standalone objects, Firebase RTDB or localStorage persistence)
- WorkItemService & SessionService use per-user Firebase paths (`command-center/{uid}/backlog`, `command-center/{uid}/sessions`)
- TokenRegistryService is pure client-side (no Firebase dependency)
- EngineRegistryService is static reference data with localStorage preference for default engine
- Lifecycle fields are additive — existing apps get empty defaults, no data loss

## [8.19.0] — 2026-02-09

### Added
- **Data Service Layer** — Six service objects extracted from App() and views: DeployService, SessionLogService, IssueService, ReleaseService, UserReportService, RollbackService
- **Orchestrator Phase 0.1** — Foundation for AI Development Orchestrator evolution

### Changed
- All deploy history persistence routed through `DeployService` (localStorage + Firebase dual-write)
- All session log persistence routed through `SessionLogService`
- All rollback snapshot persistence routed through `RollbackService`
- All issues CRUD in IssuesView routed through `IssueService` and `ReleaseService`
- Global issues listener in App() uses `IssueService.listen()`
- Issue-to-version linking uses `IssueService.linkToVersion()`
- Firebase startup overlay uses service `.overlay()` methods
- Force sync and push-all operations use service `.load()` methods

### Architecture
- Services follow `FirebaseConfigSync` pattern (standalone objects, not React components)
- Pure refactoring — zero behavior change, all views work identically
- Eliminates 6 inline `localStorage.getItem/setItem` patterns from App()
- Eliminates 8 inline `firebaseDb.ref()` calls from IssuesView
- Prepares data access layer for Phase 0.2 (new entity services)

## [8.18.6] — 2026-02-09

### Fixed
- **Firebase overlay deleting local-only apps** — overlay replaced entire apps object with Firebase data, wiping apps that only existed locally. Now merges local apps into Firebase data, preserving local-only apps, repos, versions, and projects. Pushes merged config back to Firebase.

## [8.18.5] — 2026-02-09

### Fixed
- **Firebase overlay overwriting correct local repos** — "always overlay" from v8.18.4 let stale Firebase repo names (`managementprod`) overwrite correct local repos (`command-center`). Overlay now preserves local repos as authoritative source of truth, pushes corrections back to Firebase.
- **Reverted migration timestamp hack** — restored `ConfigManager.save()` in migration. Overlay repo preservation handles conflicts properly.

## [8.18.4] — 2026-02-09

### Fixed
- **Firebase overlay blocked by migration timestamp** — `ConfigManager.save()` during `cc_apps_v6` migration bumped `_updatedAt`, making local config "newer" than Firebase. Overlay was skipped, so hosted version never received repos. Migration save now preserves existing timestamp.
- **Always overlay Firebase config in Phase 1** — removed timestamp comparison; always apply Firebase config when it has data. Timestamp-based conflict resolution will be added in multi-user phase.

## [8.18.3] — 2026-02-09

### Fixed
- **Firebase overlay overwriting locally-migrated repos** — startup overlay pulled Firebase config (with empty repo strings) and replaced local config (which had repos from `cc_apps_v6` migration). Now preserves local repo assignments when Firebase has empty values, and pushes corrected config back to Firebase automatically.
- **Diagnostic logging** — `migrateFromOldFormat()` now logs how many apps had repos synced.

## [8.18.2] — 2026-02-09

### Fixed
- **Auto-detected repos not synced to Firebase** — `autoMapRepos()` wrote `testRepo`/`prodRepo` to legacy `apps` state but never back to `config.apps[id].repos`. Firebase config had empty repo strings, causing hosted Dashboard to filter out apps without repos. Now syncs detected repos back to config after auto-mapping.

## [8.18.1] — 2026-02-09

### Fixed
- **Apps grouped under "Other" after Firebase sync** — `mergeWithDefaults()` schema migration was missing `project` field, so apps synced from Firebase without it defaulted to `'other'`. Added backfill from `DEFAULT_APP_DEFINITIONS` seeds.

## [8.18.0] — 2026-02-09

### Added
- **Firebase Sync Settings UI** — new "Firebase Config Sync" section in Settings with sync status, data size breakdown, last sync time, and manual Push/Pull/Clear buttons
- **Push All to Firebase** — force-overwrite all local data to Firebase from Settings
- **Pull All from Firebase** — force-overlay Firebase data onto local state from Settings
- **Clear Firebase Data** — remove all `command-center/` data from Firebase (with confirmation dialog)
- **Data size inspector** — shows total Firebase data size and per-key breakdown (config, deploy-history, etc.)
- **`FirebaseConfigSync.clearAll()`** — removes all CC data from Firebase RTDB
- **`FirebaseConfigSync.getDataSize()`** — measures approximate data size per key in Firebase
- **Debounced Firebase writes** — deploy history, session log, and deletion history use 2-second debounce to prevent rapid-fire writes during batch operations

### Changed
- **`FirebaseConfigSync.pushSmart()`** — new routing method that auto-debounces rapid-fire keys while keeping config/rules immediate
- **`pushDeployHistory()`** / **`pushSessionLog()`** / **`pushDeletionHistory()`** — now route through debounced push
- **SettingsView** — receives `syncStatus` and `onForceSync` props for sync UI integration

## [8.17.0] — 2026-02-09

### Added
- **Firebase Config Sync** — new `FirebaseConfigSync` class syncs non-sensitive CC data to Firebase RTDB at `command-center/` path
- **Dual-write pattern** — every config/history save writes to localStorage (instant) then fire-and-forget to Firebase
- **Startup overlay** — loads localStorage immediately, pulls Firebase async, overlays if newer; seeds Firebase on first run
- **Sync status indicator** — header shows ☁️ synced | 🔄 syncing | ⚡ offline | ⚠️ error
- **`_updatedAt` / `_updatedBy` timestamps** — added to config saves for conflict detection
- **`FirebaseConfigSync.pullAll()` / `pushAll()`** — bulk read/write for startup and manual sync

### Changed
- **`ConfigManager.save()`** — now dual-writes to localStorage + Firebase
- **Deploy history persistence** — dual-writes to Firebase
- **Session log persistence** — dual-writes to Firebase
- **Rules history saves** — dual-writes to Firebase (both snapshot add and delete)
- **Deletion history saves** — dual-writes to Firebase
- **Rollback snapshot persistence** — dual-writes to Firebase

## [8.16.7] — 2026-02-09

### Added
- **Google auth in header** — sign-in/out moved from Firebase page to header status bar. Shows profile photo + first name when signed in, "Sign In" link when signed out. Disabled gracefully when running locally (requires HTTPS).

## [8.16.6] — 2026-02-09

### Changed
- **Hide top Scan button on Repo Reset tab** — "Scan Repositories" button (for Stale Files/Legacy Repos) now hides when viewing Repo Reset tab to avoid confusion with "Scan All Repos"

## [8.16.5] — 2026-02-09

### Changed
- **Repo Reset bulk scan** — replaced per-app scanner with "Scan All Repos" that checks all recently-deployed apps at once. Results grouped by app/repo with Select All + batch delete. Handles directories recursively.

## [8.16.4] — 2026-02-09

### Fixed
- **React Error #310 on Repo Reset** — extracted Repo Reset from inline IIFE (which broke useState hooks) into proper `RepoResetPanel` component

## [8.16.3] — 2026-02-09

### Fixed
- **Running Locally link** — was hardcoded to old `managementprod` repo URL (404). Now dynamically reads command-center app's prod repo from config.

## [8.16.2] — 2026-02-09

### Fixed
- **Health alert → Repo Reset navigation** — "Open Repo Reset" now lands on the Repo Reset tab instead of Stale Files, and dismisses the alert banner

## [8.16.1] — 2026-02-09

### Changed
- **Health check scoped to recent deploys** — only checks apps with successful deployments in the last 30 days, reducing API calls and noise

## [8.16.0] — 2026-02-09

### Added
- **Daily repo health check** — lightweight startup scan of all app repos (root-level) for unexpected files, runs once per 24h
- **Health alert banner** — dashboard notification showing repos with stale files, with "Open Repo Reset" and dismiss buttons

## [8.15.6] — 2026-02-09

### Fixed
- **HTML deploy path from zip** — HTML files from zips with nested folders deployed to wrong path; now use filename-only as targetPath

### Added
- **Repo Reset tool** — new tab in Cleanup view; scans repo contents against expected app structure, shows expected/unexpected/total file counts, selectable unexpected files with batch delete

## [8.15.5] — 2026-02-09

### Fixed
- **`setStagedFiles` scoping error** — was undefined in `DashboardView` causing `ReferenceError: Can't find variable: setStagedFiles` after doc push. Now passed as prop from `App`. This was the root cause of docs not clearing from staged files after push.

## [8.15.4] — 2026-02-09

### Changed
- **Drift banner auto-collapse** — uses `<details>` element; auto-opens only for errors/warnings, collapsed for info-only drift
- **Subdued info-only styling** — slate colors instead of blue when only info items present
- **Copy Fix Prompt** — only shown in header for errors/warnings; `e.preventDefault()` prevents details toggle

## [8.15.3] — 2026-02-09

### Fixed
- **Doc files not clearing after push** — batch deploy and Deploy All modal now remove successfully pushed docs from staged files via `setStagedFiles` filter, preventing double-push loop
- **Wrong doc target path for standalone repos** — zip-derived paths like `command-center/CONTEXT.md` were used instead of root `CONTEXT.md`; default `docTargetPath` now uses `fileName` not zip `targetPath`

## [8.15.2] — 2026-02-09

### Fixed
- **Seed drift** — Quotle icon (📖→💬), quotle-info name (Quotle.info→Quotle-info), CC appType (internal→public) in manifest, seeds, and app definitions
- **Copy buttons** — added 📋 Copy button inside both doc validation and config drift prompt text blocks

## [8.15.1] — 2026-02-09

### Added
- **`CC_SEED_MANIFEST`** — machine-readable JSON block in index.html capturing identity fields for all seed projects and apps, delimited by comment markers for easy parsing
- **`detectConfigDrift()`** — compares manifest from staged HTML against running config; checks gs-app-id, project names/presence, app identity fields; classifies as error/warn/info
- **Config ↔ Code Drift banner** — color-coded banner (red/orange/blue) in staged files area when deploying CC; shows all drifts with Copy Fix Prompt button and expandable Claude prompt

## [8.15.0] — 2026-02-09

### Changed
- **App identity rename: management → command-center** — full rename across all code, seeds, detection, mappings, and UI defaults
- **Page title** — "Command Center" (was "Game Shelf Command Center")
- **gs-app-id meta tag** — `command-center` (was `management`)
- **DEFAULT_APP_DEFINITIONS** — key and id changed to `command-center`
- **Hardcoded fallback detection** — legacy signature updated
- **Default deploy target** — `command-center` (was `management`)
- **Repo-to-app-id mappings** — Smart Deploy + Claude Prep updated
- **Internal tools list** — Projects view updated
- **Console startup log** — now shows v8.15.0

### Added
- **localStorage migration** — `mergeWithDefaults()` auto-renames `management` → `command-center` in stored config

## [8.14.2] — 2026-02-09

### Fixed
- **Batch deploy controls** — now correctly split deploy files from push-doc files; shows "Deploy 1 file + Push 6 docs" instead of treating all files as deploy targets
- **Doc files inherit primaryApp** — post-extraction assigns detected app from index.html to all doc files in the same zip package
- **Batch action handler** — refactored into single `executeBatchAction()` that deploys files to Pages AND pushes docs to source repo in one click

## [8.14.1] — 2026-02-09

### Added
- **`validateDocPackage()`** — checks staged files for missing required docs and version alignment between deploy files and doc headers
- **Doc validation banner** — amber warning banner in staged files area showing missing docs, version mismatches, and expandable Claude fix prompt
- **Copy Fix Prompt** — one-click button copies a pre-written prompt for Claude with specific files and versions to fix
- **Per-file doc indicators** — green ✓ or amber ⚠️ inline on each doc file card showing version alignment status

## [8.14.0] — 2026-02-09

### Added
- **Unified deploy + push docs** — files dropped on dashboard auto-classified as deploy (`.html/.js/.json`) or push-doc (`.md/.txt`); both handled in single "Deploy All" flow
- **`classifyFileAction()`** — helper that routes files by name/extension; known doc files → `push-doc`, `SESSION_BRIEF.md` → `skip`, deploy files → `deploy`
- **Staged file visual distinction** — doc files show cyan "📄 Push to repo:" label; deploy files show standard "Deploy as:"
- **DeployAllModal** — now shows two sections: "🚀 Deploy to GitHub Pages" and "📄 Push docs to repo" with separate counts and adaptive button text
- **Batch doc push** — groups docs by app, checks SHA for existing files, commits via GitHub API
- **File input accepts .md/.txt** — upload and drop zone now accept doc files

## [8.13.2.0] — 2026-02-09

### Changed
- **Config as source of truth** — `mergeWithDefaults()` no longer force-merges `DEFAULT_APP_DEFINITIONS` into stored apps on every load; seed data used only for first-time initialization
- **Schema migration** — `mergeWithDefaults()` now only ensures structural fields exist (repos, versions, createdAt, detectionPatterns) without overwriting user values

### Removed
- **`DEFAULT_APP_DEFINITIONS` runtime fallbacks** — 8 references across deploy, Smart Deploy, version checking, and Projects views replaced with `config.apps[appId]`
- **`subPath` fallback pattern** — `DEFAULT_APP_DEFINITIONS[appId]?.subPath` fallback removed from all 8 locations; simplified to `app.subPath || ''`
- **`SEED_PROJECTS` force-merge** — existing stored projects are no longer merged with seed definitions on every load

## [8.13.1.7] — 2026-02-09

### Changed
- **Command Center project independence** — `management` app seed now defaults to `project: 'command-center'` (was `'gameshelf'`), icon updated to 🏗️, `repoPatterns` updated to `command-center` / `command-center-test`
- **SEED_PROJECTS** — added `command-center` project definition (🏗️, cyan), re-ordered existing projects

## [8.13.1.6] — 2026-02-09

### Fixed
- **Version scanner false positives** — extracted `SEED_VERSION` constant for `generateInitialHTML()` and `generateAdminHTML()` scaffolding; `0.1.0` no longer appears as literal meta/footer versions in CC source
- **shouldSkip() lookback range** — increased from 500 to 1000 chars to catch `generate*()` function declarations further from their template content
- **Placeholder version patterns** — `X.X.X` / `X.Y.Z` format auto-skipped as obvious non-versions

## [8.13.1.5] — 2026-02-07

### Added
- **Project emoji picker** — categorized emoji grid in ProjectEditModal, same UX as app modal

## [8.13.1.4] — 2026-02-07

### Added
- **Extra docs scanning** in Claude Prep — scans repo root for additional .md/.txt files beyond the standard set and includes them in the package

## [8.13.1.3] — 2026-02-07

### Fixed
- Push Docs progress — clear visual states: green push button → amber pulsing during push → green completion banner → red error banner with retry

## [8.13.1.2] — 2026-02-07

### Fixed
- Push Docs UI flow — eliminated toggle confusion. Three-step progression: button → drop zone → staged files + push. Clear button replaced by Cancel link.

## [8.13.1.1] — 2026-02-07

### Added
- **Zip support for Push Docs** — drop a .zip package and all .md/.txt files are extracted automatically. Deduplicates by filename.

## [8.13.1.0] — 2026-02-07

### Added
- **Push Docs to Repo** — new feature in Claude Prep modal. Drop .md/.txt files, CC checks repo for existing SHAs, pushes via GitHub API with create/update support.

## [8.13.0.9] — 2026-02-07

### Fixed
- **App detection** — new dynamic pattern matching tier using configurable detection patterns from app config. Scores all apps by specificity (match count + pattern length) to pick best match. Fixes "Rungs Builder" detected as "Rungs" issue.
- Exposed `window.__CC_APPS` for detection function access outside React

## [8.13.0.8] — 2026-02-07

### Fixed
- Auto-generated detection patterns — replaced competing useEffect hooks with single `handleNameChange()` function to eliminate race condition

## [8.13.0.7] — 2026-02-07

### Added
- **Emoji picker** on AppEditModal — categorized grid with Tools, Games, Objects, Symbols, Combo sections
- **Auto-generated detection patterns** — title, kebab-case, camelCase, UPPER_CASE patterns generated as user types app name

## [8.13.0.6] — 2026-02-07

### Added
- **Projects promoted to main navigation** — 5 sections: Deploy → Projects → Monitor → Maintain → Configure
- Single-view sections (Projects) render as direct-click button, skip dropdown

### Fixed
- `availableRepos` prop missing from ProjectsTab invocation

## [8.13.0.5] — 2026-02-07

### Added
- **Repository Assignment dropdowns** — select from actual GitHub repos grouped as "Shared Repos" (with app usage labels) vs "Available Repos"
- Auto-derives repo patterns from selected repo
- Preview path display when repo + subPath set
- Toggle to "Manual entry" mode for advanced pattern editing

## [8.13.0.4] — 2026-02-07

### Added
- **Sub Path field** in AppEditModal — monospace input for specifying app subdirectory within shared repos

## [8.13.0] — 2025-02-07

### Added
- **Claude Prep feature** — 🤖 button on each app row in ProjectsTab to prepare context packages for Claude sessions
- **ClaudePrepModal component** — Progress modal that fetches source + docs from repo, generates session brief, builds downloadable zip
- **SESSION_BRIEF.md generation** — Auto-generated from CC data: versions, recent deploys, open issues, app config
- **Doc bootstrapping** — When docs don't exist in repo, generates skeleton CONTEXT.md, PROJECT_PLAN.md, CHANGELOG.md, RELEASE_NOTES.txt templates
- **Doc detection logic** — Standalone repos check root, consolidated repos check `{subPath}/docs/` then `{subPath}/` then root
- **CLAUDE_PREP_DOCS constant** — Standard doc filenames for the package convention
- Helper functions: `generateSessionBrief()`, `generateSkeletonContext()`, `generateSkeletonPlan()`, `generateSkeletonChangelog()`, `getDocsPath()`

### Changed
- `ProjectsTab` now receives `deployments` prop for session brief generation
- App row actions column now has 3 buttons: Claude Prep (🤖), Edit, Delete

---

## [8.12.0] — 2025-02-07

### Added
- **Projects as stored data** — Projects promoted from hardcoded `DEFAULT_PROJECTS` constant to first-class objects in `cc_config_v3.projects`
- **ProjectEditModal component** — Create, edit, and delete projects with name, icon, color theme picker (7 options), description, and sort order
- **ConfigManager project CRUD** — `addProject()`, `updateProject()`, `removeProject()`, `getProjectAppCount()`
- **New Project button** in ProjectsTab header
- **Edit project button** (✏️) on each project card header
- Delete confirmation with app reassignment warning

### Changed
- `_standalone` project concept replaced with `other` (catch-all, non-deletable)
- `getProjectsWithApps()` now accepts `projects` parameter from config
- `DashboardView` now receives `config` prop for project-aware filtering
- `AppEditModal` and `SetupNewAppView` project dropdowns read from `config.projects` instead of constant
- Project active/hidden state now stored in `config.projects[id].state` instead of separate `cc_projectStates` localStorage key
- `DEFAULT_PROJECTS` renamed to `SEED_PROJECTS` (used only during initial migration)

### Migration
- First load auto-seeds `config.projects` from `SEED_PROJECTS`
- Migrates `app.project: '_standalone'` → `'other'` in all app definitions
- Migrates `cc_projectStates` localStorage into `config.projects[id].state`

---

## [8.11.0] — 2025-02-07

### Added
- **FirebaseFunctionsDashboard component** — Cloud Functions overview (Phase 3)
  - Summary cards: active/total functions, 24h error count, last deploy time, last refresh
  - Functions table with name, status badge (ACTIVE/green, DEPLOY_IN_PROGRESS/amber, other/red), runtime, memory, error count, last deploy
  - Health ping: sends POST to each function's HTTPS endpoint, reports status code and response time
  - Ping All button to sequentially test every function
  - Error counts fetched from Cloud Logging API (severity>=ERROR, last 24 hours, grouped by function)
- **FirebaseLogViewer component** — Cloud Logging search and filter (Phase 3)
  - Filter by severity level (All/Debug/Info/Warning/Error/Critical)
  - Filter by function name (auto-populated from returned log entries)
  - Free-text search within log payloads
  - Configurable page size (25/50/100/200 entries)
  - Auto-refresh toggle with 30-second interval
  - Severity summary bar with clickable counts to quick-filter
  - Color-coded log entries: timestamp, severity badge, function name (clickable), and message
  - Supports textPayload and jsonPayload formats
  - Error entries highlighted with red background tint

### Changed
- **FirebaseView** now has 4 tabs: 🗄️ Data Browser | 🔒 Rules | ⚡ Functions | 📋 Logs
- Version bumped to 8.11.0

---

## [8.10.0] — 2025-02-07

### Added
- **FirebaseRulesManager component** — Security rules viewer, editor, and deployer (Phase 2)
  - Fetch and display current RTDB rules as formatted JSON with size/line stats
  - Inline editor with Tab key support, real-time JSON validation, Format/prettify button
  - Deploy rules with confirmation dialog (warns about overwrite, shows path count)
  - Automatic pre-deploy snapshot of current rules
  - Manual snapshot button to save current state on demand
  - Rules history stored in localStorage (`cc_rulesHistory`, last 20 snapshots)
  - Snapshot viewer with raw JSON or line-by-line diff against current rules
  - Restore any snapshot to editor (still requires explicit Deploy to push)
  - Delete individual snapshots
  - Requires service account configured in Settings (shows setup prompt if missing)

### Changed
- **FirebaseView** refactored to tabbed layout with two tabs: 🗄️ Data Browser | 🔒 Rules
- **FirebaseDataBrowser** — extracted from original FirebaseView (all functionality preserved)
- Version bumped to 8.10.0

---

## [8.9.0] — 2025-02-07

### Added
- **FirebaseAdmin class** — Google OAuth2 service account token management
  - Stores service account JSON key in localStorage (`cc_firebase_sa`)
  - JWT signing using Web Crypto API (RS256 / RSASSA-PKCS1-v1_5)
  - Exchanges signed JWT for Google OAuth2 access token via `oauth2.googleapis.com/token`
  - Token caching with 55-minute refresh window (Google tokens last 1 hour)
  - Admin API: `getRules()` / `putRules()` — RTDB security rules via REST
  - Admin API: `listFunctions()` — Cloud Functions status via `cloudfunctions.googleapis.com/v1`
  - Admin API: `getLogs()` — Cloud Logging entries via `logging.googleapis.com/v2`
  - `testConnection()` — 3-point validation (token exchange, rules access, functions API)
- **FirebaseAdminSettings component** — UI in Settings view
  - Paste/save/clear service account JSON key with validation
  - Status display: email, project, key ID, token state (active/expired/not requested)
  - Test Connection button with detailed pass/fail results
  - Refresh Token on demand
  - Info panel listing what admin access enables
- **Global `firebaseAdmin` instance** — available to all components

### Changed
- Settings view now has 4 sections: GitHub Token, Firebase Admin, Options, Reset
- Version bumped to 8.9.0

### Documented (design decisions from session discussion, not yet implemented)
- **Priority 1: Projects as stored data** — Promote `DEFAULT_PROJECTS` from hardcoded constant to `cc_config_v3.projects` with ConfigManager migration, plus Create/Edit/Delete Project modal
- **Priority 2: App creation consolidation** — Merge Setup New App wizard into Projects view, remove standalone nav entry, pre-fill project on "Add App"
- **Priority 3: Firebase-per-app metadata** — New `firebasePaths` field on app definitions linking apps to their Firebase RTDB paths
- **Firebase capabilities gap analysis** — Documented current vs missing FirebaseView features and Claude environment access constraints

---

## [8.8.0] — 2025-02-07

### Added
- **Project layer** — Apps grouped under project umbrellas (Game Shelf, Quotle.info, LabelKeeper, Super Bowl, Standalone)
- **Projects view** — Standalone view (Configure → Projects) with project attributes and app table
- **Dashboard project cards** — Collapsible, color-coded borders, auto-expand on active deploy
- **Timestamp tracking** — `createdAt` and `updatedAt` on all app definitions
- **SB Squares app** — New app under Super Bowl project (🏈)

### Changed
- Dashboard grouping from Public/Internal/Other to project-based
- Configure nav: replaced "Apps" with "Projects"

### Removed
- Old Apps view — replaced by Projects view
- Public/Internal/Other app sections in Dashboard

---

## [8.7.7] — 2025-02-07

### Added
- **Setup New App wizard** — 4-step process (Configure → Setup New App)
- **Quotle.info app** — Landing page at quote-info repo root
- **Quotle.info Admin app** — Database manager at quote-info/admin

---

## [8.7.6] — 2025-02-06

### Notes
- Starting version for this development session

---

## Version History Summary

| Version | Date | Highlight |
|---------|------|-----------|
| 8.11.0 | 2025-02-07 | Functions Dashboard & Log Viewer (Phase 3) — status, health ping, error monitoring, log search |
| 8.10.0 | 2025-02-07 | Firebase Security Rules Manager (Phase 2) — view, edit, deploy, history, rollback |
| 8.9.0 | 2025-02-07 | Firebase admin token management, service account JWT/OAuth2 |
| 8.8.0 | 2025-02-07 | Project layer, standalone Projects view, timestamp tracking |
| 8.7.7 | 2025-02-07 | Setup New App wizard, quotle.info apps |
| 8.7.6 | 2025-02-06 | Session starting point |
| 8.7.x | prior | Firebase monitoring, beta program, issue tracking |
| 8.3.x | prior | App categories, Smart Deploy |
| 8.0.x | prior | ConfigManager v3, multi-environment support |
