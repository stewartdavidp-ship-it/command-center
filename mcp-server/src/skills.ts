import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAllCachedSkills, type SkillRecord } from "./skill-cache.js";

/**
 * CC skills registered as MCP prompts.
 * 33 skills:
 *   1. cc-odrc-framework — ODRC type definitions, state machine, writeback protocol
 *   2. cc-session-structure — Live session lifecycle with Firebase-backed tracking
 *   3. cc-session-protocol — Master "how to run a session" skill (Claude Chat)
 *   4. cc-mode-exploration — Exploration posture and flow
 *   5. cc-lens-technical — Technical probing framework
 *   6. cc-build-protocol — Master "how to run a build" skill (Claude Code)
 *   7. cc-build-resume — Compaction recovery for Claude Code mid-build (CRITICAL)
 *   8. cc-session-resume — Compaction recovery for Claude Chat mid-session (CRITICAL)
 *   9. cc-session-continuity — New conversation continuing an existing idea
 *  10. cc-spec-generation — When and how to generate and push CLAUDE.md
 *  11. cc-build-hygiene — Post-build concept cleanup and idea graduation
 *  12. cc-mcp-workflow — End-to-end lifecycle: how Chat and Code interact via MCP
 *  13. cc-lens-stress-test — Stress test probing: find what breaks in existing decisions
 *  14. cc-lens-voice-of-customer — User persona analysis, journey mapping, retention
 *  15. cc-lens-competitive — Competitive analysis, differentiation, positioning
 *  16. cc-lens-economics — Cost analysis, effort estimation, maintenance, ROI
 *  17. cc-protocol-messaging — Inter-agent message types and conversation loop protocol
 *  18. cc-lens-integration — Cross-app integration analysis, data coupling, ecosystem impact
 *  19. cc-lens-ux-deep-dive — Screen-by-screen UX walkthrough, user flows, transitions
 *  20. cc-lens-content — Content strategy, information architecture, quality gates
 *  21. cc-lens-growth — Distribution strategy, SEO, social sharing, measurement
 *  22. cc-lens-accessibility — WCAG compliance, keyboard nav, screen readers, cognitive load
 *  23. cc-lens-operations — Post-launch ops: analytics, monitoring, deployment verification
 *  24. cc-lens-security — Security audit: attack surfaces, auth, Firebase rules, dependencies
 *  25. cc-skill-router — Routing table: which skills to load for each trigger
 *  26. cc-job-creation-protocol — How Chat creates well-formed build jobs for Code
 *  27. cc-retro-journal — Shared learning journal for Chat and Code
 *  28. cc-startup-checklist — Mandatory cold start sequence for Chat
 *  29. cc-tutorial — Guided onboarding tutorial, builds a grocery list app
 *  30. cc-code-startup-checklist — Cold start sequence for Code
 *  31. cc-acc-video — ACC video production pipeline, HTML animations to MP4
 *  32. cc-skill-creation — How to create CC MCP skills, the 6-step flow
 *  33. cc-cowork-startup-checklist — Cold start sequence for Cowork
 */
export function registerSkillPrompts(server: McpServer): void {
  // Register prompts from in-memory cache (Firebase-backed).
  // Each request creates a new McpServer, so this runs per-request.
  // The cache is a module-level singleton populated at startup.
  const cachedSkills = getAllCachedSkills();

  if (cachedSkills.length > 0) {
    for (const skill of cachedSkills) {
      server.prompt(
        skill.name,
        skill.description,
        {},
        async () => ({
          messages: [{
            role: "user",
            content: {
              type: "text",
              text: skill.content,
            },
          }],
        })
      );
    }
    return;
  }

  // Fallback: register from compiled constants if cache is empty
  // (should only happen if cache init failed)
  console.warn("[skills] Cache empty, falling back to compiled prompt registration");

  // ─── 1. ODRC Framework ───────────────────────────────────────────────
  server.prompt(
    "cc-odrc-framework",
    "ODRC thinking framework for ideation sessions. Defines the four concept types, state machine transitions, and immediate Firebase writeback protocol.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_ODRC_FRAMEWORK,
        },
      }],
    })
  );

  // ─── 2. Session Structure ────────────────────────────────────────────
  server.prompt(
    "cc-session-structure",
    "Live session lifecycle — start, work, track, complete. Defines how sessions map to Firebase records and how concept tracking works in real-time.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_SESSION_STRUCTURE,
        },
      }],
    })
  );

  // ─── 3. Session Protocol ─────────────────────────────────────────────
  server.prompt(
    "cc-session-protocol",
    "Master protocol for running a live ideation session. Step-by-step: session (start), concept (create) with sessionId, handle tangents via idea affinity, session (complete).",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_SESSION_PROTOCOL,
        },
      }],
    })
  );

  // ─── 4. Exploration Mode ─────────────────────────────────────────────
  server.prompt(
    "cc-mode-exploration",
    "Exploration mode for ideation sessions. Open discovery focused on surfacing OPENs and making early Decisions.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_MODE_EXPLORATION,
        },
      }],
    })
  );

  // ─── 5. Technical Lens ───────────────────────────────────────────────
  server.prompt(
    "cc-lens-technical",
    "Technical lens for ideation sessions. Probes feasibility, architecture, dependencies, implementation risk, and technical constraints.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_LENS_TECHNICAL,
        },
      }],
    })
  );

  // ─── 6. Build Protocol ─────────────────────────────────────────────
  server.prompt(
    "cc-build-protocol",
    "Master protocol for Claude Code build execution. Step-by-step: check document queue, deliver docs locally, start job, review spec, build, complete job.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_BUILD_PROTOCOL,
        },
      }],
    })
  );

  // ─── 7. Build Resume (Compaction Recovery) ─────────────────────────
  server.prompt(
    "cc-build-resume",
    "CRITICAL: Compaction recovery for Claude Code. Recovers jobId, progress, and position from Firebase when context is lost mid-build.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_BUILD_RESUME,
        },
      }],
    })
  );

  // ─── 8. Session Resume (Compaction Recovery) ───────────────────────
  server.prompt(
    "cc-session-resume",
    "CRITICAL: Compaction recovery for Claude Chat. Recovers sessionId, concepts created, and position from Firebase when context is lost mid-session.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_SESSION_RESUME,
        },
      }],
    })
  );

  // ─── 9. Session Continuity ─────────────────────────────────────────
  server.prompt(
    "cc-session-continuity",
    "New conversation continuing an existing idea. Loads prior session history, identifies arc position, and recommends session focus.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_SESSION_CONTINUITY,
        },
      }],
    })
  );

  // ─── 10. Spec Generation ───────────────────────────────────────────
  server.prompt(
    "cc-spec-generation",
    "When and how to generate CLAUDE.md. Readiness checks, generate vs push decisions, pre-push review, and handoff to Claude Code.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_SPEC_GENERATION,
        },
      }],
    })
  );

  // ─── 11. Build Hygiene ─────────────────────────────────────────────
  server.prompt(
    "cc-build-hygiene",
    "Post-build cleanup: resolve OPENs answered during build, harden DECISIONs to RULEs, graduate ideas, update app records.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_BUILD_HYGIENE,
        },
      }],
    })
  );

  // ─── 12. MCP Workflow ──────────────────────────────────────────────
  server.prompt(
    "cc-mcp-workflow",
    "End-to-end lifecycle overview: how Claude Chat and Claude Code interact via the MCP server, document queue, and job state machine.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_MCP_WORKFLOW,
        },
      }],
    })
  );

  // ─── 13. Stress Test Lens ──────────────────────────────────────────
  server.prompt(
    "cc-lens-stress-test",
    "Stress test probing framework — find what breaks in existing decisions. Adversarial pressure testing before spec generation.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_LENS_STRESS_TEST,
        },
      }],
    })
  );

  // ─── 14. Voice of Customer Lens ────────────────────────────────────
  server.prompt(
    "cc-lens-voice-of-customer",
    "User persona analysis, journey mapping, and retention drivers. Examines the idea from the user's emotional perspective.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_LENS_VOICE_OF_CUSTOMER,
        },
      }],
    })
  );

  // ─── 15. Competitive Lens ──────────────────────────────────────────
  server.prompt(
    "cc-lens-competitive",
    "Competitive analysis, differentiation, and positioning. Compares against existing products and defines unique value.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_LENS_COMPETITIVE,
        },
      }],
    })
  );

  // ─── 16. Economics Lens ────────────────────────────────────────────
  server.prompt(
    "cc-lens-economics",
    "Cost analysis, effort estimation, maintenance burden, and ROI assessment. Go/no-go decision support.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_LENS_ECONOMICS,
        },
      }],
    })
  );

  // ─── 17. Inter-Agent Messaging Protocol ──────────────────────────
  server.prompt(
    "cc-protocol-messaging",
    "Inter-agent message types and conversation loop protocol for Claude Chat ↔ Claude Code communication.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_PROTOCOL_MESSAGING,
        },
      }],
    })
  );

  // ─── 18. Integration / Ecosystem Lens ─────────────────────────────
  server.prompt(
    "cc-lens-integration",
    "Cross-app integration analysis: data coupling, shared dependencies, contract boundaries, and ecosystem impact.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_LENS_INTEGRATION,
        },
      }],
    })
  );

  // ─── 19. UX Deep-Dive Lens ───────────────────────────────────────
  server.prompt(
    "cc-lens-ux-deep-dive",
    "Screen-by-screen UX walkthrough: user flows, transitions, navigation, loading states, accessibility, mobile interaction.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_LENS_UX_DEEP_DIVE,
        },
      }],
    })
  );

  // ─── 20. Content / Information Architecture Lens ─────────────────
  server.prompt(
    "cc-lens-content",
    "Content strategy and information architecture: editorial structure, quality gates, content lifecycle, enrichment pipelines.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_LENS_CONTENT,
        },
      }],
    })
  );

  // ─── 21. Growth / Distribution Lens ──────────────────────────────
  server.prompt(
    "cc-lens-growth",
    "Distribution strategy, user acquisition, viral mechanics, SEO, social sharing, and success measurement.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_LENS_GROWTH,
        },
      }],
    })
  );

  // ─── 22. Accessibility Lens ──────────────────────────────────────
  server.prompt(
    "cc-lens-accessibility",
    "Dedicated accessibility audit: WCAG compliance, keyboard navigation, screen readers, color contrast, motion sensitivity, cognitive load.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_LENS_ACCESSIBILITY,
        },
      }],
    })
  );

  // ─── 23. Operations / Observability Lens ─────────────────────────
  server.prompt(
    "cc-lens-operations",
    "Post-launch operations: analytics, error monitoring, health checks, deployment verification, incident response.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_LENS_OPERATIONS,
        },
      }],
    })
  );

  // ─── 24. Security / Privacy Lens ─────────────────────────────────
  server.prompt(
    "cc-lens-security",
    "Security and privacy audit: attack surfaces, data exposure, authentication, authorization, Firebase rules, dependency risks.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_LENS_SECURITY,
        },
      }],
    })
  );

  // ─── 28. Startup Checklist ──────────────────────────────────────
  server.prompt(
    "cc-startup-checklist",
    "Mandatory cold start sequence for Chat. Profile check, in-flight work, messages, session orientation, context loading, budget tracking, compaction recovery.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_STARTUP_CHECKLIST,
        },
      }],
    })
  );

  // ─── 29. Tutorial ──────────────────────────────────────────────
  server.prompt(
    "cc-tutorial",
    "Guided onboarding tutorial — builds a grocery list app through 9 steps, teaching ODRC, knowledge trees, lenses, jobs, and messaging.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_TUTORIAL,
        },
      }],
    })
  );

  // ─── 30. Code Startup Checklist ────────────────────────────────
  server.prompt(
    "cc-code-startup-checklist",
    "Cold start sequence for Code — messages, documents, jobs, build protocol loading.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_CODE_STARTUP_CHECKLIST,
        },
      }],
    })
  );

  // ─── 31. ACC Video Production ─────────────────────────────────
  server.prompt(
    "cc-acc-video",
    "ACC video production pipeline — HTML animations to MP4 for landing page episodes. Use for episode creation, HTML animation building, HTML-to-MP4 conversion, or ACC landing page video content.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_ACC_VIDEO,
        },
      }],
    })
  );

  // ─── 32. Skill Creation & Router Registration ────────────────────
  server.prompt(
    "cc-skill-creation",
    "How to create CC MCP skills — the 6-step flow from trigger recognition to Code deployment. Use when building new skills or updating the skill router.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_SKILL_CREATION,
        },
      }],
    })
  );

  // ─── 33. Cowork Startup Checklist ──────────────────────────────────
  server.prompt(
    "cc-cowork-startup-checklist",
    "Cold start sequence for Cowork — router load, message check, opt-in session capture, budget tracking. Load at conversation start for claude-cowork surface.",
    {},
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: SKILL_COWORK_STARTUP_CHECKLIST,
        },
      }],
    })
  );
}


// ═══════════════════════════════════════════════════════════════════════
// Skill content — embedded as string constants
// ═══════════════════════════════════════════════════════════════════════

const SKILL_ODRC_FRAMEWORK = `# ODRC Framework

ODRC is the structured thinking framework for all ideation work managed through Command Center. Every ideation session uses ODRC to organize thinking and write concepts directly to Firebase via MCP tools.

## The Four ODRC Categories

### OPENs
Questions, uncertainties, or unresolved issues that need investigation or decision. OPENs represent gaps in understanding.

- Phrased as specific, actionable questions — not vague
- Good: "How does the system handle concurrent edits from multiple users?"
- Bad: "Need to figure out the architecture"
- OPENs are the primary driver of session work — the goal is to resolve them into Decisions or surface new ones

### DECISIONs
Resolved positions on how something should work, what to build, or which direction to take. Decisions include rationale.

- Must include both WHAT was decided AND WHY
- Good: "Use WebSocket for real-time sync because polling would create unacceptable latency at scale"
- Bad: "Use WebSocket"
- Decisions are cumulative — they build on each other across sessions

### RULEs
Behavioral principles that govern how future work should be done. Rules are patterns, not one-time choices.

- Rules apply broadly and repeatedly, not to a single instance
- Good: "All API responses must include pagination metadata even if the result set is small"
- Bad: "Paginate the user list endpoint"
- Rules often emerge from Decisions that reveal a repeatable pattern

### CONSTRAINTs
Hard boundaries that cannot be changed — technology limits, policy requirements, scope boundaries, resource caps.

- Constraints are facts, not choices — they exist whether you like them or not
- Good: "Claude.ai limits custom skills to ~20 per account"
- Bad: "We should limit the number of skills" (that's a Decision)
- Constraints shape what's possible and often generate OPENs about workarounds

## State Machine

Concepts transition between types following strict rules:

\`\`\`
OPEN → DECISION, RULE, or CONSTRAINT
DECISION → RULE (hardening)
CONSTRAINT → DECISION or RULE (when external reality changes)
RULE → OPEN (destabilized, needs rethinking)
\`\`\`

When a CONSTRAINT transitions, all active DECISIONs and RULEs sharing its scope tags are flagged for review.

Use \`concept\` with action="transition" to change type, action="supersede" to replace content within the same type, action="resolve" to mark OPENs as answered.

## How ODRC Drives Sessions

Every session should actively work toward:
1. **Surfacing OPENs** — finding the questions that haven't been asked yet
2. **Resolving OPENs into Decisions** — making choices with clear rationale
3. **Recognizing Rules** — identifying patterns that should govern future work
4. **Identifying Constraints** — documenting hard boundaries early

## Immediate Firebase Writeback

In live sessions, concepts are written to Firebase **immediately** when identified — not batched at session end.

- Use \`concept\` with action="create" and the \`sessionId\` parameter to create and track in one call
- The session record in Firebase is updated automatically with every concept creation
- All data persists in real-time — no need to produce documents, manifests, or ZIP packages

### Conversational Markers

Use markdown prefixes when surfacing ODRC items in conversation to make them visible:

\`\`\`
- NEW DECISION: "what was decided AND why"
- NEW OPEN: "specific actionable question"
- NEW RULE: "behavioral principle governing future work"
- NEW CONSTRAINT: "hard boundary"
- RESOLVE OPEN: "original open text" → resolution with rationale
\`\`\`

After announcing a concept conversationally, immediately call the appropriate MCP tool to persist it.

## Tangent Handling — Idea Affinity

When a concept doesn't fit the current Idea's scope, use the idea affinity protocol:

1. Ask the user: "This seems outside the current Idea. Should I assign it to: (a) current Idea, (b) an existing Idea, or (c) create a new Idea?"
2. If (c): call \`idea\` with action="create" first, then create the concept linked to the new Idea
3. Log the tangent: call \`session\` with action="add_event", eventType "tangent_captured"

Don't suppress tangents — capture them immediately, but route them correctly.

## Phase Signals

The distribution of ODRC items signals idea maturity (advisory, not gating):

- Many OPENs, few Decisions → early exploration
- Decisions outnumber OPENs, Rules emerging → converging
- OPENs near zero, strong Rules and Constraints → spec-ready

## Guidelines

- Frame ALL exploration in ODRC terms — don't just discuss, categorize
- Challenge vague OPENs — push for specificity
- When a Decision is made, immediately check: does this create new OPENs? Does it reveal a Rule?
- Track resolved OPENs explicitly — shows progress
- Every concept must be self-contained — someone reading just that concept should understand it without needing session context
- Write concepts to Firebase as soon as they're identified — don't wait`;


const SKILL_SESSION_STRUCTURE = `# Session Structure — Live Model

This skill defines how live ideation sessions work with Command Center. Sessions are backed by Firebase in real-time — every concept, event, and status update is written immediately via MCP tools.

## Live Session Model

A session is a single conversation in Claude.ai Chat with the CC MCP server connected. The session record in Firebase serves as the live manifest — there are no separate documents, ZIP packages, or post-session uploads.

### Session Modes (4-Mode State Machine)

Every session operates in one of four modes. The mode shapes behavior, pacing, and focus:

| Mode | Purpose | Typical Focus |
|------|---------|---------------|
| **base** | General purpose, no special framing | Default for unspecified sessions |
| **ideation** | Open exploration and discovery | Surfacing OPENs, making Decisions |
| **build-review** | Post-build review and hygiene | Addressing concerns, resolving OPENs from builds |
| **debrief** | Retrospective and planning | Lessons learned, next phase direction |

**Flat transitions** — any mode can transition to any other mode mid-session:
\`\`\`
base ↔ ideation ↔ build-review ↔ debrief
\`\`\`

To change mode mid-session:
\`\`\`
Call: session
  action: "update"
  sessionId: [session ID]
  mode: "build-review"
\`\`\`

There is no mode stacking. The session is always in exactly one mode.

### Session Lifecycle

1. **Auto-Create** — The MCP server auto-creates sessions on any tool call. Chat receives \`_session\` metadata in tool responses:
   - \`autoCreated: true\` → Enrich with title/mode/goal/ideaId via \`session/update\`
   - \`mismatch: true\` → Prompt user to continue existing session or start fresh
   - \`id\` only → Use this sessionId for subsequent calls
   - \`staleClosed\` → A stale session (>24h) was auto-closed and a new one created
2. **Work** — Create concepts, transition/supersede/resolve existing ones, all with \`sessionId\` for tracking
3. **Track** — Events are logged automatically; use \`session\` with action="add_event" for notable moments
4. **Complete** — Call \`session\` with action="complete" with summary, closingSummary, nextSessionRecommendation, and conceptsResolved. Server auto-flushes pendingFlush documents.

### What Gets Tracked Automatically

When you pass \`sessionId\` to concept tools:
- \`conceptsCreated\` array — every new concept ID
- \`conceptsModified\` array — every concept transitioned, superseded, or resolved
- \`events\` array — timestamped log of what happened
- \`metadata.conceptCount\` — running tally by ODRC type (OPEN, DECISION, RULE, CONSTRAINT)
- \`metadata.toolCallCount\` — total MCP tool invocations

The session state machine also tracks:
- \`mode\` — current session mode
- \`activeIdeaId\` / \`activeAppId\` — current focus
- \`activeLens\` — active analysis lens (technical, economics, etc.) or null
- \`targetOpens\` — OPEN concept IDs being addressed this session
- \`sessionGoal\` — declared purpose/focus
- \`conceptBlockCount\` — running count of concept blocks
- \`serverSentTotal\` — auto-incremented by MCP server based on response sizes
- \`interactionTotal\` — accumulated from turnDelta reported by surfaces
- \`presentationMode\` — interactive or cli
- \`configSnapshot\` — snapshot of session config at start
- \`lastActivityAt\` — timestamp of most recent mutation

### Session Record (Firebase)

Path: \`command-center/{uid}/sessions/{sessionId}\`

The session record is the source of truth for what happened. CC's web UI reads this record to display session history and status. It also serves as the complete recovery document for compaction survival.

### pendingFlush — Document Delivery Tracking

Firebase map at \`sessions/{sessionId}/pendingFlush/{docId}: true\`

When a document is pushed with a \`sessionId\`, the server atomically writes both the document AND a pendingFlush entry on the session record. This creates an audit trail of documents created during the session.

- **Populated:** Atomically by the server when \`document(action="push")\` includes a \`sessionId\`
- **Emptied:** Automatically during \`session/complete\` — the server iterates the map and attempts \`deliver-to-github\` for each document
- **Recovery:** During compaction recovery, check pendingFlush to see if documents need attention
- **_flushResults:** The \`session/complete\` response includes delivery outcomes for each flushed document

## Presentation Modes

Presentation mode controls how Claude interacts during a session:

### Interactive Mode (default)
- Full conversational flow with explanations
- Announce each concept verbally before writing
- Provide context and rationale during discussions
- Use periodic check-ins with detailed progress summaries
- Ideal for exploration and deep-dive sessions

### CLI Mode
- Compact, tool-focused output
- Minimal narration between tool calls
- Terse status updates
- Skip verbose explanations
- Ideal for experienced users or rapid-fire sessions

Presentation mode is a **user-level preference** stored in Firebase:
\`\`\`
Call: session
  action: "preferences"
  presentationMode: "cli"  (to set)

Call: session
  action: "preferences"    (to read current)
\`\`\`

The preference persists across sessions. Override per-session by passing \`presentationMode\` to session/start.

## Session Opening

When a session begins:

1. **Check preferences** — \`session\` action="preferences" to get presentationMode
2. **Make any tool call** — The server auto-creates a session. Watch for \`_session\` in the response.
3. **Enrich if auto-created** — If \`_session.autoCreated: true\`, call \`session/update\` with title, mode, sessionGoal, activeIdeaId, activeAppId, presentationMode
4. **Handle mismatch** — If \`_session.mismatch: true\`, present the user with the existing session details and options
5. **Pull context** — Use \`get_active_concepts\` and \`idea\` with action="get_active" to understand current state
6. **Review unresolved OPENs** — These are the backlog driving the session
7. **Confirm focus with the user** — What should this session accomplish?

## Session Pacing

### Compaction Estimate as Pacing Input

Every MCP response includes \`_contextHealth.compactionEstimate\` — the server's best approximation of total context window usage. Use it as a pacing signal:

- **Green (< 60%)** — Early/mid session. Full depth exploration appropriate.
- **Yellow (60-75%)** — Mid-late session. Start summarizing, reduce tool call verbosity.
- **Red (75-90%)** — Late session. Minimize tool calls, compress outputs, prioritize remaining OPENs.
- **Imminent (> 90%)** — Write memory snapshot, prepare for compaction, close session.

### turnDelta — Per-Turn Context Tracking

Every MCP tool call includes a required \`turnDelta\` parameter — the total characters consumed since the last MCP call (assistant responses, user messages, tool results). Pass 0 if unknown.

**Per-turn habit:** Append \`*(~N chars)*\` to every response. N = rough character count of the full turn. When making an MCP call, sum annotations since the last call and pass as \`turnDelta\`.

Read it via:
\`\`\`
Call: session
  action: "get"
  sessionId: [session ID]
\`\`\`

### Concept Block Awareness

A concept block is a new concept entering the conversation — a topic shift, a new OPEN explored, a new decision domain.

**Escalating nudges based on concept accumulation:**
- **~5-6 concepts created:** Light check-in. Summarize progress.
- **~8-9 concepts:** Directive check-in. Are we covering what we intended?
- **~12+ concepts:** Consider wrapping. Context quality may be degrading.

### Check-ins

At natural transition points:
- Summarize what's been decided so far
- Count OPENs resolved vs new OPENs surfaced
- Ask if the user wants to continue, shift focus, or wrap up

### Depth Over Breadth
Push deep on each topic before moving to the next. Surface-level coverage produces vague OPENs. Deep examination produces specific Decisions, Rules, and Constraints.

### Recognizing Completion Signals
- Same questions circling without new information → topic exhausted
- User answers with high confidence → Decisions forming
- "That's a good question, I don't know" → valuable OPEN surfaced
- Energy shifts to a different topic → follow the energy

## Command Vocabulary

Users can issue these commands during a session:

| Command | Effect |
|---------|--------|
| "switch to ideation" | Update session mode to ideation |
| "switch to build-review" | Update session mode to build-review |
| "switch to debrief" | Update session mode to debrief |
| "cli mode" / "compact" | Update presentationMode to cli |
| "interactive mode" / "verbose" | Update presentationMode to interactive |
| "status" / "where are we" | Show session progress summary |
| "wrap up" / "close" | Begin session closing sequence |

## Session Closing

When the user wants to wrap up or the session has run its course:

### Question Capture
- **Formal sessions (ideation/build-review/debrief):** Topic summaries should have been captured at concept block boundaries during the session via \`session(action="add_event", eventType="note", detail="[keyword-dense topic summary]")\`. No additional capture needed.
- **Base-mode sessions:** Capture a single keyword-dense topic summary at close via add_event before calling session/complete.

### Document Flush
\`session/complete\` auto-flushes all documents in the session's \`pendingFlush\` map to GitHub. You do NOT need to manually iterate and deliver them.

Optionally review what's pending before closing:
1. Read session record to see pendingFlush map
2. Inform user: "[N] documents will be delivered to GitHub on close"

### Close
1. **Summarize** — Review what was accomplished, key decisions, new OPENs
2. **Call \`session\` with action="complete"** — Include closing data:
   - \`summary\` — Substantive summary of session outcomes
   - \`closingSummary\` — 2-3 sentence distillation for future session inheritance
   - \`nextSessionRecommendation\` — What the next session should focus on
   - \`conceptsResolved\` — Count of OPENs resolved this session
3. **Check \`_flushResults\`** — Review delivery outcomes in the response. Handle any failures (offer local download, review attention queue).
4. **No packaging needed** — Everything is already in Firebase

## Session Principles

- **Write immediately** — Concepts go to Firebase the moment they're identified
- **The user drives direction** — Skills provide structure, not control
- **ODRC framing is continuous** — Name OPENs, Decisions, Rules, and Constraints as they emerge
- **Bias toward decisions** — Push for decisions when enough information exists
- **Tangents get captured, not suppressed** — Route them via idea affinity
- **No artifacts to manage** — Firebase is the artifact
- **Respect presentation mode** — Match output style to user preference`;


const SKILL_SESSION_PROTOCOL = `# Session Protocol — Step-by-Step

This is the master protocol for running a live ideation session with Command Center. Follow these steps in order.

## Before You Begin

**For startup sequence, see cc-startup-checklist.** This skill covers the session work loop (Steps 1-6), not startup.

You need:
- The CC MCP server connected (you'll have access to tools like \`concept\`, \`session\`, \`idea\`, \`job\`, \`app\`, etc.)
- An active Idea to work on (the user or seed prompt will specify this)

**When creating any job for Code:** Read \`cc-job-creation-protocol\` first. It defines the standard format for well-formed build jobs.

**On compaction recovery:** Re-read \`cc-startup-checklist\` alongside \`cc-session-resume\`. The checklist may not survive compaction since it's loaded once at startup.

## Step 1: Session Initialization (Server-Managed)

The MCP server auto-creates sessions on any tool call. You do NOT call \`session/start\` explicitly. Instead, watch for \`_session\` metadata in every tool response:

### Handling _session Metadata

Every tool response may include a \`_session\` block. Handle these cases:

1. **\`_session.autoCreated: true\`** — The server just created a blank session. Enrich it immediately:
   \`\`\`
   Call: session
     action: "update"
     sessionId: [_session.id]
     title: [brief description of session focus]
     mode: "ideation"  (or "base", "build-review", "debrief")
     sessionGoal: [declared purpose/focus for this session]
     activeIdeaId: [the idea to work on]
     activeAppId: [the app, if idea is linked]
     presentationMode: [from user preferences, or "interactive"]
     targetOpens: [array of OPEN concept IDs to address, if known]
   \`\`\`

2. **\`_session.mismatch: true\`** — An active session exists but its context (appId/ideaId) doesn't match the current tool call. Present the user with:
   - The existing session details (\`_session.existingSession\`: id, title, appId, ideaId, startedAt)
   - Options: (a) Continue with the existing session, (b) Complete the existing session and start fresh
   - If user chooses (b): call \`session/complete\` on the existing session, then the next tool call will auto-create a new one

3. **\`_session.id\` only (no flags)** — An active session matches context. Use this sessionId for all subsequent calls.

4. **\`_session.staleClosed\`** — A stale session (>24h) was auto-closed and a new one was auto-created. Note this to the user: "Your previous session was auto-closed due to inactivity. Starting fresh."

Save the sessionId from the first tool response — you'll use it for every concept tool call.

### Session Modes

Every session operates in a **mode** that shapes its behavior:
- **base** — General purpose, no special framing. Default if unspecified.
- **ideation** — Open exploration focused on surfacing OPENs and making Decisions
- **build-review** — Reviewing build output, addressing concerns, post-build hygiene
- **debrief** — Retrospective on what was built, lessons learned, next phase planning

Set the mode when enriching the auto-created session. It can be changed mid-session via \`session\` action="update".

### Presentation Mode Awareness

Check user preferences first:
\`\`\`
Call: session
  action: "preferences"
\`\`\`

This returns the user's preferred \`presentationMode\`:
- **interactive** — Full conversational style. Announce concepts verbally, discuss in detail, use check-ins.
- **cli** — Compact output. Minimize narration, focus on tool calls and results, terse status updates.

Respect the presentation mode throughout the session. Interactive sessions explain; CLI sessions execute.

### Session Inheritance

If continuing work from a previous session:
1. Check for recently completed sessions on the same idea
2. Read the previous session's \`closingSummary\` and \`nextSessionRecommendation\`
3. Use those to inform the current session's \`sessionGoal\` and \`targetOpens\`
4. Reference the prior session in your opening summary

## Step 2: Load Context

Pull the current state from Firebase:

1. \`idea\` with action="get_active" and appId — understand the current idea's name, description, status
2. \`get_active_concepts\` with appId — see all active RULEs, CONSTRAINTs, DECISIONs, OPENs
3. Review unresolved OPENs — these are the session backlog

Share a brief summary with the user: "Here's where we are. Here are the unresolved OPENs. What should we focus on?"

## Step 3: Work — The ODRC Loop

This is the core of the session. For each topic explored:

1. **Discuss** with the user
2. **Identify** the ODRC type (is this an OPEN? A DECISION? A RULE? A CONSTRAINT?)
3. **Announce** it: "NEW DECISION: [what and why]"
4. **Write immediately**:
   \`\`\`
   Call: concept
     action: "create"
     type: DECISION
     content: "Full self-contained description with rationale"
     ideaOrigin: [current idea ID]
     scopeTags: ["relevant", "tags"]
     sessionId: [your session ID]
   \`\`\`
5. **Continue** — the session record updates automatically

### Handling Existing Concepts

- To evolve a concept's type: \`concept\` with action="transition", conceptId, newType, sessionId
- To update content: \`concept\` with action="supersede", conceptId, newContent, sessionId
- To close an OPEN: \`concept\` with action="resolve", conceptId, sessionId

## Step 4: Handle Tangents (Idea Affinity)

When you identify a concept that doesn't belong to the current Idea:

1. **Pause** — don't just create it under the current idea
2. **Ask the user**: "This OPEN/DECISION/etc. seems outside [current idea name]. Should I:
   (a) Assign it to the current idea anyway
   (b) Assign it to [existing idea name] (list relevant ones)
   (c) Create a new idea for it"
3. **Act on their choice**:
   - (a): Create concept with current ideaId
   - (b): Create concept with the chosen ideaId
   - (c): Call \`idea\` with action="create" first, then create concept with the new idea's ID
4. **Log the tangent**: \`session\` with action="add_event", sessionId, eventType="tangent_captured", detail="Routed [concept] to [idea]", refId=conceptId

## Step 5: Periodic Check-ins

Every ~5-6 concepts created, do a brief check-in:

- "We've created [N] concepts so far: [X] OPENs, [Y] DECISIONs, [Z] RULEs, [W] CONSTRAINTs"
- "Key decisions so far: [list top 2-3]"
- "Want to continue on this track, shift focus, or wrap up?"

## Step 6: Complete the Session (Closing Data Writes)

When the user wants to stop or the session's focus is exhausted:

### Step 6.1: Question Capture

Before closing, ensure topic summaries have been captured:
- **Formal sessions (ideation/build-review/debrief):** Questions and topic summaries should have been captured at concept block boundaries during the session via \`session(action="add_event", eventType="note", detail="[keyword-dense topic summary]")\`. No additional capture needed at close.
- **Base-mode sessions:** Capture a single keyword-dense topic summary at close:
  \`\`\`
  Call: session
    action: "add_event"
    sessionId: [your session ID]
    eventType: "note"
    detail: "[keyword-dense summary of what this session covered]"
  \`\`\`

### Step 6.2: Review Pending Documents (Optional)

Before closing, optionally review what documents are pending delivery:
\`\`\`
Call: session
  action: "get"
  sessionId: [your session ID]
\`\`\`

If \`pendingFlush\` is non-empty, inform the user: "This session has [N] documents pending GitHub delivery. They will be automatically delivered when the session closes."

### Step 6.3: Close the Session

\`session/complete\` automatically flushes all pendingFlush documents to GitHub. You do NOT need to manually iterate and deliver them.

1. **Summarize** what was accomplished
2. **Write closing data** to the session:
   \`\`\`
   Call: session
     action: "complete"
     sessionId: [your session ID]
     summary: "Explored [topic]. Made [N] key decisions including [highlights].
               Surfaced [N] new OPENs about [areas]. Created [N] total concepts.
               Recommended next focus: [suggestion]."
     closingSummary: "Mini-brief: [2-3 sentence distillation of session outcome]"
     nextSessionRecommendation: "Next session should focus on [specific area/OPENs]"
     conceptsResolved: [count of OPENs resolved this session]
   \`\`\`
3. **Check \`_flushResults\` in the response** — the server returns delivery outcomes for each pendingFlush document:
   - Successfully delivered docs: note in closing summary
   - Failed deliveries: offer local file download as fallback, and review attention queue entries the server created

The \`closingSummary\`, \`nextSessionRecommendation\`, and \`conceptsResolved\` fields are used by future sessions for inheritance and by CC for session history display.

**Important:** Any document pushes during closing should pass the active sessionId for atomic pendingFlush tracking.

## What NOT to Do

- **Don't produce ZIP packages or session.json files** — everything is in Firebase
- **Don't wait until session end to write concepts** — write them immediately
- **Don't create concepts without sessionId** — the session record won't track them
- **Don't call session/start explicitly** — the server auto-creates sessions. Enrich with session/update.
- **Use the consolidated tool names** — \`session\` (not start_session), \`concept\` (not create_concept), \`idea\` (not create_idea)
- **Don't assign tangent concepts to the wrong idea** — use idea affinity
- **Don't produce restart docs or link briefs** — the session record IS the manifest
- **Don't ignore presentation mode** — check preferences, respect the user's choice
- **Don't manually flush pendingFlush before session/complete** — the server handles this automatically
- **Consider cc-retro-journal** — when completing or reviewing jobs, consider whether the session surfaced a genuine discovery (delegation insight, process improvement, assumption that collapsed). If yes, create a skill-update job to append an entry.`;


const SKILL_MODE_EXPLORATION = `# Exploration Mode

Exploration mode is for open-ended discovery. The goal is to map the terrain of an idea — surface what's unknown, make early directional decisions, and identify the boundaries of the problem space.

## Posture

- **Curious, not challenging** — "what if" and "how might we", not "prove to me that"
- **Breadth first, then depth** — Map the full scope before drilling into any one area
- **Bias toward surfacing OPENs** — Finding the right questions is more valuable than finding answers
- **Make easy Decisions quickly** — Don't deliberate on obvious choices

## Session Flow

### Phase 1: Orientation (first 10-15 minutes)
- Understand the idea at a high level
- Identify the core problem being solved
- Map the major components or dimensions
- Establish what's known vs unknown

### Phase 2: Systematic Probing (bulk of session)
- Work through the lens domain systematically
- For each area: What do we know? What don't we know? What can we decide now?
- Capture OPENs as they surface — write to Firebase immediately
- Make Decisions when information is sufficient
- Note Rules and Constraints as they emerge

### Phase 3: Synthesis (last 10-15 minutes)
- Review what was covered and what wasn't
- Count OPENs vs Decisions — are we progressing or just generating questions?
- Identify clusters of related OPENs for focused sessions
- Recommend next session lens/mode

## Output Emphasis

Exploration sessions typically produce:
- **More OPENs than Decisions** — expected for early-stage ideas
- **Broad coverage** — many topics touched, not all resolved
- **Directional Decisions** — "we're going this way" without full specification
- **Early Constraints** — fundamental boundaries discovered

## Guidelines

- Don't force closure on topics needing more research — capture the OPEN and move on
- If the developer has strong convictions, capture them as Decisions with rationale
- Track which areas were covered and which were skipped
- If the idea is more mature than expected, shift toward making Decisions

## When Exploration Mode Is Wrong

If the developer already has extensive ODRC state (many Decisions, few OPENs), exploration will feel frustrating. Suggest:
- Many Decisions but untested → stress test mode
- Decisions made but not specified → spec mode
- Need to evaluate what exists → review mode`;


const SKILL_LENS_TECHNICAL = `# Technical Lens

This lens focuses the session on technical aspects of an idea. When the session brief specifies the technical lens, use this skill to guide what questions to ask and what ODRC categories to look for.

## What This Lens Examines

- **Feasibility** — Can this actually be built? What are the hard technical problems?
- **Architecture** — How should components be structured? What patterns apply?
- **Dependencies** — What does this rely on? External services, APIs, libraries, platforms?
- **Implementation risk** — What could go wrong during build? What's uncertain?
- **Technical debt** — What shortcuts would we take and what's the cost?
- **Integration** — How does this connect to existing systems?
- **Performance** — Will it work at the required scale and speed?
- **Security** — What are the attack surfaces and data risks?

## Probing Framework

### Start Broad, Then Dig
Begin with the high-level technical approach, then drill into specific components.

### Question Patterns

**Feasibility probes:**
- "What's the hardest technical problem in this idea?"
- "Is there anything here that you're not sure can be done?"
- "What would you prototype first to reduce risk?"

**Architecture probes:**
- "Walk me through how data flows from input to output"
- "What are the major components and how do they communicate?"
- "Where does state live? Who owns it?"

**Dependency probes:**
- "What external services does this require?"
- "What happens if [dependency] goes down or changes its API?"
- "Are there licensing or cost implications?"

**Implementation risk probes:**
- "What part of this would you estimate poorly?"
- "Where are the unknowns that could blow up the timeline?"
- "Have you built something like [component] before?"

**Integration probes:**
- "How does this interact with existing systems?"
- "What data needs to be shared between this and other components?"
- "Are there version compatibility concerns?"

## ODRC Tendencies

Technical lens sessions tend to produce:
- **Constraints** frequently — platform limits, API rate limits, browser capabilities
- **Rules** about architecture patterns, coding conventions, integration approaches
- **OPENs** about feasibility and implementation approaches
- **Decisions** about technology choices, architecture patterns, build-vs-buy

## Depth Signals

You're going deep enough when:
- The developer says "I don't know" or "I'd need to research that" → OPEN captured
- Specific technology names, version numbers, and API endpoints are discussed
- Trade-offs between approaches are weighed with concrete criteria
- Edge cases and failure modes are identified

You're too shallow when:
- Conversation stays at "we'd use a database" without specifying which and why
- No Constraints identified (every technical idea has technical constraints)
- Implementation risks haven't been discussed`;


const SKILL_BUILD_PROTOCOL = `# Build Protocol — Step-by-Step

This is the master protocol for executing a build with Command Center tracking. Follow these steps in order.

## Before You Begin

**CRITICAL SAFETY RULE:** Never create background scripts, shell loops, or persistent processes to poll for messages or check job status. All MCP tool calls must happen inline within the conversation. Background processes outlive your session and cause runaway Firebase costs ($17+/day incident in Feb 2026).

You need:
- The CC MCP server connected (you'll have access to tools like \`document\`, \`job\`, \`concept\`, \`app\`, \`generate_claude_md\`, etc.)
- An app to build for (the user or CLAUDE.md will specify this)

**On startup:** Read \`cc-skill-router\` to load the command routing table. This tells you which skills are available and when to load them. The router includes an embedded Quick Reference with safety rules, auth model, and available tools.

**For infrastructure/maintenance work** (not standard builds): Call \`repo_file\` with repo="stewartdavidp-ship-it/command-center", path="ARCHITECTURE.md", and section="## Index" to see available sections. Then load specific sections as needed. Standard builds get this context from CLAUDE.md instead.

**On compaction recovery:** Re-read \`cc-skill-router\` alongside \`cc-build-resume\`. The router may not survive compaction since it's loaded once at startup.

## Step 1: Check for Pending Documents

\`\`\`
Call: document
  action: "list"
  appId: [the app ID]
  status: "pending"
\`\`\`

If there are pending documents (especially type "claude-md"), proceed to Step 2.
If no pending documents, check if CLAUDE.md already exists in the repo and proceed to Step 3.

## Step 2: Deliver Documents Locally

For each pending document:

1. Read its content and routing info
2. Write it to the local filesystem at the \`routing.targetPath\` (e.g., "CLAUDE.md" goes to project root, "specs/feature-x.md" goes to specs folder)
3. Mark it delivered:

\`\`\`
Call: document
  action: "deliver"
  docId: [the document ID]
  deliveredBy: "claude-code"
\`\`\`

## Step 3: Start a Build Job

\`\`\`
Call: job
  action: "start"
  appId: [the app ID]
  title: "Build: [brief description of what you're building]"
  claudeMdSnapshot: [the CLAUDE.md content]
\`\`\`

Save the returned jobId — you'll use it throughout the build.

## Step 4: Review the Spec (CODEBASE-FIRST)

**CRITICAL: Before evaluating the CLAUDE.md, you MUST examine the target app's existing codebase.** Read index.html, CONTEXT.md, package.json, and any other key files to understand what already exists. A spec that assumes a greenfield build when there's an existing v1.0.0 app will produce wrong results.

### Codebase examination checklist:
- What files already exist in the repo?
- What frameworks/libraries are in use?
- What data sources does the app currently use (Firebase, APIs, static files)?
- What is the current version and feature set?
- Does a CONTEXT.md or README describe the existing architecture?

### Then review CLAUDE.md against what you found:
- **Spec-codebase conflicts**: Does the spec assume greenfield when there's existing code? Does it propose technologies that contradict what's already in use?
- **OPENs that block**: Are there unresolved questions that prevent you from building?
- **Stale CONSTRAINTs**: Do any constraints reference technologies, APIs, or limitations that no longer apply?
- **Conflicting DECISIONs**: Do any decisions contradict the current code or each other?
- **Missing information**: Is there enough detail to build? Are there implicit assumptions that should be explicit?
- **Scope clarity**: Is it clear what "done" looks like?

### If you find concerns:

\`\`\`
Call: job
  action: "review"
  jobId: [your job ID]
  concerns: ["Concern 1: description", "Concern 2: description", ...]
\`\`\`

Then STOP and tell the user what you found. Present each concern clearly and ask how to proceed. Wait for the user to either:
- Resolve the concerns (you may need to update concepts via \`concept\` tool)
- Approve proceeding despite concerns

When approved:
\`\`\`
Call: job
  action: "approve"
  jobId: [your job ID]
  resolutions: "Brief description of how concerns were resolved"
\`\`\`

### If no concerns:
Proceed directly to Step 5.

## Step 5: Build

Execute the spec. During the build, track your work:

### Log file changes:
\`\`\`
Call: job
  action: "add_event"
  jobId: [your job ID]
  eventType: "file_changed"
  detail: "Modified [file] — [what changed]"
  refId: "[filepath]"
\`\`\`

### Log concepts addressed:
When you implement something that addresses a specific ODRC concept:
\`\`\`
Call: job
  action: "add_event"
  jobId: [your job ID]
  eventType: "concept_addressed"
  detail: "Implemented [concept description]"
  refId: "[conceptId]"
\`\`\`

### Log blockers:
If you hit a blocker during build:
\`\`\`
Call: job
  action: "add_event"
  jobId: [your job ID]
  eventType: "blocker"
  detail: "Blocked on [description]. Need [what's needed]."
\`\`\`

### Create new concepts:
If you discover new OPENs, make DECISIONs, or identify RULEs during the build:
\`\`\`
Call: concept
  action: "create"
  type: [OPEN/DECISION/RULE/CONSTRAINT]
  content: "Description with rationale"
  ideaOrigin: [the idea ID from the spec]
  jobId: [your job ID]
\`\`\`

## Step 6: Close Out the Build

### Step 6a: Mark Concepts Built

Before completing the job, review ALL active concepts for the idea — not just the ones listed in "Concepts Addressed."

1. **Fetch active concepts for the idea:**
\`\`\`
Call: list_concepts
  ideaId: [the idea ID]
  grouped: true
\`\`\`

2. **For each active DECISION:** Was it implemented in this build? If yes, mark it built:
\`\`\`
Call: concept
  action: "mark_built"
  conceptId: [concept ID]
\`\`\`

3. **For each active OPEN:** Was it encountered or answered? If yes, resolve it:
\`\`\`
Call: concept
  action: "resolve"
  conceptId: [concept ID]
\`\`\`

4. **For RULEs and CONSTRAINTs:** These stay active (they're ongoing). Only transition them if the build revealed they're wrong.

Work through every concept. This is how CC tracks which decisions were actually implemented — skipping this creates orphaned "active" decisions that are already built, making idea lifecycle tracking inaccurate. Jobs that complete with an empty \`conceptsAddressed\` array are a red flag.

### Step 6b: Complete the Job

When the build is done (or if it fails), include the conceptsAddressed array:

\`\`\`
Call: job
  action: "complete"
  jobId: [your job ID]
  status: "completed"  // or "failed"
  summary: "Built [what]. Key decisions: [list]. New OPENs: [list]. Files changed: [count]."
  filesChanged: ["file1.ts", "file2.ts", ...]
  testsRun: [number]
  testsPassed: [number]
  testsFailed: [number]
  buildSuccess: true/false
  linesAdded: [number]
  linesRemoved: [number]
  conceptsAddressed: ["conceptId1", "conceptId2", ...]
\`\`\`

### Step 6c: Notify Chat

After completing the job, send a message to Chat so it knows the build is finished:

\`\`\`
Call: document
  action: "send"
  to: "claude-chat"
  createdBy: "claude-code"
  content: "Job completed: [job title]. Status: [completed/failed]. Summary: [brief summary of what was built and any issues]."
  metadata: {"jobId": "[jobId]", "appId": "[appId]", "ideaId": "[ideaId]", "status": "[completed/failed]"}
\`\`\`

This enables the bidirectional handoff — Chat will see the message via piggyback notifications on its next tool call, or on its next startup.

## Step 7: Retrospective Check

After completing the job, review whether this build produced a genuine discovery worth capturing in \`cc-retro-journal\`. The bar is high — only write if a future Chat or Code instance would make a worse decision without this knowledge.

Good journal entries from builds:
- **Codebase gotchas** — data model assumptions that caused runtime errors (e.g. expected array, got object)
- **Deploy pitfalls** — tooling behavior that silently corrupts output
- **Pattern discoveries** — undocumented conventions in the codebase that new code must follow
- **Delegation insights** — tasks that should have been handled by the other agent

If you have a genuine entry, create a skill-update job to append it to cc-retro-journal. If nothing surprising happened, skip — the journal is not a log.

## What NOT to Do

- **Don't skip the document check** — always check for pending documents first
- **Don't build without a job** — the job record is how CC tracks what happened
- **Don't ignore concerns** — if the spec has issues, flag them before building
- **Don't forget to complete the job** — even failed builds need a completion record
- **Don't skip mark_built** — every concept in "Concepts Addressed" must be marked. This is a RULE, not a suggestion. Orphaned active concepts poison idea lifecycle tracking.
- **Use the consolidated tool names** — \`job\` (not start_job), \`concept\` (not create_concept), \`document\` (not push_document)
- **Don't forget architecture docs** — Review what changed and update the relevant docs:
  - **Added/removed skills?** Update skill count in: skills.ts header comment, ARCHITECTURE.md (ecosystem map + data flow), SYSTEM-CONTEXT.md (key numbers)
  - **Added/removed MCP tools?** Update tool count in the same three places
  - **Changed Firebase listeners, query patterns, indexes, or background processes?** Update SYSTEM-CONTEXT.md Section 17 (Operational Safeguards) and ARCHITECTURE.md's listener tables
  - **Changed deploy workflows, auth model, or data paths?** Update ARCHITECTURE.md's relevant section
  - **Changed e2e test count?** Update SYSTEM-CONTEXT.md key numbers
  - Rule of thumb: if the build changed something described in ARCHITECTURE.md or SYSTEM-CONTEXT.md, update it before completing the job`;


// ═══════════════════════════════════════════════════════════════════════
// Skills 7–12: Compaction Recovery, Continuity, and Lifecycle
// ═══════════════════════════════════════════════════════════════════════

const SKILL_BUILD_RESUME = `# Build Resume — Compaction Recovery (Claude Code)

This skill tells you how to recover when your context is reset mid-build. If you are Claude Code and you have lost track of an active build job, follow this protocol.

## When to Use This Skill

You should suspect a compaction occurred if:
- You have no jobId in your context but the user says a build was in progress
- You see a CLAUDE.md in the project root but don't remember delivering it
- The user says "continue the build" or "pick up where you left off"

## Recovery Sequence

### Step 1: Find the Orphaned Job

\`\`\`
Call: job
  action: "list"
  appId: [the app ID — check CLAUDE.md header or ask the user]
  status: "active"
\`\`\`

If no active jobs, also check:
\`\`\`
Call: job
  action: "list"
  appId: [the app ID]
  status: "review"
\`\`\`

And:
\`\`\`
Call: job
  action: "list"
  appId: [the app ID]
  status: "approved"
\`\`\`

Take the most recent job (highest startedAt timestamp).

### Step 2: Read the Job State

\`\`\`
Call: job
  action: "get"
  jobId: [the found job ID]
\`\`\`

The job record contains everything you need to reconstruct your position:

- **status** — Where you are in the build lifecycle:
  - \`active\` — Build was in progress, no concerns raised
  - \`review\` — You flagged concerns and were waiting for user response
  - \`approved\` — User approved the concerns, build should proceed
- **claudeMdSnapshot** — The spec you were building against (DO NOT re-read from document queue)
- **events[]** — Chronological log of everything that happened. Scan this to find:
  - Last \`file_changed\` event → the last file you were working on
  - \`concept_addressed\` events → concepts already implemented
  - \`blocker\` events → blockers that may still be unresolved
  - \`concept_created\` events → OPENs/DECISIONs you discovered during build
- **filesChanged[]** — Deduplicated list of files already modified
- **conceptsAddressed[]** — Concepts already marked as addressed
- **conceptsCreated[]** — Concepts you created during the build
- **concerns[]** — If status is "review", these are the unresolved concerns

### Step 3: Handle Based on Status

**If status is "review":**
- Present the concerns to the user again: "I was previously in review with these concerns: [list]. How should we proceed?"
- Wait for user response
- If they approve: call \`job\` with action="approve" and proceed to build
- If they want changes: handle as directed

**If status is "approved" or "active":**
- You can resume building immediately
- Start from where you left off based on the events log

### Step 4: Announce Recovery

Tell the user what you found:

"My context was reset. I've recovered from the CC build job:
- **Job:** [title] (started [time])
- **Status:** [status]
- **Files changed so far:** [list from filesChanged]
- **Concepts addressed:** [count]
- **Last action:** [last event detail]
- **Resuming from:** [next item to work on]"

### Step 5: Resume Building

Continue the build using the SAME jobId. All subsequent \`job\` calls (add_event, complete) must use this recovered jobId.

## Critical Rules

- **NEVER start a new job** — the existing job must be continued. Starting a new job loses the audit trail.
- **The claudeMdSnapshot on the job IS the spec** — do not re-read from the document queue or re-deliver documents.
- **Events are append-only** — do not re-log events that already exist in the job record.
- **filesChanged is the truth** — check it before re-editing files to avoid duplicate work.
- **One job at a time** — if you find multiple active jobs, take the most recent one and flag the anomaly to the user.

## What if No Job Is Found?

If no active/review/approved job exists for the app:
1. Check completed jobs — maybe the build finished before compaction
2. Check the document queue — maybe documents haven't been delivered yet
3. If nothing found, tell the user: "I couldn't find an active build job. Should I start fresh?"`;


const SKILL_SESSION_RESUME = `# Session Resume — Compaction Recovery (Claude Chat)

This skill tells you how to recover when your context is reset mid-ideation session. If you are Claude Chat and you have lost track of an active session, follow this protocol.

## When to Use This Skill

You should suspect a compaction occurred if:
- The user says "continue our session" or "where were we?"
- You have no sessionId in your context but the conversation suggests a session was active
- The CC MCP tools are available but you don't remember starting a session

Context-triggered recovery: if the \`serverSentTotal + interactionTotal\` on a session is high (>100K chars), compaction is likely. The session record tells you how much work was done.

## Recovery Sequence

### Step 1: Find the Orphaned Session

\`\`\`
Call: session
  action: "list"
  status: "active"
\`\`\`

If multiple active sessions, pick the one with the most recent \`lastActivityAt\`. If there's only one, that's yours.

### Step 2: Read the Session State

\`\`\`
Call: session
  action: "get"
  sessionId: [the found session ID]
\`\`\`

The session record contains everything needed for recovery:
- **title** — What the session was focused on
- **ideaId** / **appId** — The idea and app context
- **mode** — What mode the session was in (ideation, build-review, etc.)
- **sessionGoal** — The declared focus for this session
- **presentationMode** — How to present output (interactive or cli)
- **activeLens** — Any active analysis lens
- **targetOpens** — OPEN concept IDs being addressed
- **conceptsCreated[]** — IDs of every concept created in this session
- **conceptsModified[]** — IDs of every concept transitioned/superseded/resolved
- **events[]** — Chronological log of session activity
- **metadata.conceptCount** — Running tally by ODRC type
- **serverSentTotal** — Server-sent content chars before compaction
- **interactionTotal** — Surface-reported interaction chars before compaction
- **configSnapshot** — Original session configuration
- **lastActivityAt** — When the session was last active

### Step 2.5: Check pendingFlush State

Check if the session has documents pending GitHub delivery:

If \`session.pendingFlush\` is a non-empty map:
- Note the count and document IDs
- Add to the recovery summary: "⚠️ This session has N documents pending GitHub delivery"
- List the pending document IDs for user visibility

These documents were created during the session but haven't been flushed to GitHub yet. They need to be handled during recovery.

### Step 3: Recover Concept Content

The session record has concept IDs but not full content. Pull the concepts:

\`\`\`
Call: list_concepts
  ideaId: [the idea ID from the session]
  status: "active"
\`\`\`

This gives you all active concepts for the idea. Cross-reference with the session's conceptsCreated[] to know which ones were created THIS session.

### Step 4: Load Current ODRC State

\`\`\`
Call: get_active_concepts
  appId: [the app ID]
\`\`\`

This gives you the full active concept landscape — rules, decisions, constraints, opens.

### Step 5: Always Show Summary

**Always present a recovery summary, regardless of presentation mode.** This is the one place where even CLI mode gets a full summary.

**Interactive recovery:**

"I've recovered our session:
- **Session:** [title] (started [time])
- **Mode:** [mode] | **Goal:** [sessionGoal]
- **Idea:** [idea name from idea record]
- **Concepts created this session:** [count] — [breakdown by type]
- **Context consumed:** ~[serverSentTotal + interactionTotal] chars
- **Pending documents:** [N] documents awaiting GitHub delivery (if any)
- **Key items created:**
  [list 3-5 most important concepts with content]
- **Current OPENs remaining:** [list unresolved OPENs]

Would you like to:
1. **Resume** — Continue where we left off (pending documents will flush on session close)
2. **Flush Now** — Deliver pending documents to GitHub immediately, then resume
3. **Abandon** — Mark this session as abandoned, start fresh
4. **Start Fresh** — Complete this session with current state, begin a new one"

**CLI recovery:**

\`\`\`
RECOVERED: [title] | mode=[mode] | concepts=[count] | ctx=[serverSentTotal+interactionTotal]
⚠️ PENDING FLUSH: [N] documents awaiting delivery
Goal: [sessionGoal]
Created: [N] OPENs, [N] DECISIONs, [N] RULEs, [N] CONSTRAINTs
Remaining OPENs: [count]

[R]esume / [F]lush Now / [A]bandon / [S]tart Fresh?
\`\`\`

### Step 6: Handle User Choice

**Resume:** Continue the session using the SAME sessionId. All subsequent calls use the recovered sessionId. Pending documents will auto-flush when the session completes.

**Flush Now:** Immediately attempt \`document(action="deliver-to-github")\` for each document in pendingFlush:
\`\`\`
For each docId in session.pendingFlush:
  Call: document
    action: "deliver-to-github"
    docId: [docId]
\`\`\`
Report results (success/failure for each). Then continue the session using the recovered sessionId.

**Abandon:** If pendingFlush is non-empty, present sub-options before abandoning:
- "Flush documents to GitHub first, then abandon" — deliver all, then abandon
- "Download documents locally, then abandon" — use \`document(action="get")\` to retrieve content for each, present for local save
- "Discard documents and abandon" — requires explicit user confirmation: "Are you sure? [N] documents will be lost."

Then mark the session as abandoned:
\`\`\`
Call: session
  action: "complete"
  sessionId: [session ID]
  summary: "Session abandoned after compaction recovery"
  closingSummary: "Abandoned at user request. [N] concepts were created before compaction."
\`\`\`
The next tool call will auto-create a new session on the same idea.

**Start Fresh:** Complete the current session gracefully (session/complete auto-flushes pendingFlush):
\`\`\`
Call: session
  action: "complete"
  sessionId: [session ID]
  summary: "[N] concepts created. Session completed during recovery."
  closingSummary: "[summary of what was accomplished]"
  nextSessionRecommendation: "[what to focus on next based on remaining OPENs]"
  conceptsResolved: [count]
\`\`\`
Check \`_flushResults\` for delivery outcomes. Then the next tool call will auto-create a new session with inheritance from the completed one.

## Critical Rules

- **NEVER call session/start** — the server auto-creates sessions. On recovery, always present options first.
- **Always show the recovery summary** — even in CLI mode, the user needs to see what was recovered
- **Reuse the recovered sessionId** if resuming — don't create duplicates
- **Don't re-announce concepts that are already in the session record** — check conceptsCreated before creating duplicates
- **The session events[] are your conversation history** — use them to understand the flow of the discussion
- **Respect the session's presentationMode** after recovery — match the mode it was in
- **Never silently drop pending documents** — always present pendingFlush status during recovery and give the user options

## What if No Active Session Is Found?

If no active session exists:
1. Check recently completed sessions — maybe the session was completed before compaction
2. If the most recent session is completed:
   - Read its \`closingSummary\` and \`nextSessionRecommendation\`
   - Start a new session on the same idea with inheritance
   - Tell the user: "Our previous session was completed. Starting a new session continuing from where we left off."
3. If no sessions exist at all, start fresh — this is a new conversation`;


const SKILL_SESSION_CONTINUITY = `# Session Continuity — Resuming Work on an Existing Idea

This skill guides how to start a new ideation session when the idea already has prior sessions. Unlike session-resume (which recovers from compaction mid-session), this is for intentionally starting a new conversation that continues prior work.

## When to Use This Skill

- A new Claude.ai Chat conversation is opened for an idea that already has session history
- The user says "let's continue working on [idea]" or "next session for [app]"
- The start-ideation-session prompt fires and you can see ideaHistory with completed sessions

## Step 1: Check for Orphaned Active Sessions

Before starting anything new:

\`\`\`
Call: session
  action: "list"
  status: "active"
\`\`\`

If an active session exists for this idea, DO NOT start a new one. Instead, follow the cc-session-resume protocol to recover it. Tell the user: "There's an active session from a previous conversation. Let me recover it."

## Step 2: Load Session History

\`\`\`
Call: session
  action: "list"
  ideaId: [the idea ID]
\`\`\`

Read the completed sessions. For each, note:
- **title** — What was explored
- **summary** — What was accomplished and recommended next
- **metadata.conceptCount** — How many concepts by type
- **completedAt** — When it happened

## Step 3: Load Current ODRC State

\`\`\`
Call: get_active_concepts
  appId: [the app ID]
\`\`\`

Count: rules, decisions, constraints, opens.

## Step 4: Determine Arc Position

Based on session history and ODRC state, identify where the idea is in its lifecycle:

| Signal | Arc Position | Recommended Posture |
|--------|-------------|-------------------|
| 1-2 sessions, many OPENs, few Decisions | Early exploration | Use cc-mode-exploration |
| Multiple sessions, Decisions outnumber OPENs, Rules forming | Converging | Focus on closing remaining OPENs, hardening Decisions |
| OPENs near zero, strong Rules and Constraints | Spec-ready | Use cc-spec-generation to assess readiness |
| CLAUDE.md has been generated and pushed | Build phase | Check job status, don't ideate — monitor or review |
| Job completed successfully | Post-build | Use cc-build-hygiene for cleanup, consider next idea |

## Step 5: Brief the User

Present a concise status update:

"Here's where we are on **[idea name]**:
- **Sessions completed:** [N] — Last session: [title] ([date])
- **Active concepts:** [N rules], [N decisions], [N constraints], [N opens]
- **Last session recommended:** [recommendation from last session summary]
- **Arc position:** [early/converging/spec-ready/post-build]

I recommend we focus on: [specific recommendation based on arc position]

What would you like to do?"

## Step 6: Start the New Session

Once the user confirms direction:

\`\`\`
Call: session
  action: "start"
  ideaId: [the idea ID]
  appId: [the app ID]
  title: [focus-specific title, e.g., "Converging on data model decisions"]
\`\`\`

Then proceed with the standard cc-session-protocol.

## Guidelines

- **Don't repeat ground already covered** — read prior session summaries carefully
- **Reference prior Decisions explicitly** — "In session 2, we decided [X]. Does that still hold?"
- **Close stale OPENs** — if an OPEN from session 1 is no longer relevant, resolve it early
- **Escalate convergence pressure** — each successive session should produce more Decisions relative to OPENs
- **Watch for idea readiness** — if OPENs are near zero, suggest generating CLAUDE.md rather than another exploration session`;


const SKILL_SPEC_GENERATION = `# Spec Generation — When and How to Generate CLAUDE.md

This skill guides the decision of when to generate a CLAUDE.md spec and how to review it before pushing to the document queue for Claude Code delivery.

## When to Generate

### Readiness Signals (Check These First)

Call \`get_active_concepts\` with the appId and evaluate:

1. **OPENs near zero** — Zero is ideal. 1-2 non-blocking OPENs are acceptable if they're noted in the spec's OPENs section. Blocking OPENs (questions that prevent implementation) MUST be resolved first.

2. **Sufficient DECISIONs** — Every major feature area should have at least one DECISION specifying direction. If there are feature areas with no Decisions, the spec will have gaps.

3. **RULEs established** — Core patterns and invariants should be captured as RULEs. These become the "do not violate" section of the spec.

4. **CONSTRAINTs documented** — Technology limits, platform boundaries, and external realities should be identified. These shape what's possible.

### Readiness Blockers (Do NOT Generate If)

- Critical OPENs remain that block implementation (e.g., "What database should we use?")
- No RULEs exist — the spec has no behavioral constraints, which means the build will be unprincipled
- The Idea description is vague or missing — this becomes the "What This App Is" section
- Key feature areas have no DECISIONs — the builder will have to make unguided choices

### When in Doubt

Ask the user: "The concept state has [N OPENs, N DECISIONs, N RULEs, N CONSTRAINTs]. I think we're [ready/not ready] because [reasoning]. Should we generate the spec or continue refining?"

## Generate vs Push

Two actions exist:
- **action="generate"** — Assembles the CLAUDE.md and stores it in Firebase. Use this to PREVIEW the spec without queuing it for delivery.
- **action="push"** — Generates AND creates a document queue entry for Claude Code. Use this when you're confident the spec is ready.

**Recommended flow:** Generate first, review with the user, then push.

## Pre-Push Review

After generating, review the output with the user:

1. **"What This App Is"** — Does the app description capture the intent? (Comes from the App record's description field — update via \`app\` action="update" if wrong)

2. **"Current Build Objective"** — Does the active Idea's name and description clearly state what this phase builds? (Update via \`idea\` action="update" if needed)

3. **RULEs section** — Are these enforceable by a builder without asking questions? Are any too vague?

4. **CONSTRAINTs section** — Are these real external realities, not preferences disguised as constraints?

5. **DECISIONs section** — Does each Decision include the "why"? Can a builder act on these without needing more context?

6. **OPENs section** — Are remaining OPENs truly non-blocking? Will the builder know to flag these but continue working?

## Push and Handoff

When the spec is approved:

\`\`\`
Call: generate_claude_md
  action: "push"
  appId: [the app ID]
  appName: [human-readable name]
\`\`\`

This:
1. Generates the CLAUDE.md content from active concepts
2. Stores it in Firebase (claudeMd/{appId})
3. Creates a document queue entry (type: "claude-md", targetPath: "CLAUDE.md", status: "pending")

Tell the user: "The spec has been generated and queued. When Claude Code next checks for pending documents, it will deliver the CLAUDE.md to the project root and begin the build protocol."

If a session is active, the server handles pendingFlush tracking atomically — Chat does NOT need to manually manage pendingFlush for generate_claude_md pushes.

## Document Tracking

All documents created during a session should pass the active sessionId to \`document(action="push", sessionId=...)\` for automatic pendingFlush tracking. This is the key behavioral change: Chat doesn't manage pendingFlush directly. It passes sessionId on every document push; the server handles atomic tracking.

Example:
\`\`\`
Call: document
  action: "push"
  type: "spec"
  appId: "my-app"
  content: "[spec content]"
  targetPath: "specs/feature.md"
  sessionId: "[active session ID]"
\`\`\`

The server atomically writes both the document AND a pendingFlush entry on the session record, creating an audit trail.

## After Push

- The pushed document is now tracked in the session's pendingFlush. It will be delivered to GitHub when the session closes (\`session/complete\` auto-flushes), or can be delivered immediately via \`document(action="deliver-to-github", docId=...)\`.
- The session should be completed with a summary noting "Spec generated and pushed for build"
- Monitor the document queue status if desired: \`document\` action="list" with status="pending"
- The job state machine takes over from here — Claude Code will start a job, review the spec, and build`;


const SKILL_BUILD_HYGIENE = `# Build Hygiene — Post-Build Cleanup

This skill guides the cleanup work after a build job completes. Concepts that were implemented should be evolved, the idea lifecycle should advance, and the app record should be updated.

## When to Use This Skill

After calling \`job\` with action="complete" and status="completed" (or "failed"), run through this checklist.

## Step 1: Review Addressed Concepts

The completed job record contains:
- **conceptsAddressed[]** — Concepts that were implemented
- **conceptsCreated[]** — New concepts discovered during the build

For each addressed concept:

### OPENs that were answered during build:
\`\`\`
Call: concept
  action: "resolve"
  conceptId: [the OPEN's ID]
\`\`\`
Include a note about how it was resolved. The builder should know — they logged it as concept_addressed.

### DECISIONs that became hardened patterns:
If a DECISION was implemented and it represents a repeatable pattern (not a one-time choice), harden it to a RULE:
\`\`\`
Call: concept
  action: "transition"
  conceptId: [the DECISION's ID]
  newType: "RULE"
\`\`\`

### CONSTRAINTs that were validated:
If a CONSTRAINT was confirmed during build (e.g., "Firebase RTDB has a 32MB limit" was tested), keep it active. If a CONSTRAINT turned out to be wrong, transition it:
\`\`\`
Call: concept
  action: "transition"
  conceptId: [the CONSTRAINT's ID]
  newType: "DECISION"
\`\`\`

## Step 2: Handle Unaddressed Concepts

Check what was NOT addressed. Compare the spec's DECISIONs and OPENs against conceptsAddressed[]:

- **DECISIONs not implemented** — Were they deferred intentionally? If so, they remain active for the next build phase.
- **OPENs not encountered** — The spec said "flag if you encounter these." If they weren't encountered, they may still be valid OPENs for future work.
- **If the build failed** — Unaddressed concepts stay as-is. Create new OPENs for whatever caused the failure.

## Step 3: Review New Concepts from the Build

Concepts in conceptsCreated[] were discovered during implementation. Review them:
- Are they properly categorized (OPEN/DECISION/RULE/CONSTRAINT)?
- Do they have clear content and rationale?
- Should any DECISIONs from the build be immediately hardened to RULEs?

## Step 4: Update the Idea

If the build was successful and the spec was fully implemented:

\`\`\`
Call: idea
  action: "update"
  ideaId: [the idea ID]
  status: "graduated"
\`\`\`

This marks the idea as complete. Its concepts remain active — they don't disappear. The idea becomes part of the app's decision archaeology.

If the build was partial or failed, leave the idea as "active" for the next iteration.

## Step 5: Update the App Record

After a successful build:
\`\`\`
Call: app
  action: "update"
  appId: [the app ID]
  description: [updated description reflecting what was built]
  lifecycleFields: "{\\"currentMaturity\\":\\"[updated maturity]\\"}"
\`\`\`

## Step 6: Prepare for Next Phase

If the idea graduated:
- The app is ready for its next addon idea
- Start a new ideation session when the user wants to define the next phase
- The graduated idea's RULEs and CONSTRAINTs carry forward — they're part of the app's active concept set

If the idea did NOT graduate:
- OPENs from the build should be fed into the next ideation session
- The same idea continues to accumulate concepts until the build succeeds

## Who Does This?

Build hygiene can be done by either Claude Code (as part of job completion) or Claude Chat (in a post-build review session). The tool calls are the same either way.

**Recommended:** Claude Code handles Steps 1-2 (resolving addressed concepts) as part of the build protocol. Claude Chat handles Steps 3-6 in a post-build review session with the user.`;


const SKILL_MCP_WORKFLOW = `# MCP Workflow — End-to-End Lifecycle

This skill describes how the full lifecycle works across Claude Chat, Claude Code, and the CC MCP server. Use this to understand the big picture of how ideation becomes working code.

## The Players

- **Claude Chat** — Runs ideation sessions. Creates ideas, concepts, sessions. Generates and pushes CLAUDE.md specs. Monitors job status. Enriches server-created sessions with context.
- **Claude Code** — Executes builds. Checks document queue, delivers files locally, claims jobs, reviews specs, builds code, completes jobs.
- **CC MCP Server** — The shared backend. Both Chat and Code connect to the same server. Firebase is the persistence layer. Auto-creates and manages session lifecycle (creation, stale detection, context matching). Tracks pendingFlush documents per session. Manages user profile and attention queue.
- **CC Web UI** — The user's dashboard. Shows apps, ideas, concepts, sessions, jobs. Read-only for now.

## The Lifecycle

\`\`\`
IDEATE ──→ SPECIFY ──→ DELIVER ──→ BUILD ──→ COMPLETE ──→ NEXT PHASE
 Chat       Chat       Queue       Code       Code         Chat
\`\`\`

### Phase 1: IDEATE (Claude Chat)

**Tools used:** session, concept, idea, get_active_concepts, list_concepts
**Skills:** cc-session-protocol, cc-odrc-framework, cc-mode-exploration, cc-lens-technical, cc-session-resume

1. User opens Claude.ai Chat with CC MCP connected
2. **Check preferences**: \`session\` action="preferences" — get presentationMode
3. **React to server-created session**: Check \`_session\` metadata in first tool response. If \`autoCreated: true\`, enrich with \`session/update\` (title, mode, sessionGoal, activeIdeaId, activeAppId, presentationMode). If \`mismatch: true\`, present user with existing session details and options.
4. ODRC loop: discuss, identify concepts, write to Firebase immediately
5. **Monitor context**: check \`_contextHealth.compactionEstimate\` in every tool response — use zone (green/yellow/red/imminent) for pacing decisions. Pass \`turnDelta\` on every tool call.
6. **Mode transitions**: switch between ideation/build-review/debrief as needed
7. **Document pushes**: when pushing documents, pass sessionId for atomic pendingFlush tracking
8. Session completes with closing data: closingSummary, nextSessionRecommendation, conceptsResolved. Server auto-flushes pendingFlush. Check \`_flushResults\` for delivery outcomes.
9. Repeat for multiple sessions until the idea converges

### Phase 2: SPECIFY (Claude Chat)

**Tools used:** generate_claude_md, get_active_concepts, app, idea
**Skills:** cc-spec-generation

1. Readiness check: mostly DECISIONs, few OPENs, RULEs established
2. Generate preview: generate_claude_md action="generate"
3. Review with user: is the spec complete? App description correct? Idea description clear?
4. Push to queue: generate_claude_md action="push"
5. Document appears in Firebase: command-center/{uid}/documents/{docId} with status "pending"

### Phase 3: DELIVER (Claude Code — Automatic)

**Tools used:** document
**Skills:** cc-build-protocol (Steps 1-2)

1. Claude Code checks: document action="list" status="pending"
2. For each pending document: read content, write to local filesystem at routing.targetPath
3. Mark delivered: document action="deliver" docId=[id]
4. CLAUDE.md is now in the project root

### Phase 4: BUILD (Claude Code)

**Tools used:** job, concept, document
**Skills:** cc-build-protocol (Steps 3-6), cc-build-resume

1. Start job: job action="start" with claudeMdSnapshot
2. Review spec: check for blocking OPENs, conflicts, missing info
   - If concerns: job action="review" → STOP, present to user → wait for approval
   - If clean: proceed to build
3. Build: implement the spec
   - Log events: job action="add_event" (file_changed, concept_addressed, blocker)
   - Create new concepts: concept action="create" with jobId
4. Complete: job action="complete" with outcomes

### Phase 5: COMPLETE (Claude Code + Chat)

**Tools used:** concept, idea, app
**Skills:** cc-build-hygiene

1. Claude Code: resolve OPENs answered during build, log final events
2. Claude Chat: review build outcomes with user
3. Graduate idea if spec was fully implemented
4. Update app record with new description/maturity

### Phase 6: NEXT PHASE (Claude Chat)

**Tools used:** idea, session
**Skills:** cc-session-protocol (session inheritance)

1. The graduated idea's RULEs and CONSTRAINTs carry forward
2. User defines the next addon idea
3. New ideation sessions begin with **session inheritance** — reading closingSummary and nextSessionRecommendation from prior sessions
4. The cycle repeats

## Presentation Mode — Cross-Cutting Concern

Presentation mode affects ALL phases where Claude interacts with the user:

### User Preferences Node
Firebase path: \`command-center/{uid}/preferences\`

\`\`\`json
{
  "presentationMode": "interactive"  // or "cli"
}
\`\`\`

Read/write via \`session\` action="preferences". The preference persists across all sessions and conversations.

### How It Affects Behavior

| Aspect | Interactive | CLI |
|--------|------------|-----|
| Concept announcements | Verbose, explain rationale | Terse, just type + content |
| Check-ins | Full progress summary | One-line status |
| Recovery | Detailed summary with options | Compact table + choice prompt |
| Tool calls | Explain before calling | Call and show result |
| Closing | Narrative summary | Structured brief |

### Per-Session Override
Pass \`presentationMode\` to session/start to override the preference for a specific session. The session-level setting takes precedence over the user preference.

## State Machine Summary

### Session Lifecycle (Server-Managed)
\`server auto-creates\` → \`Chat enriches via session/update\` → \`active\` → \`completed\`

Server handles: auto-creation on any tool call, stale detection (>24h auto-close), context matching (appId/ideaId mismatch detection).

### Session Modes
\`base\` ↔ \`ideation\` ↔ \`build-review\` ↔ \`debrief\` (flat, any-to-any transitions)

### Session Status
\`active\` → \`completed\` | \`abandoned\`

### pendingFlush Lifecycle
\`document pushed with sessionId\` → \`pendingFlush entry created atomically\` → \`session/complete\` → \`server auto-delivers to GitHub\` → \`pendingFlush cleared\`

Failed deliveries → attention queue entry created → user notified via \`_flushResults\`

### Document Status
\`pending\` → \`delivered\` (success) or \`failed\` (error)

### Job Status
\`draft\` → \`active\` → \`review\` → \`approved\` → \`completed\`/\`failed\`/\`abandoned\`
\`active\` → \`completed\`/\`failed\`/\`abandoned\` (straight-through, no concerns)
\`review\` → \`draft\` (via revise)

### Idea Status
\`active\` → \`graduated\` (built successfully) or \`archived\` (abandoned)

### Concept Status
\`active\` → \`resolved\` | \`superseded\` | \`transitioned\`

## Compaction Survival

All state lives in Firebase. If either Claude Chat or Claude Code loses context:

- **Claude Code mid-build:** Use cc-build-resume — find job via job/list, reconstruct from events
- **Claude Chat mid-session:** Use cc-session-resume — find session via session/list, reconstruct from session record (mode, goal, concepts, serverSentTotal + interactionTotal). cc-session-resume now checks pendingFlush state and presents document-aware recovery options (Resume, Flush Now, Abandon with document handling, Start Fresh).
- **Claude Chat new conversation:** The server auto-creates a new session on any tool call. Load prior sessions for the idea, read closingSummary and nextSessionRecommendation for session inheritance.

The session record is the complete recovery document: it has configSnapshot, mode, goal, serverSentTotal + interactionTotal, concept lists, pendingFlush map, and event history.

The Firebase records ARE the state. The conversation is ephemeral — Firebase is the truth.

## Tool Count

15 tools total: app, idea, session, concept, job, document, skill, list_concepts, get_active_concepts, generate_claude_md, knowledge_tree, knowledge_node, search_knowledge_base, repo_file, surface_registry

The \`session\` tool includes profile and attentionQueue capabilities (via action="profile").

27 skills total: cc-odrc-framework, cc-session-structure, cc-session-protocol, cc-mode-exploration, cc-lens-technical, cc-build-protocol, cc-build-resume, cc-session-resume, cc-session-continuity, cc-spec-generation, cc-build-hygiene, cc-mcp-workflow, cc-lens-stress-test, cc-lens-voice-of-customer, cc-lens-competitive, cc-lens-economics, cc-protocol-messaging, cc-lens-integration, cc-lens-ux-deep-dive, cc-lens-content, cc-lens-growth, cc-lens-accessibility, cc-lens-operations, cc-lens-security, cc-skill-router, cc-job-creation-protocol, cc-retro-journal`;


// ═══════════════════════════════════════════════════════════════════════
// Skills 13–16: Lens Skills (from Claude Chat)
// ═══════════════════════════════════════════════════════════════════════

const SKILL_LENS_STRESS_TEST = `# Stress Test Lens

This lens systematically challenges existing Decisions, Rules, and Constraints to find gaps, edge cases, and failure modes. Use it when the idea has converged (few or zero OPENs) and needs adversarial pressure before spec generation.

## When to Use

- Idea has multiple Decisions but hasn't been stress-tested
- OPENs are near zero — the idea *feels* ready but hasn't been challenged
- Before generating CLAUDE.md — this is the last check before committing to build

## Posture

- **Adversarial, not destructive** — the goal is to find gaps, not to kill the idea
- **Decision-by-decision** — work through each existing Decision and ask "what breaks this?"
- **Bias toward surfacing OPENs** — every gap found is a new OPEN that needs resolution
- **Capture new Constraints** — hard limits discovered under pressure become Constraints
- **Promote Rules** — patterns that must always hold become Rules

## Probing Framework

For each existing Decision, apply these stress vectors:

### Scale
- "What happens when there are 10x more [items/users/data]?"
- "What if this needs to work for a different game or product?"

### Edge Cases
- "What input would break this?"
- "What about empty, null, negative, or out-of-range values?"
- "What about the least common case — the author with no Wikipedia page, the quote with no context?"

### Dependency Failures
- "What if [external service] goes down?"
- "What if the API changes or the library is deprecated?"
- "What if the data source is wrong?"

### User Misbehavior
- "What does a user see if they manually edit the URL?"
- "What if they share a link that later becomes invalid?"
- "What if they access this before the intended flow?"

### Integration Conflicts
- "Does this conflict with any other Decision?"
- "Does this conflict with any Rule or Constraint?"
- "What about timing — does the order of operations matter?"

### Content Quality
- "What if the generated content is wrong?"
- "What if it's technically correct but boring/useless?"
- "How do we know if quality is good enough?"

## ODRC Tendencies

Stress test sessions typically produce:
- **Many OPENs** — this is the primary output. Every gap is an OPEN.
- **New Constraints** — hard limits discovered under pressure
- **New Rules** — patterns that must always hold
- **Few new Decisions** — stress testing reveals questions, not answers
- **Superseded Decisions** — existing Decisions that don't hold up get superseded with caveats

## Depth Signals

You're going deep enough when:
- At least 2-3 OPENs surfaced per major Decision area
- At least one Decision has been found to have a gap or unstated assumption
- Edge cases for user input and data quality have been explored
- Integration points between components have been probed

You're too shallow when:
- Just restating Decisions without challenging them
- No OPENs surfaced (every Decision has at least one gap)
- Edge cases haven't been explored
- Only happy-path scenarios considered

## Session Flow

1. Load all active concepts with get_active_concepts
2. Group Decisions by scope area (architecture, content, UX, integration, etc.)
3. For each group, apply stress vectors systematically
4. Write OPENs immediately as gaps are found
5. Promote to Rules/Constraints when hard limits are discovered
6. Check-in after each area: "Found N gaps in [area]. Moving to [next area]."
7. Synthesize: which Decisions held up, which need work, what's the overall risk profile`;


const SKILL_LENS_VOICE_OF_CUSTOMER = `# Voice of Customer Lens

This lens examines the idea from the user's perspective. It defines who the users are, what their journeys look like, what motivates them, and what would make them come back (or leave). Use it to ensure the idea serves real human needs, not just technical elegance.

## When to Use

- After core architecture and scope decisions are made
- When the idea has Decisions but hasn't been examined from the user's emotional perspective
- Before finalizing UX-related Rules

## Posture

- **Empathetic, not analytical** — think about feelings, not just features
- **Persona-driven** — define 3-5 distinct user types and examine each separately
- **Journey-oriented** — map the full path from discovery to repeated use
- **Retention-focused** — what brings them back? What's the habit loop?

## Probing Framework

### Persona Definition
For each persona, define:
- **Who**: demographic, context, relationship to the product
- **Journey**: step-by-step path from entry to completion
- **Emotional state**: how do they feel at each step?
- **Time budget**: how long will they spend? Seconds? Minutes?
- **Success criteria**: what makes this interaction "worth it" for them?

### Persona Archetypes to Consider
- **Primary user** — the person the feature is built for
- **Power user** — someone who uses it more than expected
- **Accidental visitor** — someone who arrives without context
- **Sharer** — someone who wants to tell others about it
- **Aspirational user** — someone the feature could serve in v2+

### Retention & Habit Loop Analysis
- What brings users back daily/weekly?
- Is there an independent retention mechanism, or does it depend on another product?
- What's the "aha moment" that hooks a first-time visitor?
- What would make a user share this with someone?

### Content & Readability
- Is the content engaging or encyclopedic?
- Does the tone match the user's emotional state?
- Is the reading level appropriate?
- How long is the optimal content length?

### Accessibility & Inclusion
- Screen reader compatibility
- Color contrast and font sizes
- Keyboard navigation
- Language and cultural sensitivity

## ODRC Tendencies

Voice of Customer sessions typically produce:
- **Decisions** about UX design, content tone, and user flow
- **Rules** about accessibility, content quality bars, and design principles
- **Constraints** about retention dependencies and user limitations
- **OPENs** about sharing mechanics and engagement features

## Depth Signals

You're going deep enough when:
- At least 3 distinct personas defined with different journeys
- Emotional states mapped for the primary persona's journey
- Retention loop explicitly identified (or its absence acknowledged)
- Content tone and readability have been addressed
- Accessibility has been discussed as a quality bar

You're too shallow when:
- Only one persona considered
- Journey described as features, not user experiences
- No discussion of what makes users come back
- Accessibility not mentioned

## Session Flow

1. Load active concepts to understand what's been decided
2. Define 3-5 user personas based on the idea's target audience
3. For each persona: map journey, identify emotional states, find gaps
4. Analyze retention: what's the habit loop? Is there one?
5. Examine content quality: tone, readability, engagement
6. Assess accessibility: is this usable by everyone?
7. Synthesize: which personas are well-served, which are underserved?`;


const SKILL_LENS_COMPETITIVE = `# Competitive Lens

This lens examines the idea in the context of what else exists. It identifies comparable products, analyzes what they do well and poorly, defines differentiation, and captures anti-patterns to avoid. Use it to ensure the idea has a clear reason to exist and isn't accidentally replicating something that already exists (or repeating known mistakes).

## When to Use

- After the idea's core scope and architecture are defined
- When you need to validate that the idea has a unique value proposition
- Before committing significant build effort — is this worth doing?

## Posture

- **Analytical, not defensive** — honestly assess where competitors are better
- **Category-oriented** — group comparables by category, not individual products
- **Steal-worthy** — identify proven patterns worth adopting
- **Anti-pattern-aware** — document what to explicitly avoid

## Probing Framework

### Comparable Product Categories
Identify 3+ categories of products that serve similar needs:
- **Direct competitors** — products doing the same thing for the same audience
- **Adjacent products** — products serving the same audience with different features
- **Analogous products** — products doing something similar for a different audience

### Per-Category Analysis
For each category:
- What do they do well? (proven patterns to consider adopting)
- What do they do poorly? (mistakes to avoid)
- What's missing? (gaps we could fill)
- How are they monetized? (business model implications)

### Differentiation
- What is the unique value proposition?
- What's the "moat" — what makes this hard to replicate?
- Is the differentiation in the product, the integration, the audience, or the content?
- Would a user choose this over alternatives? Why?

### Anti-Patterns
Document specific things to avoid based on competitor analysis:
- UX anti-patterns (ads, dark patterns, feature bloat)
- Content anti-patterns (SEO bait, thin content, user-generated noise)
- Technical anti-patterns (slow load times, broken mobile, authentication walls)

### Positioning Statement
Synthesize a clear positioning: "This is [what it is] for [who], unlike [alternatives] because [differentiator]."

### Risk Assessment
- Is competitive risk high (many strong competitors) or low (niche/novel)?
- What's the main risk — a competitor copying us, or us building something nobody wants?
- What's the success metric that validates the positioning?

## ODRC Tendencies

Competitive lens sessions typically produce:
- **Decisions** about positioning, visual design patterns, and feature scope
- **Rules** about anti-patterns to avoid (what NOT to do)
- **Constraints** about competitive risk and success metrics
- **Few OPENs** — competitive analysis tends to confirm or reject, not raise questions

## Depth Signals

You're going deep enough when:
- 3+ competitor categories analyzed
- Specific proven patterns identified for adoption
- Anti-patterns documented with rationale
- Clear positioning statement articulated
- Success metric defined that validates the positioning

You're too shallow when:
- Only one competitor considered
- Analysis is just "we're different because we're us"
- No anti-patterns documented
- No success metric for validating the positioning

## Session Flow

1. Load active concepts to understand the idea's scope and architecture
2. Identify 3+ comparable product categories
3. For each category: strengths, weaknesses, gaps, monetization
4. Define differentiation and competitive moat
5. Document anti-patterns as Rules
6. Articulate positioning statement
7. Assess competitive risk and define success metrics`;


const SKILL_LENS_ECONOMICS = `# Economics Lens

This lens examines the idea's cost structure — build effort, hosting costs, maintenance burden, opportunity cost, and return on investment. Use it to make an informed go/no-go decision and to set realistic expectations for timeline and effort. Especially important for solo developers where time is the scarcest resource.

## When to Use

- After architecture and scope decisions are made (so costs can be estimated)
- Before committing to build — is the effort justified?
- When comparing this idea against alternative uses of the same time

## Posture

- **Realistic, not optimistic** — estimate conservatively, especially for review/testing time
- **Solo-developer-aware** — time is the primary cost, not money
- **Maintenance-conscious** — ongoing cost matters more than build cost for long-lived projects
- **Opportunity-cost-aware** — what else could this time be spent on?

## Probing Framework

### Build Cost Breakdown
Enumerate every task required to ship v1:
- Code development (hours, with Claude Code acceleration factored in)
- Content creation/generation (hours)
- Content review/QA (hours — this is often the hidden cost)
- Configuration and deployment (hours)
- Testing (hours)
- Total: provide a range (optimistic to conservative)

### Hosting & Infrastructure Cost
- Monthly/annual hosting cost
- Database/storage cost
- API costs (if applicable)
- Domain/SSL costs
- Compare against existing infrastructure (can we piggyback?)

### Maintenance Burden
- How often will this need updates?
- What triggers a maintenance task? (bug reports, dependency updates, content changes)
- Estimated hours per month for ongoing maintenance
- What's the "maintenance profile"? (deploy-once-forget vs. constant-tending)

### Opportunity Cost
- What else could this time be spent on?
- List 3-5 alternative projects competing for the same time
- How does this idea compare on: bounded vs. open-ended, reusable vs. one-off, learning value

### ROI / Go-No-Go Assessment
Rate the idea: RED / YELLOW / GREEN
- **GREEN**: Low cost, bounded effort, clear value, acceptable risk
- **YELLOW**: Moderate cost, some uncertainty, value depends on execution
- **RED**: High cost, unbounded effort, unclear value, or better alternatives exist

### Risk Factors
- What's the biggest cost risk? (scope creep, content quality, integration complexity)
- What's the mitigation?
- What's the "kill switch" — at what point do we stop investing?

## ODRC Tendencies

Economics lens sessions typically produce:
- **Decisions** about effort estimates, review strategies, build phasing, and go/no-go
- **Constraints** about hosting limits, budget limits, and time availability
- **Few Rules** — economics is about choices, not patterns
- **Few OPENs** — economics analysis tends to produce answers, not questions

## Depth Signals

You're going deep enough when:
- Build effort broken down by task with hour estimates
- Hosting cost calculated (even if it's "zero")
- Maintenance burden estimated in hours/month
- Opportunity cost compared against 3+ alternatives
- Clear go/no-go recommendation with rationale

You're too shallow when:
- Just "it's a small project" without estimates
- Hosting cost not calculated
- Maintenance not considered
- No comparison to alternative uses of time
- No explicit go/no-go recommendation

## Session Flow

1. Load active concepts to understand scope and architecture decisions
2. Break down build effort by task with hour ranges
3. Calculate hosting and infrastructure costs
4. Estimate ongoing maintenance burden
5. Assess opportunity cost against alternative projects
6. Synthesize go/no-go recommendation with rationale
7. Identify the biggest cost risk and its mitigation`;


const SKILL_PROTOCOL_MESSAGING = `# Inter-Agent Messaging Protocol

Defines structured message types for Claude Chat <-> Claude Code conversation loops. Both sides know what kind of message they're receiving, what response is expected, and how long it should take.

## Message Format

Every message includes a TYPE header on its first line:
TYPE: [message-type]

This replaces free-form chat with typed, predictable exchanges.

## Message Types

### 1. spec-push
- Sender: Chat
- Meaning: "Here's a new/updated CLAUDE.md. Evaluate it."
- Expected response: spec-review (ready or issues)
- Response time: ~30-60s (Code reads spec, examines codebase, checks for conflicts)
- Content: CLAUDE.md doc ID or inline spec summary

### 2. spec-review
- Sender: Code
- Subtypes:
  - spec-review:ready — "Spec looks good against the codebase. Starting build."
  - spec-review:issues — "Found N blocking issues: [list]"
- Expected response: spec-resolution from Chat (if issues), or none (if ready)
- Response time: ~30s for review
- Content: List of issues with severity (blocking/warning). MUST include codebase examination results.

### 3. spec-resolution
- Sender: Chat
- Meaning: "Issues resolved. Here's what changed."
- Expected response: spec-review (Code re-evaluates)
- Response time: ~15s
- Content: List of resolutions, updated concept IDs, new CLAUDE.md doc ID if regenerated

### 4. build-status
- Sender: Code
- Subtypes:
  - build-status:phase-complete — "Phase N done. Moving to Phase N+1." (informational)
  - build-status:complete — "Build finished. Job ID: [id]"
  - build-status:blocked — "Hit a blocker: [description]"
  - build-status:failed — "Build failed: [reason]"
- Expected response: build-review (for complete/failed), resolution (for blocked), none (for phase-complete)
- Content: Job ID, summary, files changed, test results

### 5. build-review
- Sender: Chat
- Subtypes:
  - build-review:approved — "Looks good. Ship it."
  - build-review:issues — "Found problems: [list]"
- Expected response: Deploy confirmation (if approved), fix + new build-status (if issues)
- Response time: ~15s
- Content: Approval or list of issues

### 6. question
- Sender: Either
- Meaning: "I need input to proceed."
- Expected response: answer
- Response time: ~10s

### 7. answer
- Sender: Either
- Meaning: "Here's the answer to your question."
- Expected response: Depends on context

### 8. info
- Sender: Either
- Meaning: "FYI, no response needed."
- Expected response: None (ack only)

### 9. end
- Sender: Either
- Meaning: "Conversation loop complete."
- Expected response: None
- Content: Summary of what was accomplished

### 10. escalate
- Sender: Either
- Meaning: "Need Dave's input. Cannot proceed without human decision."
- Expected response: None (both sides wait for Dave)
- Content: The question for Dave, with options if possible

## Polling Behavior

Based on message type sent, the sender should poll with appropriate patience:
- After spec-push: poll up to 60s (Code needs time to examine codebase + evaluate)
- After question: poll up to 30s
- After info/end: poll once or twice, then stop
- After build-status:complete: poll up to 30s for review
- After escalate: stop polling (wait for Dave)

## Flow Examples

### Happy path (spec to build):
Chat: spec-push -> Code: spec-review:ready -> Code builds -> Code: build-status:complete -> Chat: build-review:approved -> Code: end

### Spec has issues:
Chat: spec-push -> Code: spec-review:issues -> Chat: spec-resolution -> Code: spec-review:ready -> build continues

### Build hits blocker:
Code: build-status:blocked -> Chat: answer (or escalate) -> Code continues

### Needs Dave:
Either: escalate -> both wait -> Dave provides input -> conversation resumes

## Protocol Rules

### RULE: Code Ack Format (WAIT Signals + Progress Updates)
When Code acknowledges a task, the ack must include: (1) a numbered step plan of what it will do, (2) a WAIT signal — either "WAIT: poll" for quick lookups under 60 seconds, or "WAIT: working" for multi-step implementation tasks. For "WAIT: working" tasks, Code must send TYPE: info progress messages at each meaningful checkpoint (e.g., code written, tests running, tests passed, deploying, deployed). Silence longer than 2 minutes without a progress update violates this rule.

### RULE: Chat Poll-vs-Stop Behavior (WAIT Signal Governed)
Chat's polling behavior is governed by Code's WAIT signal. On "WAIT: poll" — Chat stays polling, expects a reply within 60 seconds. On "WAIT: working" — Chat tells Dave what Code is doing and stops polling. Chat informs Dave to re-engage when ready, at which point Chat checks for messages. This prevents wasting context window on empty poll loops during multi-step implementation tasks.

### RULE: Failure Escalation (No Silent Retry Loops)
If Code encounters repeated failures (2+ retry cycles on the same step), unexpected blockers, or a task is taking significantly longer than the step plan implied, Code must send a TYPE: info message to Chat explaining what's failing, what it has tried, and whether it needs Chat input or Dave escalation. Code should not silently retry indefinitely — after 3 failed attempts at the same approach, Code must escalate with a TYPE: question or TYPE: escalate message rather than continuing to burn cycles.

### RULE: No Background Polling Processes
Claude Code must NEVER create background bash scripts, shell loops, cron jobs, or any persistent process to poll for messages. All message checking must happen inline via document(receive) calls within the active conversation. Background scripts outlive sessions and cause catastrophic Firebase bandwidth costs ($17+/day from a single zombie polling loop discovered Feb 2026).

The correct pattern:
- Call document(receive) once when you want to check for messages
- If told "WAIT: poll", call document(receive) again after 30-60 seconds WITHIN the conversation
- If told "WAIT: working", stop checking and tell the user to re-engage later
- NEVER spawn a background process, write a bash script to /tmp, or use nohup/& to run polling in the background`;




// ═══════════════════════════════════════════════════════════════════════
// Skills 18–24: Lens Skills (Batch 2 — from Claude Chat)
// ═══════════════════════════════════════════════════════════════════════

const SKILL_LENS_INTEGRATION = `# Integration / Ecosystem Lens

This lens examines how the idea connects to other apps, services, and data sources in the ecosystem. It identifies coupling points, defines contracts between systems, and surfaces risks from independent deployment of connected components. Essential for any app that reads, writes, or links to another app.

## When to Use

- The idea connects to one or more other apps in the ecosystem (Game Shelf games, Quotle, CC itself)
- The idea shares a database, Firebase path, or API with another product
- The idea depends on another app's URL structure, data schema, or behavior
- Multiple repos could be deployed independently but affect each other

## Posture

- **Contract-oriented** — define what each side promises and depends on
- **Failure-aware** — what breaks when the other side changes without warning?
- **Ownership-clear** — who owns the data, who owns the schema, who owns the URL?
- **Versioning-conscious** — can these components evolve independently?

## Probing Framework

### Dependency Mapping
For each external connection, identify:
- **What app/service** does this connect to?
- **What data** flows between them? (fields, formats, frequency)
- **What direction** — read-only, write, or bidirectional?
- **What's the coupling type** — shared database, API call, URL link, embed, shared auth?

### Contract Definition
For each coupling point:
- "What specific fields/paths/URLs does this app depend on from [other app]?"
- "If [other app] renames a field, changes a path, or restructures data, what breaks?"
- "Is this dependency documented anywhere, or is it implicit?"
- "Who is responsible for maintaining compatibility?"

### Independent Deployment Risk
- "Can [app A] and [app B] be deployed independently without breaking each other?"
- "Is there a deployment ordering requirement?"
- "What's the blast radius if [app A] ships a breaking change?"
- "How would you detect that a dependent app broke?"

### Data Ownership
- "Does this app own its data, or does it read another app's data?"
- "Should data be copied (decoupled) or read live (coupled)?"
- "If the source data changes schema, who updates the consumers?"
- "Are there multiple consumers of the same data source?"

### Ecosystem Coherence
- "Does this app's UX feel like it belongs in the ecosystem? (branding, navigation, tone)"
- "Can a user navigate between apps without disorientation?"
- "Are shared UI patterns (share text format, status indicators, design tokens) consistent?"

## ODRC Tendencies

Integration lens sessions typically produce:
- **Rules** about coupling contracts, data ownership, and deployment coordination
- **Constraints** about external data schemas, URL structures, and API contracts you don't control
- **Decisions** about whether to copy vs. reference data, how to handle schema evolution
- **OPENs** about undocumented dependencies and cross-app deployment risks

## Depth Signals

You're going deep enough when:
- Every external dependency is enumerated with specific field-level coupling
- Data ownership is explicit for each shared data path
- At least one "what breaks if X changes" scenario has been explored per dependency
- Deployment independence has been assessed

You're too shallow when:
- Dependencies described vaguely ("it connects to Quotle") without specifying what data
- No coupling contracts defined
- Independent deployment risk not discussed
- Data ownership ambiguous

## Session Flow

1. Load active concepts to understand architecture and integrations already decided
2. Enumerate every external app, service, and data source the idea touches
3. For each: map the data flow, direction, and coupling type
4. Define coupling contracts: what fields/paths/URLs are depended upon
5. Assess independent deployment risk for each coupling point
6. Determine data ownership: copy vs. live read for each data source
7. Check ecosystem coherence: branding, navigation, shared patterns
8. Synthesize: which couplings are healthy, which are risky, what contracts need documenting`;


const SKILL_LENS_UX_DEEP_DIVE = `# UX Deep-Dive Lens

This lens walks through the idea screen by screen as a user would experience it. It examines navigation flow, transitions between states, loading behavior, error states, and interaction design. Unlike Voice of Customer (which asks "who is the user and what do they want?"), this lens asks "what exactly does the user see and do at each step?"

## When to Use

- After architecture and persona decisions are made — you need to know what's being built and for whom before walking through the UX
- When the idea has multiple views or routes
- Before spec generation — catches navigation and interaction gaps that architecture lenses miss
- When existing decisions describe features but not the flow between them

## Posture

- **Sequential, not analytical** — walk through the experience step by step, in order
- **State-aware** — every view has states: loading, empty, populated, error. Examine all of them.
- **Transition-focused** — how does the user get from A to B? What does the in-between look like?
- **Device-conscious** — the same flow on mobile vs. desktop may have different needs
- **Accessibility-integrated** — keyboard, screen reader, and contrast concerns are examined at each step, not as an afterthought

## Probing Framework

### Journey Walkthrough
For each user persona (from Voice of Customer), walk the complete path:
1. "Where does the user start?" (entry point: URL, link from another app, search result)
2. "What do they see first?" (above the fold, no scroll)
3. "What's their first action?" (tap, scroll, search, read)
4. "Where does that action take them?"
5. "How do they get back or navigate elsewhere?"
6. Continue until the journey ends or loops

### View State Analysis
For each view/route, examine all states:
- **Loading** — what does the user see while data loads? Skeleton? Spinner? Nothing?
- **Empty** — what if there's no data? (no search results, no quotes, empty author)
- **Populated** — the happy path, content is present
- **Error** — what if something fails? (network error, invalid data, missing resource)
- **Partial** — what if some data is present but not all? (enrichment not yet complete)

### Navigation Architecture
- "Is there a persistent navigation element (header, bottom bar, sidebar)?"
- "Can the user always get home from any view?"
- "Does the back button work correctly at every step?"
- "Is there breadcrumb context or just back navigation?"
- "How many taps to reach any content from the home page?"

### Interaction Design
- "Are touch targets at least 44x44px on mobile?"
- "Are clickable elements visually distinguishable from static content?"
- "Is there hover/active/focus feedback on interactive elements?"
- "Are form inputs (search, filters) responsive and forgiving?"

### Transitions
- "What happens visually when transitioning between views?"
- "Is it instant, animated, or does it flash/flicker?"
- "Does scroll position reset appropriately on navigation?"
- "Is there a sense of spatial continuity (where did I come from, where am I going)?"

### Accessibility (Mandatory Section)
Every UX Deep-Dive session MUST include these checks:
- **Keyboard navigation** — Can every interactive element be reached and activated via keyboard? Are focus styles visible?
- **Screen reader** — Are route changes announced? Do images have alt text? Are interactive elements labeled?
- **Color contrast** — Do text/background combinations meet WCAG AA (4.5:1 for normal text, 3:1 for large text)?
- **Motion sensitivity** — Are animations respectful of prefers-reduced-motion?
- **Touch targets** — Are all interactive elements at least 44x44px on mobile?

## ODRC Tendencies

UX Deep-Dive sessions typically produce:
- **Decisions** about navigation architecture, loading states, transition behavior, and interaction patterns
- **Rules** about accessibility standards, touch target minimums, and focus management
- **OPENs** about unresolved design choices (e.g., card layout vs. list layout)
- **Few Constraints** — UX is mostly about choices, not external limits

## Depth Signals

You're going deep enough when:
- Every view has been examined in all states (loading, empty, populated, error, partial)
- Navigation between views has been walked step by step
- The back button and browser history behavior has been addressed
- Accessibility checks have been completed (keyboard, screen reader, contrast, touch)
- Loading states have been explicitly designed

You're too shallow when:
- Only the happy path was examined (no loading, empty, or error states)
- Navigation architecture not addressed ("how do I get home?")
- Accessibility not discussed
- Transitions between views not examined
- Only desktop OR mobile considered, not both

## Session Flow

1. Load active concepts — especially routing, personas, and architecture decisions
2. Identify all views/routes
3. Walk the primary persona's journey step by step
4. For each view: examine all states (loading, empty, populated, error, partial)
5. Assess navigation architecture: persistent nav, back button, home access
6. Check interaction design: touch targets, feedback, distinguishability
7. Run accessibility checks: keyboard, screen reader, contrast, motion, touch targets
8. Note transitions: what happens between views
9. Repeat for secondary persona if their journey differs meaningfully
10. Synthesize: what views are well-designed, what states are missing, what navigation gaps exist`;


const SKILL_LENS_CONTENT = `# Content / Information Architecture Lens

This lens examines the content model — not the data schema (that's Technical) or the user's emotional response (that's Voice of Customer), but the editorial strategy: what content exists, how it's structured, what quality bar it must meet, and how it's created, reviewed, and maintained over time. Essential for any app where content is a primary value driver.

## When to Use

- The idea's core value is content (articles, context, descriptions, analysis, generated text)
- Content is AI-generated and needs quality assurance
- The idea has a content pipeline (creation → review → publish → maintain)
- Multiple content types exist with different structures or quality requirements

## Posture

- **Editorial, not technical** — think like an editor-in-chief, not an engineer
- **Structure-first** — define the template before worrying about individual pieces
- **Quality-gated** — every piece of content must meet a defined bar before publishing
- **Lifecycle-aware** — content is created, reviewed, published, potentially updated, and sometimes retired

## Probing Framework

### Content Inventory
- "What distinct types of content does this app contain?" (e.g., quote context, author bios, thematic analysis)
- "How many pieces of each type?" (bounded or unbounded?)
- "What's the source?" (AI-generated, human-written, imported, user-generated)

### Content Template
For each content type, define the template:
- "What sections/fields must every piece include?"
- "What's the target length for each section?"
- "What questions should each section answer?"
- "What's a great example look like vs. a mediocre one?"

### Quality Gate
- "What makes this content 'good enough' to publish?"
- "What's the review checklist?" (factual accuracy, tone, length, readability, completeness)
- "Who reviews it?" (human, automated checks, or publish-and-fix?)
- "What happens if content fails the quality gate?"

### Content Lifecycle
- "How is content initially created?" (batch generation, manual authoring, import)
- "What's the review process?" (human QA, automated validation, sampling)
- "How is content updated?" (triggered by errors, scheduled review, never?)
- "Is there a versioning or 'last reviewed' mechanism?"
- "Can content be retired or hidden?"

### Enrichment Pipeline (if AI-generated)
- "What prompt/instruction produces this content?"
- "What source material does the AI work from?"
- "What are the known failure modes?" (hallucination, wrong tone, too long, hedging language)
- "How is the output validated?"
- "What's the cost per piece to generate?"

### Information Architecture
- "How is content organized for discovery?" (search, browse, categories, tags, timelines)
- "Can users find related content from any piece?" (cross-linking, related items, author pages)
- "Is there a hierarchy?" (featured vs. standard, primary vs. supplementary)

## ODRC Tendencies

Content lens sessions typically produce:
- **Rules** about content templates, quality gates, and review checklists
- **Decisions** about content structure, enrichment pipelines, and lifecycle management
- **Constraints** about content volume, generation costs, and review capacity
- **OPENs** about specific content quality standards and edge cases

## Depth Signals

You're going deep enough when:
- Every content type has a defined template with section-level structure
- A quality gate exists with specific, checkable criteria
- The content lifecycle is documented (create → review → publish → maintain)
- If AI-generated: the enrichment pipeline's failure modes are identified
- Information architecture (how users find and navigate content) is addressed

You're too shallow when:
- Content described only by type ("we have bios") without structure
- No quality gate defined ("we'll review it")
- Lifecycle not discussed (creation only, no maintenance plan)
- AI-generated content assumed to be correct without validation strategy

## Session Flow

1. Load active concepts — especially data schema, personas, and tone decisions
2. Inventory all content types
3. For each type: define the template (sections, length, questions answered)
4. Define the quality gate and review checklist
5. Map the content lifecycle: creation, review, publication, maintenance
6. If AI-generated: examine the enrichment pipeline and failure modes
7. Assess information architecture: how users discover and navigate content
8. Synthesize: which content types are well-defined, which need structure, what's the biggest quality risk`;


const SKILL_LENS_GROWTH = `# Growth / Distribution Lens

This lens examines how users discover, arrive at, and spread the word about the idea. It covers acquisition channels, SEO strategy, social sharing mechanics, viral loops, and the measurement infrastructure needed to know if growth is working. Unlike Competitive (which asks "is this differentiated?") or Economics (which asks "can we afford it?"), this lens asks "how do people find out about it and come back?"

## When to Use

- The idea is public-facing (not an internal tool)
- User acquisition is not guaranteed (no built-in captive audience)
- The idea depends on organic discovery (search, social, word-of-mouth)
- Even if there IS a built-in audience, this lens validates the funnel and identifies expansion opportunities

## Posture

- **Channel-specific** — don't say "we'll do marketing." Identify the exact channels and what works in each.
- **Funnel-oriented** — trace the path from discovery to first use to repeat use
- **Measurement-first** — if you can't measure it, you can't optimize it
- **Honest about virality** — most things don't go viral. Identify realistic growth, not fantasy.

## Probing Framework

### Channel Identification
Enumerate every realistic acquisition channel:
- **Organic search** — What queries would lead someone here? Are we optimized for them?
- **Referral from other apps** — Is there a built-in traffic source? (e.g., Quotle → quotle.info)
- **Social sharing** — What gets shared? Is the shared artifact compelling?
- **Direct/bookmarks** — Will users come back directly?
- **Word of mouth** — What's the "tell a friend" moment?

### SEO Strategy
- "What are the target search queries?" (exact phrases users would type)
- "Does every page have unique, descriptive title tags and meta descriptions?"
- "Are Open Graph tags present for social previews?" (og:title, og:description, og:image)
- "Is there a sitemap.xml?"
- "Are URLs human-readable and keyword-relevant?"
- "Is the site mobile-friendly?" (Google mobile-first indexing)

### Social Sharing Mechanics
- "What does a shared link look like in iMessage / Twitter / Slack?" (preview card)
- "Is the share text compelling enough to click?" (not just a URL)
- "Does the landing page for a shared link work for someone with no context?"
- "Is there a visual artifact worth sharing?" (quote card, result image, screenshot)

### Viral Loop Analysis
- "If user A shares with user B, what's user B's experience?"
- "Does user B have a reason to (a) stay, (b) share further, or (c) try the source app?"
- "What's the realistic viral coefficient?" (< 1 for most apps — be honest)
- "Is there a network effect, or is the app equally useful solo?"

### Conversion Funnel
- "What's the path from landing to 'aha moment'?"
- "How many clicks/taps from arrival to value?"
- "What are the drop-off points?"
- "Is there a clear next action on every page?"

### Measurement
- "What analytics are in place to track acquisition?"
- "Can you measure: page views, unique users, referral source, search queries, share clicks?"
- "What's the primary growth metric?" (DAU, page views, shares, conversion rate?)
- "How often will you check these metrics?"

## ODRC Tendencies

Growth lens sessions typically produce:
- **Decisions** about SEO tags, analytics implementation, share mechanics, and channel priority
- **Rules** about meta tag requirements, social preview standards, and measurement discipline
- **Constraints** about budget limitations for paid acquisition (usually $0 for solo dev)
- **OPENs** about whether to invest in social preview images, email capture, or other growth features

## Depth Signals

You're going deep enough when:
- Every realistic acquisition channel is enumerated with a specific strategy for each
- SEO fundamentals are addressed (titles, meta descriptions, OG tags, sitemap)
- Social sharing previews have been explicitly designed
- Analytics/measurement is decided (even if it's "none for v1")
- The conversion funnel from landing to value has been traced

You're too shallow when:
- Channel strategy is "SEO and social" without specifics
- No mention of meta tags, OG tags, or sitemaps
- Share mechanics not examined (what does the share look like?)
- No measurement plan
- Viral coefficient assumed to be high without evidence

## Session Flow

1. Load active concepts — especially personas, positioning, and sharing decisions
2. Enumerate all realistic acquisition channels
3. For each channel: define the specific strategy and what's needed
4. Assess SEO: titles, meta descriptions, OG tags, sitemap, URL structure
5. Design social sharing: what the preview looks like, what gets shared
6. Trace the conversion funnel: landing → value → repeat
7. Analyze viral potential honestly
8. Define measurement: what analytics, what metrics, how often checked
9. Synthesize: which channels are strongest, what's missing, what's the growth risk`;


const SKILL_LENS_ACCESSIBILITY = `# Accessibility Lens

This lens conducts a thorough accessibility audit of the idea. While the UX Deep-Dive lens includes an accessibility section for routine checks, this standalone lens goes deeper — examining WCAG compliance systematically, cognitive accessibility, internationalization readiness, and inclusive design principles. Use this when accessibility is a primary concern or when the app serves diverse populations.

## When to Use

- The app targets a broad public audience (not just internal/developer tools)
- The app has complex interactions (forms, games, real-time updates, rich media)
- Accessibility hasn't been examined in prior sessions
- Legal or policy requirements exist for accessibility compliance
- The UX Deep-Dive lens raised accessibility concerns that need deeper exploration

## Posture

- **Standards-grounded** — reference WCAG 2.1 AA as the baseline, not vague "best practices"
- **Empathetic** — consider real users with real disabilities, not abstract compliance checkboxes
- **Practical** — prioritize fixes by impact (how many users affected × how severe the barrier)
- **Progressive** — perfect accessibility isn't required for v1, but the foundation must be right

## Probing Framework

### Visual Accessibility
- **Color contrast**: Do all text/background combinations meet WCAG AA? (4.5:1 normal text, 3:1 large text, 3:1 UI components)
- **Color independence**: Is information conveyed by color alone? (error states, status indicators, categories)
- **Text scaling**: Does the layout survive 200% text zoom without breaking?
- **Dark/light modes**: If applicable, does the alternate theme maintain contrast?

### Motor Accessibility
- **Keyboard navigation**: Can every interactive element be reached via Tab? Is the tab order logical?
- **Focus visibility**: Are focus indicators visible and high-contrast?
- **Touch targets**: Are all targets at least 44x44px with adequate spacing?
- **Keyboard shortcuts**: Are they documented and non-conflicting? Can they be remapped?
- **Timing**: Are there time-limited interactions? Can they be extended or disabled?

### Auditory / Screen Reader Accessibility
- **Semantic HTML**: Are headings (h1-h6), landmarks (nav, main, aside), and lists used correctly?
- **ARIA labels**: Do interactive elements have descriptive labels?
- **Route changes**: Are SPA navigation changes announced to screen readers?
- **Live regions**: Are dynamic content updates (search results, loading states, errors) announced?
- **Image alt text**: Do all informational images have descriptive alt text?

### Cognitive Accessibility
- **Reading level**: Is content at an appropriate reading level for the target audience?
- **Predictability**: Are navigation and interactions consistent across views?
- **Error prevention**: Do forms validate before submission? Are error messages clear and specific?
- **Information density**: Is content scannable? Are there clear headings and visual hierarchy?
- **Animation**: Does the app respect prefers-reduced-motion? Are animations non-essential?

### Internationalization Readiness
- **Text direction**: Does the layout support RTL languages if needed?
- **Text expansion**: Do containers handle text that's 30-50% longer in other languages?
- **Cultural sensitivity**: Are icons, colors, and metaphors culturally neutral?
- **Date/number formats**: Are they locale-aware?

## ODRC Tendencies

Accessibility lens sessions typically produce:
- **Rules** about contrast minimums, focus styles, touch targets, and screen reader requirements
- **Decisions** about specific accessibility implementations (ARIA patterns, focus management strategy)
- **Constraints** about WCAG compliance level (AA vs. AAA) and browser/assistive technology support
- **OPENs** about specific design changes needed to meet accessibility standards

## Depth Signals

You're going deep enough when:
- Color contrast has been checked for all primary text/background combinations
- Keyboard navigation flow has been traced through the main user journey
- Screen reader behavior for route changes and dynamic content has been addressed
- At least one cognitive accessibility concern has been examined
- Specific WCAG criteria have been referenced (not just "make it accessible")

You're too shallow when:
- Accessibility discussed only as "we should add alt text"
- No contrast ratios calculated or estimated
- Keyboard navigation not traced
- Screen reader behavior not discussed
- Only visual accessibility considered (ignoring motor, auditory, cognitive)

## Session Flow

1. Load active concepts — especially design system, routing, and UX decisions
2. Audit visual accessibility: contrast ratios, color independence, text scaling
3. Audit motor accessibility: keyboard flow, focus styles, touch targets
4. Audit screen reader support: semantic HTML, ARIA, route announcements, live regions
5. Audit cognitive accessibility: reading level, predictability, information density
6. Assess internationalization readiness if the audience is global
7. Prioritize findings by impact: severe barriers first, enhancements second
8. Synthesize: what's the baseline accessibility level, what must be fixed before launch, what can be improved later`;


const SKILL_LENS_OPERATIONS = `# Operations / Observability Lens

This lens examines what happens after launch — how you know the app is working, how you know users are using it, and what you do when something breaks. Most ideation focuses on "what to build" and ignores "how to know it's working." This lens fills that gap. Especially important for apps with server-side components, real-time features, external dependencies, or state machines.

## When to Use

- The app has external dependencies that could fail (Firebase, APIs, CDNs)
- The app has defined success metrics that need measurement
- The app has state machines, queues, or background processes
- The app serves real users whose experience you need to monitor
- The app has been launched and you're planning the next phase (what's actually happening?)

## Posture

- **Day-2 thinking** — the build is done, it's live, now what?
- **Signal-focused** — what are the minimum signals that tell you "healthy" vs. "broken"?
- **Proportional** — don't over-instrument a hobby project, don't under-instrument a production system
- **Failure-first** — assume things will break. How do you find out?

## Probing Framework

### Health Monitoring
- "How do you know the app is up and working right now?"
- "What would break first?" (the most fragile dependency)
- "How long before you'd notice if it broke?" (minutes? hours? days? never?)
- "Is there an automated health check, or do you rely on manual visits / user reports?"

### Analytics & Usage Measurement
- "What are the defined success metrics?" (from Economics or VoC sessions)
- "How are those metrics measured?" (analytics tool, custom counters, server logs)
- "What data do you need to answer: is this working?" (page views, unique users, feature usage)
- "What's the minimum viable analytics?" (simplest thing that tells you if people use it)
- "How often will you check metrics?"

### Error Monitoring
- "How are JavaScript errors captured?" (browser console only? error tracking service? custom logging?)
- "How are API/Firebase errors surfaced?" (to the user? to you? silently swallowed?)
- "Is there a 'something went wrong' feedback path for users?"
- "What errors are expected vs. unexpected?"

### Deployment Verification
- "After deploying, how do you verify it worked?"
- "Is there a smoke test?" (automated or manual)
- "Does the deploy process have rollback capability?"
- "How do you verify that the deploy didn't break an existing feature?"

### Incident Response
- "If the app breaks at 2 AM, who finds out and how?"
- "Is there a runbook for common failures?" (Firebase down, CDN issue, bad deploy)
- "What's the recovery process?" (rollback, hotfix, wait-it-out)
- "Are there dependencies that could break the app without any deploy?" (third-party API changes, certificate expiry, quota limits)

### Data Integrity
- "How do you know the data is correct?" (especially for AI-generated or imported content)
- "Is there a validation layer?" (schema validation, integrity checks)
- "What happens if data gets corrupted?" (recovery strategy)
- "Are there backups?" (for Firebase RTDB, exported snapshots)

## ODRC Tendencies

Operations lens sessions typically produce:
- **Decisions** about analytics implementation, error monitoring approach, and deployment verification
- **Rules** about minimum observability requirements and data backup frequency
- **Constraints** about monitoring budget and tool availability
- **Few OPENs** — operations questions tend to have clear right answers

## Depth Signals

You're going deep enough when:
- At least one health monitoring approach is decided (even if it's "manual check weekly")
- Success metrics have a measurement plan (even if it's "Firebase Analytics page views")
- Error handling strategy includes both user-facing and developer-facing paths
- Deployment verification has been addressed
- Data integrity/backup has been discussed for persistent data stores

You're too shallow when:
- "We'll add analytics later" without specifying what
- Error monitoring not discussed
- No deployment verification plan
- Data backup not considered for apps with persistent state
- Success metrics defined but not measurable

## Session Flow

1. Load active concepts — especially architecture, dependencies, and success metrics
2. Assess health monitoring: how do you know it's working?
3. Define analytics: what metrics, what tool, what frequency
4. Assess error monitoring: how errors are captured and surfaced
5. Plan deployment verification: smoke tests, rollback capability
6. Consider incident response: who, how, when
7. Check data integrity: validation, backups, recovery
8. Synthesize: what's the minimum viable observability for this app's complexity level`;


const SKILL_LENS_SECURITY = `# Security / Privacy Lens

This lens examines the attack surfaces, data exposure risks, and security boundaries of the idea. It covers authentication, authorization, data protection, dependency security, and Firebase-specific security patterns. Essential for any app with user accounts, user-generated content, payment flows, or write access to shared data stores.

## When to Use

- The app has user authentication (Firebase Auth, OAuth, custom auth)
- The app writes user data to a database
- The app handles payments or virtual currency
- The app exposes an API or MCP server
- The app reads from shared data stores that other apps also access
- The app stores any personally identifiable information (PII)

## When to Skip

- Read-only public content sites with no authentication
- Internal tools with no user data
- Static sites with no database writes

Even for "skip" cases, a 5-minute check of "is the Firebase API key exposure acceptable?" and "are RTDB rules correct?" is worthwhile.

## Posture

- **Attacker-mindset** — think about what a malicious user would try, not just what a good user does
- **Defense-in-depth** — multiple layers of protection, not just one
- **Principle of least privilege** — every user and service gets minimum necessary access
- **Assume breach** — what's the damage if someone gets in?

## Probing Framework

### Attack Surface Inventory
- "What endpoints/URLs accept user input?" (forms, search, URL parameters, API calls)
- "What data is visible in the browser?" (Firebase API key, data structure, user info)
- "What can a user do by manipulating the URL or browser devtools?"
- "Are there admin functions accessible from the client?"

### Authentication & Authorization
- "How are users authenticated?" (Firebase Auth, custom, none)
- "What can an unauthenticated user see and do?"
- "What can an authenticated user see and do that they shouldn't?"
- "Can user A access user B's data by changing a parameter?"
- "Are there admin/elevated roles? How are they assigned and verified?"

### Firebase-Specific Security
- "Are RTDB rules correctly restrictive?" (read/write per path)
- "Is the RTDB rules file tested?" (Firebase emulator, manual verification)
- "Does the app use .validate rules for data integrity?"
- "Are Firestore/RTDB queries indexed for the access patterns used?"
- "Are Cloud Functions authenticated where needed?"

### Data Protection
- "What PII is stored?" (names, emails, locations, payment info)
- "Is PII encrypted at rest?" (Firebase default encryption is usually sufficient)
- "Is PII transmitted securely?" (HTTPS only)
- "What's the data retention policy?" (how long is data kept, can users delete their data?)
- "Is there a privacy policy? Is it accurate?"

### Input Validation & Injection
- "Are all user inputs sanitized before rendering?" (XSS prevention)
- "Are user inputs validated before writing to the database?" (injection prevention)
- "Is there rate limiting on write operations?" (abuse prevention)
- "Can a user submit data that breaks other users' experience?"

### Dependency Security
- "Are CDN-loaded libraries from trusted sources with known versions?"
- "Are there known vulnerabilities in the dependency versions used?"
- "What happens if a CDN-loaded script is compromised?" (supply chain risk)
- "Are Content Security Policy (CSP) headers set?"

### Incident Scenarios
- "What's the worst thing that could happen?" (data breach, financial loss, reputation damage)
- "What data would be exposed in a breach?"
- "How would you detect a breach?"
- "What's the response plan?"

## ODRC Tendencies

Security lens sessions typically produce:
- **Rules** about Firebase RTDB rules, input validation, and minimum security standards
- **Constraints** about authentication requirements and data handling regulations
- **Decisions** about specific security implementations (rate limiting approach, CSP configuration)
- **OPENs** about complex security scenarios that need research (specific RTDB rule patterns, CSP policies)

## Depth Signals

You're going deep enough when:
- Every data write path has been examined for authorization
- Firebase RTDB rules have been explicitly discussed
- User input handling has been assessed for XSS and injection
- The "worst case scenario" has been named and its impact assessed
- At least one attacker-mindset scenario has been explored

You're too shallow when:
- Security discussed as "Firebase handles that"
- RTDB rules not examined
- Input validation not discussed
- No attacker-mindset thinking
- Only authentication examined, not authorization (who can do what)

## Session Flow

1. Load active concepts — especially architecture, authentication, and data decisions
2. Inventory the attack surface: inputs, endpoints, visible data
3. Assess authentication and authorization: who can see and do what
4. Review Firebase-specific security: RTDB rules, Cloud Functions auth, data validation
5. Check data protection: PII inventory, encryption, retention, privacy policy
6. Examine input validation: XSS, injection, rate limiting
7. Assess dependency security: CDN trust, known vulnerabilities, CSP
8. Run incident scenarios: worst case, detection, response
9. Synthesize: what's the security posture, what must be fixed before launch, what's acceptable risk`;


// ═══════════════════════════════════════════════════════════════════════
// Skills 25–26: Routing Infrastructure
// ═══════════════════════════════════════════════════════════════════════

const SKILL_ROUTER = `# Skill Router — What Gets Loaded When

## How This Works
This skill is the single source of truth for which skills to read for any action.
Read this once at startup. Reference from memory. Re-read on compaction recovery.

## Quick Reference (Embedded)

These are the key facts for immediate orientation. This is enough for ideation sessions. For infrastructure/maintenance work, load only the section you need:

\\\`\\\`\\\`
Call: repo_file
  repo: "stewartdavidp-ship-it/command-center"
  path: "ARCHITECTURE.md"
  section: "## Index"
\\\`\\\`\\\`
Then load specific sections via \`section="## Section Name"\`.

| Item | Value |
|------|-------|
| CC app | Single-file HTML (\`index.html\`), React via CDN, Firebase RTDB |
| MCP server | Express + MCP SDK on Cloud Run (\`us-central1\`) |
| Firebase project | \`word-boxing\` |
| GitHub repo | \`stewartdavidp-ship-it/command-center\` |
| GH Pages | \`stewartdavidp-ship-it.github.io/command-center-test/\` |

### Auth Model
| Client | Method |
|--------|--------|
| CC Browser | Firebase Auth (Google Sign-In) |
| Claude.ai Chat | OAuth 2.1 with PKCE |
| Claude Code CLI | CC API Key (\`cc_{uid}_{secret}\`) |

### Safety Rules (Do Not Violate)
1. All \`.on('value')\` listeners MUST use \`limitToLast(N)\` — unbounded listeners caused $17/day billing crisis
2. Never create polling scripts for \`document(receive)\` — use MCP tools inline
3. \`domainProxy\` requires Firebase Auth token — all call sites pass Bearer token
4. Deploy Firebase Functions with \`--only functions:NAME\` — bare \`--only functions\` deletes Game Shelf functions

### MCP Tools Available
| Tool | Purpose |
|------|---------|
| app | App CRUD and discovery |
| concept | ODRC concept CRUD with state machine |
| idea | Idea lifecycle management |
| session | Ideation session tracking |
| job | Build job management |
| document | Inter-agent messaging (Chat ↔ Code) |
| generate_claude_md | CLAUDE.md generation and delivery |
| skill | Skill content retrieval |
| repo_file | Fetch files from GitHub repos (read-only) |

## Skill Catalog — Keyword + Intent Routing

Each entry has keywords for matching and an intent statement describing when to load it.

### Onboarding

**cc-startup-checklist**
Keywords: startup, cold start, new conversation, profile, onboarding
Intent: Chat agent starting a new conversation — run mandatory cold start sequence
Surface: Chat

**cc-code-startup-checklist**
Keywords: startup, cold start, messages, jobs, documents
Intent: Code agent starting a new session — check messages, documents, draft jobs
Surface: Code

**cc-cowork-startup-checklist**
Keywords: startup, cold start, messages, router, cowork
Intent: Cowork agent starting a new session — load router, check messages, opt-in session capture
Surface: Cowork

**cc-tutorial**
Keywords: tutorial, onboard, learn, teach, getting started, walkthrough
Intent: User wants guided onboarding through a hands-on CC tutorial
Surface: Chat

### Ideation

**cc-odrc-framework**
Keywords: ODRC, concept, open, decision, rule, constraint, capture
Intent: User wants to create, classify, or transition ODRC concepts during ideation
Surface: Chat

**cc-session-structure**
Keywords: session, ideation, start session, wrap up, done, close
Intent: User wants to start, manage, or close an ideation session
Surface: Chat

**cc-session-protocol**
Keywords: session, protocol, enrichment, mismatch, flush, auto-created
Intent: Master session protocol — how to run a session end-to-end (Chat)
Surface: Chat

**cc-mode-exploration**
Keywords: explore, discovery, brainstorm, diverge, what if, open-ended
Intent: User wants open-ended exploration to surface OPENs and early decisions
Surface: Chat

**cc-lens-technical**
Keywords: technical, architecture, feasibility, implementation, dependencies, risk
Intent: Run technical lens — probe feasibility, architecture, and implementation risk
Surface: Chat

**cc-lens-stress-test**
Keywords: stress, break, edge case, failure, what breaks, pressure
Intent: Run stress test lens — find what breaks in existing decisions
Surface: Chat

**cc-lens-voice-of-customer**
Keywords: user, persona, journey, retention, customer, audience
Intent: Run voice-of-customer lens — persona analysis, journey mapping, retention
Surface: Chat

**cc-lens-competitive**
Keywords: competitive, competitor, differentiation, positioning, market
Intent: Run competitive lens — competitive analysis and positioning
Surface: Chat

**cc-lens-economics**
Keywords: cost, economics, effort, ROI, budget, maintenance, pricing
Intent: Run economics lens — cost analysis, effort estimation, ROI
Surface: Chat

**cc-lens-integration**
Keywords: integration, ecosystem, coupling, dependency, contract, cross-app
Intent: Run integration lens — cross-app data coupling and ecosystem impact
Surface: Chat

**cc-lens-ux-deep-dive**
Keywords: UX, user flow, navigation, interaction, loading, transition, mobile
Intent: Run UX deep-dive lens — screen-by-screen walkthrough and user flows
Surface: Chat

**cc-lens-content**
Keywords: content, information architecture, editorial, quality, lifecycle
Intent: Run content lens — content strategy and information architecture
Surface: Chat

**cc-lens-growth**
Keywords: growth, distribution, acquisition, SEO, social, viral, sharing
Intent: Run growth lens — distribution strategy and measurement
Surface: Chat

**cc-lens-accessibility**
Keywords: accessibility, WCAG, keyboard, screen reader, contrast, cognitive
Intent: Run accessibility lens — compliance audit and inclusive design
Surface: Chat

**cc-lens-operations**
Keywords: operations, monitoring, analytics, health check, deployment, incident
Intent: Run operations lens — post-launch observability and verification
Surface: Chat

**cc-lens-security**
Keywords: security, privacy, auth, attack, Firebase rules, vulnerability, XSS
Intent: Run security lens — attack surfaces, authorization, data protection
Surface: Chat

### Handoff

**cc-spec-generation**
Keywords: CLAUDE.md, spec, generate, push, specification, document
Intent: User wants to generate and optionally push a CLAUDE.md to a repo
Surface: Chat

**cc-job-creation-protocol**
Keywords: job, build, spec, code, handoff, submit, draft job
Intent: User wants to package decisions into a build job for Code
Surface: Chat

### Build

**cc-build-protocol**
Keywords: build, implement, code, claim, execute, deploy, job
Intent: Code agent has a job to execute — master build protocol
Surface: Code

**cc-build-hygiene**
Keywords: hygiene, cleanup, post-build, graduation, complete, close job
Intent: Build is done — run post-build concept cleanup and idea graduation
Surface: Code

**cc-mcp-workflow**
Keywords: workflow, lifecycle, end-to-end, Chat Code, interaction, pipeline
Intent: Understand the full Chat → Code lifecycle and how agents interact via MCP
Surface: Both

### Coordination

**cc-protocol-messaging**
Keywords: message, send, receive, inter-agent, Chat Code, notification
Intent: Agent needs to send/receive messages between surfaces
Surface: Both

**cc-skill-creation**
Keywords: skill, create skill, new skill, add skill, router entry, naming
Intent: User wants to define a new CC skill — content, format, router entry, build job
Surface: Chat

### Recovery

**cc-session-resume**
Keywords: resume, compaction, recovery, lost context, session restore, orphan
Intent: Chat session hit compaction or needs to recover from context loss
Surface: Chat

**cc-build-resume**
Keywords: resume, compaction, recovery, lost context, build restore
Intent: Code build hit compaction — recover job state and continue
Surface: Code

**cc-session-continuity**
Keywords: continue, pick up, left off, existing idea, resume work
Intent: New conversation continuing work on an existing idea
Surface: Chat

### Meta

**cc-skill-router**
Keywords: router, skill list, which skill, routing, catalog, prompt
Intent: Determine which skill to load for a given trigger or user request
Surface: Both

**cc-retro-journal**
Keywords: retro, journal, learning, discovery, reflection, insight
Intent: Record or read genuine discoveries that change future behavior
Surface: Both

### Other

**cc-acc-video**
Keywords: episode, video, animation, HTML to MP4, landing page, Descript, segment
Intent: User wants to create ACC landing page video episodes — HTML animations to MP4
Surface: Code

## System-Level Triggers (No User Action Required)

These triggers are detected automatically by the agent, not triggered by user keywords:

| Trigger | Skill(s) to Load |
|---|---|
| Cold start (Chat) | cc-startup-checklist |
| Cold start (Code) | cc-code-startup-checklist |
| Cold start (Cowork) | cc-cowork-startup-checklist |
| Compaction detected (Chat) | cc-session-resume + cc-skill-router |
| Compaction detected (Code) | cc-build-resume + cc-skill-router |
| _session.autoCreated in tool response | cc-session-protocol |
| _session.mismatch in tool response | cc-session-protocol |
| Session close with pendingFlush | cc-session-protocol |
| projectInstructionsDirty from profile | cc-session-protocol |
| Stale/orphan session at startup | cc-session-resume |
| Fresh start / claim job (Code) | cc-build-protocol + cc-skill-router + cc-retro-journal |
| Infra / maintenance task (Code) | cc-build-protocol + cc-skill-router + repo_file(ARCHITECTURE.md) |
| Job complete (Code) | cc-build-hygiene |`;


const SKILL_JOB_CREATION_PROTOCOL = `# Job Creation Protocol — How Chat Creates Jobs for Code

This skill defines the standard process for creating well-formed build jobs that Claude Code can claim and execute. Follow this protocol whenever you create a job via the MCP server.

## When to Use This Skill

- You've reached a point in an ideation session where decisions are ready to be built
- The user says "create a job", "submit for build", "spec this out for Code"
- You've accumulated enough DECISIONs and resolved enough OPENs for a focused build

## Step 1: Scope the Job

**One focused deliverable per job.** If you have multiple features to build, create multiple jobs.

Ask yourself:
- What is the single outcome of this job?
- Can Code complete this in one session (roughly)?
- Are all blocking OPENs resolved?

If OPENs remain that would block the build, resolve them first or explicitly exclude that scope.

## Step 2: Select the Job Type

| Type | When to Use |
|---|---|
| build | New features, new capabilities, new UI |
| maintenance | Reviews, fixes, refactoring, tech debt |
| test | Test-only changes, E2E additions |
| skill-update | Skill content changes (no server code) |
| cleanup | Housekeeping, file cleanup, dead code removal |

## Step 3: Write the Instructions

Use this standard format:

\\\`\\\`\\\`markdown
## Build Objective
[1-2 sentences: what this job produces]

## What to Build
### 1. [First deliverable]
[Detailed spec with code examples if helpful]

### 2. [Second deliverable]
[Details]

## What NOT to Build
- [Explicitly exclude adjacent work]
- [Prevent scope creep]

## Concepts Addressed
These concept IDs should be marked as addressed on completion:
- \\\`-conceptId1\\\` (description)
- \\\`-conceptId2\\\` (description)

## App-Specific Artifacts to Update
- [List any files that need updating as a side effect of this build]
- Examples: ARCHITECTURE.md (if adding skills/changing structure), README (if setup steps change), config files (if new env vars needed)
\\\`\\\`\\\`

**Note on artifacts:** Generic build steps (concept updates, running tests, deploying) are handled by Code's standard process and should NOT be restated in instructions. Only list app-specific side effects that Code wouldn't know to do on its own.

### Instructions Quality Checklist
- [ ] Build objective is specific and testable
- [ ] Each deliverable has enough detail to implement without guessing
- [ ] "What NOT to Build" prevents scope creep
- [ ] Concept IDs listed for Code to pass at completion time
- [ ] App-specific artifacts listed (e.g., ARCHITECTURE.md if adding a skill)

## Step 4: Build the Concept Snapshot

Include the relevant active DECISIONs, RULEs, and CONSTRAINTs from the current session context as the \`conceptSnapshot\` field. This gives Code the decision context without requiring a full concept fetch.

Format: \`{ "decisions": ["-id1", "-id2"], "rules": ["-id3"], "constraints": ["-id4"] }\`

Include:
- All DECISIONs that inform this specific build
- All RULEs that constrain the build
- Relevant CONSTRAINTs (external realities Code must respect)
- Do NOT include OPENs — those should be resolved before the job is created

## Step 5: Create the Draft Job

\\\`\\\`\\\`
Call: job
  action: "start"
  appId: [the app ID]
  title: "[Type]: [Brief description]"
  ideaId: [the active idea ID]
  jobType: [build/maintenance/test/skill-update/cleanup]
  createdBy: "claude-chat"
  instructions: [the formatted instructions from Step 3]
  conceptSnapshot: [JSON string from Step 4]
  conceptsAddressed: [array of concept IDs — NOTE: if the server doesn't support this on start yet, list them in the instructions for Code to include at completion]
\\\`\\\`\\\`

## Step 6: Notify Code

After creating the job, send a message to Code:

\\\`\\\`\\\`
Call: document
  action: "send"
  to: "claude-code"
  createdBy: "claude-chat"
  content: "New [jobType] job posted: [title]. Job ID: [jobId]. Ready for claim."
\\\`\\\`\\\`

## Step 7: Attach Supporting Documents (Optional)

If the build needs a CLAUDE.md or other spec documents:

\\\`\\\`\\\`
Call: generate_claude_md
  action: "push"
  appId: [the app ID]
\\\`\\\`\\\`

This queues a fresh CLAUDE.md for Code to pick up via the document workflow.

## Common Mistakes to Avoid

- **Don't combine multiple features into one job** — scope creep kills builds
- **Don't leave OPENs unresolved in scope** — Code can't make ideation decisions
- **Don't skip conceptSnapshot** — Code needs decision context
- **Don't forget "What NOT to Build"** — explicit exclusions prevent drift
- **Don't put concept IDs only in instructions text** — list them in conceptsAddressed array so the auto-transition system works at completion time (workaround: if not supported on start, Code can pass them at completion)
- **Don't create jobs without an ideaId** — jobs must be linked to the idea they serve
- **Don't restate generic build steps in instructions** — concept updates, tests, and deploys are Code's standard process. DO explicitly list app-specific artifacts that need updating (ARCHITECTURE.md, README, config files) since Code won't know these automatically`;


// ═══════════════════════════════════════════════════════════════════════
// Skill 27: Retrospective Journal — shared learning surface for Chat + Code
// ═══════════════════════════════════════════════════════════════════════

const SKILL_RETRO_JOURNAL = `# CC Retrospective Journal

A shared learning surface for Chat and Code. Both agents read this on startup. Entries capture genuine discoveries that change future behavior — not routine observations.

## Write Rules
- Only write an entry when something genuinely surprising or non-obvious was learned
- The bar: "Would a future Chat or Code instance make a worse decision without knowing this?"
- If the answer is no, don't write. This is not a log.
- Max 2-3 sentences per entry. Include date, job ref, and who learned it.

## Size Rules
- Total skill: under 60 lines
- Distilled Patterns: max ~20 lines
- Recent Entries: max ~10 entries (~30 lines)
- When Recent Entries exceeds 10: consolidate — distill patterns, prune consumed entries

---

## Distilled Patterns

1. **Code sees what Chat imagines.** Chat works from described architecture; Code sees actual code. For scope analysis, dependency mapping, or dead code discovery — dispatch to Code with a review job, don't estimate in Chat.

2. **One question can collapse complexity.** Before planning around assumed requirements, verify assumptions still hold with the user. A single strategic question eliminated an entire build phase.

3. **CC data shapes are objects, not arrays.** \\\`apps\\\` is keyed by app ID (\\\`apps[appId]\\\`), not iterable (\\\`apps.find()\\\`). Same for \\\`concepts\\\`, \\\`sessions\\\`, \\\`jobs\\\`. Always use bracket notation.

---

## Recent Entries

**2026-02-19** | Firebase cost crisis | infrastructure-gotcha
Background polling scripts outlived sessions — 3 scripts at 10s intervals, ~1MB/call, $17/day. NEVER create persistent background processes. All MCP calls happen inline. Every Firebase query MUST use server-side filtering.

**2026-02-19** | Phase 2 deploy | deploy-gotcha
\\\`gh api\\\` with \\\`-f content=@file\\\` silently truncates files >100KB. For large files, use \\\`--input\\\` with a JSON payload file. Always verify blob size after creation.`;


// ═══════════════════════════════════════════════════════════════════════
// Skill 28: Startup Checklist — mandatory cold start sequence for Chat
// ═══════════════════════════════════════════════════════════════════════

const SKILL_STARTUP_CHECKLIST = `# Startup Checklist

**Your surface identity: \\\`claude-chat\\\`**
Use this as your \\\`createdBy\\\` when calling \\\`document(action="send")\\\` or \\\`job(action="start")\\\`. Use it as \\\`to\\\` when calling \\\`document(action="receive")\\\`.

**Piggyback message notifications:** Every MCP tool response may include \\\`_pendingMessages\\\` metadata listing unread messages for all surfaces. Each message has \\\`to\\\`, \\\`from\\\`, and \\\`subject\\\` fields. If you see messages where \\\`to: "claude-chat"\\\`, call \\\`document(action="receive", to="claude-chat", summary=true)\\\` to get envelopes first (saves tokens). Then use \\\`document(action="get", docId=...)\\\` to read full content only for messages you need. Present relevant ones to the user.

You MUST complete every step below before responding to the user's first message. Do not skip steps. Do not address the user's request until all blockers are cleared.

## Step 1: Profile Check

\\\`\\\`\\\`
Call: session(action="profile")
\\\`\\\`\\\`

Check the response for two flags:

### 1a. projectInstructionsDirty

If \\\`true\\\` — **BLOCKER. Stop everything.**

1. Tell the user: "Your project instructions need updating before we can proceed."
2. Call \\\`document(action="get-latest", type="project-instructions")\\\` to fetch the latest version.
3. Output the content as a downloadable markdown file so the user can copy it.
4. Wait for the user to confirm they've pasted it into their Claude project settings.
5. Call \\\`session(action="profile", clearInstructionsDirty=true)\\\` to clear the flag.
6. Only then continue to Step 2.

### 1b. showTutorial

If \\\`true\\\` — the user hasn't seen the onboarding tutorial yet.

After completing ALL other startup steps (2-6), present a widget BEFORE the opening message:

> **Welcome to Command Center!** Want a hands-on tutorial that walks you through the full workflow by building a real app? (~20 min)
>
> **Yes, let's go!** / **Skip for now**

- Either choice: call \\\`session(action="profile", clearShowTutorial=true)\\\` to clear the flag
- "Yes" → load \\\`cc-tutorial\\\` skill and begin the tutorial flow
- "Skip" → tell the user they can say "start tutorial" anytime, then continue with the normal opening message

### 1c. needsAttention

If \\\`true\\\` — note it, but not a blocker. Mention it to the user after startup completes.

## Step 2: Check for In-Flight Work

\\\`\\\`\\\`
Call: job(action="list", status="review", limit=5)
Call: job(action="list", status="draft", createdBy="claude-chat", limit=5)
\\\`\\\`\\\`

- **Review jobs**: Code flagged concerns. Present them to the user — these need resolution before new work starts.
- **Draft jobs**: Chat-created specs waiting for Code to claim. Mention them as FYI.

## Step 3: Check Messages

\\\`\\\`\\\`
Call: document(action="receive", to="claude-chat")
\\\`\\\`\\\`

Pick up any messages from Code. Present relevant ones to the user (e.g., build questions, review completions).

## Step 4: Session Orientation

The MCP server auto-creates sessions on any tool call. Watch for \\\`_session\\\` metadata in every response:

- \\\`_session.autoCreated: true\\\` → Enrich immediately with \\\`session(action="update")\\\` — set title, mode, sessionGoal, activeIdeaId, activeAppId, presentationMode.
- \\\`_session.mismatch: true\\\` → Present the conflict to the user. Let them choose: continue existing or complete and start fresh.
- \\\`_session.staleClosed\\\` → Inform the user their old session was auto-closed.

Check for the last completed session on the same app/idea to inherit \\\`closingSummary\\\` and \\\`nextSessionRecommendation\\\`.

## Step 5: Load Active Context

\\\`\\\`\\\`
Call: idea(action="get_active", appId=[active app])
Call: list_concepts(grouped=true, ideaId=[active idea])
\\\`\\\`\\\`

Summarize briefly: current idea, count of active concepts by type, unresolved OPENs.

## Step 6: Present Opening

Combine everything into a single opening message:

1. Any blockers encountered and resolved (dirty flag, review jobs)
2. Messages from Code (if any)
3. Session context (continuing from last session's recommendation, or fresh start)
4. Active idea + concept summary
5. Present 2-3 focus options and ask the user to choose

---

## Budget Tracking Reference

Track every turn: \\\`📊 Budget: [est total]K / [zone] / [headroom]\\\`

### Sources to Count

| Source | Estimate |
|--------|----------|
| System overhead | ~85K fixed |
| MCP tool responses | Sum \\\`_responseSize\\\` from each call |
| Web search | ~10K per call |
| Web fetch | Use \\\`text_content_token_limit\\\` or estimate ~3-5K |
| Conversation history | All prior user + assistant messages |
| Past chat search | ~3-5K per call |
| Image search | ~1K per call |

### Rules
- \\\`_contextHealth.used\\\` and \\\`.ceiling\\\` from tool responses are authoritative — override estimates
- Flag any single MCP response over 10K: \\\`⚠️ last call: [size]\\\`
- Call out zone transitions explicitly
- Write budget to memory every ~5 turns: \\\`"CC budget: [total]K / [zone]. Session: [sessionId]"\\\`
- Remove budget entry from memory when session closes

### Estimation Shortcuts
- Assistant output: ~1.5K short, ~3K medium, ~5K+ long
- User messages: ~0.1-0.5K typical
- 3 web searches ≈ 30K

### Baseline
~53K tool total after standard startup. ~138K with system overhead. ~486K runway to compaction.

---

## Compaction Recovery Protocol

Compaction replaces conversation history with a lossy summary. System prompt, project instructions, and memory survive. Each cycle degrades quality.

### Detection
Both must be true:
1. Memory contains a budget snapshot with a session ID
2. First MCP \\\`_contextHealth.used\\\` is significantly lower than the memory value

### Recovery Sequence (mandatory, in order)
1. \\\`session(get, sessionId)\\\` from memory — restores goal, mode, idea/app
2. \\\`list_concepts(grouped=true, ideaId)\\\` — restores current truth
3. Check session's \\\`pendingFlush\\\` for documents awaiting delivery
4. \\\`job(list, status=active)\\\` + \\\`job(list, status=draft)\\\` — checks in-flight work
5. Note \\\`_contextHealth.used\\\` as new budget baseline

### Post-Recovery Message
> ⚠️ **Compaction detected** (cycle [N]). Structured state reloaded — session, concepts, and jobs are current. Conversational reasoning from earlier turns is degraded.
>
> **New budget baseline:** [used] / [zone] / [headroom]
>
> I can continue with straightforward tasks. For complex ideation or design work, a fresh chat will give better results.

### Cycle Tracking
Update memory: \\\`"CC budget: [total]K / [zone]. Session: [id]. Compaction: [N]"\\\`
At cycle 3+, strongly recommend a fresh chat.

---

## Skill Router Quick Reference

| Trigger | Skill(s) to Load |
|---|---|
| "start tutorial" | cc-tutorial |
| "start ideation [idea/app]" | cc-odrc-framework, cc-session-structure |
| "run [name] lens" | cc-lens-{name} |
| "start exploration" | cc-mode-exploration |
| "create draft job" / build spec | cc-job-creation-protocol |
| "generate CLAUDE.md" | cc-spec-generation |
| "wrap up" / "done" | cc-session-structure (close section) |
| "continue where we left off" | cc-session-continuity |
| "capture [concept]" | cc-odrc-framework |
| Compaction detected | cc-startup-checklist + cc-session-resume |

### On Session/Job Close
Consider cc-retro-journal for genuine discoveries (delegation insights, process improvements, collapsed assumptions).

### Output Rules
Never read docx/pptx/xlsx SKILL.md files. Output reports as markdown (.md). No Word docs unless explicitly requested.`;


// ═══════════════════════════════════════════════════════════════════════
// Skill 29: Tutorial — Guided onboarding through 9 steps
// ═══════════════════════════════════════════════════════════════════════

const SKILL_TUTORIAL = `# CC Tutorial — Guided Onboarding

You are running a guided tutorial that walks the user through the full Command Center workflow by building a real grocery list app. This is a CONVERSATION GUIDE — be natural and fluid, not robotic. Weave feature explanations into the conversation organically.

## Key Principles

- Each step creates real CC artifacts (ideas, concepts, jobs)
- 5 user decision points shape the final app
- Feature callouts woven conversationally, not in formatted boxes
- Track progress via session metadata: \\\`session(action="update", tutorialStep=[1-9])\\\`
- Resume detection: if a "Smart Grocery List" idea already exists with concepts, offer "Resume where you left off?" or "Start fresh?"

## Step 1 — Welcome

Brief intro to CC's value proposition: CC helps you think through ideas rigorously before building. It captures decisions, constraints, and open questions so your build specs are complete and your code agent knows exactly what to build.

Mention: "By the way, CC supports two presentation modes — interactive (with widgets and visual elements) and CLI (text-only). You're currently in interactive mode."

Transition: "Let's build something real. How about a smart grocery list app?"

\\\`session(action="update", tutorialStep=1)\\\`

## Step 2 — Create the Idea

Create the idea:

\\\`\\\`\\\`
Call: idea
  action: "create"
  name: "Smart Grocery List"
  description: "A grocery list app that auto-categorizes items by store department and sorts them by your preferred walking route."
\\\`\\\`\\\`

Tell the user what just happened: "I created an Idea in CC. Ideas are how CC tracks what you're building — they hold all the decisions, constraints, and open questions for a feature. You can see all your ideas anytime by saying 'show my ideas'."

Mention the idea lifecycle: ideas start as standalone, then can be linked to an app when ready to build.

\\\`session(action="update", tutorialStep=2)\\\`

## Step 3 — Validation (First Decision Point)

**USER DECISION: Which store?**

Present a widget with common grocery store options:
- Trader Joe's
- Whole Foods
- Kroger / Ralphs
- Target
- Costco

After the user picks, create a DECISION concept:

\\\`\\\`\\\`
Call: concept
  action: "create"
  type: "DECISION"
  content: "Target store: [user's choice]. The app's department taxonomy and aisle layout will be modeled after this store's typical organization."
  ideaOrigin: [ideaId]
  scopeTags: ["ux", "data-model"]
\\\`\\\`\\\`

Then create an OPEN question:

\\\`\\\`\\\`
Call: concept
  action: "create"
  type: "OPEN"
  content: "Can we reliably categorize grocery items into store departments? What taxonomy should we use?"
  ideaOrigin: [ideaId]
  scopeTags: ["data-model", "research"]
\\\`\\\`\\\`

Explain naturally: "I just created two things in CC — a DECISION and an OPEN. CC uses four concept types: OPENs are unresolved questions, DECISIONs are choices we've made, RULEs are things that must never be violated, and CONSTRAINTs are external realities we can't change. Together they're called ODRC — it's how CC keeps your thinking organized. You can always say 'show my concepts' to see them."

\\\`session(action="update", tutorialStep=3)\\\`

## Step 4 — Research

Do a web search for grocery categorization data:

\\\`\\\`\\\`
Web search: "grocery item categorization taxonomy dataset departments aisles"
\\\`\\\`\\\`

Create a knowledge tree and node with the findings:

\\\`\\\`\\\`
Call: knowledge_tree
  action: "create_tree"
  name: "Grocery Categorization Research"
  description: "Research into grocery item taxonomies and department structures"

Call: knowledge_node
  action: "create"
  treeId: [treeId]
  question: "What taxonomy exists for categorizing grocery items by department?"
  content: "[Summarize findings — mention Instacart dataset: 134 aisles, 21 departments, ~50K products. Note that a simplified version (15-20 departments) would work well for our app.]"
  trust: "credible"
  keyFinding: "Instacart's public dataset provides a proven taxonomy: 21 departments covering all grocery categories"
  sources: "[JSON array with source URLs]"
\\\`\\\`\\\`

Now transition the OPEN to a DECISION with evidence:

\\\`\\\`\\\`
Call: concept
  action: "transition"
  conceptId: [the OPEN concept ID]
  newType: "DECISION"

Call: concept
  action: "supersede"
  conceptId: [the now-DECISION concept ID]
  newContent: "Use a simplified Instacart-derived taxonomy with ~20 departments. Items will be categorized using keyword matching against department names and common items."

Call: concept
  action: "add_knowledge_ref"
  conceptId: [conceptId]
  nodeId: [nodeId]
  treeId: [treeId]
  treeName: "Grocery Categorization Research"
  relationship: "supports"
\\\`\\\`\\\`

Explain: "I just did something important — I turned that open question into a decision, backed by research. CC tracks this provenance so you always know WHY a decision was made. Knowledge trees store your research so it's reusable across ideas. Say 'show research' anytime to see what's been collected."

### Competitive Quick-Look

Before moving to UX, do a brief competitive callout: "Before we design the UX, let's see what's already out there. Google Keep is the obvious baseline — it handles lists but has zero grocery intelligence. No auto-categorization, no aisle sorting. That's our differentiation."

Create a DECISION capturing competitive positioning:

\\\`\\\`\\\`
Call: concept
  action: "create"
  type: "DECISION"
  content: "Google Keep as UX baseline — match its simplicity for list management, beat it on smart categorization and store-aware aisle sorting."
  ideaOrigin: [ideaId]
  scopeTags: ["competitive", "ux"]
\\\`\\\`\\\`

Explain lenses: "What we just did is a quick competitive lens — focused analysis of what's already out there and where we can win. CC has a full set of lenses you can run during any session: competitive, technical, economics, accessibility, and more. Say 'run competitive lens' in a real session for a deeper analysis."

\\\`session(action="update", tutorialStep=4)\\\`

## Step 5 — UX Lens (Two Decision Points)

**USER DECISION: App name**

Ask: "What should we call your grocery app? Something fun like 'CartSmart' or 'AislePilot'? Or type your own name."

Create a DECISION with their choice.

**USER DECISION: Store walk order**

Present a widget:
- Perimeter first (produce → deli → dairy → meat, then center aisles)
- Aisle by aisle (systematic left-to-right sweep)
- Wander freely (no specific order — group by department only)

Create a DECISION with their choice.

Mention: "This is another lens in action — the UX lens. Each lens brings a different perspective to the same idea."

\\\`session(action="update", tutorialStep=5)\\\`

## Step 6 — Technical Lens (Two Decision Points)

**USER DECISION: Pick 2 features**

Present a multi-select widget:
- ⭐ Favorites / frequent items
- 🔢 Quantity tracking
- 💰 Budget estimate per trip
- 👥 Shared list (family sync)

Create DECISIONs for the two selected features.

Create a CONSTRAINT:

\\\`\\\`\\\`
Call: concept
  action: "create"
  type: "CONSTRAINT"
  content: "Tutorial app scope limit: core categorization + sorting + 2 optional features. No external APIs, no authentication, local storage only."
  ideaOrigin: [ideaId]
  scopeTags: ["architecture", "scope"]
\\\`\\\`\\\`

Explain: "That CONSTRAINT is different from a DECISION — it's an external reality we're working within. The tutorial app needs to be buildable in one shot, so we're capping scope. In real projects, constraints come from things like budget, timeline, API limitations, or platform requirements."

**USER DECISION: Visual theme**

Present a widget:
- 🌙 Clean light
- 🌑 Dark mode
- 🏪 Store-branded colors (uses the selected store's palette)
- 🎨 Colorful / playful

Create a DECISION with their choice.

If the user selected "Budget estimate" as one of their features, call it out: "Nice pick on the budget feature — that'll add real utility. We'll track price estimates per item and show a running trip total."

\\\`session(action="update", tutorialStep=6)\\\`

## Step 7 — Spec Build

Compile all decisions into a job. First, read back all concepts:

\\\`\\\`\\\`
Call: list_concepts
  grouped: true
  ideaId: [ideaId]
\\\`\\\`\\\`

Then create the job:

\\\`\\\`\\\`
Call: job
  action: "start"
  appId: "tutorial-grocery-app"
  ideaId: [ideaId]
  title: "Build Smart Grocery List App"
  createdBy: "claude-chat"
  instructions: "[Compile all decisions into a build spec — include store name, app name, walk order, 2 selected features, theme, department taxonomy, scope constraints. Specify: single HTML file, React via CDN, local storage, static Instacart-derived taxonomy embedded, no external APIs.]"
\\\`\\\`\\\`

Show the user what's in the spec — summarize the key decisions and how they map to what will be built.

Mention: "This is what CC calls a 'job' — it's the handoff artifact between Chat (where we think) and Code (where we build). The spec captures every decision we made so Code knows exactly what to build. CC can also generate a CLAUDE.md file that gives Code full project context — say 'generate CLAUDE.md' in a real session."

\\\`session(action="update", tutorialStep=7)\\\`

## Step 8 — Handoff to Code

Send a message to Code:

\\\`\\\`\\\`
Call: document
  action: "send"
  to: "claude-code"
  createdBy: "claude-chat"
  content: "Tutorial job ready for build. Job ID: [jobId]. App: tutorial-grocery-app. This is the onboarding tutorial — build the grocery list app per the job spec."
  metadata: {"jobId": "[jobId]", "appId": "tutorial-grocery-app", "ideaId": "[ideaId]", "tutorial": true}
\\\`\\\`\\\`

Tell the user:

"I've sent the build spec to Claude Code. Here's what to do next:

1. Open Claude Code (in your terminal or IDE)
2. Say: **'Chat sent a message'**
3. Code will pick up the job, read the spec, and build your grocery app

When Code is done, it'll send a message back. Come back here and say **'Code sent a message'** — I'll review the build against our spec."

Explain the messaging system: "CC uses a message queue so Chat and Code can communicate asynchronously. Neither needs to be running at the same time — messages wait until the other picks them up."

\\\`session(action="update", tutorialStep=8)\\\`

## Step 9 — Review (triggered when user returns)

When the user comes back and says "Code sent a message" or similar:

\\\`\\\`\\\`
Call: document
  action: "receive"
  to: "claude-chat"
\\\`\\\`\\\`

Read Code's completion message. Then review the build against the spec:

- Check each decision is reflected in the app
- Note anything Code flagged or deviated from
- If the job included a deploy URL or file path, share it with the user

Tell the user: "This is the maker/checker pattern — Chat creates the spec (maker), Code builds it, then Chat reviews (checker). This ensures nothing gets lost between thinking and building."

\\\`session(action="update", tutorialStep=9)\\\`

## Completion

Summarize what the user learned:
1. **Ideas** — How CC tracks what you're building
2. **ODRC** — The four concept types that organize your thinking
3. **Knowledge trees** — Research storage with evidence linking
4. **Lenses** — Focused analysis tools for different perspectives
5. **Jobs** — The handoff between Chat and Code
6. **Messages** — Async communication between agents
7. **Maker/checker** — The review cycle that catches gaps
8. **Cleanup** — How to clean up artifacts when you're done with an idea

### Cleanup

Present a cleanup choice widget:
- 🧹 Clean up (recommended) — remove all tutorial artifacts
- 📦 Keep everything — tutorial artifacts stay as reference

If user picks "Keep everything": say "Your tutorial idea, concepts, research, and grocery app will stay in your project as reference. You can always delete them later." Then present the closing widget below.

If user picks "Clean up":

1. Create a cleanup job for Code:

\\\`\\\`\\\`
Call: job
  action: "start"
  appId: "tutorial-grocery-app"
  title: "Tutorial Cleanup"
  createdBy: "claude-chat"
  jobType: "cleanup"
  instructions: "Delete all tutorial artifacts: [list the idea ID, all concept IDs created during the tutorial, the knowledge tree ID, the build job ID, and grocery-app.html from the GitHub Pages repo]. Complete the job when done."
\\\`\\\`\\\`

2. Send message to Code:

\\\`\\\`\\\`
Call: document
  action: "send"
  to: "claude-code"
  createdBy: "claude-chat"
  content: "Tutorial cleanup job ready. Delete all tutorial artifacts per the job spec."
\\\`\\\`\\\`

3. Tell the user: "I've queued a cleanup job. Next time you're in Code, say 'Chat sent a message' and it'll handle the rest."

Then present the closing widget below.

Present a closing widget:
- 🚀 Start my own project
- 📋 Explore CC commands
- 👍 I'm good for now

If "Explore CC commands" — show a quick reference:

| Command | What it does |
|---------|-------------|
| "show my ideas" | List all your ideas |
| "show my concepts" | Show ODRC concepts for current idea |
| "show research" | Browse knowledge trees |
| "start ideation [topic]" | Begin a new ideation session |
| "run [name] lens" | Focused analysis (technical, UX, economics, etc.) |
| "create draft job" | Package decisions into a build spec |
| "generate CLAUDE.md" | Create project instructions for Code |
| "start tutorial" | Replay this tutorial |

If "Start my own project" — transition directly into a new ideation session.`;


// ═══════════════════════════════════════════════════════════════════════
// Skill 30: Code Startup Checklist — Cold start for Claude Code
// ═══════════════════════════════════════════════════════════════════════

const SKILL_CODE_STARTUP_CHECKLIST = `# Code Startup Checklist

**Your surface identity: \\\`claude-code\\\`**
Use this as your \\\`createdBy\\\` when calling \\\`document(action="send")\\\` or \\\`job(action="start")\\\`. Use it as \\\`to\\\` when calling \\\`document(action="receive")\\\`.

**Piggyback message notifications:** Every MCP tool response may include \\\`_pendingMessages\\\` metadata listing unread messages for all surfaces. Each message has \\\`to\\\`, \\\`from\\\`, and \\\`subject\\\` fields. If you see messages where \\\`to: "claude-code"\\\`, call \\\`document(action="receive", to="claude-code", summary=true)\\\` to get envelopes first (saves tokens). Then use \\\`document(action="get", docId=...)\\\` to read full content only for messages you need to act on.

You MUST complete every step below when starting a new session. This is the Code-side equivalent of Chat's cc-startup-checklist.

## Step 1: Check for Messages

\\\`\\\`\\\`
Call: document
  action: "receive"
  to: "claude-code"
\\\`\\\`\\\`

Pick up any pending messages from Chat. These may contain:
- Build instructions or context
- Tutorial handoffs
- Review requests or follow-ups

If messages are found, acknowledge each one:

\\\`\\\`\\\`
Call: document
  action: "ack"
  docId: [each message ID]
\\\`\\\`\\\`

## Step 2: Check for Pending Documents

\\\`\\\`\\\`
Call: document
  action: "list"
  status: "pending"
\\\`\\\`\\\`

Look for pending documents that need local delivery:
- \\\`claude-md\\\` type → deliver to project root as CLAUDE.md
- \\\`spec\\\` type → deliver to the specified targetPath
- \\\`project-instructions\\\` type → notify user to update their project settings

For each document that should be delivered locally:

\\\`\\\`\\\`
Call: document
  action: "deliver"
  docId: [docId]
\\\`\\\`\\\`

## Step 3: Check for Draft Jobs

\\\`\\\`\\\`
Call: job
  action: "list"
  status: "draft"
  limit: 5
\\\`\\\`\\\`

If draft jobs exist:
- Show the user what's available (title, app, creation date)
- If only one draft job, offer to claim it immediately
- If multiple, let the user choose

To claim a job:

\\\`\\\`\\\`
Call: job
  action: "claim"
  jobId: [jobId]
\\\`\\\`\\\`

Also check for active jobs (in case of session recovery):

\\\`\\\`\\\`
Call: job
  action: "list"
  status: "active"
  limit: 5
\\\`\\\`\\\`

## Step 4: Check for Active Jobs (Recovery)

If there are active jobs claimed by this agent, you may be resuming a build. Check the job details and continue where you left off.

## Step 5: Load Build Protocol

If you have a job to work on, load the build protocol:

\\\`\\\`\\\`
Call: skill
  action: "get"
  skillName: "cc-build-protocol"
\\\`\\\`\\\`

Follow the build protocol from the appropriate step based on the job's current state.

## Step 6: Present Status

Tell the user what you found:
- Messages received (if any)
- Documents delivered (if any)
- Jobs available or in progress
- Ready state

If no work is pending, let the user know you're ready for instructions.`;


// ═══════════════════════════════════════════════════════════════════════
// Skill 31: ACC Video Production Pipeline
// ═══════════════════════════════════════════════════════════════════════

const SKILL_ACC_VIDEO = `# ACC Video Production Pipeline

## What This Is

A repeatable workflow for producing AI Command Center (ACC) landing page episode videos. Each episode follows a 5-segment structure and moves through a pipeline: Script → HTML animations → MP4 → Descript (AI images + voiceover) → YouTube → Landing page embed.

Claude builds the HTML animations and converts them to MP4. The user handles Descript, YouTube upload, and provides the YouTube URL for landing page integration.

## Current Build Objective

Given a script for an episode (containing narration text and visual descriptions for 5 segments), produce:

1. **5 animated HTML files** — self-contained 1280×720 HTML pages with CSS animations
2. **5 MP4 files** — screen-captured from the HTML at 30fps using Playwright + ffmpeg

## Architecture Rules (DO NOT VIOLATE)

1. **Canvas is always 1280×720.** Every HTML segment sets \\\`body { width: 1280px; height: 720px; overflow: hidden; }\\\`. No exceptions.

2. **Single-file HTML.** Each segment is one self-contained \\\`.html\\\` file. CSS is inline in \\\`<style>\\\`. No external CSS/JS files. Google Fonts loaded via CDN \\\`<link>\\\` tag.

3. **ACC design system is law.** All colors, fonts, and visual patterns follow the design system spec below. Do not deviate.

4. **Animations are CSS-only with staggered delays.** Use \\\`@keyframes\\\` with \\\`animation-delay\\\` for sequential reveals. No JavaScript animation libraries.

5. **MP4 conversion uses Playwright, not Puppeteer.** Puppeteer downloads x86 Chrome which fails on ARM VMs. Playwright correctly resolves ARM-compatible Chromium.

6. **Marketing images are NOT our job.** The photorealistic conceptual illustrations (glowing trees, sci-fi monitors, etc.) are AI-generated by Descript. Do NOT attempt to create marketing images with HTML/CSS — they will look like static screenshots, which is wrong.

7. **Brand footer on every segment.** \\\`aicommandcenter.dev\\\` in amber monospace text, positioned bottom-right.

## Constraints

- VM may be ARM architecture — Puppeteer will fail, Playwright works
- Google Fonts CDN must be accessible (the HTML loads 3 font families)
- ffmpeg must be installed (typically pre-installed on the VM)
- Playwright + Chromium must be installed per session: \\\`npm install playwright && npx playwright install chromium\\\`
- Each MP4 encode takes ~2-3 minutes per segment (frame capture is the bottleneck)

## Implementation Plan

### Phase 1: Create HTML Animation Segments

For each of the 5 segments, create an HTML file following this template structure:

\\\`\\\`\\\`html
<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box }
body { width: 1280px; height: 720px; overflow: hidden; background: #0c0c14;
       font-family: 'DM Sans', system-ui, sans-serif; position: relative }

/* Background pattern — radial gradients + grid lines */
/* Content layout — typically .left + .right flex panels */
/* Component styles — chat panels, stat blocks, badges, etc. */
/* Animation keyframes + staggered delays */
</style>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,300..700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
</head><body>
<!-- Content here -->
<div class="brand">aicommandcenter.dev</div>
</body></html>
\\\`\\\`\\\`

**File naming:** \\\`ep{N}_01_hook.html\\\` through \\\`ep{N}_05_teaser.html\\\`

**Output location:** User's Downloads folder

### Phase 2: Convert HTML to MP4

**Step 1: Install dependencies (once per session)**
\\\`\\\`\\\`bash
npm install playwright
npx playwright install chromium
\\\`\\\`\\\`

**Step 2: Copy or create the conversion script**

The script (\\\`html2mp4.js\\\`) is bundled at \\\`scripts/html2mp4.js\\\` relative to this skill. It:
- Launches headless Chromium via Playwright
- Opens the HTML at 1280×720 viewport
- Waits 1.5s for fonts to load
- Captures PNG frames at 30fps for the specified duration
- Encodes to MP4 using ffmpeg (libx264, CRF 18, yuv420p)
- Cleans up temporary frames

**Step 3: Run conversion for each segment**
\\\`\\\`\\\`bash
node html2mp4.js ep{N}_01_hook.html ep{N}_01_hook.mp4 10
node html2mp4.js ep{N}_02_pain.html ep{N}_02_pain.mp4 10
node html2mp4.js ep{N}_03_solution.html ep{N}_03_solution.mp4 8
node html2mp4.js ep{N}_04_evidence.html ep{N}_04_evidence.mp4 10
node html2mp4.js ep{N}_05_teaser.html ep{N}_05_teaser.mp4 7
\\\`\\\`\\\`

**Duration rule:** Set duration to the last \\\`animation-delay\\\` value in the CSS + 2 seconds.

### Phase 3: Landing Page Integration (After User Provides YouTube URL)

Add a new video card to the grid in \\\`command-center/landing-page.html\\\`:

\\\`\\\`\\\`html
<div class="video-card">
  <div class="video-wrapper">
    <iframe src="https://www.youtube.com/embed/{VIDEO_ID}"
            title="Episode {N}: {Title}"
            frameborder="0" allow="accelerometer; autoplay; clipboard-write;
            encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerpolicy="strict-origin-when-cross-origin"
            allowfullscreen></iframe>
  </div>
  <h3>Episode {N}: {Title}</h3>
  <p>{Description}</p>
</div>
\\\`\\\`\\\`

Update grid columns if needed (e.g., \\\`repeat(2,1fr)\\\` for 4 videos, \\\`repeat(3,1fr)\\\` for 3 or 6).

## Design System Spec

### Colors
| Token | Hex | Usage |
|-------|-----|-------|
| bg-dark | \\\`#080810\\\` to \\\`#0f1118\\\` | Page backgrounds |
| amber | \\\`#e8a838\\\` | Brand accent, labels, badges |
| teal | \\\`#2dd4bf\\\` | Positive/solution, AI avatar, trust:authoritative |
| blue | \\\`#4d7cff\\\` | User/chat, trust:credible |
| purple | \\\`#8b5cf6\\\` | Hierarchy/structure, forests |
| rose | \\\`#f43f5e\\\` | Warning/conflict, trust:questionable |

All colors at low opacity (0.03-0.08) for backgrounds, medium (0.5-0.9) for text/borders.

### Fonts
| Font | Role | Sizes |
|------|------|-------|
| DM Sans | Body, descriptions, taglines | 10-15px |
| Instrument Serif | Display headings | 36-64px, with italic gradient for emphasis |
| JetBrains Mono | Code, labels, badges, technical | 8-14px |

### Gradient Text (Emphasis Words in Headings)
\\\`\\\`\\\`css
em {
  font-style: italic;
  background: linear-gradient(135deg, #8b5cf6, #f43f5e);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
\\\`\\\`\\\`
Gradient color pairs vary by theme: purple→rose, teal→blue, blue→teal.

### Background Pattern
Every segment uses subtle radial gradients + grid lines:
\\\`\\\`\\\`css
.bg {
  position: absolute; inset: 0;
  background:
    radial-gradient(ellipse at 30% 50%, rgba(ACCENT1, 0.06) 0%, transparent 50%),
    radial-gradient(ellipse at 70% 45%, rgba(ACCENT2, 0.04) 0%, transparent 50%),
    linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
  background-size: 100% 100%, 100% 100%, 28px 28px, 28px 28px;
}
\\\`\\\`\\\`

### Common UI Components

**Chat panels:** Dark panel (rgba(15,18,28,0.95)), 1px border rgba(255,255,255,0.07), rounded corners. Top bar with traffic light dots + session label + badge. User bubble: blue border/bg. AI bubble: teal border/bg.

**Stat blocks:** Large monospace numbers (44px) in accent colors, small muted labels underneath.

**Trust badges:** Authoritative=teal, Credible=blue, Unverified=amber, Questionable=rose. Pill shape, monospace font.

**Brand footer:** \\\`position: absolute; bottom: 20px; right: 40px; font: 400 13px/1 'JetBrains Mono', monospace; color: rgba(232,168,56,0.4);\\\`

### Animation Pattern
\\\`\\\`\\\`css
@keyframes fadeSlideUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
.element {
  opacity: 0;
  animation: fadeSlideUp 0.5s ease forwards;
  animation-delay: 600ms;
}
\\\`\\\`\\\`
- First element: 600ms delay
- Stagger subsequent elements by 400-800ms
- All animations complete before segment duration ends

## Episode Segment Patterns

### 01_hook — Show the Problem
- Typically: two chat panels side-by-side showing contradictory AI responses
- Or: a "before" scenario that reveals the core issue
- Layout: left panel(s) + right editorial (episode number, title, tagline, stats)
- Stats show the damage (e.g., "0 context carried", "2 conflicting recommendations")
- Include a quote from the script

### 02_pain — Why It Hurts
- Typically: a timeline or progression showing degradation
- Steps go from green (good) → amber (uncertain) → red (broken) → ghost (lost)
- Show decisions decaying, evidence disappearing, trust eroding
- Bottom insight quote summarizing the core pain

### 03_solution — ACC's Answer
- Typically: a visual diagram of the feature (tree hierarchy, graph, flow)
- SVG or CSS-based visualization of the data structure
- Right-side info cards explaining the levels/components
- Trust ratings, categorization system, or structural overview

### 04_evidence — Feature in Action
- Typically: a query panel ("Why did we choose X?") + linked evidence nodes
- Shows the traceability chain from decision → evidence sources
- Includes a drift/staleness warning showing the system catching issues
- Bottom quote about the transformation

### 05_teaser — Next Episode Preview
- Two-part layout: left visual (agent diagram, feature preview) + right info
- ACC branding (logo SVG, tagline, URL)
- "Next Episode" badge + episode title with gradient emphasis
- 3 bullet points previewing the next episode's content
- "Episode N — Coming Soon" footer

## Episode History

| Ep | Title | YouTube ID | Status |
|----|-------|-----------|--------|
| 1 | — | m3pkJz_ny2Y | Live |
| 2 | Research Amnesia | ciPLCeNmrak | Live |
| 3 | — | LLwZ87OUTl8 | Live |
| 4 | Knowledge Trees | (pending) | MP4s delivered |

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Puppeteer fails with "ELF: not found" | ARM architecture, x86 binary | Use Playwright instead |
| Fonts not rendering in MP4 | Insufficient wait time | Increase wait to 2000ms+ |
| Animations not captured | Duration too short | Set duration = last delay + 2s |
| ffmpeg not found | Not installed | Should be pre-installed; check \\\`which ffmpeg\\\` |
| npm install fails | No sudo | Use \\\`--break-system-packages\\\` for pip; npm should work without sudo |

## OPENs (Non-blocking)

- Should we batch all 5 conversions into a single script run to reduce browser startup overhead?
- Should the teaser segment for each episode be templated (since the structure is always: branding + next ep preview)?
- Landing page grid layout strategy as episode count grows (currently 3-col, needs rethinking at 6+ episodes)

---

## REFERENCE: Design System

### Canvas

\\\`\\\`\\\`css
body {
  width: 1280px;
  height: 720px;
  overflow: hidden;
  background: #080810;
  font-family: 'DM Sans', system-ui, sans-serif;
  position: relative;
}
\\\`\\\`\\\`

Always \\\`#080810\\\` or \\\`#0f1118\\\` for body background. Never lighter.

### Color Palette

| Token | Hex | RGB for rgba() | Usage |
|-------|-----|-----------------|-------|
| amber | \\\`#e8a838\\\` | \\\`232,168,56\\\` | Brand accent, grid lines, labels, badges, brand footer |
| teal | \\\`#2dd4bf\\\` | \\\`45,212,191\\\` | Positive/solution, AI avatar, trust:authoritative |
| blue | \\\`#4d7cff\\\` | \\\`77,124,255\\\` | User/chat, trust:credible |
| purple | \\\`#8b5cf6\\\` | \\\`139,92,246\\\` | Hierarchy/structure, forests |
| rose | \\\`#f43f5e\\\` | \\\`244,63,94\\\` | Warning/conflict, trust:questionable |
| indigo | \\\`#6366f1\\\` | \\\`99,102,241\\\` | Secondary reference items |

#### Opacity conventions

- **Backgrounds**: 0.02–0.08 (very subtle tints)
- **Borders**: 0.1–0.25
- **Text (accent)**: 0.5–0.9
- **Text (muted body)**: white at 0.3–0.5
- **Text (main body)**: white at 0.45–0.7 or specific muted color like \\\`#8a8a8e\\\`

### Fonts

\\\`\\\`\\\`html
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,300..700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
\\\`\\\`\\\`

| Font | Role | Typical sizes |
|------|------|--------------|
| \\\`'DM Sans', system-ui, sans-serif\\\` | Body text, descriptions, taglines | 10–16px |
| \\\`'Instrument Serif', Georgia, serif\\\` | Display headings, titles | 28–64px, always with \\\`font-weight:400\\\` |
| \\\`'JetBrains Mono', monospace\\\` | Code, labels, badges, technical, counters | 7–14px |

For short monospace labels, you can just use \\\`monospace\\\` (the panels use this).

### Gradient Text for Emphasis

Headings use \\\`<em>\\\` tags with gradient fill:

\\\`\\\`\\\`css
em {
  font-style: italic;
  background: linear-gradient(135deg, COLOR1, COLOR2);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
\\\`\\\`\\\`

Common gradient pairs:
- Purple → Rose: \\\`#8b5cf6, #f43f5e\\\` (conflict, dramatic)
- Blue → Teal: \\\`#4d7cff, #2dd4bf\\\` (solution, positive)
- Teal → Blue: \\\`#2dd4bf, #4d7cff\\\` (alternate positive)
- Amber → Rose: \\\`#e8a838, #f43f5e\\\` (impact, multiplier)

### Background Pattern

Every segment has a \\\`.bg\\\` div with radial gradients and grid lines:

\\\`\\\`\\\`css
.bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 30% 60%, rgba(ACCENT1, 0.05) 0%, transparent 50%),
    radial-gradient(ellipse at 70% 40%, rgba(ACCENT2, 0.04) 0%, transparent 50%),
    linear-gradient(rgba(232,168,56, 0.015) 1px, transparent 1px),
    linear-gradient(90deg, rgba(232,168,56, 0.015) 1px, transparent 1px);
  background-size: 100% 100%, 100% 100%, 32px 32px, 32px 32px;
}
\\\`\\\`\\\`

- Vary ACCENT1 and ACCENT2 based on segment theme (purple/teal for knowledge, blue/amber for comparison, etc.)
- Grid line opacity: 0.012–0.02 (barely visible)
- Grid size: 28–40px (32px is most common)

### Panel / Card Component

The dark panel used for chat sessions, code windows, and info areas:

\\\`\\\`\\\`css
.panel {
  border: 1px solid rgba(232,168,56, 0.15);
  border-radius: 12px;
  background: rgba(10,10,20, 0.8);
  overflow: hidden;
}

.panel-header {
  height: 32px;
  background: rgba(232,168,56, 0.06);
  border-bottom: 1px solid rgba(232,168,56, 0.1);
  display: flex;
  align-items: center;
  padding: 0 14px;
  gap: 6px;
}

/* Traffic light dots */
.dot { width: 7px; height: 7px; border-radius: 50%; background: rgba(232,168,56, 0.25); }

.panel-title {
  font-size: 10px;
  color: rgba(232,168,56, 0.4);
  letter-spacing: 1.5px;
  text-transform: uppercase;
  margin-left: 8px;
  font-family: monospace;
}
\\\`\\\`\\\`

### Chat Message Component

\\\`\\\`\\\`css
.msg {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.msg-avatar {
  width: 28px; height: 28px;
  border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px;
  flex-shrink: 0;
}
.msg-avatar.user { background: rgba(77,124,255,0.15); border: 1px solid rgba(77,124,255,0.25); }
.msg-avatar.ai   { background: rgba(45,212,191,0.15); border: 1px solid rgba(45,212,191,0.25); }

.msg-bubble {
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.6;
  font-family: monospace;
  max-width: 420px;
}
.msg-bubble.user { background: rgba(77,124,255,0.08); border: 1px solid rgba(77,124,255,0.15); color: rgba(77,124,255,0.85); }
.msg-bubble.ai   { background: rgba(45,212,191,0.08); border: 1px solid rgba(45,212,191,0.15); color: rgba(45,212,191,0.85); }
\\\`\\\`\\\`

User avatar shows initial letter (e.g., "D"), AI avatar shows "C".

### Trust Badges

\\\`\\\`\\\`css
.trust-pill {
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 10px;
  font-family: monospace;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.trust-pill.auth  { background: rgba(45,212,191,0.12); color: rgba(45,212,191,0.8); border: 1px solid rgba(45,212,191,0.2); }
.trust-pill.cred  { background: rgba(77,124,255,0.12); color: rgba(77,124,255,0.8); border: 1px solid rgba(77,124,255,0.2); }
.trust-pill.unver { background: rgba(232,168,56,0.12); color: rgba(232,168,56,0.8); border: 1px solid rgba(232,168,56,0.2); }
.trust-pill.quest { background: rgba(244,63,94,0.12); color: rgba(244,63,94,0.8); border: 1px solid rgba(244,63,94,0.2); }
\\\`\\\`\\\`

### Info Cards

Used on the right side of solution/evidence segments:

\\\`\\\`\\\`css
.info-card {
  padding: 16px 20px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.06);
  background: rgba(255,255,255,0.02);
}
.info-card.active {
  border-color: rgba(45,212,191,0.2);
  background: rgba(45,212,191,0.04);
}
.info-label {
  font-size: 11px;
  font-family: monospace;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  margin-bottom: 4px;
}
.info-text {
  font-size: 12px;
  color: rgba(255,255,255,0.45);
  line-height: 1.6;
  font-family: monospace;
}
\\\`\\\`\\\`

### Stat Blocks

Large numbers with labels:

\\\`\\\`\\\`css
.stat-number {
  font-size: 44px;
  font-weight: 300;
  font-family: monospace;
}
.stat-label {
  font-size: 11px;
  color: rgba(255,255,255,0.35);
  font-family: monospace;
  letter-spacing: 0.5px;
}
\\\`\\\`\\\`

### Brand Bars (Teaser Segments Only)

Top branding bar with ACC logo + name:

\\\`\\\`\\\`css
.brand-bar {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 56px;
  display: flex;
  align-items: center;
  padding: 0 36px;
  z-index: 10;
}
.brand-name {
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 15px;
  font-weight: 600;
  color: rgba(255,255,255,0.7);
  margin-left: 12px;
}
.brand-accent { color: #e8a838; }
.brand-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, rgba(232,168,56,0.2), transparent 80%);
  margin-left: 20px;
}
\\\`\\\`\\\`

Bottom bar with tagline and URL:

\\\`\\\`\\\`css
.bottom-bar {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 36px;
}
.bottom-tagline {
  font-size: 12px;
  color: rgba(255,255,255,0.3);
}
.bottom-tagline em {
  font-style: italic;
  font-family: 'Instrument Serif', Georgia, serif;
  font-size: 14px;
  color: rgba(255,255,255,0.45);
}
.bottom-url {
  font-size: 14px;
  font-family: monospace;
  color: rgba(232,168,56,0.55);
}
\\\`\\\`\\\`

The ACC logo SVG (hexagonal cluster):

\\\`\\\`\\\`html
<svg class="brand-logo" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" fill="none" width="32" height="32">
  <polygon points="72,5 94,20 94,50 72,65 50,50 50,20" fill="#e8a838" fill-opacity=".45"/>
  <polygon points="72,5 94,20 94,50 72,65 50,50 50,20" fill="none" stroke="#e8a838" stroke-opacity=".65" stroke-width="3"/>
  <g transform="translate(5.5,3.75)">
    <polygon points="28,5 50,20 50,50 28,65 6,50 6,20" fill="#e8a838" fill-opacity=".2"/>
    <polygon points="28,5 50,20 50,50 28,65 6,50 6,20" fill="none" stroke="#e8a838" stroke-opacity=".25" stroke-width="3"/>
  </g>
  <g transform="translate(0,-15)">
    <polygon points="50,50 72,65 72,95 50,110 28,95 28,65" fill="#e8a838" fill-opacity=".3"/>
    <polygon points="50,50 72,65 72,95 50,110 28,95 28,65" fill="none" stroke="#e8a838" stroke-opacity=".4" stroke-width="3"/>
  </g>
  <polygon points="50,20 72,35 72,65 50,80 28,65 28,35" fill="#e8a838"/>
</svg>
\\\`\\\`\\\`

### Animation Pattern

All animations use the same approach: elements start hidden, JavaScript \\\`setTimeout\\\` adds a \\\`.show\\\` class at staggered intervals.

\\\`\\\`\\\`css
/* Base hidden state */
.element {
  opacity: 0;
  transform: translateY(15px);
}

/* Revealed state */
.element.show {
  opacity: 1;
  transform: translateY(0);
  transition: all 0.7s ease;
}
\\\`\\\`\\\`

\\\`\\\`\\\`javascript
// Timing pattern
setTimeout(() => { document.getElementById('el1').classList.add('show') }, 600);
setTimeout(() => { document.getElementById('el2').classList.add('show') }, 1200);
setTimeout(() => { document.getElementById('el3').classList.add('show') }, 1800);
// ... stagger by 400–800ms
\\\`\\\`\\\`

Common keyframe animations used alongside:

\\\`\\\`\\\`css
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.6; }
}

@keyframes blink {
  50% { opacity: 0; }
}
\\\`\\\`\\\`

For SVG branch lines, use stroke-dasharray/offset for draw-on effect:

\\\`\\\`\\\`css
.branch {
  stroke-dasharray: 200;
  stroke-dashoffset: 200;
}
.branch.show {
  stroke-dashoffset: 0;
  transition: stroke-dashoffset 0.8s ease;
}
\\\`\\\`\\\`

#### Timing Guidelines

- First element appears at **600ms** (gives fonts time to load)
- Stagger by **400–800ms** between elements
- Total animation should end **2s before** the MP4 duration
- Teaser segments are shortest (~5.5s of animation in 7s MP4)
- Hook/pain/evidence are longest (~7–8.5s of animation in 10s MP4)

---

## REFERENCE: Segment Patterns

### 01_hook — Show the Problem

**Purpose:** Visually demonstrate the problem the episode addresses. Make the viewer feel it.

**Typical layout:** Two-column flex. Left side has the "evidence" (chat panels, code windows, timelines). Right side has editorial narrative (episode number, title with gradient \\\`<em>\\\`, body text, stats).

**Common patterns:**
- Two chat session panels stacked vertically, showing contradictory AI responses to similar questions
- A single large window showing something filling up or breaking (context window overloading)
- Session panels have: header with 3 dots + session label, body with user/AI message bubbles
- Right narrative has: small monospace phase label ("THE HOOK"), large Instrument Serif title with gradient emphasis word, body paragraph in DM Sans

**Animation timing:** ~7-8s total. Panels appear first (600ms), messages stagger in (1400-5600ms), conflict/punchline last (6800-7400ms).

### 02_pain — Why It Hurts

**Purpose:** Show the consequences of the problem. Make the cost tangible.

**Typical layout:** Centered vertical content. A timeline, progression, or comparison that degrades visually.

**Common patterns:**
- Vertical timeline with steps that go from green (good) → amber (uncertain) → red (broken) → ghost/faded (lost)
- Bar chart comparison showing dramatic difference (23× multiplier reveal)
- Each step has an icon, label, description, and visual indicator of health/trust
- Source tags or evidence labels that fade/disappear as the timeline progresses
- Bottom insight quote summarizing the core pain

**Animation timing:** ~8s total. Progressive reveals that mirror the degradation story.

### 03_solution — ACC's Answer

**Purpose:** Show the data structure or feature that solves the problem. Make it feel elegant and organized.

**Typical layout:** Two-column. Left has an SVG or CSS visualization (tree, graph, hierarchy). Right has info cards explaining the levels.

**Common patterns:**
- SVG tree visualization with animated branch growth (stroke-dashoffset) and node reveals
- Capacity bar or block diagram showing organized structure
- Right-side info cards with emoji icon, monospace label in accent color, monospace description
- Trust rating legend at the bottom (colored pills: Authoritative, Credible, Unverified, Questionable)
- Nodes have trust badges — small colored rectangles with abbreviated text

**Animation timing:** ~6-7s total. Tree grows bottom-up: root → branches → forests → trees → leaves. Info cards appear alongside their corresponding tree level.

### 04_evidence — Feature in Action

**Purpose:** Demonstrate the feature working on a real scenario. Show traceability and the "aha moment."

**Typical layout:** Varies more than other segments. Could be:
- A query panel + linked evidence nodes ("Why did we choose Firebase?")
- A bar chart comparison with animated counters (context cost comparison)
- A before/after with data flowing through the system

**Common patterns:**
- Query/question panel at top with a decision being traced
- Evidence nodes showing source attribution, trust ratings, and linked reasoning
- A warning/alert bar showing drift detection or staleness
- Animated counters that tick up to final values
- Bottom quote about the transformation ("From an oracle... to a research partner")

**Animation timing:** ~8s total. Query appears first, evidence nodes populate, then the insight/warning reveals.

### 05_teaser — Next Episode Preview

**Purpose:** Brand the series and tease the next episode. This is the most templated segment.

**Typical layout:** Two-column. Left has a visual representing the next episode's concept (agent diagram, feature preview). Right has episode info.

**Required elements (every teaser has these):**
- **Top brand bar:** ACC logo SVG + "AI Command Center" text + gradient line
- **Bottom brand bar:** Tagline ("Stop moving faster. Start thinking *better*.") + aicommandcenter.dev URL
- **"Next Episode" badge:** Amber dot + monospace text
- **Episode title:** Large Instrument Serif with gradient \\\`<em>\\\` emphasis
- **Description paragraph:** 1-2 sentences about the next episode
- **3 detail rows:** Icon + monospace text describing what the next episode covers

**Left visual examples:**
- Two agent circles (Chat + Code) with animated connection arrows
- A feature diagram relevant to the next episode

**Animation timing:** ~5.5s total. Brand bar first (300ms), agents/visual (800-2200ms), info panel (1200-4200ms), bottom bar last (5500ms). This is the shortest segment.

---

## REFERENCE: Conversion Script (html2mp4.js)

Embed this as the html2mp4.js file when setting up a new session:

\\\`\\\`\\\`javascript
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Usage: node html2mp4.js <input.html> <output.mp4> [duration_seconds]');
  process.exit(1);
}

const inputHtml = path.resolve(args[0]);
const outputMp4 = path.resolve(args[1]);
const duration = parseInt(args[2] || '12');
const fps = 30;
const totalFrames = duration * fps;
const width = 1280;
const height = 720;

const framesDir = path.join(path.dirname(outputMp4), '.frames-tmp');

async function run() {
  if (fs.existsSync(framesDir)) execSync(\\\`rm -rf \\\${framesDir}\\\`);
  fs.mkdirSync(framesDir, { recursive: true });

  console.log(\\\`Recording \\\${inputHtml} → \\\${outputMp4}\\\`);
  console.log(\\\`Duration: \\\${duration}s, FPS: \\\${fps}, Frames: \\\${totalFrames}\\\`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.setViewportSize({ width, height });

  await page.goto(\\\`file://\\\${inputHtml}\\\`, { waitUntil: 'networkidle', timeout: 30000 });

  // Wait for fonts to load
  await page.waitForTimeout(1500);

  // Capture frames
  const interval = 1000 / fps;
  for (let i = 0; i < totalFrames; i++) {
    const framePath = path.join(framesDir, \\\`frame_\\\${String(i).padStart(5, '0')}.png\\\`);
    await page.screenshot({ path: framePath, type: 'png' });

    if (i % fps === 0) {
      console.log(\\\`  \\\${i / fps}s / \\\${duration}s captured...\\\`);
    }

    await page.waitForTimeout(interval);
  }

  await browser.close();
  console.log(\\\`Captured \\\${totalFrames} frames. Encoding MP4...\\\`);

  execSync(\\\`ffmpeg -y -framerate \\\${fps} -i \\\${framesDir}/frame_%05d.png -c:v libx264 -pix_fmt yuv420p -crf 18 -preset medium -movflags +faststart "\\\${outputMp4}" 2>&1\\\`);

  execSync(\\\`rm -rf \\\${framesDir}\\\`);
  console.log(\\\`Done: \\\${outputMp4}\\\`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
\\\`\\\`\\\``;


// ═══════════════════════════════════════════════════════════════════════
// Skill Registry — maps skill names to content for the \`skill\` tool
// ═══════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
// Skill 32: Skill Creation & Router Registration
// ═══════════════════════════════════════════════════════════════════════

const SKILL_SKILL_CREATION = `# Skill Creation & Router Registration

## When to Create a Skill

Create a new skill when:
- A workflow is being repeated across sessions and the instructions are always the same
- A protocol has been finalized and needs consistent execution
- A lens/mode/process has been validated and should be available on-demand
- A new capability needs a persistent, loadable reference

Do NOT create a skill for:
- One-off instructions that won't recur
- Content that changes frequently (use knowledge trees instead)
- Things that are better as ODRC concepts (rules, constraints, decisions)

## What a CC MCP Skill Is

A skill is a **single string constant** in \`skills.ts\` that gets registered as an MCP prompt. That's it.

- No file trees, no .skill packages, no YAML manifests
- One TypeScript constant → one registry entry → one prompt registration
- The MCP SDK serves it to Claude Chat or Claude Code on demand
- Skills are loaded into context only when triggered — they are NOT always-on

### Anatomy of a Skill in skills.ts

\`\`\`typescript
// 1. String constant (the actual content)
const SKILL_MY_SKILL = \`# My Skill Title
... skill content in markdown ...
... can be hundreds of lines ...\`;

// 2. Registry entry (in SKILL_REGISTRY array)
{ name: "cc-my-skill", description: "One-line description", content: SKILL_MY_SKILL },

// 3. Prompt registration (in registerSkillPrompts function)
server.prompt(
  "cc-my-skill",
  "Longer description for MCP prompt listing",
  {},
  async () => ({
    messages: [{ role: "user", content: { type: "text", text: SKILL_MY_SKILL } }],
  })
);
\`\`\`

### Where Things Live in skills.ts

1. **Top**: \`registerSkillPrompts()\` function — all prompt registrations
2. **Middle**: Skill constants as template literals (\`const SKILL_X = ...\`)
3. **Bottom**: \`SKILL_REGISTRY\` array, then \`getSkillNames()\` and \`getSkillContent()\`

## The 6-Step Flow

### Step 1: Recognize the Trigger
Something in the session signals a skill is needed:
- A workflow keeps being explained manually
- A protocol doc exists but isn't loadable
- Dave says "this should be a skill"
- A new capability has stabilized enough to codify

### Step 2: Gather the Workflow
Collect everything the skill needs to teach:
- What is this? (1-2 sentence purpose)
- When to use it (trigger conditions)
- When NOT to use it (anti-patterns)
- The actual procedure/protocol/framework
- Examples if helpful
- Common mistakes to avoid

Write it as markdown. The content should be self-contained — Claude should be able to follow it without needing other context.

### Step 3: Write the Skill Content
Format as a markdown document with clear sections:

\`\`\`markdown
# Skill Name

## What This Is
Brief description of purpose

## When to Use This
- Trigger condition 1
- Trigger condition 2

## The Process
### Sub-section 1
...
### Sub-section 2
...

## Anti-Patterns
- Don't do X
- Don't do Y
\`\`\`

Keep it focused. A skill should teach ONE thing well. If it's growing beyond ~500 lines, consider splitting into multiple skills.

### Step 4: Write Router Entries
Each skill needs an entry in the \`cc-skill-router\` skill content. The router uses keyword + intent format:

\`\`\`markdown
**cc-my-skill**
Keywords: keyword1, keyword2, keyword3, keyword4
Intent: One sentence describing when to load this skill
Surface: Chat | Code | Both
\`\`\`

Choose the right category from the router's 9 categories:
1. **Onboarding** — First-time and cold-start flows
2. **Ideation** — ODRC framework, session modes, lenses
3. **Handoff** — Spec generation, job creation
4. **Build** — Build protocol, hygiene, resume
5. **Coordination** — Messaging, workflow, inter-agent
6. **Recovery** — Session/build resume, continuity
7. **Meta** — Router itself, retro journal, tutorials
8. **Production** — Video, content creation, media pipelines
9. **Other** — Domain-specific skills that don't fit above

#### Writing Good Keywords
- Pick 4-6 words that a user or system would naturally use
- Include both the noun and the action: "skill, create, new, router, add"
- Don't repeat the skill name — it's already searchable
- Think: "what would someone type or say when they need this?"

### Step 5: Submit as a Job
Create a skill-update job via CC MCP:

\`\`\`
job(start):
  appId: command-center
  title: "Add cc-my-skill skill"
  jobType: skill-update
  createdBy: claude-chat
  instructions: [what to add and where]
  attachments: [{ type: "skill-content", content: "the full skill text" }]
\`\`\`

The job should include:
- The full skill content as an attachment
- The router entry to add
- Which category it belongs to
- Updated skill count for the header comment

### Step 6: Notify Code
Send a message to claude-code about the pending job:

\`\`\`
document(send):
  to: claude-code
  content: "New skill-update job ready: cc-my-skill. [brief description]"
\`\`\`

Code will:
1. Claim the job
2. Add the constant to skills.ts
3. Add the registry entry
4. Add the prompt registration
5. Update router entries
6. Deploy to test, verify, deploy to prod
7. Complete the job and notify back

## Anti-Patterns

### Don't Follow Anthropic's Built-In Skill Creator
Claude has a built-in \`/skill\` slash command and skill-creator behavior. That system creates files, uses YAML frontmatter, and follows a completely different architecture. **Ignore it entirely for CC skills.** CC skills are MCP prompts served from a Cloud Run server, not local files.

### Don't Create Skills for Volatile Content  
If the content will change every week, it shouldn't be a skill. Use knowledge trees for evolving research, and ODRC concepts for project-level decisions. Skills are for stable protocols.

### Don't Stuff Multiple Concerns Into One Skill
A skill about "how to run builds AND how to create skills AND how to write tests" is three skills. Keep each skill should focused on one teachable workflow.

### Don't Skip the Router Entry
A skill without a router entry is invisible. Even if you add the constant, registry, and prompt — Claude won't know when to load it unless the router has matching keywords and intent.

## Skill Naming Convention

Format: \`cc-[category]-[purpose]\`

Examples by category:
- Onboarding: \`cc-startup-checklist\`, \`cc-tutorial\`
- Ideation: \`cc-mode-exploration\`, \`cc-lens-technical\`
- Handoff: \`cc-spec-generation\`, \`cc-job-creation-protocol\`
- Build: \`cc-build-protocol\`, \`cc-build-hygiene\`
- Coordination: \`cc-protocol-messaging\`, \`cc-mcp-workflow\`
- Recovery: \`cc-build-resume\`, \`cc-session-resume\`
- Meta: \`cc-skill-router\`, \`cc-retro-journal\`
- Production: \`cc-acc-video\`
- Other: \`cc-[domain]-[purpose]\` (e.g., \`cc-firebase-patterns\`)`;



// ═══════════════════════════════════════════════════════════════════════
// Skill 33: Cowork Startup Checklist
// ═══════════════════════════════════════════════════════════════════════

const SKILL_COWORK_STARTUP_CHECKLIST = `# Cowork Startup Checklist

**Your surface identity: \`claude-cowork\`**
Use this as your \`createdBy\` when calling \`document(action="send")\` or \`job(action="start")\`. Use it as \`to\` when calling \`document(action="receive")\`.

**Piggyback message notifications:** Every MCP tool response may include \`_pendingMessages\` metadata listing unread messages for all surfaces. Each message has \`to\`, \`from\`, and \`subject\` fields. If you see messages where \`to: "claude-cowork"\`, call \`document(action="receive", to="claude-cowork", summary=true)\` to get envelopes first (saves tokens). Then use \`document(action="get", docId=...)\` to read full content only for messages you need.

## Step 1: Load Skill Router

\`\`\`
Call: skill(action="get", skillName="cc-skill-router")
\`\`\`

This gives you the routing table for on-demand skill loading. Do not load other skills speculatively — only load when triggered by user actions.

## Step 2: Check Messages

\`\`\`
Call: document(action="receive", to="claude-cowork", summary=true)
\`\`\`

Pick up any pending messages from Chat or Code. Present relevant ones to the user.

---

## Session Capture (Opt-In)

Cowork does NOT create sessions on startup. Most interactions are short tasks that don't need session tracking.

**Turn threshold rule:** After 5–6 turns with no active session, offer to capture:

> "We've been at this for a bit — want me to capture this as a session so we track what we've done?"

- **Yes** → Create session retroactively with title and goal inferred from the conversation so far. Use \`session(action="start", ...)\` with the relevant appId/ideaId if identifiable.
- **No** → Continue without session tracking. Don't ask again this conversation.

**Session close:** Explicit ("wrap up") or stale timeout. On close, write a \`closingSummary\` and \`nextSessionRecommendation\` — these are the high-value outputs that prevent starting from scratch next time.

---

## Budget Tracking Reference

Track every turn: \`📊 Budget: [est total]K / [zone] / [headroom]\`

**Zones:** Green <360K, Yellow 360–480K, Red 480–580K, Imminent 580K+
**Compaction threshold:** 624K

### Sources to Count

| Source | Estimate |
|--------|----------|
| System overhead | ~85K fixed |
| MCP tool responses | Sum \`_responseSize\` from each call |
| Web search | ~10K per call |
| Conversation history | All prior user + assistant messages |

### Rules
- \`_contextHealth.used\` and \`.ceiling\` from tool responses are authoritative — override estimates
- Flag any single MCP response over 10K: \`⚠️ last call: [size]\`
- Call out zone transitions explicitly
- Write budget to memory every ~5 turns: \`"CC budget: [total]K / [zone]. Session: [sessionId]"\``;

interface SkillEntry {
  name: string;
  description: string;
  content: string;
}

const SKILL_REGISTRY: SkillEntry[] = [
  { name: "cc-odrc-framework", description: "ODRC type definitions, state machine, writeback protocol", content: SKILL_ODRC_FRAMEWORK },
  { name: "cc-session-structure", description: "Live session lifecycle with Firebase-backed tracking", content: SKILL_SESSION_STRUCTURE },
  { name: "cc-session-protocol", description: "Master 'how to run a session' skill (Claude Chat)", content: SKILL_SESSION_PROTOCOL },
  { name: "cc-mode-exploration", description: "Exploration posture and flow", content: SKILL_MODE_EXPLORATION },
  { name: "cc-lens-technical", description: "Technical probing framework", content: SKILL_LENS_TECHNICAL },
  { name: "cc-build-protocol", description: "Master 'how to run a build' skill (Claude Code)", content: SKILL_BUILD_PROTOCOL },
  { name: "cc-build-resume", description: "Compaction recovery for Claude Code mid-build (CRITICAL)", content: SKILL_BUILD_RESUME },
  { name: "cc-session-resume", description: "Compaction recovery for Claude Chat mid-session (CRITICAL)", content: SKILL_SESSION_RESUME },
  { name: "cc-session-continuity", description: "New conversation continuing an existing idea", content: SKILL_SESSION_CONTINUITY },
  { name: "cc-spec-generation", description: "When and how to generate and push CLAUDE.md", content: SKILL_SPEC_GENERATION },
  { name: "cc-build-hygiene", description: "Post-build concept cleanup and idea graduation", content: SKILL_BUILD_HYGIENE },
  { name: "cc-mcp-workflow", description: "End-to-end lifecycle: how Chat and Code interact via MCP", content: SKILL_MCP_WORKFLOW },
  { name: "cc-lens-stress-test", description: "Stress test probing: find what breaks in existing decisions", content: SKILL_LENS_STRESS_TEST },
  { name: "cc-lens-voice-of-customer", description: "User persona analysis, journey mapping, retention", content: SKILL_LENS_VOICE_OF_CUSTOMER },
  { name: "cc-lens-competitive", description: "Competitive analysis, differentiation, positioning", content: SKILL_LENS_COMPETITIVE },
  { name: "cc-lens-economics", description: "Cost analysis, effort estimation, maintenance, ROI", content: SKILL_LENS_ECONOMICS },
  { name: "cc-protocol-messaging", description: "Inter-agent message types and conversation loop protocol", content: SKILL_PROTOCOL_MESSAGING },
  { name: "cc-lens-integration", description: "Cross-app integration analysis: data coupling, shared dependencies, contract boundaries, and ecosystem impact", content: SKILL_LENS_INTEGRATION },
  { name: "cc-lens-ux-deep-dive", description: "Screen-by-screen UX walkthrough: user flows, transitions, navigation, loading states, accessibility, mobile interaction", content: SKILL_LENS_UX_DEEP_DIVE },
  { name: "cc-lens-content", description: "Content strategy and information architecture: editorial structure, quality gates, content lifecycle, enrichment pipelines", content: SKILL_LENS_CONTENT },
  { name: "cc-lens-growth", description: "Distribution strategy, user acquisition, viral mechanics, SEO, social sharing, and success measurement", content: SKILL_LENS_GROWTH },
  { name: "cc-lens-accessibility", description: "Dedicated accessibility audit: WCAG compliance, keyboard navigation, screen readers, color contrast, motion sensitivity, cognitive load", content: SKILL_LENS_ACCESSIBILITY },
  { name: "cc-lens-operations", description: "Post-launch operations: analytics, error monitoring, health checks, deployment verification, incident response", content: SKILL_LENS_OPERATIONS },
  { name: "cc-lens-security", description: "Security and privacy audit: attack surfaces, data exposure, authentication, authorization, Firebase rules, dependency risks", content: SKILL_LENS_SECURITY },
  { name: "cc-skill-router", description: "Routing table: which skills to load for each trigger (Chat and Code)", content: SKILL_ROUTER },
  { name: "cc-job-creation-protocol", description: "How Chat creates well-formed build jobs for Code", content: SKILL_JOB_CREATION_PROTOCOL },
  { name: "cc-retro-journal", description: "Shared learning journal — genuine discoveries from Chat and Code that change future behavior", content: SKILL_RETRO_JOURNAL },
  { name: "cc-startup-checklist", description: "Mandatory cold start sequence for Chat — profile check, in-flight work, messages, session orientation, context loading", content: SKILL_STARTUP_CHECKLIST },
  { name: "cc-tutorial", description: "Guided onboarding tutorial — builds a grocery list app through 9 steps, teaching ODRC, knowledge trees, lenses, jobs, and messaging", content: SKILL_TUTORIAL },
  { name: "cc-code-startup-checklist", description: "Cold start sequence for Code — messages, documents, jobs, build protocol loading", content: SKILL_CODE_STARTUP_CHECKLIST },
  { name: "cc-acc-video", description: "ACC video production pipeline — HTML animations to MP4 for landing page episodes", content: SKILL_ACC_VIDEO },
  { name: "cc-skill-creation", description: "How to create CC MCP skills — the 6-step flow from trigger recognition to Code deployment", content: SKILL_SKILL_CREATION },
  { name: "cc-cowork-startup-checklist", description: "Cold start sequence for Cowork — router load, message check, opt-in session capture, budget tracking", content: SKILL_COWORK_STARTUP_CHECKLIST },
];

/** Get list of all skill names and descriptions */
export function getSkillNames(): { name: string; description: string }[] {
  return SKILL_REGISTRY.map(s => ({ name: s.name, description: s.description }));
}

/** Get skill content by name. Returns null if not found. */
export function getSkillContent(name: string): string | null {
  const entry = SKILL_REGISTRY.find(s => s.name === name);
  return entry ? entry.content : null;
}

/** Get compiled skill registry for cache fallback. */
export function getCompiledSkillRegistry(): { name: string; description: string; content: string }[] {
  return SKILL_REGISTRY.map(s => ({ name: s.name, description: s.description, content: s.content }));
}
