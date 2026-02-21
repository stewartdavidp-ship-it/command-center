# Research: How Code Would Decompose a Team-Eligible Spec

**Job:** `-OlwpOrPOMwy76U38Ybd`
**Idea:** Leverage Claude Code Agent Teams (`-OlwlFNxqh3BN7HcQnTF`)
**Date:** 2026-02-20
**Author:** Claude Code

---

## Task 1: My Decomposition Process

When I claim a CC job and decide it would benefit from an Agent Team, here are the exact steps I take BEFORE spawning teammates. This is the cognitive overhead Chat can eliminate.

### Step 1: Read the spec and build a mental graph

I read the full CLAUDE.md, job instructions, and any attachments. As I read, I'm building a dependency graph in my context window:

- **What files will be touched?** I scan instructions for file paths, component names, API routes.
- **What are the deliverables?** Each distinct output (a component, a function, a migration, a test file) becomes a potential work unit.
- **What depends on what?** If component B imports from component A, A must exist first. If a test file tests a function, the function must exist first.

This step costs ~2,000-5,000 tokens depending on spec size. For a typical CC job, I'm reading CLAUDE.md (~3K chars), instructions (~2K chars), and maybe a concept snapshot (~5K chars).

### Step 2: Identify parallelism boundaries

I look for the natural seams — places where work can proceed independently:

**File ownership boundaries**: If two work items touch different files, they can parallelize. This is the strongest signal. Example: `skills.ts` changes and `concepts.ts` changes are independent.

**Layer boundaries**: Backend vs frontend vs database vs tests. Even within a single repo, these layers often have clean interfaces.

**Codebase boundaries**: In CC's case, the MCP server (`mcp-server/src/`), Firebase Functions (`firebase-functions/functions/`), Firebase Rules (`database.rules.json`), and the CC app (`index.html`) are almost always independent.

**Read vs write phases**: Audit/investigation work is always parallelizable. Two teammates reading different files simultaneously has zero conflict risk.

### Step 3: Determine team size

My heuristic:

- **1 teammate**: Only if there's one large independent chunk and I need to coordinate.  Usually just use a subagent.
- **2-3 teammates**: The sweet spot for most CC jobs. Each owns a codebase or layer. Lead coordinates and merges.
- **4-5 teammates**: Only for broad audit/investigation tasks where each teammate scans a different subsystem. Diminishing returns above 5.

The constraint is file conflict, not compute. Two teammates editing `index.html` is worse than one teammate doing both edits sequentially. So team size = number of non-overlapping file ownership zones.

### Step 4: Define spawn prompts

Each teammate needs:

1. **Role**: What they're responsible for (e.g., "You own the MCP server. Your changes go in `mcp-server/src/`.")
2. **File scope**: Explicit list of files they can modify. This prevents conflicts.
3. **Interface contracts**: What they must produce that other teammates depend on. (e.g., "Export a `validateInput()` function from `validation.ts` that accepts a Zod schema and input object.")
4. **What NOT to touch**: Explicit exclusions. "Do not modify `index.html` — the lead handles that."
5. **Completion criteria**: How the teammate knows they're done. "All 3 tools have input validation. Tests pass."

### Step 5: Build the task list with dependencies

I create tasks in the shared task list, marking dependencies:

```
Task 1: [teammate-A] Add Zod validation to concepts.ts (no deps)
Task 2: [teammate-B] Add Zod validation to sessions.ts (no deps)
Task 3: [teammate-C] Add Zod validation to jobs.ts (no deps)
Task 4: [lead] Merge and test integration (depends: 1, 2, 3)
```

The dependency graph determines the critical path. If Task 4 can't start until 1-3 finish, the wall-clock time is max(1,2,3) + 4 rather than 1+2+3+4.

### Step 6: Identify coordination points

Where do teammates need to talk to each other?

- **Shared interfaces**: If teammate A creates a type that teammate B needs to import, A must message B when the type is ready.
- **Integration seams**: If the backend teammate creates an API endpoint, the frontend teammate needs the endpoint URL and payload shape.
- **Discovery broadcasts**: "I found a bug in the auth middleware that affects everyone" — this is a broadcast message.

### Total cost of this decomposition

For a typical CC job, this analysis consumes **3,000-8,000 tokens** of my context window and takes 1-2 minutes of wall-clock time. For a complex multi-codebase job, it can be **10,000-15,000 tokens**. This is the entire overhead Chat can eliminate.

---

## Task 2: Decompositions of Real CC Scenarios

### Scenario A: Security Hardening Sweep

**Original approach**: Sequential. Fix MCP server, then Firebase Functions, then Firebase Rules, then CC browser app. Each fix required reading the codebase, understanding the security surface, implementing, and verifying.

**Team decomposition**:

| Teammate | Role | File Ownership | Deliverable |
|----------|------|---------------|-------------|
| Teammate A | MCP server hardener | `mcp-server/src/**` | Zod validation on all tool inputs, auth checks on all endpoints |
| Teammate B | Firebase Functions hardener | `firebase-functions/functions/index.js` | Origin validation on domainProxy, input sanitization on all functions |
| Teammate C | Firebase Rules hardener | `firebase-functions/database.rules.json` | `.validate` rules on all write paths |
| Teammate D | Browser XSS hardener | `command-center/index.html` | Audit all `innerHTML` / `dangerouslySetInnerHTML` usages |
| Lead | Coordinator | None (merge only) | Deploys all four after teammates complete |

**Task dependency graph**:
```
[A: MCP server fixes]     ─┐
[B: Firebase Functions]    ─┤
[C: Firebase Rules]        ─┼─> [Lead: Integration test + deploy all]
[D: Browser XSS audit]    ─┘
```

All four teammates work in parallel. Zero dependencies between them. Lead waits for all four, then deploys in the right order (Rules first, then Functions, then MCP server, then CC app).

**Interface contracts**: None needed. Each codebase is independent. The only coordination is the deploy order, which the lead handles.

**Estimated savings**: Original took ~45 minutes across one context window. With 4 teammates: ~15 minutes wall-clock (longest single codebase) + 5 minutes for lead deploy coordination = **~55% time reduction**.

### Scenario B: TTC Audit and Fix

**Original approach**: Sequential audit of all skills and tool responses, then sequential fixes across 6 files.

**Team decomposition — Phase 1 (Audit)**:

| Teammate | Role | Scope | Deliverable |
|----------|------|-------|-------------|
| Teammate A | Skill measurer | `mcp-server/src/skills.ts` | Size of each skill in chars, grouped by surface (Chat/Code/shared) |
| Teammate B | Tool response analyzer | `mcp-server/src/tools/*.ts` | Response size measurements for each tool action with sample data |
| Teammate C | Prompt analyzer | `mcp-server/src/server.ts` | Cold-start prompt size, OPENs injection size, per-surface costs |

**Phase 1 task graph**:
```
[A: Measure skills]        ─┐
[B: Measure tool responses] ─┼─> [Lead: Synthesize findings, prioritize fixes]
[C: Measure prompts]       ─┘
```

**Phase 2 (Fixes)** — Lead assigns based on Phase 1 findings:

| Teammate | Fix | File |
|----------|-----|------|
| Teammate A | Summary mode for get_active_concepts | `tools/concepts.ts` |
| Teammate B | Events cap in session get + job get | `tools/sessions.ts`, `tools/jobs.ts` |
| Teammate C | OPENs cap in ideation prompt + retro journal trim | `server.ts`, `skills.ts` |

**Estimated savings**: Phase 1 audit alone saves ~40% (parallel reads). Phase 2 fixes save ~50% (parallel writes to different files). Total: **~45% time reduction**.

### Scenario C: Cross-Layer Feature Build (Standard React App)

**Team decomposition**:

| Teammate | Role | File Ownership | Deliverable |
|----------|------|---------------|-------------|
| Teammate A | Backend engineer | `src/routes/`, `src/middleware/`, `src/services/` | Express API routes, service layer, middleware |
| Teammate B | Frontend engineer | `src/components/`, `src/hooks/`, `src/pages/` | React components, hooks, pages |
| Teammate C | Database engineer | `migrations/`, `src/models/` | PostgreSQL migrations, model definitions |
| Teammate D | Test engineer | `tests/` | Unit tests for all layers |

**Task dependency graph**:
```
[C: DB migrations + models] ─┐
                              ├─> [A: Backend routes using models] ─┐
                              │                                      ├─> [B: Frontend using API] ─┐
                              │                                      │                              ├─> [D: Tests for all]
                              └──────────────────────────────────────┘                              │
                                                                                                   ↓
                                                                                           [Lead: Integration]
```

**Interface contracts** (critical here):
- C → A: Model exports. C messages A: "Team model is at `src/models/team.ts`, exports `Team`, `TeamMember` types and `teamService` with methods `create`, `getById`, `addMember`, `removeMember`."
- A → B: API contract. A messages B: "POST /api/teams creates team, GET /api/teams/:id returns team, PUT /api/teams/:id/members adds member. All require auth header. Response shapes: [JSON examples]."
- A,B,C → D: Test engineer needs to know what to test. Each teammate messages D with their public API.

**Why this works**: Unlike CC's single-file constraint, a standard React app has natural directory boundaries. Each teammate stays in their lane.

**Estimated savings**: The dependency chain means this isn't fully parallel — DB must finish before Backend can start, Backend before Frontend. But with interface contracts defined up front, teammates can start with stubs and fill in real implementations when dependencies land. **~35-40% time reduction**.

### Scenario D: Documentation + Skill Update Sprint

**Team decomposition**:

| Teammate | Role | File Ownership | Deliverable |
|----------|------|---------------|-------------|
| Teammate A | Documentation writer | `ARCHITECTURE.md` | Restructured architecture doc |
| Teammate B | Router updater | `mcp-server/src/skills.ts` (SKILL_ROUTER section) | Updated router with embedded Quick Reference |
| Teammate C | Protocol updater | `mcp-server/src/skills.ts` (protocol sections) | Updated session-protocol, build-protocol, session-resume |

**Important constraint**: Teammates B and C both edit `skills.ts`. This is a conflict. Options:

1. **Sequential**: B finishes router section, then C edits protocol sections. Reduces parallelism but avoids conflict.
2. **Section ownership**: B owns lines 1-200 (router), C owns lines 201-400 (protocols). Risky — line numbers shift.
3. **Merge approach**: B and C each produce a patch file. Lead applies both patches and resolves conflicts.

**Recommended**: Option 3. Each teammate writes their changes to a scratch file (`router-patch.md`, `protocol-patch.md`). Lead merges into `skills.ts`. This adds one lead step but preserves full parallelism.

**Task graph**:
```
[A: ARCHITECTURE.md]      ─┐
[B: Router patch]          ─┼─> [Lead: Merge patches into skills.ts, deploy]
[C: Protocol patches]      ─┘
```

**Estimated savings**: Original was 3 sequential deploys. With team: one deploy after merge. **~50% time reduction**.

### Scenario E: Multi-Track Bug Fixes

**Team decomposition**:

| Teammate | Role | Bug | File Ownership |
|----------|------|-----|---------------|
| Teammate A | UI bug fixer | Rendering issue in component | `src/components/affected.tsx` |
| Teammate B | Race condition fixer | Service race condition | `src/services/affected.ts` |
| Teammate C | Config fixer | Configuration error | `config/affected.json`, `src/config.ts` |

**Task graph**:
```
[A: UI fix]      ─┐
[B: Race fix]    ─┼─> [Lead: Verify all fixes, run full test suite, commit]
[C: Config fix]  ─┘
```

Zero dependencies. Each bug is in a different file. This is the simplest Agent Teams use case — pure embarrassingly parallel work.

**Estimated savings**: **~60-70% time reduction**. Wall-clock time = max(A, B, C) + lead verification, vs A + B + C sequentially.

---

## Task 3: The Ideal Spec Format for Team-Ready Specs

Based on my decomposition process above, here are the spec sections that would let me skip straight from "claim job" to "spawn team."

### Proposed CLAUDE.md Additions for Team-Eligible Specs

```markdown
## Team Decomposition

### Team Structure
| Track | Teammate Role | File Ownership | Model |
|-------|--------------|----------------|-------|
| track-a | MCP Server Engineer | mcp-server/src/** | sonnet |
| track-b | Firebase Functions Engineer | firebase-functions/** | sonnet |
| track-c | CC App Engineer | command-center/index.html | sonnet |

### File Ownership Map
Explicit non-overlapping file assignments. If a file isn't listed,
only the lead can modify it.

track-a owns:
  - mcp-server/src/tools/concepts.ts
  - mcp-server/src/tools/sessions.ts
  - mcp-server/src/tools/jobs.ts

track-b owns:
  - firebase-functions/functions/index.js
  - firebase-functions/database.rules.json

track-c owns:
  - command-center/index.html (lines 5000-5500 only — Team section)

### Task Graph
Tasks with dependencies. Format: [id] description (depends: id, id)

[1] Add Zod validation to concepts.ts (no deps)
[2] Add Zod validation to sessions.ts (no deps)
[3] Add origin checks to domainProxy (no deps)
[4] Integration test all tools (depends: 1, 2, 3)

### Interface Contracts
What teammates must produce for other teammates to consume.

track-a produces for track-c:
  - New MCP tool `team_invite` with params: {email: string, role: "admin"|"member"}
  - Response shape: {inviteId: string, status: "pending"}

track-b produces for track-a:
  - Firebase rule path: command-center/{uid}/teamInvites/{inviteId}
  - Write validation: .validate rule ensures inviteId matches auth.uid

### Spawn Prompts
Pre-written prompts for each teammate. The lead can use these verbatim.

track-a spawn prompt: |
  You are the MCP Server Engineer. Your job is to add input validation
  to all tool handlers in mcp-server/src/tools/. You own all files in
  mcp-server/src/. Do NOT modify any files outside this directory.
  When done, message the lead with a summary of changes.

track-b spawn prompt: |
  You are the Firebase Engineer. Your job is to add origin validation
  to the domainProxy function and .validate rules to all write paths.
  You own firebase-functions/. Do NOT modify any other files.
  When done, message the lead with a summary of changes.

### Coordination Protocol
When teammates need to communicate:

- After track-a completes task 1: message track-c with the new tool interface
- After track-b completes task 3: broadcast "Firebase rules updated, all
  teammates should verify their write patterns still work"

### Success Criteria Per Track
track-a: All tools have Zod validation. No tool accepts unvalidated input.
track-b: domainProxy rejects non-whitelisted origins. All write paths have .validate.
track-c: Team section renders invite UI. Connects to new MCP tool.

### Deploy Sequence
Order matters. Lead executes after all tracks complete:
1. Firebase Rules (track-b output)
2. Firebase Functions (track-b output)
3. MCP Server (track-a output)
4. CC App (track-c output)
```

### Key Design Principles

1. **File Ownership Map is non-negotiable.** This is the single most important section. Without it, teammates will step on each other. Every file that any teammate modifies must be explicitly assigned to exactly one track.

2. **Task Graph replaces prose instructions.** Instead of "first do X, then do Y," the graph lets the lead (or the task system) schedule work optimally.

3. **Interface Contracts are the glue.** When track-a produces something track-c consumes, the contract defines the shape up front. This lets track-c start working with stubs immediately.

4. **Spawn Prompts save the most context.** Writing each teammate's prompt in the spec means the lead spends zero tokens figuring out what to tell each teammate. The lead just reads the spec, creates the team, and pastes the spawn prompts.

5. **Deploy Sequence handles the merge.** For CC's multi-codebase architecture, deploy order matters. Putting it in the spec means the lead doesn't need to figure it out.

---

## Task 4: What Chat Cannot Do For Code

These are the parts of decomposition that inherently require Code's runtime judgment.

### 1. Current State of the Codebase

Chat generates specs based on its understanding of the architecture, which comes from CLAUDE.md, ODRC concepts, and session history. But Chat doesn't see the actual code. This creates gaps:

- **File sizes and complexity**: Chat might assign "add validation to concepts.ts" as one task, not knowing that `concepts.ts` is 300 lines with 8 tool actions. That might be two tasks, not one.
- **Import/dependency graphs**: Chat can't verify that `sessions.ts` doesn't import from `concepts.ts`. If it does, the file ownership map needs adjustment.
- **Existing patterns**: Chat might spec a Zod validation approach, but Code discovers the codebase already uses a custom validation helper. Teammates should use the existing pattern, not introduce a new one.

**Mitigation**: Code's lead should do a quick codebase scan (5-10 seconds) after claiming the job to validate the file ownership map. If discrepancies are found, the lead adjusts before spawning.

### 2. Merge Conflict Detection

Chat can't predict which files will have merge conflicts. Even with a file ownership map, there are edge cases:

- **Shared imports**: Two teammates both need to add an import to `server.ts`. Even if neither "owns" `server.ts`, both need to modify it.
- **Lock files**: `package-lock.json`, `yarn.lock` — any teammate who adds a dependency modifies this shared file.
- **Generated files**: TypeScript compilation, bundle outputs — these change when any source file changes.

**Mitigation**: The spec should list known shared files (like `server.ts` for registering new tools) and assign them to the lead or a specific track. Code's lead handles the rest at merge time.

### 3. Runtime Discoveries

During implementation, teammates discover things that change the plan:

- **"This function doesn't exist yet"**: Chat's spec assumed a function was there. It wasn't. The teammate needs to create it, which might conflict with another teammate's scope.
- **"The test framework isn't set up"**: Chat assumed tests could just be written. But the test runner, config, and fixtures don't exist.
- **"This approach won't work because of X"**: A teammate discovers a technical constraint that invalidates their track's plan. They need to message the lead to re-plan.

**Mitigation**: Chat can't prevent these, but Chat CAN reduce them by:
- Being explicit about assumptions: "This assumes `validateInput()` exists in `validation.ts`."
- Flagging known unknowns: "OPEN: Does the test framework support async lifecycle hooks? Teammate should verify before writing tests."
- Including fallback approaches: "If Zod doesn't support this schema shape, use manual validation with the pattern in `existing-validation.ts`."

### 4. Performance and Timing Judgments

Chat can't predict:

- **How long each track will take**: A seemingly simple task might require deep debugging. A seemingly complex task might be a 5-line change.
- **When to broadcast vs direct-message**: This depends on what teammates are currently doing, which is runtime state.
- **When to abandon a track**: If teammate C is stuck for 10 minutes on a config issue, the lead might decide to kill that track and do it sequentially. Chat can't predict this.

**Mitigation**: The spec should include time estimates ("this track is expected to take ~10 min") and fallback instructions ("if this track exceeds 20 min, the lead should absorb this work directly").

### 5. The Single-File Problem (CC-Specific)

CC's `index.html` is ~31,700 lines. For CC builds specifically, Chat cannot decompose work on this file into parallel tracks because:

- Two teammates editing different sections of the same file will overwrite each other.
- Line-based ownership is fragile — adding lines in one section shifts line numbers in another.
- Even with section ownership, React component definitions often reference each other.

**Mitigation for CC specifically**: Chat can still decompose the *design* work:
- Teammate A designs Component X (outputs a code block, doesn't write to file)
- Teammate B designs Component Y (outputs a code block, doesn't write to file)
- Lead integrates both designs into `index.html` sequentially

This is the "design-parallelism" pattern from the concepts. Chat should mark these tracks as "design-only, lead-merge" in the spec.

### Summary: What Chat CAN vs CANNOT Pre-Decompose

| Chat CAN | Chat CANNOT |
|----------|-------------|
| File ownership map (based on architecture knowledge) | Validate ownership against actual import graph |
| Task graph with dependencies | Runtime dependency discoveries |
| Interface contracts (based on ODRC concepts) | Runtime interface adjustments |
| Spawn prompts per track | Adaptive re-prompting when tracks diverge |
| Deploy sequence | Merge conflict resolution |
| Time estimates | Actual timing and abandonment decisions |
| Design-only tracks for single-file work | Direct parallel edits to same file |

---

## Recommendations for CC Spec Generation

Based on this research, here's how CC's `generate_claude_md` tool should evolve:

1. **Add a `## Team Decomposition` section** to generated CLAUDE.md when the job touches multiple codebases or has >3 independent tasks.

2. **Auto-generate File Ownership Maps** from the app's codebase structure. CC already knows the repo layout — use it.

3. **Include Spawn Prompts as job attachments**, one per track. The lead reads them verbatim.

4. **Flag single-file work explicitly** with the "design-only, lead-merge" pattern. Don't pretend `index.html` can be parallel-edited.

5. **Add a `teamEligible: boolean` field to jobs** so the lead knows immediately whether to spawn a team or work solo.

6. **Include time estimates per track** based on historical job completion data (CC already tracks this in job events).

7. **Separate "decomposition" from "execution"** in the spec. The decomposition section is for the lead. The execution details are per-track in spawn prompts.
