# Command Center — Architecture

## Overview

Single-file React application (~15,200 lines) that manages web app deployments via the GitHub API. Everything is inline — HTML, CSS (Tailwind via CDN), and JavaScript (React 18 via CDN).

---

## Component Hierarchy

```
<CommandCenter>                          Root — state, GitHub init, nav
├── <DashboardView>                      Deploy dashboard
│   └── Project cards (projects.map)     Collapsible app groups
│       └── App rows                     Version badges, actions
├── <SmartDeployView>                    Batch deploy from archives
├── <HistoryView>                        Deploy history log
├── <ProjectsTab>                        Project & app management
│   ├── Project cards (expandable)       Attributes, state toggle
│   │   └── App table (grid)             Structure, repos, versions
│   ├── <AppEditModal>                   Edit app definitions
│   ├── <ProjectEditModal>              Create/edit/delete projects (NEW v8.12.0)
│   └── <ClaudePrepModal>              Fetch source+docs, generate brief, build zip (NEW v8.13.0)
├── <SetupNewAppView>                    4-step new app wizard
├── <ConfigView>                         Environment/repo/detection config
├── <SettingsView>                       Token, Firebase admin, preferences
│   └── <FirebaseAdminSettings>          SA key management, connection test (NEW v8.9.0)
├── <FirebaseView>                       Tabbed Firebase container (v8.10.0)
│   ├── <FirebaseDataBrowser>            RTDB browser with auth
│   ├── <FirebaseRulesManager>           Rules viewer/editor/deployer (NEW v8.10.0)
│   ├── <FirebaseFunctionsDashboard>     Functions list, status, health ping (NEW v8.11.0)
│   └── <FirebaseLogViewer>              Cloud Logging search/filter (NEW v8.11.0)
├── <IntegrationsView>                   External service status
├── <UsersView>                          Player management
├── <BetaProgramView>                    Beta tester management
├── <IssuesView>                         Issue tracker
├── <SessionLogView>                     Activity log
├── <CleanupView>                        Orphan detection
└── <FilesView>                          Repo browser
```

---

## Data Flow

```
┌─────────────────────────────────────────────┐
│                 LocalStorage                 │
│  cc_config_v3    cc_deployHistory            │
│  cc_github_token cc_collapsedProjects        │
│  cc_firebase_sa (v8.9.0)                     │
│  cc_rulesHistory (v8.10.0)                   │
└───────────┬─────────────┬───────────────────┘
            │             │
            ▼             ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  ConfigManager   │  │     State        │  │  FirebaseAdmin   │
│  load/save/      │  │  apps, config,   │  │  SA key, JWT,    │
│  migrate         │  │  deployments,    │  │  OAuth2 token,   │
│                  │  │  activeDeployments│  │  admin API calls │
└──────┬───────────┘  └──────┬───────────┘  └──────┬───────────┘
       │                     │                     │
       ▼                     ▼                     ▼
┌──────────────────────────────────────────────────────────────┐
│            CommandCenter (root)                               │
│  - githubToken, github (API instance)                        │
│  - apps, config, view                                        │
│  - stagedFiles, deployments                                  │
│  - showAlert, showConfirm, showPrompt                        │
└──────────────────┬───────────────────────────────────────────┘
                   │ props
        ┌──────────┼──────────┐
        ▼          ▼          ▼
   Dashboard   Projects   Settings
        │          │          │
        ▼          ▼          ▼
   GitHub API  GitHub API  FirebaseAdmin
   (deploy)    (repos)     (SA token mgmt)
```

---

## Key Code Sections

Line numbers are approximate and shift with edits. Use search patterns to locate.

### Constants & Config (~lines 1–700)
| Pattern | Purpose |
|---------|---------|
| `DEFAULT_APP_DEFINITIONS` | All app definitions with defaults |
| `SEED_PROJECTS` | Project seed data for initial migration (v8.12.0) |
| `APP_TYPES` | Legacy category labels |
| `PROJECT_COLORS` | Tailwind class sets per color theme |
| `BASE_PACKAGES` | Required files per app type (PWA vs non-PWA) |

### Firebase Admin (~lines 68–320) — NEW v8.9.0
| Pattern | Purpose |
|---------|---------|
| `class FirebaseAdmin` | Service account management, JWT signing, OAuth2 |
| `importPrivateKey()` | Parse PEM → CryptoKey via Web Crypto API |
| `createSignedJWT()` | Build and sign RS256 JWT for Google OAuth2 |
| `getAccessToken()` | JWT → access_token exchange with caching |
| `getRules()` / `putRules()` | RTDB security rules REST API |
| `listFunctions()` | Cloud Functions v1 list API |
| `getLogs()` | Cloud Logging v2 entries:list API |
| `testConnection()` | 3-point validation |
| `const firebaseAdmin` | Global singleton instance |

#### API Response Shapes (for Phase 2-3 consumers)

**`getRules()`** → Returns the RTDB rules JSON object:
```javascript
{
  "rules": {
    ".read": false,
    ".write": false,
    "users": {
      "$uid": {
        ".read": "$uid === auth.uid",
        ".write": "$uid === auth.uid"
      }
    }
    // ... more paths
  }
}
```

**`putRules(rulesObj)`** → Send same shape back. Returns the deployed rules on success.

**`listFunctions(location)`** → Returns array:
```javascript
[
  {
    "name": "projects/word-boxing/locations/us-central1/functions/getHint",
    "status": "ACTIVE",           // ACTIVE | DEPLOY_IN_PROGRESS | DELETE_IN_PROGRESS | UNKNOWN
    "entryPoint": "getHint",
    "runtime": "nodejs18",
    "availableMemoryMb": 256,
    "timeout": "60s",
    "updateTime": "2025-01-15T...",
    "httpsTrigger": { "url": "https://us-central1-word-boxing.cloudfunctions.net/getHint" }
  },
  // ...
]
```

**`getLogs(options)`** → options: `{filter, orderBy, pageSize}`. Returns array:
```javascript
[
  {
    "timestamp": "2025-02-07T12:00:00Z",
    "severity": "ERROR",          // DEBUG | INFO | WARNING | ERROR | CRITICAL
    "textPayload": "Error message here",
    "resource": {
      "type": "cloud_function",
      "labels": { "function_name": "getHint", "region": "us-central1" }
    }
  },
  // ...
]
```

**`testConnection()`** → Returns:
```javascript
{ token: true/false, rules: true/false, functions: true/false, functionCount: N, errors: ["..."] }
```

### Core Classes (~lines 900–1800)
| Pattern | Purpose |
|---------|---------|
| `ConfigManager` | Config load, save, migrate, toLegacyAppsFormat |
| `class GitHubAPI` | GitHub REST API wrapper |
| `Icons` | SVG icon components |

### Helper Functions (~lines 1300–1400)
| Pattern | Purpose |
|---------|---------|
| `getProjectsWithApps()` | Groups apps by project, sorts by order |
| `getProjectColor()` | Returns Tailwind classes for a project color |
| `getGitHubPagesUrl()` | Constructs Pages URL from repo + subPath |

### Root Component (~lines 1900–4300)
| Pattern | Purpose |
|---------|---------|
| `function CommandCenter()` | Root component with all state |
| `handleDeploy` | Single-file deploy handler |
| `handleBatchDeploy` | Multi-file batch deploy |
| `handlePromote` | Test → Prod promotion |

### View Components (~lines 4800–14100)
| Pattern | Purpose |
|---------|---------|
| `function DashboardView` | Main dashboard with project cards |
| `function SmartDeployView` | Archive upload and batch deploy |
| `function HistoryView` | Deploy history table |
| `function FirebaseView` | Tabbed container: Data Browser + Rules + Functions + Logs |
| `function FirebaseDataBrowser` | RTDB browser with auth (extracted from old FirebaseView) |
| `function FirebaseRulesManager` | Rules viewer/editor/deployer with history (NEW v8.10.0) |
| `function FirebaseFunctionsDashboard` | Functions list, status, error counts, health ping (NEW v8.11.0) |
| `function FirebaseLogViewer` | Cloud Logging search/filter with severity coding (NEW v8.11.0) |
| `function IntegrationsView` | External service status |
| `function ProjectsTab` | Project & app management |
| `function ProjectEditModal` | Create/edit/delete projects (NEW v8.12.0) |
| `function ClaudePrepModal` | Fetch source+docs from repo, generate session brief, build zip (NEW v8.13.0) |
| `function SetupNewAppView` | New app wizard |
| `function FirebaseAdminSettings` | SA key UI (NEW v8.9.0) |
| `function SettingsView` | Token, Firebase admin, preferences |

---

## Firebase Admin Auth Flow (v8.9.0)

```
┌─────────────────────────────────────────────────────┐
│  1. Service Account JSON Key (stored in localStorage)│
│     - client_email, private_key, project_id          │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  2. Create JWT (RS256 signed via Web Crypto API)     │
│     Header: { alg: "RS256", typ: "JWT" }             │
│     Payload: { iss, scope, aud, iat, exp }           │
│     Scopes: firebase.database + cloud-platform       │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼ POST to oauth2.googleapis.com/token
┌─────────────────────────────────────────────────────┐
│  3. Google OAuth2 Access Token (1 hour lifetime)     │
│     - Cached in memory with 55-min refresh window    │
│     - Auto-refreshed on next API call after expiry   │
└───────────────────────┬─────────────────────────────┘
                        │
            ┌───────────┼───────────┐
            ▼           ▼           ▼
      RTDB Rules    Functions    Logging
      /.settings    /v1/projects /v2/entries
      /rules.json   /locations   :list
                    /functions
```

---

## GitHub API Usage

### Endpoints Used
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/user/repos` | List all repos |
| GET | `/repos/:owner/:repo` | Check repo exists |
| POST | `/user/repos` | Create new repo |
| PUT | `/repos/:owner/:repo/contents/:path` | Create/update file |
| DELETE | `/repos/:owner/:repo/contents/:path` | Delete file |
| POST | `/repos/:owner/:repo/pages` | Enable GitHub Pages |
| POST | `/repos/:owner/:repo/pages/builds` | Trigger Pages build |
| POST | `/repos/:owner/:repo/git/tags` | Create git tag |
| POST | `/repos/:owner/:repo/git/refs` | Create git ref for tag |

---

## Google Cloud API Usage (v8.9.0)

### Endpoints Used
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `oauth2.googleapis.com/token` | Exchange JWT for access token |
| GET | `{databaseURL}/.settings/rules.json` | Read RTDB security rules |
| PUT | `{databaseURL}/.settings/rules.json` | Deploy RTDB security rules |
| GET | `cloudfunctions.googleapis.com/v1/projects/{id}/locations/{loc}/functions` | List Cloud Functions |
| POST | `logging.googleapis.com/v2/entries:list` | Query Cloud Logging |

### Auth: Service account JWT → OAuth2 bearer token
### Scopes: `firebase.database`, `cloud-platform`

---

## Deploy Flow

```
1. User drops file onto Dashboard
2. File content read, version extracted from <meta> tag
3. App auto-detected via detectionPatterns
4. User confirms app + target environment
5. handleDeploy():
   a. Resolve target repo
   b. Get existing file SHA
   c. PUT file via GitHub API
   d. Create git tag
   e. Enable Pages + force rebuild
   f. Verify deployed version
   g. Update state + localStorage
   h. Log to deploy history
```

---

## Styling

- **Tailwind CSS** via CDN (utility classes only, no build)
- **Dark theme** — bg-slate-900 base, slate-700/800 cards
- **Color system** — Project colors (indigo, rose, emerald, amber, etc.)
- **Responsive** — Works on desktop, functional on tablet, limited on mobile

---

## Session Continuity

This file is part of the **Command Center project package** (`cc-project-vX.X.X.zip`). Update with any new components, data flow changes, or API usage when producing a package.

---

## Planned Architecture Changes

### Projects as Stored Data — ✅ COMPLETED (v8.12.0)

Projects are now stored in `cc_config_v3.projects` alongside apps:

```
cc_config_v3 = {
  version: '...',
  environments: { ... },
  projects: {                          ← NEW v8.12.0
    'gameshelf': { id, name, icon, color, description, order, state },
    'other': { ... }                   ← catch-all, non-deletable
  },
  apps: {
    'gameshelf': { id, name, project: 'gameshelf', ... },
    ...
  }
}
```

**ConfigManager methods:**
- `addProject()`, `updateProject()`, `removeProject()`, `getProjectAppCount()`
- `mergeWithDefaults()` seeds projects from `SEED_PROJECTS` on first load
- Migration handles `_standalone` → `other` and `cc_projectStates` → `config.projects[id].state`

**Component flow:**
- `getProjectsWithApps(apps, config.projects)` — reads from config
- `ProjectsTab` — full CRUD via `ProjectEditModal`
- `AppEditModal` / `SetupNewAppView` dropdowns read from `config.projects`

### App Creation Consolidation (Priority 2)

```
Current:                              Planned:
Configure → Setup New App     →      (removed from nav)
  SetupNewAppView (wizard)

Configure → Projects          →      Configure → Projects
  ProjectsTab                          ProjectsTab
    "Add App" → AppEditModal             "Add App" → Full Wizard (pre-filled)
    (basic form)                         (creates repos, seeds files, etc.)
```

### Firebase Capabilities — Current vs Planned

**What FirebaseView currently has:**
- Auth (Google sign-in or manual UID)
- Path browser with quick-path buttons (users, battles, friends, gameshelf-public, etc.)
- Recursive tree viewer with expand/collapse
- Inline editing of values
- Delete nodes
- Realtime listener toggle
- Copy data

**What's missing from FirebaseView (for future phases):**
- No Rules viewer/editor (admin API exists in FirebaseAdmin, UI not built yet)
- No Cloud Functions status or logs (admin API exists, UI not built yet)
- No database size/usage metrics
- No schema documentation (quickPaths hint at structure but no formal schema map)
- No connection between apps and their Firebase paths (e.g., "Quotle uses `users/{uid}/quotle`" isn't tracked)
- No Firebase config per-project (everything points to single `word-boxing-default-rtdb`)

**Firebase access from Claude's environment:**
- Network access to `*.firebaseio.com` and `*.firebasedatabase.app` is configured
- Firebase rules require authentication — anonymous REST calls get "Permission denied"
- Authenticated REST calls possible with Firebase auth token or database secret
- Cannot do Google OAuth from Claude's environment
