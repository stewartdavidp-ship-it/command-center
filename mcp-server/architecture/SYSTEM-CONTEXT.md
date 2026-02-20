# CC MCP Server — System Context Reference

> **Purpose:** AI-readable architecture reference. Load this document at the start of any session
> that modifies the MCP server to get full system context quickly.
>
> **Keep current:** Update this file whenever architecture changes are made.
>
> **Last updated:** 2026-02-19 — Revision 27

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

**Key numbers:** 10 tools, 24 skills, 2 built-in prompts, 1 resource, 357 E2E tests.

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
    │       └── lifecycle: { ... }
    │
    ├── concepts/{conceptId}/            # ODRC objects
    │   ├── type: "OPEN" | "DECISION" | "RULE" | "CONSTRAINT"
    │   ├── content, status, ideaOrigin
    │   ├── scopeTags: string[]
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
    │   ├── events: [ { type, detail, refId, timestamp } ]
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
    └── apiKeyHash                       # SHA-256 of CC API key
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
| `getConfigRef()` | `command-center/config` |
| `getConceptsRef(uid)` | `command-center/{uid}/concepts` |
| `getIdeasRef(uid)` | `command-center/{uid}/ideas` |
| `getAppIdeasRef(uid, appId)` | `command-center/{uid}/appIdeas/{appId}` |
| `getSessionsRef(uid)` | `command-center/{uid}/sessions` |
| `getSessionRef(uid, sid)` | `command-center/{uid}/sessions/{sid}` |
| `getJobsRef(uid)` | `command-center/{uid}/jobs` |
| `getJobRef(uid, jid)` | `command-center/{uid}/jobs/{jid}` |
| `getClaudeMdRef(uid, appId)` | `command-center/{uid}/claudeMd/{appId}` |
| `getDocumentsRef(uid)` | `command-center/{uid}/documents` |
| `getDocumentRef(uid, docId)` | `command-center/{uid}/documents/{docId}` |

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

Concept statuses: `active`, `superseded`, `resolved`, `transitioned`

---

## 7. Tools Reference

### 10 Registered Tools

| Tool | Actions | Primary User |
|------|---------|-------------|
| `app` | list, get, update | Both |
| `idea` | list, create, update, graduate, archive, get_active | Chat |
| `session` | start, update, add_event, complete, get, list | Chat |
| `concept` | create, update, transition, supersede, resolve | Both |
| `list_concepts` | _(query params only)_ | Both |
| `get_active_concepts` | _(appId required)_ | Both |
| `job` | start, claim, revise, review, approve, update, add_event, complete, get, list | Code |
| `generate_claude_md` | generate, push, get | Chat |
| `document` | push, list, get, deliver, deliver-to-github, fail, send, receive, ack, purge, delete | Both |
| `skill` | list, get | Chat |

### Job Event Types

`open_encountered`, `decision_made`, `file_changed`, `test_result`, `blocker`, `deviation`, `concept_addressed`, `concept_created`, `concept_transitioned`, `note`, `question`, `answer`

Auto-population: `file_changed` events auto-append to `job.filesChanged[]`; `concept_addressed` events auto-append to `job.conceptsAddressed[]`.

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

---

## 8. Skills Reference

### 24 Registered Skills

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

Skills are registered both as MCP prompts (for Claude Code) and accessible via the `skill` tool (for Claude Chat, which uses tools not prompts).

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
| `permanent` | none | Never auto-deleted | `claude-md` |

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
│   ├── firebase.ts                # Firebase Admin init, 11 reference factory functions
│   ├── github.ts                  # GitHub Contents API client (auto-delivery)
│   ├── skills.ts                  # 24 skill prompt constants, registerSkillPrompts()
│   ├── auth/
│   │   ├── oauth.ts               # OAuth 2.1 router (5 endpoints + sign-in page)
│   │   └── store.ts               # In-memory OAuth state + API key validation
│   └── tools/
│       ├── apps.ts                # app tool (list/get/update)
│       ├── concepts.ts            # concept, list_concepts, get_active_concepts tools
│       ├── ideas.ts               # idea tool (CRUD + graduate/archive)
│       ├── sessions.ts            # session tool (lifecycle + events)
│       ├── jobs.ts                # job tool (lifecycle + events + outcomes)
│       ├── generate.ts            # generate_claude_md tool (assemble + push + get)
│       ├── documents.ts           # document tool (queue + delivery + messaging)
│       └── skills.ts              # skill tool (list/get bridge for Chat)
├── deploy.sh                      # Build + deploy to Cloud Run + OAuth verification
├── e2e-test.sh                    # 303 E2E tests against live service
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

Tests use the CC API key `cc_oUt4ba0dYVRBfPREqoJ1yIsJKjr1_wxityxnkh8pqw1vu7ztmp`. Test artifacts use "E2E:" prefix convention and are cleaned up in Phase 14.

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

The `contextEstimate` field on sessions is updated via a debounce pattern:
- Every MCP response size is accumulated in an in-memory `pendingContextIncrements` Map
- A timer flushes the accumulated value to Firebase every 30 seconds
- This replaces per-call read+write that was a significant bandwidth driver

### Anti-Polling Rules

**RULE: No background polling scripts.** Claude Code must NEVER create bash scripts, cron jobs, shell loops, or any persistent background process to poll for messages or check job status. All MCP tool calls must happen inline within the active conversation context. Background scripts outlive sessions and cause catastrophic Firebase bandwidth costs.

**RULE: Inline-only message checking.** The correct pattern for inter-agent messaging:
1. Call `document(receive)` once when checking for messages
2. If told "WAIT: poll", call `document(receive)` again after 30-60 seconds WITHIN the conversation
3. If told "WAIT: working", stop checking and inform the user to re-engage later
4. NEVER spawn a background process to do this
