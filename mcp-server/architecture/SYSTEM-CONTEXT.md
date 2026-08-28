# CC MCP Server — System Context Reference

> **Purpose:** AI-readable architecture reference. Load this document at the start of any session
> that modifies the MCP server to get full system context quickly.
>
> **Keep current:** Update this file whenever architecture changes are made.
>
> **Last updated:** 2026-03-01 — Revision 35

---

## 1. System Overview

The CC MCP Server is a stateless Node.js/Express server deployed on Google Cloud Run. It implements the Model Context Protocol (MCP) over Streamable HTTP, serving as the shared backend for two Claude agents:

- **Claude Chat** (claude.ai) — connects via OAuth 2.1, runs ideation sessions
- **Claude Code** (CLI) — connects via persistent API key, executes builds

Both agents share the same Firebase Realtime Database namespace and communicate through an in-process message queue. The server also auto-delivers documents to GitHub repos via the Contents API.

```
┌──────────────┐     OAuth 2.1      ┌─────────────────────┐     Firebase RTDB
│  Claude Chat  │◄──────────────────►│                     │◄──────────────────►  word-boxing
│  (claude.ai)  │                    │   CC MCP Server     │                      default-rtdb
└──────────────┘                    │   (Cloud Run)       │
                                     │                     │     GitHub API
┌──────────────┐    CC API Key      │   Express + MCP SDK │◄──────────────────►  Contents API
│  Claude Code  │◄──────────────────►│                     │                      (auto-delivery)
│  (CLI)        │                    └─────────────────────┘
└──────────────┘
```

**Key numbers:** 14 tools, 47 skills, 2 built-in prompts, 1 resource, 482 E2E tests.

---

## 2. Infrastructure

| Component | Value |
|-----------|-------|
| Cloud Run service | `cc-mcp-server` |
| Region | `us-central1` |
| GCP project | `word-boxing` (project number: `300155036194`) |
| Service URL | `https://cc-mcp-server-300155036194.us-central1.run.app` |
| MCP endpoint | `{SERVICE_URL}/mcp` |
| Memory | 256Mi |
| Timeout | 60s |
| Instances | 0–3 (scales to zero) |
| Runtime | Node.js 20 (ESM, `"type": "module"`) |
| Firebase project | `word-boxing` |
| Firebase RTDB URL | `https://word-boxing-default-rtdb.firebaseio.com` |

---

## 3. Environment Variables and Secrets

| Variable | Source | Required | Description |
|----------|--------|----------|-------------|
| `PORT` | Cloud Run auto | No | Defaults to `8080` |
| `BASE_URL` | `--set-env-vars` | **Yes (prod)** | Full Cloud Run URL. Without it, OAuth metadata returns localhost URLs and Claude.ai cannot authenticate. |
| `FIREBASE_WEB_API_KEY` | `--set-env-vars` | Yes (prod) | Firebase client-side API key for Google Sign-In. Value: `AIzaSyBQVwn8vOrFTzLlm2MYIPBwgZV2xR9AuhM` |
| `NODE_ENV` | `--set-env-vars` | No | Set to `production` in Cloud Run |
| `GITHUB_TOKEN` | Secret Manager | No | GitHub PAT with `Contents: Read and write` permission. Enables auto-delivery pipeline. Secret name: `GITHUB_TOKEN`, version: `latest`. |
| `K_SERVICE` | Cloud Run auto | No | Auto-injected by Cloud Run. Used to detect prod environment for BASE_URL warning. |
| `SERVICE_ACCOUNT_KEY_PATH` | Local dev only | No | Path to Firebase service account JSON key file |
| `FIREBASE_UID` | Local dev only | No | UID used when `SKIP_AUTH=true` |
| `SKIP_AUTH` | Local dev only | No | Set `"true"` to bypass auth middleware |

### Secret Management

| Secret | Storage | Scope |
|--------|---------|-------|
| `GITHUB_TOKEN` | Google Secret Manager → mounted as env var via `--set-secrets` | Cloud Run service account `300155036194-compute@developer.gserviceaccount.com` has `roles/secretmanager.secretAccessor` |
| CC API Key hash | Firebase RTDB at `command-center/{uid}/apiKeyHash` | Per-user SHA-256 hash |
| OAuth tokens | In-memory `Map` in `store.ts` | Lost on every deploy/restart — users must reconnect |
| Firebase Admin SDK | Application Default Credentials in Cloud Run; service account key file in dev | Auto-configured by GCP |

---

## 4. Authentication

### Two Token Types

**CC API Key (Claude Code):**
- Format: `cc_{uid}_{secret}`
- Detected by: `token.startsWith("cc_")`
- Validation: SHA-256 hash compared against `command-center/{uid}/apiKeyHash` in Firebase RTDB
- **Persists across restarts** — stored in Firebase, not memory
- Configured in `.mcp.json`: `"Authorization": "Bearer cc_{uid}_{secret}"`

**OAuth 2.1 Access Token (Claude.ai Chat):**
- Format: UUID v4
- **In-memory only — lost on deploy/restart**
- 24-hour TTL
- After every deploy: user must disconnect and reconnect MCP integration in Claude.ai Settings

### OAuth 2.1 Flow

```
Claude.ai                          MCP Server                         Firebase Auth
   │                                    │                                   │
   │ GET /.well-known/oauth-*           │                                   │
   │───────────────────────────────────►│                                   │
   │                                    │                                   │
   │ POST /register (DCR)               │                                   │
   │───────────────────────────────────►│ → stores client in memory         │
   │◄───────────────────────────────────│   (client_id + client_secret)     │
   │                                    │                                   │
   │ GET /authorize?code_challenge=...  │                                   │
   │───────────────────────────────────►│ → renders Google Sign-In page     │
   │                                    │                                   │
   │         User signs in via Google   │                                   │
   │         ─────────────────────────► │ POST /authorize/verify            │
   │                                    │──────────────────────────────────►│
   │                                    │◄──────────────────────────────────│
   │                                    │   verifyIdToken → firebase_uid    │
   │◄───────────────────────────────────│ → redirect with auth code         │
   │                                    │                                   │
   │ POST /token (code + code_verifier) │                                   │
   │───────────────────────────────────►│ → PKCE verify (S256)              │
   │◄───────────────────────────────────│ → 24h access token with uid       │
```

### Dev Mode Bypass

When `NODE_ENV=development` or `SKIP_AUTH=true`, auth middleware reads UID from `FIREBASE_UID` env var. No token required.

---

## 5. Firebase Data Model

All data lives under `command-center/{uid}/` (per-user namespace). Config was moved from a shared path to per-uid in v8.70.9 to prevent data leaks between users.

```
command-center/
└── {uid}/                               # Per-user namespace
    ├── config/                          # App registry (per-uid since v8.70.9)
    │   └── apps/{appId}/
    │       ├── name, description, appType
    │       ├── repos: { prod: "owner/repo" }
    │       ├── subPath: string | null   # Prepended to all file paths in this app's repo
    │       ├── status: "active" | "archived"  # Archived apps excluded from list
    │       ├── conceptChangeCount: number     # Auto-incremented on concept mutations
    │       └── lifecycle: { ... }
    │
    ├── concepts/{conceptId}/            # ODRC objects
    │   ├── type: "OPEN" | "DECISION" | "RULE" | "CONSTRAINT"
    │   ├── content, status, ideaOrigin
    │   ├── scopeTags: string[]
    │   ├── knowledgeRefs[]              # [{nodeId, treeId, treeName, relationship, addedAt}]
    │   ├── knowledgeRefCount: number    # Denormalized for summary views
    │   ├── resolvedBy, transitionedFrom
    │   └── sessionId, jobId             # Provenance tracking
    │
    ├── ideas/{ideaId}/                  # Idea lifecycle
    │   ├── name, description, type ("base" | "addon")
    │   ├── appId, parentIdeaId, sequence
    │   └── status: "active" | "graduated" | "archived"
    │
    ├── appIdeas/{appId}/                # Array of ideaIds linked to app
    │
    ├── sessions/{sessionId}/            # Ideation sessions
    │   ├── title, ideaId, appId, status
    │   ├── events: [ { type, detail, timestamp } ]
    │   └── conceptsCreated: string[]
    │
    ├── jobs/{jobId}/                    # Build execution jobs (universal work orders)
    │   ├── title, appId, ideaId, status
    │   ├── instructions: string         # What Chat wants Code to do
    │   ├── jobType: "build" | "maintenance" | "test" | "skill-update" | "cleanup"
    │   ├── createdBy: "claude-chat" | "claude-code"
    │   ├── attachments: [ { type, label, content, targetPath?, action? } ]
    │   ├── conceptSnapshot: { rules, constraints, decisions, opens }
    │   ├── claimedAt, claimedBy          # Set when Code claims a draft
    │   ├── createdAt, startedAt          # createdAt always set; startedAt on active
    │   ├── reviewTier: "basic" | "intermediate" | "full"  # Review depth tier
    │   ├── reviewLenses: string[]        # Which review lenses were applied
    │   ├── events: [ { type, detail, refId, surface, lens?, timestamp } ]
    │   │              surface: string    # Who logged the event (e.g., "claude-chat")
    │   │              lens: string?      # Which review lens (e.g., "technical", "security")
    │   ├── conceptsCreated, conceptsAddressed, filesChanged
    │   └── outcomes: { testsRun, testsPassed, buildSuccess, ... }
    │
    ├── claudeMd/{appId}/                # Last generated CLAUDE.md per app
    │   ├── content (markdown), conceptCount
    │   └── ideaId, ideaName, generatedAt
    │
    ├── documents/{docId}/               # Document queue + messages
    │   ├── type, appId, content
    │   ├── routing: { targetPath, action }
    │   ├── status: "pending" | "delivered" | "failed"
    │   ├── lifespan: "ephemeral" | "short" | "standard" | "permanent"
    │   ├── metadata: { from, to, githubCommit, ... }
    │   └── createdBy, deliveredBy, failureReason
    │
    ├── preferences/                     # User preferences (presentationMode, etc.)
    │
    ├── profile/                         # User profile (presentationMode, attentionCount, projectInstructionsDirty)
    │
    ├── attentionQueue/{entryId}/        # Attention items (stale-claude-md, etc.)
    │
    ├── knowledge/                       # Evidence Engine (MCP-only, no browser listeners)
    │   ├── forests/{forestId}/          # Domain groupings
    │   │   ├── name, description, tags[], treeIds[]
    │   │   └── summary, summaryGeneratedAt, summaryNodeCount
    │   ├── trees/{treeId}/              # Topic containers
    │   │   ├── name, description, tokenBudget, tokenUsed, nodeCount
    │   │   ├── trustProfile: {authoritative, credible, unverified, questionable}
    │   │   ├── freshnessPeriodDays, lastVerified
    │   │   ├── searchHistory: [{query, nodeIdsProduced, searchedAt}]
    │   │   ├── gaps: [{question, priority, discoveredAt, status}]
    │   │   └── index/{nodeId}/          # Cheap routing entries
    │   │       ├── question, keyFinding, tokenCost, trust, tags[]
    │   │       ├── parentId, childIds[], order, lastVerified
    │   │       └── contradictedBy[]     # Denormalized contradiction index
    │   └── nodes/{nodeId}/              # Expensive content (loaded on demand)
    │       ├── treeId, content, tokenCount
    │       ├── sources: [{url, document, credibility, discoveryQuery?}]
    │       ├── consensusNotes
    │       └── crossRefs: [{nodeId, treeId, relationship, addedAt}]
    │
    ├── skills/{skillName}/              # Skill storage (Firebase-backed since v8.76)
    │   ├── name, description, content
    │   ├── category, triggers[], version
    │   ├── updatedAt, updatedBy, createdAt
    │   └── (cached in-memory with 5-min TTL)
    │
    ├── signals/{codeName}/              # Signal registry (10 signal definitions)
    │   ├── name, description
    │   ├── surfaces[]                   # Which surfaces this signal applies to
    │   ├── computation                  # How the signal is evaluated
    │   └── action                       # What the signal means for the consumer
    │
    └── apiKeyHash                       # SHA-256 of CC API key

command-center/
└── system/                              # System-wide (shared across all users)
    ├── oauth/                           # OAuth clients, token index, audit log
    └── surfaceRegistry/{surfaceId}/     # Surface configurations (NEW — Phase 1)
        ├── id: string                   # e.g., "claude-code"
        ├── displayName: string          # e.g., "Claude Code"
        ├── engine: string               # e.g., "claude", "gemini", "gpt", "grok"
        ├── surfaceType: string          # e.g., "ide", "chat", "browser", "office", "admin"
        ├── status: "production" | "beta" | "planned" | "unsupported"
        ├── launchUrl: string | null     # For landing page smart-launch
        ├── mcpConnection: "native" | "extension" | "none"
        ├── capabilities:
        │   ├── fileSystem, terminal, browser: boolean
        │   ├── messaging: boolean       # Can send/receive inter-surface messages
        │   └── skillRouting: boolean    # Can self-direct skill loading
        ├── contextWindow:
        │   ├── ceiling: number          # Estimated max usable chars
        │   └── toolBudget: number       # How much tool descriptions consume
        ├── bootstrapSkill: string | null  # Skill name for bootstrap
        ├── skillGrade: "full" | "basic" | "none"
        ├── createdAt, updatedAt
        └── (cached in-memory, lazy-loaded, no Firebase watch)
```

### Firebase RTDB Indexes

These `.indexOn` rules are required for server-side query filtering. Without them, queries fall back to client-side filtering (downloading entire collections).

| Path | Index Fields | Added In | Purpose |
|------|-------------|----------|---------|
| `command-center/$uid/documents` | `status`, `createdAt` | v8.71.4 | `document(list/receive/purge)` filter by status |
| `command-center/$uid/concepts` | `updatedAt` | v8.71.4 | Browser listener `limitToLast` by recency |
| `command-center/$uid/ideas` | `updatedAt` | v8.71.4 | Browser listener `limitToLast` by recency |
| `command-center/$uid/jobs` | `createdAt` | v8.70.10 | Browser listener + `loadBefore()` pagination |
| `command-center/$uid/sessions` | `createdAt` | v8.70.10 | Browser listener `limitToLast` by recency |

### Reference Factory Functions (firebase.ts)

| Function | Path |
|----------|------|
| `getConfigRef(uid)` | `command-center/{uid}/config` |
| `getConceptsRef(uid)` | `command-center/{uid}/concepts` |
| `getConceptRef(uid, cid)` | `command-center/{uid}/concepts/{cid}` |
| `getIdeasRef(uid)` | `command-center/{uid}/ideas` |
| `getIdeaRef(uid, iid)` | `command-center/{uid}/ideas/{iid}` |
| `getAppIdeasRef(uid, appId)` | `command-center/{uid}/appIdeas/{appId}` |
| `getSessionsRef(uid)` | `command-center/{uid}/sessions` |
| `getSessionRef(uid, sid)` | `command-center/{uid}/sessions/{sid}` |
| `getJobsRef(uid)` | `command-center/{uid}/jobs` |
| `getJobRef(uid, jid)` | `command-center/{uid}/jobs/{jid}` |
| `getClaudeMdRef(uid, appId)` | `command-center/{uid}/claudeMd/{appId}` |
| `getDocumentsRef(uid)` | `command-center/{uid}/documents` |
| `getDocumentRef(uid, docId)` | `command-center/{uid}/documents/{docId}` |
| `getPreferencesRef(uid)` | `command-center/{uid}/preferences` |
| `getProfileRef(uid)` | `command-center/{uid}/profile` |
| `getAttentionQueueRef(uid)` | `command-center/{uid}/attentionQueue` |
| `getForestsRef(uid)` | `command-center/{uid}/knowledge/forests` |
| `getForestRef(uid, fid)` | `command-center/{uid}/knowledge/forests/{fid}` |
| `getTreesRef(uid)` | `command-center/{uid}/knowledge/trees` |
| `getTreeRef(uid, tid)` | `command-center/{uid}/knowledge/trees/{tid}` |
| `getTreeIndexRef(uid, tid)` | `command-center/{uid}/knowledge/trees/{tid}/index` |
| `getNodesRef(uid)` | `command-center/{uid}/knowledge/nodes` |
| `getNodeContentRef(uid, nid)` | `command-center/{uid}/knowledge/nodes/{nid}` |
| `getSkillsRef(uid)` | `command-center/{uid}/skills` |
| `getSkillRef(uid, name)` | `command-center/{uid}/skills/{name}` |
| `getSignalsRef(uid)` | `command-center/{uid}/signals` |
| `getSignalRef(uid, name)` | `command-center/{uid}/signals/{name}` |
| `getSystemRef()` | `command-center/system` |

---

## 6. ODRC State Machine

Valid transitions (enforced in `concept` tool):

```
OPEN ──────► DECISION
OPEN ──────► RULE
OPEN ──────► CONSTRAINT

DECISION ──► RULE          (hardening)

CONSTRAINT ► DECISION      (external reality changed)
CONSTRAINT ► RULE          (external reality changed)
             └─ Triggers: flag all active DECISIONs and RULEs sharing scope tags

RULE ──────► OPEN          (destabilized, needs rethinking)
```

Concept statuses: `active`, `superseded`, `resolved`, `transitioned`, `built`

---

## 7. Tools Reference

### 14 Registered Tools

| Tool | Actions | Primary User |
|------|---------|-------------|
| `app` | list, get, create, update, archive | Both |
| `idea` | list, get, create, update, graduate, archive, get_active, list_ranked, delete | Chat |
| `session` | start, update, add_event, complete, get, list, delete, preferences, profile | Chat |
| `concept` | get, create, update, transition, supersede, resolve, mark_built, migrate, add_knowledge_ref, remove_knowledge_ref, check_evidence_drift, delete | Both |
| `list_concepts` | _(query params: ideaId, appId, type, status, scope, grouped, summary)_ | Both |
| `get_active_concepts` | _(appId required, optional: includeDriftCheck)_ | Both |
| `job` | start, claim, revise, review, approve, update, add_event, complete, get, list, delete | Code |
| `generate_claude_md` | generate, push, get | Chat |
| `document` | push, list, get, get-latest, update, deliver, deliver-to-github, fail, send, receive, ack, purge, delete | Both |
| `knowledge_tree` | list_forests, get_forest, create_forest, update_forest, delete_forest, list_trees, get_tree, create_tree, update_tree, delete_tree, get_index, add_search, search_tags, generate_summary, get_forest_summary | Both |
| `knowledge_node` | create, update, delete, load, load_batch, move, add_cross_ref, remove_cross_ref, bulk_verify | Both |
| `repo_file` | _(single read action: repo, path, branch)_ | Both |
| `skill` | list, get, create, update, delete | Both |
| `surface_registry` | list, get, create, update, delete | Both |

### Job Event Types

`open_encountered`, `decision_made`, `file_changed`, `test_result`, `blocker`, `deviation`, `concept_addressed`, `concept_created`, `concept_transitioned`, `note`, `question`, `answer`

Each event includes a `surface` field (string, who logged it) and an optional `lens` field (string, which review lens — e.g., `"technical"`, `"security"`).

Auto-population: `file_changed` events auto-append to `job.filesChanged[]`; `concept_addressed` events auto-append to `job.conceptsAddressed[]`.

### Job Auto-Notifications

When a job transitions to `review` or `completed`/`failed`/`abandoned` status, an ephemeral message is automatically sent to the `createdBy` surface via the document queue. This ensures the originating agent (typically Chat) is notified of job progress without requiring manual polling.

### Job State Machine

```
draft ──[claim]──→ active ──[review]──→ review ──[approve]──→ approved ──→ completed
                     │                    │                                    ├──→ failed
                     │                    │                                    └──→ abandoned
                     │                    └──[revise]──→ draft
                     └──→ completed/failed/abandoned (direct from active)
```

Statuses: `draft`, `active`, `review`, `approved`, `completed`, `failed`, `abandoned`

### Job as Universal Work Order

Jobs serve as the universal handoff between Claude Chat and Claude Code:

1. **Chat creates draft:** `job(start, createdBy="claude-chat", ...)` → status=`draft` with instructions, attachments, conceptSnapshot embedded inline
2. **Code discovers drafts:** `job(list, status="draft")` on startup poll
3. **Code claims:** `job(claim, jobId=...)` → validates draft, enforces one active build per app, sets status=`active`
4. **Code executes:** Normal job lifecycle with events, then review/approve/complete
5. **Revise path:** `review → draft` via `job(revise)` — sends back to Chat for revision

**Attachment types:** `claude-md`, `spec`, `file`, `context`. **Actions:** `write` (produce file at targetPath), `reference` (context only).

**Job types:** `build` (default), `maintenance`, `test`, `skill-update`, `cleanup`. One active `build` per app enforced at claim time.

### Lens-Based Job Review Protocol

When a job enters `review` status, Chat can apply structured review lenses to evaluate Code's work from multiple perspectives. The protocol is orchestrated by the `cc-review-protocol` skill and uses tiered review depth:

| Tier | Lenses Applied | When |
|------|---------------|------|
| `basic` | Technical only | Small changes, maintenance, cleanup jobs |
| `intermediate` | Technical + 1-2 relevant lenses | Standard feature builds |
| `full` | Technical + all applicable lenses | Critical changes, security-sensitive, new architecture |

**Six review lenses** provide focused evaluation: `technical`, `stress-test`, `economics`, `security`, `operations`, `integration`. Each lens produces ODRC-typed findings (OPENs, DECISIONs, RULEs, CONSTRAINTs) logged as job events with the `lens` field set.

**Job fields:** `reviewTier` records which tier was applied; `reviewLenses` tracks which lenses were actually run. Both are set during the review process and persisted on the job record.

**Presentation:** The `cc-review-presentation` skill governs how review findings are delivered to the user — structured by lens, severity-sorted, with actionable recommendations.

---

## 8. Skills Reference

### 41 Registered Skills

| # | Skill Name | Agent | Purpose |
|---|-----------|-------|---------|
| 1 | `cc-odrc-framework` | Both | ODRC type definitions, state machine, Firebase writeback protocol |
| 2 | `cc-session-structure` | Chat | Live session lifecycle with Firebase-backed tracking |
| 3 | `cc-session-protocol` | Chat | Master step-by-step ideation session protocol |
| 4 | `cc-mode-exploration` | Chat | Breadth-first discovery, OPEN-surfacing |
| 5 | `cc-lens-technical` | Chat | Architecture, dependencies, implementation risk |
| 6 | `cc-build-protocol` | Code | Master build execution protocol: doc check → job → spec → build → complete |
| 7 | `cc-build-resume` | Code | **CRITICAL:** Compaction recovery mid-build. Finds orphaned job, reconstructs position |
| 8 | `cc-session-resume` | Chat | **CRITICAL:** Compaction recovery mid-session. Finds orphaned session |
| 9 | `cc-session-continuity` | Chat | New conversation continuing prior work |
| 10 | `cc-spec-generation` | Chat | When/how to generate CLAUDE.md, readiness checks |
| 11 | `cc-build-hygiene` | Code | Post-build cleanup: resolve OPENs, harden DECISIONs, graduate ideas |
| 12 | `cc-mcp-workflow` | Both | End-to-end lifecycle: IDEATE → SPECIFY → DELIVER → BUILD → COMPLETE |
| 13 | `cc-lens-stress-test` | Chat | Adversarial pressure testing |
| 14 | `cc-lens-voice-of-customer` | Chat | User persona, journey, retention analysis |
| 15 | `cc-lens-competitive` | Chat | Competitive analysis and positioning |
| 16 | `cc-lens-economics` | Chat | Cost structure, build effort, go/no-go |
| 17 | `cc-protocol-messaging` | Both | Inter-agent message types and polling rules |
| 18 | `cc-lens-integration` | Chat | Cross-app integration, data coupling, ecosystem impact |
| 19 | `cc-lens-ux-deep-dive` | Chat | Screen-by-screen UX walkthrough, all view states |
| 20 | `cc-lens-content` | Chat | Content strategy, information architecture, quality gates |
| 21 | `cc-lens-growth` | Chat | Distribution, SEO, social sharing, measurement |
| 22 | `cc-lens-accessibility` | Chat | WCAG compliance, keyboard nav, screen readers, cognitive load |
| 23 | `cc-lens-operations` | Chat | Post-launch ops: analytics, monitoring, incident response |
| 24 | `cc-lens-security` | Chat | Security audit: attack surfaces, auth, Firebase rules |
| 25 | `cc-skill-router` | Chat | Routes user intent to appropriate skill |
| 26 | `cc-job-creation-protocol` | Chat | Protocol for creating well-formed draft jobs |
| 27 | `cc-retro-journal` | Chat | Retrospective journaling for session reflection |
| 28 | `cc-startup-checklist` | Chat | General startup checklist for new sessions |
| 29 | `cc-tutorial` | Chat | Interactive tutorial for new users |
| 30 | `cc-code-startup-checklist` | Code | Code agent startup checklist |
| 31 | `cc-acc-video` | Chat | ACC video production guidelines |
| 32 | `cc-skill-creation` | Chat | Protocol for creating new skills |
| 33 | `cc-cowork-startup-checklist` | Code | Cowork agent startup checklist |
| 34 | `cc-review-protocol` | Chat | Orchestration protocol for lens-based job review — tier selection, lens sequencing |
| 35 | `cc-review-presentation` | Chat | Presentation format for review findings — how to deliver results to the user |
| 36 | `cc-review-lens-technical` | Chat | Code review lens: architecture, patterns, performance, maintainability |
| 37 | `cc-review-lens-stress-test` | Chat | Code review lens: adversarial pressure testing, failure scenarios |
| 38 | `cc-review-lens-economics` | Chat | Code review lens: cost structure, build effort, resource efficiency |
| 39 | `cc-review-lens-security` | Chat | Code review lens: attack surfaces, auth, data exposure, Firebase rules |
| 40 | `cc-review-lens-operations` | Chat | Code review lens: monitoring, incident response, deploy safety |
| 41 | `cc-review-lens-integration` | Chat | Code review lens: cross-app integration, data coupling, ecosystem impact |

### Skill Storage

Skills are stored in Firebase RTDB at `command-center/{uid}/skills/{skillName}` and cached in-memory with a 5-minute TTL. The `skill` tool supports full CRUD (create, update, delete) with write-through to both Firebase and cache. Skills are also registered as MCP prompts (for Claude Code) from the cache at server creation time.

**Fallback chain:** Firebase → compiled constants in `skills.ts`. On first deploy (or if Firebase is empty), the compiled constants are served. Use `migrate-skills.sh` to seed Firebase from compiled constants.

**Cache lifecycle:** `skill-cache.ts` initializes lazily on first authenticated request. The `initSkillCache(uid)` function is idempotent — subsequent calls are no-ops. Cache entries have a 5-min TTL but write-through operations keep them fresh.

### Signal Infrastructure

Signal codes are computed per-request by `signal-computation.ts` and piggybacked on every MCP tool response as `_signals` (an array of active signal code strings). This coexists with the existing `_pendingMessages` and `_session` metadata already injected by `response-metadata.ts`.

10 initial signals cover four categories:
- **Profile flags** — e.g., projectInstructionsDirty, showTutorial
- **Job state** — e.g., active build in progress, draft jobs awaiting claim
- **Session state** — e.g., active session detected, session nearing context limit
- **Cold-start detection** — first request from a surface with no prior session

Signals are surface-aware: some signals only fire for specific surfaces (e.g., cold-start signals target `claude-chat` or `claude-code` independently). The signal registry is stored in Firebase at `command-center/{uid}/signals/{codeName}` and seeded via `migrate-signals.sh`.

### Bootstrap & Init Actions

Two new session actions provide single-call startup replacement:

**`session(action="bootstrap", initiator="claude-chat|claude-code|claude-cowork")`** — Fan-out reads across Firebase via `Promise.all()`, returns orientation payload in one call:
- `instructions` — Surface-specific behavioral baseline from `cc-bootstrap-instructions-{surface}` skill
- `profile` — User profile flags (initialized, projectInstructionsDirty, showTutorial, needsAttention)
- `activeSession` — Current session info (id, title, mode, goal, ideaId, appId)
- `activeIdea` — Active idea with concept counts (rules, constraints, decisions, opens)
- `priorSession` — Most recent completed session's closingSummary and nextSessionRecommendation
- `jobs` — Active, draft, and review jobs
- `signalDefinitions` — Signal registry filtered to this surface (description + action)

**`session(action="init", initiator="claude-chat|claude-code|claude-cowork")`** — One-time onboarding entry point:
- Sets `initialized: true` in user's Firebase profile (idempotent)
- Returns `memoryLines` array for Claude to write to Memory (3-line boot loader)
- Memory boot loader references surface-specific `cc-router-{surface}` skill
- Returns `confirmation` message with next steps

**Router Skills** — Entry-point skills referenced by memory boot loader, loaded on conversation start:
- `cc-router-chat` — Bootstrap trigger, signal table, skill loading triggers, budget tracking
- `cc-router-code` — Bootstrap trigger, signal table, job workflow, skill loading
- `cc-router-cowork` — Bootstrap trigger, signal table, capabilities, messaging

Implementation lives in `session-bootstrap.ts` — extracted from the main session handler to keep the 735-line handler manageable.

### Surface Registry

The surface registry replaces the hardcoded `SURFACES` enum with a Firebase-backed registry at `command-center/system/surfaceRegistry/{surfaceId}`. Phase 1 provides rough plumbing — data model, in-memory cache, and CRUD tool. Future wiring into bootstrap, signals, and context health happens incrementally.

**Architecture:**
- **Storage:** `command-center/system/surfaceRegistry/{surfaceId}` (system-wide, not per-user)
- **Cache:** In-memory `Map<string, SurfaceConfig>` in `surface-registry.ts`, lazy-loaded on first access, lives for server lifetime (no Firebase watch — surfaces change rarely)
- **Validation:** `surfaces.ts` → `isRegisteredSurface()` checks registry cache first, falls back to hardcoded `SURFACES` array. `parseSurface()` recognizes dynamically registered surfaces immediately
- **Tool:** `surface_registry` — list, get, create, update, delete (follows standard INITIATOR_PARAM pattern)

**7 initial surfaces seeded:**

| Surface | Engine | Type | Status | Key Capabilities |
|---------|--------|------|--------|-----------------|
| `claude-chat` | claude | chat | production | messaging, skillRouting |
| `claude-code` | claude | ide | production | fileSystem, terminal, messaging, skillRouting |
| `claude-cowork` | claude | automation | beta | fileSystem, terminal, messaging, skillRouting |
| `claude-chrome` | claude | browser | beta | browser, messaging |
| `claude-powerpoint` | claude | office | beta | messaging |
| `claude-excel` | claude | office | beta | messaging |
| `user` | none | admin | production | none |

**Not yet wired (future tasks):**
- Bootstrap does not yet read `bootstrapSkill` from registry (uses hardcoded `INSTRUCTION_SKILLS` map)
- Signal computation does not yet use `capabilities` from registry
- `_contextHealth` does not yet use `contextWindow.ceiling` from registry
- Landing page smart-launch does not yet read `launchUrl` from registry

---

## 9. Inter-Agent Messaging

### Transport

Messages use the `document` tool with `type: "message"` and `routing.action: "message"`.

### Message Flow

```
Claude Chat                    Firebase RTDB                   Claude Code
    │                              │                               │
    │ document(send,               │                               │
    │   content="TYPE: spec-push   │                               │
    │   ...", to="claude-code")    │                               │
    │─────────────────────────────►│                               │
    │                              │    document(receive,           │
    │                              │      to="claude-code")         │
    │                              │◄──────────────────────────────│
    │                              │──────────────────────────────►│
    │                              │                               │
    │                              │    document(ack, docId=...)    │
    │                              │◄──────────────────────────────│
```

### Protocol Message Types (from cc-protocol-messaging)

| Type | Direction | Purpose |
|------|-----------|---------|
| `spec-push` | Chat → Code | CLAUDE.md ready for build |
| `spec-review` | Code → Chat | Ready / has issues |
| `spec-resolution` | Chat → Code | Issues resolved |
| `build-status` | Code → Chat | Phase complete / complete / blocked / failed |
| `build-review` | Chat → Code | Approved / has issues |
| `question` | Either | Ask the other agent |
| `answer` | Either | Response to question |
| `info` | Either | FYI, no response needed |
| `end` | Either | Conversation complete |
| `escalate` | Either | Needs human intervention |

### Protocol Rules

- Code acks must include: numbered step plan, `WAIT: poll` or `WAIT: working`, progress updates every 2 min max
- Chat polling governed by WAIT signal: `poll` = check every 30s, `working` = wait for next message
- Failure escalation: no silent retry loops, escalate after 3 failed attempts
- **No background polling scripts** — Claude Code must NEVER create bash scripts, cron jobs, or persistent background processes to poll `document(receive)`. All message checking must happen inline within the active conversation. Background scripts outlive sessions and cause catastrophic Firebase bandwidth costs. See Section 17 for the full incident report.
- **Receive queries are server-side filtered** — `document(receive)` queries `status=pending` at the Firebase level (v8.71.4). Even frequent polling only downloads pending documents (~12KB), not the full collection.

---

## 10. Document Delivery Pipeline

### Three Delivery Paths

**Path A — Manual (Claude Code picks up):**
1. Document created via `document(push)` or `generate_claude_md(push)` → status: `pending`
2. Claude Code calls `document(list, status="pending")` to find documents
3. Code writes file to local filesystem at `routing.targetPath`
4. Code calls `document(deliver, docId=...)` → status: `delivered`

**Path B — Auto GitHub (immediate on push):**
1. `generate_claude_md(push)` always attempts auto-delivery if `GITHUB_TOKEN` is set
2. `document(push, autoDeliver=true)` attempts auto-delivery for any document type
3. Server looks up `config.apps[appId].repos.prod` and `config.apps[appId].subPath`
4. Calls `deliverToGitHub()` → GitHub Contents API PUT
5. Success: status `delivered`, `deliveredBy: "mcp-github"`, commit SHA in metadata
6. Failure: status `failed`, `failureReason` set, document remains for manual retry

**Path C — On-demand GitHub delivery:**
1. `document(deliver-to-github, docId=...)` explicitly triggers GitHub delivery
2. Same logic as Path B but for any pending document

### Path Resolution

`resolveTargetPath(docType, targetPath, subPath)`:
- `("CLAUDE.md", null)` → `CLAUDE.md`
- `("CLAUDE.md", "my-app")` → `my-app/CLAUDE.md`
- `("specs/f.md", "/my-app/")` → `my-app/specs/f.md`

### GitHub API Details

- Base: `https://api.github.com`
- Auth: `Bearer {GITHUB_TOKEN}`
- Version header: `X-GitHub-Api-Version: 2022-11-28`
- Commit message: `docs({appName}): update {type} via CC MCP [{ISO timestamp}]`
- Committer: `Command Center MCP <noreply@cc-mcp.dev>`
- Conflict handling: one retry on HTTP 409 (SHA mismatch)

### Document Lifecycle (Lifespan / TTL)

Documents have a `lifespan` field that controls automatic cleanup:

| Lifespan | TTL | Cleanup Trigger | Default For |
|----------|-----|-----------------|-------------|
| `ephemeral` | immediate | Deleted from Firebase on `deliver` or `ack` | `message` |
| `short` | 7 days | Lazy-deleted when `list` is called | `spec`, `architecture`, `test-plan`, `design` |
| `standard` | 30 days | Lazy-deleted when `list` is called | all other types |
| `permanent` | none | Never auto-deleted; retained in Firebase after GitHub delivery | `claude-md`, `project-instructions` |

**Ephemeral behavior:** When `deliver` or `ack` is called on an ephemeral document, it is immediately removed from Firebase. The response includes `_deleted: true` to indicate the document no longer exists in the database.

**Lazy-delete:** When `list` is called, expired documents (based on `createdAt` + TTL) are filtered out of results and asynchronously deleted from Firebase. The response includes `{ docs: [...], _purged: N }` when purging occurs.

**Purge action:** `document(purge)` deletes all delivered/failed documents older than 24 hours regardless of lifespan. Use for manual cleanup.

**deliver-to-github:** Always deletes from Firebase after successful GitHub commit (per RULE: Firebase is not the system of record for committed files).

---

## 11. AsyncLocalStorage Pattern

**Problem:** MCP SDK tool handlers have no per-request parameter — no access to the HTTP request or authenticated user.

**Solution:** Node.js `AsyncLocalStorage` from `async_hooks`.

```
Request arrives at POST /mcp
  → authMiddleware extracts firebaseUid from token
  → requestContext.run({ firebaseUid }, async () => {
      → mcpServer.connect(transport)
      → transport.handleRequest(req, res, req.body)
        → SDK dispatches to tool handler
          → tool calls getCurrentUid()
            → requestContext.getStore()?.firebaseUid
    })
```

Fallback chain: AsyncLocalStorage → `FIREBASE_UID` env var → throws error.

This gives full multi-tenancy: concurrent requests each have their own UID context.

---

## 12. Source File Map

```
mcp-server/
├── architecture/
│   └── SYSTEM-CONTEXT.md          # This file
├── src/
│   ├── index.ts                   # Express app, CORS, auth middleware, MCP endpoints
│   ├── server.ts                  # MCP server creation, tool/prompt/resource registration
│   ├── context.ts                 # AsyncLocalStorage<RequestContext>, getCurrentUid()
│   ├── firebase.ts                # Firebase Admin init, 27 reference factory functions
│   ├── github.ts                  # GitHub Contents API client (auto-delivery)
│   ├── skills.ts                  # 33+ skill prompt constants, registerSkillPrompts(), getCompiledSkillRegistry()
│   ├── skill-cache.ts             # In-memory skill cache (Firebase-backed, 5-min TTL, write-through)
│   ├── surface-registry.ts        # Firebase-backed surface config cache (lazy-loaded Map, CRUD, system-wide)
│   ├── signal-computation.ts      # Per-request signal computation. Evaluates 10 signal codes based on context (profile flags, job state, session meta, pending messages).
│   ├── session-bootstrap.ts       # handleBootstrap() fan-out reads + handleInit() onboarding. Single-call startup replacement.
│   ├── response-metadata.ts       # Piggybacks metadata onto every MCP tool response: _pendingMessages, _session, _contextHealth, _signals
│   ├── auth/
│   │   ├── oauth.ts               # OAuth 2.1 router (5 endpoints + sign-in page)
│   │   └── store.ts               # In-memory OAuth state + API key validation
│   └── tools/
│       ├── apps.ts                # app tool (list/get/create/update/archive)
│       ├── concepts.ts            # concept (12 actions), list_concepts, get_active_concepts
│       ├── ideas.ts               # idea tool (9 actions: CRUD + graduate/archive/list_ranked)
│       ├── sessions.ts            # session tool (lifecycle + events + preferences + profile + bootstrap + init)
│       ├── jobs.ts                # job tool (lifecycle + events + outcomes)
│       ├── generate.ts            # generate_claude_md tool (generate/push/get)
│       ├── documents.ts           # document tool (queue + delivery + messaging, 13 actions)
│       ├── knowledge-tree.ts      # knowledge_tree tool (forest/tree CRUD, index, search, 15 actions)
│       ├── knowledge-node.ts      # knowledge_node tool (node CRUD, cross-refs, bulk_verify, 9 actions)
│       ├── repo.ts                # repo_file tool (read files from GitHub repos)
│       ├── skills.ts              # skill tool (list/get/create/update/delete — full CRUD)
│       └── surface-registry.ts    # surface_registry tool (list/get/create/update/delete — surface config CRUD)
├── deploy.sh                      # Build + deploy to Cloud Run + OAuth verification
├── e2e-test.sh                    # 482+ E2E tests against live service
├── migrate-skills.sh              # Seed Firebase skills from compiled constants (idempotent)
├── migrate-signals.sh             # Seed Firebase signal registry with 10 signal definitions
├── Dockerfile                     # Two-stage: build TypeScript, run production
├── package.json                   # Dependencies and scripts
├── tsconfig.json                  # TypeScript config (ES2022, NodeNext, strict)
├── .dockerignore                  # Excludes node_modules, dist, .md, .git, .env
└── .gcloudignore                  # Excludes node_modules, dist, .git, .md, e2e-test.sh
```

---

## 13. Dependencies

### Production

| Package | Version | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | ^1.10.0 | MCP server framework |
| `express` | ^4.21.0 | HTTP server |
| `firebase-admin` | ^13.6.0 | Firebase RTDB + Auth token verification |
| `uuid` | ^11.0.0 | OAuth client/code/token ID generation |
| `zod` | ^3.24.0 | Tool parameter schema validation |

### Dev

| Package | Version | Purpose |
|---------|---------|---------|
| `@types/express` | ^4.17.21 | TypeScript types |
| `@types/node` | ^20.17.0 | TypeScript types |
| `@types/uuid` | ^10.0.0 | TypeScript types |
| `tsx` | ^4.19.0 | Dev server (`npm run dev`) |
| `typescript` | ^5.7.0 | Compiler |

---

## 14. Deploy and Maintenance

### Deploy

```bash
cd mcp-server
bash deploy.sh              # Build TypeScript + deploy to Cloud Run
bash deploy.sh --build-only # Just compile, skip deploy
```

### After Every Deploy

- **Claude.ai users must reconnect:** OAuth tokens are in-memory, lost on restart. Go to Claude.ai → Settings → Integrations → disconnect and reconnect cc-mcp-server.
- **Claude Code is unaffected:** CC API keys are validated against Firebase RTDB (persistent).

### Key Provisioning

| Key | How to Create | How to Store |
|-----|--------------|-------------|
| CC API Key | Generated in CC app UI, stored as SHA-256 hash in Firebase | Firebase RTDB: `command-center/{uid}/apiKeyHash` |
| GitHub PAT | GitHub → Settings → Developer Settings → Fine-grained PATs → Contents: Read and write | `echo -n "github_pat_..." \| gcloud secrets create GITHUB_TOKEN --data-file=- --project=word-boxing` then `gcloud secrets add-iam-policy-binding GITHUB_TOKEN --member="serviceAccount:300155036194-compute@developer.gserviceaccount.com" --role="roles/secretmanager.secretAccessor" --project=word-boxing` |
| Firebase Web API Key | Firebase Console → Project Settings → Web API Key | Set via `--set-env-vars` in deploy.sh (public, not a secret) |

### Updating GitHub Token

```bash
# Create new version of existing secret
echo -n "github_pat_NEW_TOKEN" | gcloud secrets versions add GITHUB_TOKEN --data-file=- --project=word-boxing
# Redeploy to pick up new version (uses :latest)
bash deploy.sh
```

### Monitoring

- Cloud Run logs: `gcloud run logs read cc-mcp-server --region=us-central1 --project=word-boxing`
- Startup log shows: `GitHub delivery: ENABLED | DISABLED (no GITHUB_TOKEN)`

### E2E Tests

```bash
cd mcp-server
bash e2e-test.sh    # Runs 357 tests against live Cloud Run service
```

Tests use the CC API key `cc_oUt4ba0dYVRBfPREqoJ1yIsJKjr1_wxityxnkh8pqw1vu7ztmp`. Test artifacts are identifiable by convention — "E2E" in job/session titles, `e2e-test-` appId prefixes, `e2e-test/` document targetPaths — and are cleaned up in Phase 14 plus the teardown phase.

**The test and prod servers share one Firebase RTDB.** Cleanup must therefore be scoped to IDs the run tracked, or to the fixture markers above. Never list-and-sweep a collection by `appId` alone: `appId=command-center` holds the live Chat↔Code message queue, and delivering a pending document there destroys inter-agent messages neither side has read. `document(purge)` is a global maintenance op (all delivered/failed docs older than 24h, across every app) and is opt-in only:

```bash
bash e2e-test.sh --purge   # also exercises document(purge)
```

---

## 15. MCP Prompts and Resource

### Built-in Prompts

| Name | Parameters | Purpose |
|------|-----------|---------|
| `start-ideation-session` | appId, appName, focusArea | Loads ODRC state, constructs full session protocol prompt |
| `generate-claude-md` | appId, appName | Instructs model to call generate_claude_md with push |

### Resource

| Name | URI Template | Returns |
|------|-------------|---------|
| `app-odrc-state` | `cc://apps/{appId}/state` | JSON: `{ rules, constraints, decisions, opens, totalActive }` |

---

## 16. Connection Configuration

### Claude Code (.mcp.json)

```json
{
  "mcpServers": {
    "cc-mcp": {
      "type": "http",
      "url": "https://cc-mcp-server-300155036194.us-central1.run.app/mcp",
      "headers": {
        "Authorization": "Bearer cc_{uid}_{secret}"
      }
    }
  }
}
```

### Claude.ai Chat

1. Settings → Integrations → Add MCP Server
2. URL: `https://cc-mcp-server-300155036194.us-central1.run.app/mcp`
3. Sign in via Google or paste Firebase UID
4. Configure: "Allow all tools automatically"

### CORS

Allowed origins: `https://claude.ai`, `https://claude.com`, `https://www.claude.ai`, `https://www.claude.com`

Allowed headers: `Content-Type`, `Authorization`, `Mcp-Session-Id`

---

## 17. Operational Safeguards

> **Why this section exists:** On 2026-02-18/19, zombie polling scripts from orphaned Claude Code sessions caused $17/day in Firebase bandwidth costs for a single user. This section documents the incident, the safeguards put in place, and the rules that prevent recurrence.

### Firebase Cost Model

Firebase Realtime Database charges ~$1/GB for bandwidth (data downloaded by clients). Every `.on('value')` listener re-downloads its entire query result set whenever any child changes. Every `.once('value')` read downloads the full result set once. Full-collection reads on paths with hundreds of objects and heavy payloads (jobs with instructions, attachments, events arrays) are the primary cost driver.

### The Zombie Polling Incident (Feb 2026)

**Root cause:** Three bash scripts created by previous Claude Code sessions were left running in `/tmp/` after those sessions ended. Each script polled `document(receive)` every 10 seconds via the MCP server. Combined polling cadence: one full-collection read every ~3.5 seconds.

**Why it was expensive:** The `document(receive)` action performed `getDocumentsRef(uid).once("value")` — downloading the entire documents collection (~1MB, 173 documents including delivered/failed ones) on every call. At ~3.5 second intervals, this consumed ~17MB/minute = ~1GB/hour = ~$17/day.

**Fix applied:**
1. Killed all zombie scripts, deleted from `/tmp/`
2. Purged 171 delivered/failed documents (1MB → 12KB)
3. Changed `document(receive)` to query `orderByChild("status").equalTo("pending")` server-side
4. Changed `document(list)` to filter by status server-side (default: "pending")
5. Changed `document(purge)` to query by status separately instead of full collection read
6. Added `.indexOn: ["status", "createdAt"]` on the documents path

**Lesson:** Any background process that outlives its creating session becomes a zombie. Firebase bandwidth costs are proportional to data × frequency, so even small reads at high frequency are expensive.

### Browser Listener Limits (v8.71.4)

All Firebase `.on('value')` listeners in the CC browser app are bounded by `limitToLast(N)`:

| Collection | Limit | Object Size | Max Per-Trigger Download | Rationale |
|-----------|-------|-------------|------------------------|-----------|
| Jobs | 10 | ~10-100KB (instructions, attachments, events) | ~1MB | Heaviest objects; "Load More" button for historical |
| Sessions | 15 | ~3KB | ~45KB | Moderate size; no Load More yet |
| Concepts | 50 | ~0.5KB | ~25KB | Lightweight; CLAUDE.md gen uses `.once()` |
| Ideas | 20 | ~0.5KB | ~10KB | Lightweight; rarely exceed 20 per user |
| Work Items | 20 | ~1KB | ~20KB | Lightly used feature |

**Suspended listeners** (v8.70.11): activity, team, teamMembership, streams, orphan commits — all suspended because they had no data for single-user operation. Re-enable when features become active.

### Server-Side Query Filtering Rules

**RULE: No full-collection reads.** Every Firebase query in the MCP server must use `orderByChild().equalTo()`, `limitToLast()`, or both. Never call `ref.once("value")` on a collection path without a query constraint.

**RULE: Indexes required.** Any `orderByChild()` query requires a corresponding `.indexOn` rule in Firebase RTDB. Without it, Firebase downloads the entire collection and filters client-side, defeating the purpose.

### Write Debouncing

Context tracking uses two accumulation strategies depending on the parameter:
- **`turnDelta`** (delta semantics): Accumulated in an in-memory `pendingContextIncrements` Map keyed by `uid:surface`. A timer flushes to Firebase every 30 seconds. This replaces per-call read+write that was a significant bandwidth driver.
- **`contextEstimate`** (absolute semantics): Written directly to Firebase via `setInteractionAbsolute()`. Not batched — the value IS the interaction total, not a delta to add. This is critical: accumulating absolute values caused a bug where Chat hit "imminent" zone at startup (562K computed from summing 15K+35K+71K+... instead of using 76K).
- **`serverSent`** always uses the debounce/batch pattern regardless of which client parameter is used.

### Anti-Polling Rules

**RULE: No background polling scripts.** Claude Code must NEVER create bash scripts, cron jobs, shell loops, or any persistent background process to poll for messages or check job status. All MCP tool calls must happen inline within the active conversation context. Background scripts outlive sessions and cause catastrophic Firebase bandwidth costs.

**RULE: Inline-only message checking.** The correct pattern for inter-agent messaging:
1. Call `document(receive)` once when checking for messages
2. If told "WAIT: poll", call `document(receive)` again after 30-60 seconds WITHIN the conversation
3. If told "WAIT: working", stop checking and inform the user to re-engage later
4. NEVER spawn a background process to do this
