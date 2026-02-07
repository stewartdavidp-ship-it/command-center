# Command Center — CONTEXT.md

> **Read this first** at the start of every session working on Command Center.

## Current Version

**v8.13.1.5** — Released 2026-02-07

## What Command Center Is

Command Center is an internal tool for managing the Game Shelf ecosystem of web applications. It handles:

- **Deployment** — Drag-and-drop deploy packages to GitHub Pages repos (with GitHub API)
- **Version tracking** — Reads `<meta name="version">` from deployed sites
- **App detection** — Auto-identifies which app a file belongs to via regex patterns
- **Project management** — Groups apps under project umbrellas
- **Firebase monitoring** — Checks Firebase RTDB status
- **Firebase admin** — Service account-based admin access to rules, functions, and logs (NEW v8.9.0)
- **User/beta management** — Tracks beta testers and referral system
- **Issue tracking** — Links bugs to app versions
- **Session logging** — Records deploy history and session activity

## Architecture

- **Single HTML file** — All CSS, JS, React inline (~830KB, ~15,200 lines)
- **React via CDN** — React 18 + ReactDOM loaded from unpkg
- **No build step** — Runs directly from file:// or GitHub Pages
- **GitHub API** — All repo/deploy operations use personal access token
- **Firebase** — Uses word-boxing-default-rtdb for shared data
- **Firebase Admin** — Service account JWT → OAuth2 token for rules/functions/logs APIs (NEW v8.9.0)
- **LocalStorage** — Config, deploy history, project states, collapse states, service account key

## Key Technical Details

### Meta Tags (Required)
```html
<meta name="version" content="8.11.0">
<meta name="gs-app-id" content="management">
```

### Config Storage
- `cc_config_v3` — Main config (apps, **projects**, environments, repos)
- `cc_deployHistory` — Deploy log
- `cc_collapsedProjects` — Dashboard project collapse state
- `cc_github_token` — GitHub PAT
- `cc_firebase_sa` — Firebase service account JSON key (NEW v8.9.0)
- `cc_rulesHistory` — Firebase rules snapshots for rollback (NEW v8.10.0)

### App Definition Schema
```javascript
{
    id: 'app-id',
    name: 'Display Name',
    icon: '📦',                    // Emoji or 'gs-logo' for SVG
    project: 'project-id',         // v8.8.0 — groups under project
    appType: 'public',             // public | internal | other
    targetPath: 'index.html',
    subPath: '',                   // For apps in subdirectories
    swPath: 'sw.js',              // Empty if not PWA
    hasServiceWorker: true,
    repos: { test: '', prod: '' },
    versions: { test: '', prod: '' },
    repoPatterns: { test: ['pattern'], prod: ['pattern'] },
    detectionPatterns: ['regex1', 'regex2'],
    createdAt: 1707300000000,
    updatedAt: 1707300000000
}
```

### Project Definition Schema (v8.12.0 — stored in `config.projects`)
```javascript
{
    id: 'project-id',
    name: 'Project Name',
    icon: '📦',           // Emoji or 'gs-logo'
    color: 'indigo',      // indigo | rose | emerald | amber | slate | cyan | purple
    description: 'What this project is',
    order: 1,             // Sort order in UI
    state: 'active'       // active | hidden
}
```

### Current Projects
| Project | ID | Icon | Color | Apps |
|---------|-----|------|-------|------|
| Game Shelf | gameshelf | gs-logo | indigo | 12 apps |
| Quotle.info | quotle-info | 📖 | rose | 2 apps |
| LabelKeeper | labelkeeper | 🏷️ | emerald | 1 app |
| Super Bowl | superbowl | 🏈 | amber | 1 app |
| Other | other | 📦 | slate | 3 apps |

## Deployment

- **Repo:** stewartdavidp-ship-it/command-center (internal)
- **Structure:** Single repo, prod only (no test environment)
- **Deploy type:** Single index.html file — no SW, no icons, no zip needed
- **Detection patterns:** `gs-app-id.*management`, `Command Center`

## Navigation Structure

```
Deploy
├── Dashboard        — App cards grouped by project, deploy drop zone
├── Smart Deploy     — Upload gs-active zip, batch deploy
└── Deploy History   — Log of all deployments

Monitor
├── Users            — Player stats
├── Beta Program     — Beta tester management
├── Firebase         — Database status
├── Integrations     — External service status
└── Issues           — Bug/issue tracker

Maintain
├── Cleanup          — Orphan file detection
├── Files            — Repo file browser
├── Archive          — gs-active management
└── Session Log      — Activity log

Configure
├── Environments     — Test/Prod environment config
├── Projects         — Project & app management
├── Setup New App    — New app wizard
└── Settings         — GitHub token, Firebase admin (NEW v8.9.0), preferences
```

## Key Components

| Component | Purpose |
|-----------|---------|
| `CommandCenter` | Root component, state management, GitHub init |
| `DashboardView` | Main deploy dashboard with project-grouped apps |
| `SmartDeployView` | Batch deploy from gs-active archives |
| `ProjectsTab` | Project & app management |
| `ClaudePrepModal` | Fetch source+docs from repo, generate session brief, build zip for Claude sessions (NEW v8.13.0) |
| `ProjectEditModal` | Create/edit/delete projects (NEW v8.12.0) |
| `SetupNewAppView` | 4-step new app wizard |
| `FirebaseView` | Tabbed container: Data Browser + Rules + Functions + Logs |
| `FirebaseDataBrowser` | RTDB browser with auth, path navigation, inline editing |
| `FirebaseRulesManager` | Security rules viewer/editor/deployer with history (NEW v8.10.0) |
| `FirebaseFunctionsDashboard` | Functions list, status, error counts, health ping (NEW v8.11.0) |
| `FirebaseLogViewer` | Cloud Logging search/filter with severity color coding (NEW v8.11.0) |
| `FirebaseAdmin` | Service account JWT → OAuth2 → rules/functions/logs API (NEW v8.9.0) |
| `FirebaseAdminSettings` | UI for service account key management (NEW v8.9.0) |
| `GitHubAPI` | GitHub REST API wrapper |
| `ConfigManager` | Config load/save/migrate with backward compatibility |

## Recent Changes (This Session)

### v8.13.1.x — Push Docs & Detection Improvements
- **Push Docs to Repo** — new feature in Claude Prep modal. Drop .md/.txt files or a .zip package, CC extracts docs, checks repo for existing files (🔄 update vs 🆕 create), and pushes via GitHub API. Clear progress states: staging → pushing (animated) → ✅ done banner.
- **Extra docs scanning** — Claude Prep now scans repo for additional .md files beyond the standard 4 (e.g. DATA_MODEL.md, UX_LAYERS.md) and includes them in the package. Follows the CLAUDE-PREP-STANDARD: "extras are included in Claude Prep packages when present in the repo."
- **Dynamic app detection** — `detectAppFromContent()` now checks configurable detection patterns from app config (scored by specificity) before falling back to hardcoded legacy signatures. Fixes "Rungs Builder detected as Rungs" issue.
- **`window.__CC_APPS`** — apps state exposed to window for detection function access.

### v8.13.0.x — App Configuration Improvements
- **Sub Path field** in AppEditModal for apps in subdirectories within shared repos
- **Repository Assignment dropdowns** — select from actual GitHub repos instead of typing patterns. Repos grouped as "Shared" (shows which apps use them) vs "Available". Auto-derives patterns from selection. Preview path display.
- **Projects promoted to main nav** — 5 sections: Deploy → Projects → Monitor → Maintain → Configure
- **Emoji picker** on both App and Project edit modals — categorized grid, click to select
- **Auto-generated detection patterns** — generates title, kebab-case, camelCase, UPPER_CASE patterns as you type app name
- **Project emoji picker** — added to ProjectEditModal with same categorized grid

### v8.13.0 — Claude Prep (Session Prep per App)
- **Claude Prep button (🤖)** added to every app row in ProjectsTab
- `ClaudePrepModal` — new modal component that assembles a context package for starting a Claude session:
  1. Fetches app source files from GitHub repo (index.html, sw.js, manifest.json for PWAs)
  2. Fetches project docs from repo (CONTEXT.md, PROJECT_PLAN.md, CHANGELOG.md, RELEASE_NOTES.txt, ARCHITECTURE.md)
  3. Generates `SESSION_BRIEF.md` from CC live data (versions, recent deploys, open issues, app config)
  4. Bundles everything into a downloadable `{app}-project-v{X.X.X}.zip`
- **Bootstrap on first use:** When docs don't exist in the repo, generates skeleton templates pre-filled from CC config data
- **Doc detection logic:** Standalone repos check root `/`, consolidated repos (with subPath) check `{subPath}/docs/` then `{subPath}/` then root
- Helper functions: `generateSessionBrief()`, `generateSkeletonContext()`, `generateSkeletonPlan()`, `generateSkeletonChangelog()`, `getDocsPath()`
- Standard doc filenames defined in `CLAUDE_PREP_DOCS` constant
- `deployments` prop added to `ProjectsTab` for session brief generation
- JSZip (already loaded via CDN) used for zip creation

### v8.12.0 — Projects as Stored Data (Priority 1)
- **Projects promoted from hardcoded constant to first-class stored objects** in `config.projects`
- `SEED_PROJECTS` replaces `DEFAULT_PROJECTS` — used only for initial migration
- `_standalone` concept removed — replaced by `other` project (catch-all, non-deletable)
- `ConfigManager` gains project CRUD: `addProject()`, `updateProject()`, `removeProject()`, `getProjectAppCount()`
- `mergeWithDefaults()` handles project migration from old format, including `cc_projectStates` → `config.projects[id].state`
- `getProjectsWithApps()` now accepts `projects` parameter (reads from config instead of constant)
- `ProjectEditModal` — new component for create/edit/delete projects with name, icon, color picker (7 themes), description, sort order
- `ProjectsTab` header gains "New Project" button; each project card gains ✏️ edit button
- `AppEditModal` and `SetupNewAppView` dropdowns now read from `config.projects`
- `DashboardView` now receives `config` prop for project-aware filtering
- Project active/hidden state now persisted in `config.projects[id].state` instead of separate `cc_projectStates` localStorage

### v8.11.0 — Functions Dashboard & Log Viewer (Phase 3)
- `FirebaseView` gains two more tabs: ⚡ Functions | 📋 Logs (now 4 tabs total)
- `FirebaseFunctionsDashboard` — new component showing all Cloud Functions at a glance
  - Summary cards: active/total functions, errors in 24h, last deploy time, last refresh
  - Functions table: name, status badge, runtime, memory, 24h error count, last deploy, health ping
  - Health ping: POST to each function's HTTPS endpoint, shows response time and status
  - Ping All button to test all functions sequentially
  - Error counts fetched from Cloud Logging API (severity>=ERROR, last 24h)
- `FirebaseLogViewer` — new component for searching and filtering Cloud Logging entries
  - Filter by severity (All/Debug/Info/Warning/Error/Critical)
  - Filter by function name (populated from returned logs)
  - Text search within log payloads
  - Configurable page size (25/50/100/200)
  - Auto-refresh toggle (30-second interval)
  - Severity summary bar with clickable counts
  - Color-coded log entries with timestamp, severity badge, function name, and payload
  - Supports both textPayload and jsonPayload log formats
  - Click function name in any log entry to filter to that function

### v8.10.0 — Firebase Security Rules Manager (Phase 2)
- `FirebaseView` refactored to tabbed layout: Data Browser | Rules
- `FirebaseRulesManager` — rules viewer/editor/deployer with history and rollback

### v8.9.0 — Firebase Admin Token Management
- `FirebaseAdmin` class: service account storage, JWT signing (Web Crypto RS256), OAuth2 token exchange
- Admin API methods: `getRules()`, `putRules()`, `listFunctions()`, `getLogs()`
- `FirebaseAdminSettings` component in Settings view
- 3-point connection test (token, rules, functions)
- Token caching with 55-minute auto-refresh

## Pending / Future Work

### Priority 1: Projects as Stored Data + Create/Edit Modal — ✅ COMPLETED (v8.12.0)

**Goal:** Promote projects from a hardcoded constant to a first-class data entity in `cc_config_v3`.

**Current state:** Projects are hardcoded in `DEFAULT_PROJECTS` (~line 352). There's no UI to create, edit, or delete projects. The `ProjectsTab` reads from this constant and merges it with app data to build project cards.

**What exists that's useful:**
- Project schema is well-defined: `{ id, name, icon, color, description, order }`
- 7 color themes already in `PROJECT_COLORS` (indigo, rose, emerald, amber, slate, cyan, purple)
- `getProjectsWithApps()` already handles unknown project IDs gracefully — falls back to `_standalone`
- Project state (active/hidden) already persists to localStorage
- The `AppEditModal` has a project dropdown, but only lists `DEFAULT_PROJECTS`

**What's missing:**
- No project storage in config/localStorage — projects only exist as a constant or as inferred from `app.project` fields
- No create/edit/delete project modal
- No way to persist custom project definitions (name, icon, color, description, order) across sessions
- The project dropdown in `SetupNewAppView` and `AppEditModal` only references `DEFAULT_PROJECTS`

**What needs to happen:**
1. Add `config.projects` object to `cc_config_v3` via ConfigManager — store custom projects alongside defaults
2. Migrate existing `DEFAULT_PROJECTS` into stored config on first load
3. Build a Project Edit Modal (create/edit/delete) with fields: name, icon, color (picker from `PROJECT_COLORS`), description, order
4. Update `getProjectsWithApps()` to read from `config.projects` instead of `DEFAULT_PROJECTS`
5. Update project dropdowns in `SetupNewAppView` and `AppEditModal` to include custom projects

### Priority 2: Consolidate App Creation into Projects View

**Goal:** Merge the Setup New App wizard into the Projects view so app creation is contextual and unified.

**Current state:** There are two different ways to add an app:
- `SetupNewAppView` — A standalone 4-step wizard at Configure → Setup New App (creates repos, enables Pages, seeds files, generates Claude prompts)
- `ProjectsTab` "Add App" button — Opens `AppEditModal` (a basic form that just adds a config entry)

**The fix:** When "Add App" is clicked from within a project in the Projects view, launch the full wizard (pre-filled with that project) instead of the basic modal. Then remove the standalone Setup New App nav entry.

**Steps:**
1. Refactor the wizard steps from `SetupNewAppView` into a reusable modal/flow
2. Wire the Projects view "Add App" button to launch the full wizard, pre-selecting the project
3. Remove the standalone Configure → Setup New App nav entry
4. Keep `AppEditModal` for editing existing apps (it's the right tool for that)

### Priority 3: Firebase-per-App Metadata

**Goal:** Track which Firebase paths each app uses, so Command Center knows the relationship between apps and Firebase data.

**What to add:** A new field on app definitions:
```javascript
firebasePaths: ['users/{uid}/quotle', 'gameshelf-public/quotle']
```

This creates a formal link between apps and their Firebase data, which enables:
- Firebase data browser knowing which app "owns" a path
- Impact analysis when changing rules (which apps are affected)
- Documentation of the data schema per app

### Phase 2: Security Rules Manager — ✅ COMPLETED (v8.10.0)

**Goal:** View, edit, and deploy Firebase RTDB security rules directly from Command Center without needing the Firebase Console.

**Backend (already done in v8.9.0):**
- `firebaseAdmin.getRules()` → returns JSON object of current RTDB rules
- `firebaseAdmin.putRules(rulesObject)` → deploys new rules (PUT, overwrites existing)
- Both require a valid service account key configured in Settings

**UI to build — new view or tab under Monitor → Firebase:**
1. **Rules Viewer** — Fetch and display current rules as formatted JSON (syntax highlighted)
2. **Rules Editor** — Editable textarea/code editor for modifying rules JSON
3. **Deploy button** — PUT updated rules with confirmation dialog ("This will overwrite all existing rules. Continue?")
4. **Validation** — Parse JSON before deploy, show errors if invalid
5. **Rules History** — Before each deploy, snapshot the current rules to localStorage (`cc_rulesHistory`) with timestamp, so user can diff/rollback
6. **Rollback** — Select a previous snapshot and deploy it

**Where it should live in nav:**
- Option A: New tab inside the existing `FirebaseView` (Monitor → Firebase → add "Rules" tab alongside current data browser)
- Option B: New standalone view (Monitor → Rules) — probably overkill for now
- Recommend Option A — keeps all Firebase stuff together

**Search patterns for relevant code:**
- `function FirebaseView` — current Firebase data browser (~line 8265+)
- `class FirebaseAdmin` — admin API class (~line 68+, search `class FirebaseAdmin`)
- `const firebaseAdmin` — global singleton instance
- `getRules()` / `putRules()` — already implemented in FirebaseAdmin class

### Phase 3: Functions Dashboard & Error Monitoring — ✅ COMPLETED (v8.11.0)

**Goal:** See all Cloud Functions at a glance — which are healthy, which have errors, recent logs — without going to the Google Cloud Console.

**Backend (already done in v8.9.0):**
- `firebaseAdmin.listFunctions(location)` → returns array of Cloud Function objects (name, status, runtime, updateTime, entryPoint, availableMemoryMb, httpsTrigger.url)
- `firebaseAdmin.getLogs({filter, orderBy, pageSize})` → returns array of log entries (timestamp, severity, textPayload/jsonPayload, resource.labels.function_name)
- See ARCHITECTURE.md for full response shapes

**Known functions in word-boxing project:**
- `getHint` — AI hints via Claude API (auth required)
- `getHintUsage` — Check hint rate limits (auth required)
- `createCoinCheckout` — Stripe checkout session (auth required)
- `stripeWebhook` — Payment webhook (no auth, server-to-server)
- `getTransactionHistory` — Wallet transaction history (auth required)
- `resetPurchaseHistory` — Dev tool (auth required)

**UI to build — enhance IntegrationsView or new tab in FirebaseView:**
1. **Functions List** — Table: function name, status badge (ACTIVE/green, other/red), runtime, memory, last deployed time
2. **Health Ping** — Button to call each function's HTTPS endpoint with a test payload, show response time / error
3. **Error Log Panel** — Fetch logs with `filter: 'severity>=ERROR'`, show last 24h errors grouped by function
4. **Log Viewer** — Searchable/filterable log viewer with severity color coding (DEBUG=grey, INFO=blue, WARNING=amber, ERROR=red, CRITICAL=red+bold)
5. **At-a-Glance Summary** — Card at top: X functions active, Y errors in last 24h, last deploy time

**Where it should live:**
- Recommend enhancing the existing `IntegrationsView` (Monitor → Integrations) which already has Firebase/Claude/Stripe status checks but they're basic. OR add "Functions" and "Logs" tabs to `FirebaseView`.

**Search patterns for relevant code:**
- `function IntegrationsView` — current integrations status view
- `FUNCTIONS_BASE` — current functions endpoint constant (`https://us-central1-word-boxing.cloudfunctions.net`)
- `integrations` object — current integration definitions with function lists
- `class FirebaseAdmin` → `listFunctions()`, `getLogs()`

### Phase 4: Firebase Project Alias / Multi-project

**Goal:** Decouple the UI from the legacy "word-boxing" project name. Prepare Command Center's data model so that when new Firebase projects are created, CC can manage them without code changes.

**What to build:**
1. **Project-level Firebase config** — Add optional `firebaseConfig` field to project schema: `{ projectId, databaseURL, functionsRegion, alias }`. If not set, falls back to the global `FIREBASE_CONFIG`.
2. **Display alias** — Anywhere CC shows "word-boxing", show the alias ("Game Shelf") instead. The underlying project ID stays the same.
3. **Multi-project FirebaseAdmin** — Currently `firebaseAdmin` is a singleton tied to one SA key. Support multiple SA keys keyed by project ID, so each CC project can have its own Firebase admin access.
4. **Project selector in FirebaseView** — Dropdown to switch between Firebase projects when browsing data/rules/functions.

**This is future work.** Not needed until you actually create a second Firebase project. The main value now is making sure Phase 2-3 code doesn't hardcode `word-boxing` anywhere — use `FIREBASE_CONFIG.projectId` and `firebaseAdmin.serviceAccount.project_id` instead.

### Other
- [x] Session Prep per app — ✅ COMPLETED (v8.13.0) — "Claude Prep" button in ProjectsTab assembles context package
- [ ] Doc migration: LabelKeeper — restructure README.md→CONTEXT.md, PROJECT-PLAN.md→PROJECT_PLAN.md, FIXES.md→CHANGELOG.md
- [ ] Doc migration: Quotle.info — split PROJECT_FOUNDATION.md into CONTEXT.md + PROJECT_PLAN.md, add CHANGELOG.md + RELEASE_NOTES.txt
- [ ] Doc bootstrapping: Game Shelf consolidated repo — create {subPath}/docs/ folders per app (bootstrap on first Claude Prep use)
- [ ] App reordering within projects
- [ ] Config export/import
- [ ] Command Center self-update

---

## 📦 Project Package Convention

See PROJECT_PLAN.md § File Structure for full details. All 5 docs must be updated when producing a package.
