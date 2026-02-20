# Command Center — Architecture

> **Last updated:** 2026-02-20 (v8.71.6)
>
> **Companion document:** For MCP server architecture, see `mcp-server/architecture/SYSTEM-CONTEXT.md` (Rev 27).

---

## Quick Reference

**Read this first.** Everything a new session needs to start working.

| Item | Value |
|------|-------|
| **CC app** | `/Users/davidstewart/Downloads/command-center/index.html` (single-file, v8.71.6) |
| **MCP server** | `/Users/davidstewart/Downloads/command-center/mcp-server/src/` |
| **Firebase Functions** | `/Users/davidstewart/Downloads/firebase-functions/functions/index.js` |
| **Firebase Rules** | `/Users/davidstewart/Downloads/firebase-functions/database.rules.json` |
| **GH Pages site** | `/Users/davidstewart/Downloads/command-center-test/` → `stewartdavidp-ship-it.github.io/command-center-test/` |
| **Firebase project** | `word-boxing` |
| **Firebase UID** | `oUt4ba0dYVRBfPREqoJ1yIsJKjr1` |
| **MCP server URL** | `https://cc-mcp-server-300155036194.us-central1.run.app` |
| **Latest MCP revision** | `cc-mcp-server-00049-dtr` |

### Deploy Commands

```bash
# CC browser app → GitHub Pages
cp index.html ../command-center-test/ && cd ../command-center-test && git add index.html && git commit -m "v8.x.x" && git push

# MCP server → Cloud Run
cd mcp-server && npm run build && gcloud run deploy cc-mcp-server --source . --region us-central1 --project word-boxing --allow-unauthenticated

# Firebase Functions (CC only — MUST target specific functions, Game Shelf deployed separately)
cd /Users/davidstewart/Downloads/firebase-functions && firebase deploy --only functions:domainProxy,functions:documentCleanup --project word-boxing

# Firebase RTDB Rules
cd /Users/davidstewart/Downloads/firebase-functions && firebase deploy --only database --project word-boxing
```

### Safety Rules (Do Not Violate)

1. **All `.on('value')` listeners MUST use `limitToLast(N)`** — unbounded listeners caused a $17/day billing crisis in Feb 2026
2. **Never create polling scripts for `document(receive)`** — use MCP tools instead. See SYSTEM-CONTEXT.md Section 17.
3. **`domainProxy` requires Firebase Auth token** — all 3 call sites in index.html pass Bearer token via `Authorization` header
4. **Deploy Firebase Functions with `--only functions:NAME`** — bare `--only functions` will try to delete 22 Game Shelf functions

---

## Overview

Command Center (CC) is an **AI ideation rigor platform** — a structured system for turning vague ideas into well-formed, buildable specifications before code is written. It manages ODRC concepts (OPENs, DECISIONs, RULEs, CONSTRAINTs), ideation sessions, build jobs, and inter-agent messaging between Claude Chat and Claude Code.

CC is a single-file React application deployed via GitHub Pages. It uses React 18 via CDN, Tailwind CSS via CDN, and Firebase Realtime Database for persistence.

---

## Ecosystem Map

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          CC Ecosystem                                    │
│                                                                          │
│  ┌─────────────┐    Firebase RTDB     ┌──────────────────────┐          │
│  │  CC Browser  │◄──────────────────►│  word-boxing          │          │
│  │  App (SPA)   │   push listeners    │  default-rtdb         │          │
│  │  GitHub Pages│                     │                       │          │
│  └─────────────┘                     │  command-center/{uid}/ │          │
│                                       └──────────┬───────────┘          │
│  ┌─────────────┐    MCP over HTTP            │                          │
│  │ Claude Chat  │◄───────────────►┌──────────┴───────────┐             │
│  │ (claude.ai)  │  OAuth 2.1      │  CC MCP Server       │             │
│  └─────────────┘                  │  (Cloud Run)         │             │
│                                    │  11 tools, 27 skills │             │
│  ┌─────────────┐    MCP over HTTP │                      │──► GitHub   │
│  │ Claude Code  │◄───────────────►│  Express + MCP SDK   │    Contents │
│  │ (CLI)        │  CC API Key     └──────────────────────┘    API      │
│  └─────────────┘                                                        │
│                                                                          │
│  ┌──────────────────────────────────────────┐                           │
│  │  Firebase Cloud Functions (word-boxing)    │                           │
│  │  CC: domainProxy, documentCleanup         │                           │
│  │  Game Shelf: 22 functions (separate repo) │                           │
│  └──────────────────────────────────────────┘                           │
└──────────────────────────────────────────────────────────────────────────┘
```

| Service | Where It Runs | Purpose |
|---------|--------------|---------|
| CC Browser App | GitHub Pages | UI for ODRC management, jobs, sessions, settings |
| CC MCP Server | Cloud Run (`us-central1`) | Tools + skills for Claude Chat/Code |
| Firebase Cloud Functions | GCP (`word-boxing`) | CC: DNS proxy + doc cleanup. Game Shelf: 22 functions (separate codebase) |
| Firebase RTDB | GCP (`word-boxing`) | All persistent data under `command-center/{uid}/` |

### Authentication Model

| Client | Auth Method | Flow |
|--------|------------|------|
| CC Browser App | Firebase Auth (Google Sign-In) | Client-side popup → Firebase UID |
| Claude.ai (Chat) | OAuth 2.1 with PKCE | `/register` → `/authorize` → Google Sign-In or CC API Key → `/token` |
| Claude Code (CLI) | CC API Key | `cc_{uid}_{secret}` validated against SHA-256 hash in Firebase RTDB |
| domainProxy | Firebase ID Token | CC browser passes Bearer token in `Authorization` header |

---

## Component Hierarchy

```
<CommandCenter>                          Root — state, Firebase auth, nav
├── <ProjectsDrillDown>                  Projects with Ideas tab drill-down
│   ├── Project cards (expandable)       Apps, ideas, lifecycle metadata
│   │   └── App rows                     Structure, repos, versions
│   ├── <AppsView>                       App detail with Ideas tab
│   │   └── <IdeasView>                  Idea management per app
│   ├── <AppEditModal>                   Edit app definitions
│   ├── <ProjectEditModal>              Create/edit/delete projects
│   └── <DomainsView>                   Domain management (GoDaddy/Porkbun)
├── <JobsView>                          Build job list + detail
│   └── "Load older jobs" button         On-demand fetch via .once()
├── <SessionsView>                      Ideation session list + detail
├── <SetupNewAppView>                   4-step new app wizard
└── <SettingsView>                      Token, Firebase admin, preferences
```

**Navigation tabs:** Projects | Jobs | Sessions | Settings

---

## Firebase Realtime Listeners

### Active Listeners (v8.71.4+)

These are persistent `.on('value')` subscriptions set up once at auth time. Each listener re-downloads its entire query result set whenever any child in the query window changes.

| Collection | Limit | Order By | Object Size | Max Download | Service |
|-----------|-------|----------|-------------|-------------|---------|
| Jobs | `limitToLast(10)` | `createdAt` | 10-100KB | ~1MB | `JobService.listen()` |
| Sessions | `limitToLast(15)` | `createdAt` | ~3KB | ~45KB | `SessionService.listen()` |
| Concepts | `limitToLast(50)` | `updatedAt` | ~0.5KB | ~25KB | `ConceptManager.listen()` |
| Ideas | `limitToLast(20)` | `updatedAt` | ~0.5KB | ~10KB | `IdeaManager.listen()` |

**On-demand loading:** `JobService.loadBefore(uid, oldestCreatedAt, limit)` fetches older jobs via `.once()` reads when the user clicks "Load older jobs".

### Suspended Listeners

| Listener | Reason |
|----------|--------|
| Activity | No data, zero cost |
| Team / TeamMembership | Single-user, no data |
| WorkItems | Feature lightly used |
| Streams | Feature inactive |
| Orphan Commits | 5.2MB/13K records, expensive to listen |
| Documents | Managed via MCP tools only (v8.71.0) |

---

## Data Flow

```
┌──────────────────────────────────────────────────────┐
│              Firebase RTDB (word-boxing)               │
│          command-center/{uid}/                         │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐ │
│  │ concepts │ │  ideas   │ │  jobs   │ │ sessions │ │
│  │ (ODRC)   │ │          │ │         │ │          │ │
│  └────┬─────┘ └────┬─────┘ └────┬────┘ └────┬─────┘ │
│       │            │            │            │        │
│  ┌────┴────┐  ┌────┴────┐  documents  claudeMd      │
│  │appIdeas │  │  config │  preferences  apiKeyHash   │
│  └─────────┘  └─────────┘                            │
└─────────────────────┬────────────────────────────────┘
                      │
          ┌───────────┼───────────┐
          │           │           │
          ▼           ▼           ▼
    CC Browser    MCP Server    Cloud Functions
    (listeners)   (reads/writes) (triggers/scheduled)
    4 active      11 tools       domainProxy, documentCleanup
```

### Browser → Firebase
- **Auth:** Firebase Auth (Google Sign-In) → UID
- **Read:** 4 persistent listeners (bounded by `limitToLast`)
- **Write:** App config updates, preferences only — all ODRC/job/session writes go through MCP server
- **On-demand reads:** `JobService.loadBefore()` for historical jobs

### MCP Server → Firebase
- **Read:** Per-tool `.once()` reads with query filters (no full collection reads)
- **Write:** ODRC concepts, ideas, sessions, jobs, documents, claudeMd, preferences
- **Debounced:** `contextEstimate` flushed every 30 seconds (not per-call)

### Cloud Functions → Firebase
- **domainProxy:** Authenticated CORS proxy for Porkbun/GoDaddy APIs (requires Firebase ID token)
- **documentCleanup:** Daily 4am ET scheduled purge of delivered/failed docs older than 7 days

---

## Cost Architecture

Firebase RTDB charges ~$1/GB for bandwidth. The primary cost driver is listener re-downloads: every write to a watched path triggers all listeners on that path to re-download their entire query result set.

### Cost Guardrails

1. **Listener limits:** All `.on('value')` listeners use `limitToLast(N)` to bound per-trigger download size
2. **Server-side query filtering:** MCP server uses `orderByChild().equalTo()` — no full-collection reads
3. **Firebase indexes:** `.indexOn` rules on all queried fields. Without indexes, Firebase downloads the entire collection and filters client-side.
4. **Write debouncing:** `contextEstimate` batched over 30-second windows
5. **No background polling:** Claude Code must never create persistent scripts to poll `document(receive)`

### Historical Incident (Feb 2026)

Three zombie bash scripts from orphaned Claude Code sessions polled `document(receive)` every 10 seconds, downloading ~1MB per call. Combined: ~17MB/min = ~$17/day. Fixed by killing scripts, adding server-side status filtering, and documenting anti-polling rules in MCP skills.

---

## CC Cloud Functions

Source: `stewartdavidp-ship-it/firebase-functions` (private repo).

| Function | Trigger | Purpose | Note |
|----------|---------|---------|------|
| `domainProxy` | HTTPS onRequest | CORS proxy for Porkbun/GoDaddy DNS APIs | Auth required (Firebase ID token), restricted CORS origins |
| `documentCleanup` | Scheduled (4am ET daily) | Purge delivered/failed documents older than 7 days | Per-user error handling |

Game Shelf functions (22 functions) are deployed from a separate codebase at `/Developer/gameshelf-functions/`. They share the `word-boxing` Firebase project but are not in the `firebase-functions` repo.

---

## Repositories

| Repo | Visibility | Content |
|------|-----------|---------|
| `stewartdavidp-ship-it/command-center` | Public | CC app, MCP server source, ARCHITECTURE.md, CLAUDE.md |
| `stewartdavidp-ship-it/command-center-test` | Public | GitHub Pages deploy target |
| `stewartdavidp-ship-it/firebase-functions` | **Private** | domainProxy, documentCleanup, database.rules.json |

---

## Styling

- **Tailwind CSS** via CDN (utility classes only, no build)
- **Dark theme** — bg-slate-900 base, slate-700/800 cards
- **No build system** — all inline in single HTML file

---

## Known Issues

| # | Issue | Status |
|---|-------|--------|
| 1 | Sessions have no "Load More" — only 15 most recent visible in browser | Open |
| 2 | MCP server cold starts lose OAuth tokens — configured with 0 min instances | Open (SEC-1) |
| 3 | CLAUDE.md generator can produce duplicates across ideas | Open |
| 4 | Shared Firebase project `word-boxing` hosts CC + Game Shelf | Accepted |

---

## Architecture Backlog

### Open Items

| ID | Item | Severity | Notes |
|----|------|----------|-------|
| SEC-1 | **In-memory OAuth token store** — Cold starts wipe tokens. Claude.ai users must reconnect. | Medium | Fix: Firebase-backed store. Cost vs UX tradeoff — `minInstances: 1` adds ~$18/month. |
| SEC-2 | **`Math.random()` for API key secret** — Not cryptographically secure. | Low | Acceptable single-user. Upgrade to `crypto.randomBytes()` if multi-user. |
| SEC-5 | **`teamMembership` write rule template** — Allows any auth user to write under any `$uid`. Not deployed. | Low | Fix template before deploying team features. |
| PERF-1 | **`documentCleanup` full tree read** — Downloads ~787KB daily. | Low | Optimize if CC data grows past 10MB. |
| PERF-3 | **Jobs collection is heaviest listener** — 60KB per trigger at current size. | Low | Monitor. Reduce limit if job payloads grow. |
| PERF-4 | **No Firebase budget alerts** — Blaze plan has no spending caps. | Medium | Enable Cloud Billing Budget API, set $25/month alert. |
| PERF-5 | **Firebase Functions SDK upgrade needed** — `firebase-functions@4.9.0`, Node.js 20 deprecates 2026-04-30. | Medium | Upgrade to v5.x + nodejs22 before April 2026. |
| DEBT-4 | **Second CC user** (`ptYPWbTDlCPvrKTq2NmWWHuEvkv1`) — Test account? Clean up if unneeded. | Low | |
| DEBT-5 | **CC line count documentation stale** | Low | Update after next major change. |
| DEBT-12 | **Firebase SA JSON in Downloads folder** — Should move to secure location. | Medium | User action required. |
| DEBT-13 | **Game Shelf functions not in firebase-functions repo** — 22 functions in separate codebase. | Low | Consider consolidating. |
| DEBT-14 | **Firebase Functions SDK upgrade** — Same as PERF-5. | Medium | Before April 2026. |

### Resolved (2026-02-20)

<details>
<summary>Click to expand resolved items from v8.71.5 and v8.71.6 security hardening</summary>

| ID | Resolution |
|----|-----------|
| DEBT-1 | v8.71.5 pushed to GitHub Pages |
| DEBT-2 | `domainProxy.js` dead code deleted |
| DEBT-3 | `firebase-rules-updated.json` deleted. Canonical: `firebase-functions/database.rules.json` |
| DEBT-6 | 17 debug scripts removed from git, added to `.gitignore` |
| DEBT-7 | Legacy `domainProxy.js` deletion committed |
| DEBT-8 | `activityLog` → `activity` rules index mismatch fixed |
| DEBT-9 | `debug-sessions` paths restricted to admin UID |
| DEBT-10 | OAuth clients Map bounded (max 100, auto-cleanup) |
| DEBT-11 | SA email redacted from browser console.log |
| SEC-3 | SKIP_AUTH production guard added (process exits on Cloud Run) |
| PERF-2 | Firebase rules version-controlled in `database.rules.json` |
| Known-2 | domainProxy authenticated (Firebase ID token + restricted CORS) |
| Known-3 | `documentCleanup` scheduled Cloud Function added (daily 4am ET) |

</details>

---

## Disaster Recovery

All source code is in GitHub. Updated 2026-02-20.

### Deployed Services

| Service | Platform | Recovery Path |
|---------|----------|---------------|
| CC browser app | GitHub Pages | Push to `command-center-test` repo |
| MCP server | Cloud Run (`cc-mcp-server`) | See deploy commands in Quick Reference |
| Cloud Functions | Firebase | See deploy commands in Quick Reference |
| RTDB rules | Firebase | See deploy commands in Quick Reference |

### Data

| Data | Location | Backup |
|------|----------|--------|
| Firebase RTDB | `word-boxing` project | Firebase automatic daily backups (Blaze plan) |
| Cloud Run images | Google Artifact Registry | Retained per GCP policy |

### Environment Variables (Cloud Run)

Required for MCP server rebuild:
- `FIREBASE_PROJECT_ID` — `word-boxing`
- `FIREBASE_WEB_API_KEY` — Firebase Web API key (from Firebase console → Project Settings)
- `GITHUB_TOKEN` — GitHub PAT for repo operations
- `BASE_URL` — `https://cc-mcp-server-300155036194.us-central1.run.app`

### Not Version-Controlled (Accepted)

- Firebase service account key (Cloud Run mounted secret)
- Cloud Run service config (min/max instances, memory, CPU)
- Firebase budget alerts (PERF-4 — not yet configured)
