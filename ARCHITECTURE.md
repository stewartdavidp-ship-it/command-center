# Command Center — Architecture

> **Last updated:** 2026-02-19 (v8.71.4)
>
> **Companion document:** For MCP server architecture, see `mcp-server/architecture/SYSTEM-CONTEXT.md` (Rev 27).

---

## Overview

Command Center (CC) is an **AI ideation rigor platform** — a structured system for turning vague ideas into well-formed, buildable specifications before code is written. It manages ODRC concepts (OPENs, DECISIONs, RULEs, CONSTRAINTs), ideation sessions, build jobs, and inter-agent messaging between Claude Chat and Claude Code.

CC is a single-file React application (~16,900 lines after satellite extraction in v8.71.0) deployed via GitHub Pages. It uses React 18 via CDN, Tailwind CSS via CDN, and Firebase Realtime Database for persistence.

---

## Ecosystem Map

CC is not just a browser app — it's part of a multi-service ecosystem:

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
│                                    │  10 tools, 24 skills │             │
│  ┌─────────────┐    MCP over HTTP │                      │──► GitHub   │
│  │ Claude Code  │◄───────────────►│  Express + MCP SDK   │    Contents │
│  │ (CLI)        │  CC API Key     └──────────────────────┘    API      │
│  └─────────────┘                                                        │
│                                                                          │
│  ┌──────────────────────────────────────────┐                           │
│  │  Firebase Cloud Functions (word-boxing)    │                           │
│  │  Game Shelf: hints, battles, tokens, etc. │                           │
│  │  CC Utility: domainProxy (DNS API proxy)  │                           │
│  │  Scheduled: cache cleanup, battle check   │                           │
│  └──────────────────────────────────────────┘                           │
└──────────────────────────────────────────────────────────────────────────┘
```

| Service | Where It Runs | Purpose | Details |
|---------|--------------|---------|---------|
| CC Browser App | GitHub Pages | UI for ODRC management, jobs, sessions, settings | This file |
| CC MCP Server | Cloud Run (`us-central1`) | Tools + skills for Claude Chat/Code | See `SYSTEM-CONTEXT.md` |
| Firebase Cloud Functions | GCP (`word-boxing`) | Game Shelf features, DNS proxy, scheduled cleanup | See below |
| Firebase RTDB | GCP (`word-boxing`) | All persistent data | `command-center/{uid}/` |

---

## Component Hierarchy

```
<CommandCenter>                          Root — state, Firebase auth, nav
├── <ProjectsDrillDown>                  Projects with Ideas tab drill-down (v8.70.19)
│   ├── Project cards (expandable)       Apps, ideas, lifecycle metadata
│   │   └── App rows                     Structure, repos, versions
│   ├── <AppsView>                       App detail with Ideas tab
│   │   └── <IdeasView>                  Idea management per app
│   ├── <AppEditModal>                   Edit app definitions
│   ├── <ProjectEditModal>              Create/edit/delete projects
│   └── <DomainsView>                   Domain management (GoDaddy/Porkbun)
├── <JobsView>                          Build job list + detail (v8.70.18)
│   └── "Load older jobs" button         On-demand fetch via .once() (v8.71.4)
├── <SessionsView>                      Ideation session list + detail (v8.70.18)
├── <SetupNewAppView>                   4-step new app wizard
└── <SettingsView>                      Token, Firebase admin, preferences
```

**Navigation tabs** (v8.70.19): Projects | Jobs | Sessions | Settings

**Removed views** (extracted to satellites or eliminated in v8.71.0): DashboardView, SmartDeployView, HistoryView, FirebaseView, IntegrationsView, UsersView, BetaProgramView, IssuesView, BacklogView, SessionLogView, CleanupView, FilesView, ConfigView.

---

## Firebase Realtime Listeners

### Active Listeners (v8.71.4)

These are persistent `.on('value')` subscriptions set up once at auth time. Each listener re-downloads its entire query result set whenever any child in the query window changes.

| Collection | Limit | Order By | Object Size | Max Download | Service |
|-----------|-------|----------|-------------|-------------|---------|
| Jobs | `limitToLast(10)` | `createdAt` | 10-100KB | ~1MB | `JobService.listen()` |
| Sessions | `limitToLast(15)` | `createdAt` | ~3KB | ~45KB | `SessionService.listen()` |
| Concepts | `limitToLast(50)` | `updatedAt` | ~0.5KB | ~25KB | `ConceptManager.listen()` |
| Ideas | `limitToLast(20)` | `updatedAt` | ~0.5KB | ~10KB | `IdeaManager.listen()` |

**On-demand loading:** `JobService.loadBefore(uid, oldestCreatedAt, limit)` fetches older jobs via `.once()` reads when the user clicks "Load older jobs". Same pattern can be added for Sessions, Concepts, Ideas as needed.

### Suspended Listeners (v8.70.11 / v8.71.0)

These listeners are disabled because they either have no data (single-user) or the features they serve are inactive:

| Listener | Suspended In | Reason | Impact |
|----------|-------------|--------|--------|
| Activity | v8.70.11 | No data, zero cost | Activity log shows empty |
| Team | v8.70.11 | No data, single-user | Team views show empty |
| TeamMembership | v8.70.11 | No data, single-user | Team views show empty |
| WorkItems | v8.70.11 | Feature lightly used | Backlog view shows empty |
| Streams | v8.70.11 | No data | Feature inactive |
| Orphan Commits | v8.70.11 | 5.2MB/13K records | Cleanup view doesn't auto-detect |
| Documents | v8.71.0 | Removed from browser | Documents managed via MCP tools only |

**To re-enable:** Add back to the auth `useEffect` (line ~6450) with appropriate `limitToLast()` bounds. See Cost Architecture section for limits guidance.

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
    4 active      10 tools       ~20 functions
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
- **Triggers:** `calculateBattleScore` on participant data write
- **Scheduled:** `dailyCacheCleanup` (3am), `checkBattleCompletion` (hourly), `dailyUserStatsEmail` (8am)
- **On-demand:** Hint cache, morning review, AI help — all write to their own Firebase paths

---

## Cost Architecture

Firebase RTDB charges ~$1/GB for bandwidth. The primary cost driver is listener re-downloads: every write to a watched path triggers all listeners on that path to re-download their entire query result set.

### Cost Guardrails

1. **Listener limits:** All `.on('value')` listeners use `limitToLast(N)` to bound per-trigger download size. See listener table above.
2. **Server-side query filtering:** MCP server uses `orderByChild().equalTo()` on document queries. No full-collection reads.
3. **Firebase indexes:** `.indexOn` rules on all queried fields (status, createdAt, updatedAt). Without indexes, Firebase downloads the entire collection and filters client-side.
4. **Write debouncing:** `contextEstimate` batched over 30-second windows instead of per-call.
5. **No background polling:** Claude Code must never create persistent scripts to poll `document(receive)`. See `SYSTEM-CONTEXT.md` Section 17 for the full incident report.

### Historical Incident (Feb 2026)

Three zombie bash scripts from orphaned Claude Code sessions polled `document(receive)` every 10 seconds, downloading ~1MB per call. Combined: ~17MB/min = ~$17/day. Fixed by killing scripts, adding server-side status filtering, and documenting anti-polling rules in MCP skills.

---

## Cloud Functions Inventory

All functions run in the `word-boxing` Firebase project. Source: `/Developer/gameshelf-functions/functions/index.js`.

### Game Shelf Functions
| Function | Trigger | Purpose |
|----------|---------|---------|
| `getHint` | HTTPS callable | AI puzzle hints via Claude Haiku, cached globally |
| `getHintUsage` | HTTPS callable | Rate limit status |
| `getDailyInsight` | HTTPS callable | AI puzzle analysis, cached daily |
| `submitInsightReaction` | HTTPS callable | User votes on insights |
| `getMorningReview` | HTTPS callable | Pre-puzzle preview for up to 10 games |
| `getAIHelp` | HTTPS callable | In-app AI assistant (20/day limit) |
| `createCoinCheckout` | HTTPS callable | Stripe checkout for token purchase |
| `stripeWebhook` | HTTPS onRequest | Stripe payment processing |
| `getGiftOptions` / `redeemGift` / `getGiftHistory` | HTTPS callable | Token gift system |
| `completeBetaRegistration` | HTTPS callable | Beta signup with referral bonuses |
| `getUserType` | HTTPS callable | User type lookup |

### Database Triggers
| Function | Trigger Path | Purpose |
|----------|-------------|---------|
| `calculateBattleScore` | `battles/{id}/participants/{id}` | Server-side authoritative scoring |

### Scheduled
| Function | Schedule | Purpose |
|----------|---------|---------|
| `dailyCacheCleanup` | 3am ET daily | Purge stale hint/review caches |
| `checkBattleCompletion` | Hourly | Mark ended battles as completed |
| `dailyUserStatsEmail` | 8am ET daily | Stats email via SendGrid |

### CC Utility
| Function | Trigger | Purpose | Note |
|----------|---------|---------|------|
| `domainProxy` | HTTPS onRequest | CORS proxy for Porkbun/GoDaddy DNS APIs | ⚠️ Unauthenticated, CORS wildcard |

### Admin
| Function | Purpose |
|----------|---------|
| `getUserStats` | Aggregate user stats (admin-restricted) |
| `getBetaAnalytics` | Beta onboarding analytics (admin-restricted) |
| `testDailyStatsEmail` | Manual trigger for stats email |

---

## Repository Structure

| Repo | Environment | URL | Purpose |
|------|------------|-----|---------|
| `command-center-test` | Test | `stewartdavidp-ship-it.github.io/command-center-test/` | Test deploys |
| `command-center` | Prod | `aicommandcenter.dev` | Production |

**Deploy rule:** Always deploy to test first. Verify, then promote to prod.

---

## Styling

- **Tailwind CSS** via CDN (utility classes only, no build)
- **Dark theme** — bg-slate-900 base, slate-700/800 cards
- **No build system** — all inline in single HTML file

---

## Known Issues / OPENs

1. **Sessions have no "Load More"** — only 15 most recent visible in browser. Older sessions accessible via MCP `session(list)` only.
2. ~~**domainProxy is unauthenticated**~~ — **RESOLVED v8.71.5** (2026-02-20). Added Firebase ID token verification + origin-restricted CORS.
3. ~~**Document TTL cleanup is lazy-only**~~ — **RESOLVED v8.71.5** (2026-02-20). Added `documentCleanup` scheduled Cloud Function (daily 4am ET).
4. **MCP server cold starts lose OAuth tokens** — configured with 0 min instances. Claude.ai users must reconnect after deploys.
5. **CLAUDE.md generator can produce duplicates** — same concept appears multiple times when linked across ideas.
6. **Shared Firebase project** — `word-boxing` hosts CC, Game Shelf, and all experiments. Causes naming confusion.

---

## Architecture Backlog

Captured from security & performance audit (2026-02-20). Tracked as OPENs for future sessions.

### Security

| ID | Item | Severity | Notes |
|----|------|----------|-------|
| SEC-1 | **In-memory OAuth token store** — Cloud Run cold starts wipe all OAuth tokens. Claude.ai users must reconnect after every deploy or idle period. | Medium | Fix: Firebase-backed token store. `store.ts` line 6 has a TODO for this. Cost vs UX tradeoff — `minInstances: 1` adds ~$18/month. |
| SEC-2 | **`Math.random()` for API key secret** — CC API keys use `Math.random()` which is not cryptographically secure. Predictable given enough observations. | Low | Acceptable single-user. Upgrade to `crypto.randomBytes()` if/when multi-user. Located in `index.html` line ~5479. |
| SEC-3 | **Dev mode auth bypass (`SKIP_AUTH`)** — If `SKIP_AUTH=true` env var is accidentally set on Cloud Run, all auth is bypassed. | Low | Verified not set in production. Add a startup check that logs a warning if `SKIP_AUTH` is set in non-development. |
| SEC-4 | **Game Shelf world-writable paths** — `games`, `lobby`, `battles`, `public-battles` are writable by any authenticated user. | Info | By design for multiplayer. Validated by game code format (`/^[A-Z]{5}$/`). Separate concern from CC. |
| SEC-5 | **`teamMembership` write rule** — `generateRulesTemplate()` in `index.html` allows any auth user to write `teamMembership` under any `$uid`. Not currently deployed (template only), but would be a risk if deployed. | Low | Fix the template to restrict writes to `auth.uid === $uid` before deploying team features. |

### Performance

| ID | Item | Severity | Notes |
|----|------|----------|-------|
| PERF-1 | **`documentCleanup` full tree read** — The new cleanup function does `db.ref("command-center").once("value")` downloading ~787KB. Runs daily = negligible now. | Low | If CC data grows past 10MB, optimize to shallow-read user list first, then query each user's documents separately. |
| PERF-2 | **Firebase indexes not file-backed before v8.71.5** — Prior to the `database.rules.json` file, indexes were only in the live Firebase console with no version control or rollback. | Resolved | Fixed in v8.71.5 — `database.rules.json` in `firebase-functions/` repo now tracks all rules. |
| PERF-3 | **Jobs collection is heaviest listener** — 30 jobs at 176KB total. `limitToLast(10)` bounds it to ~60KB per trigger. If job payloads grow (larger instructions/attachments), consider reducing limit or trimming completed job data. | Low | Monitor. Current cost: ~$0.06/KB × triggers/day. |
| PERF-4 | **No Firebase budget alerts configured** — The Blaze plan has no spending caps or alerts. The billing budgets API isn't enabled on the project. | Medium | Enable Cloud Billing Budget API and set a $25/month alert. |
| PERF-5 | **Firebase SDK upgrade warning** — Cloud Functions using `firebase-functions@4.9.0` (SDK warns to upgrade to ≥5.1.0). Runtime Node.js 20 will be deprecated 2026-04-30. | Medium | Schedule upgrade to `firebase-functions@5.x` and `nodejs22` before April 2026. |

### Technical Debt

| ID | Item | Notes |
|----|------|-------|
| ~~DEBT-1~~ | ~~**Push v8.71.5 to GitHub Pages**~~ | **RESOLVED** (2026-02-20). Pushed to `command-center-test` repo. |
| ~~DEBT-2~~ | ~~**`command-center/command-center/domainProxy.js` is dead code**~~ | **RESOLVED** (2026-02-20). File deleted. |
| ~~DEBT-3~~ | ~~**`firebase-rules-updated.json` in Downloads is stale**~~ | **RESOLVED** (2026-02-20). File deleted. Canonical rules: `firebase-functions/database.rules.json`. |
| DEBT-4 | **Second CC user (`ptYPWbTDlCPvrKTq2NmWWHuEvkv1`) has only an apiKeyHash** — Likely a test account. Consider cleaning up if not needed. |
| DEBT-5 | **CC line count documentation stale** — ARCHITECTURE.md says ~16,900 lines but v8.71.5 changes haven't been counted. Update after next deploy. |

---

## Disaster Recovery

All source code is now in GitHub. Updated 2026-02-20.

### Source Repositories

| Asset | Repository | Visibility | Notes |
|-------|-----------|------------|-------|
| CC browser app (`index.html`) | `stewartdavidp-ship-it/command-center` | Public | Main app, ARCHITECTURE.md, CLAUDE.md, skills/ |
| CC GitHub Pages deploy | `stewartdavidp-ship-it/command-center-test` | Public | Live site at `stewartdavidp-ship-it.github.io/command-center-test/` |
| MCP server source | `stewartdavidp-ship-it/command-center` → `mcp-server/` | Public | OAuth, API key auth, tools, Firebase integration. Added 2026-02-20. |
| Firebase Functions + RTDB rules | `stewartdavidp-ship-it/firebase-functions` | **Private** | domainProxy, documentCleanup, database.rules.json. Created 2026-02-20. |

### Deployed Services

| Service | Platform | Recovery Path |
|---------|----------|---------------|
| CC browser app | GitHub Pages | Auto-deploys from `command-center-test` repo push |
| MCP server | Cloud Run (`cc-mcp-server`) | `cd mcp-server && gcloud run deploy cc-mcp-server --source . --region us-central1 --project word-boxing --allow-unauthenticated` |
| Cloud Functions | Firebase (`domainProxy`, `documentCleanup`) | `cd firebase-functions && firebase deploy --only functions` |
| RTDB security rules | Firebase | `cd firebase-functions && firebase deploy --only database` |

### Data

| Data | Location | Backup |
|------|----------|--------|
| Firebase RTDB | `word-boxing` project | Firebase automatic daily backups (Blaze plan) |
| Cloud Run container images | Google Artifact Registry | Retained per GCP policy — previous revisions available |

### Environment Variables (Cloud Run)

Required env vars for MCP server rebuild (set via Cloud Run console or `gcloud run deploy --set-env-vars`):
- `FIREBASE_PROJECT_ID` — `word-boxing`
- `FIREBASE_WEB_API_KEY` — Firebase Web API key (from Firebase console → Project Settings)
- `GITHUB_TOKEN` — GitHub PAT for repo operations
- `BASE_URL` — `https://cc-mcp-server-300155036194.us-central1.run.app`

### Not Version-Controlled (Accepted)

- Firebase service account key (stored in Cloud Run as mounted secret)
- Cloud Run service configuration (min/max instances, memory, CPU) — recreatable via console
- Firebase budget alerts (PERF-4) — not yet configured
