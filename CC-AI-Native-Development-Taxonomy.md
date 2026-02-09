# AI-Native Development Taxonomy

## A Shared Language for Building Software with AI

---

## Why This Matters

The software industry is in a transition. MIT Technology Review and Thoughtworks both documented the 2025 shift from "vibe coding" (Karpathy's term — just describe what you want and go) to "context engineering" (systematically managing what AI knows when it builds). Anthropic's own team says it directly: **"Intelligence is not the bottleneck. Context is."**

But there's no shared vocabulary for this new way of working. Traditional development has Agile, Scrum, Kanban with well-defined terms (sprint, story, epic, backlog). AI-native development borrows some of those words but the actual workflow is fundamentally different — the "developer" is an AI that forgets everything between sessions, has a fixed-size working memory (context window), and charges by the word (tokens).

This document defines a taxonomy for AI-native development. It covers three layers:

1. **Project Structure** — What are we building, how is it organized
2. **AI Engine** — How the AI works, what constrains it, what optimizes it
3. **Integration** — External services that extend the system

Each term is defined once, with its relationship to other terms.

---

## Layer 1: Project Structure

*What we're building and how we track progress.*

### Portfolio
The entire collection of projects managed by a single instance of Command Center. Not a formal entity — it's the tool itself. Useful for rollup reporting: "19 apps, 5 projects, 12 open work items."

### Project
A logical grouping of related apps that share a purpose and audience.

| Field | Description |
|-------|-------------|
| Identity | Name, icon, color, description |
| Purpose | Problem statement, target audience |
| Status | active, maintenance, paused, sunset |
| Apps | The deployable units within this project |

*Examples: Game Shelf, LabelKeeper, Command Center*

### App
A single deployable unit — one URL, one version number, one set of source files. The atomic unit of deployment.

| Field | Description |
|-------|-------------|
| Identity | Name, ID, icon, category (game/tool/dashboard/content/admin) |
| Infrastructure | Repos, environments, PWA config, subPath |
| State | Current version per environment |
| Lifecycle | Maturity target, current maturity, problem statement, user goal, tech stack |

*Examples: Game Shelf app, Quotle, Slate, Command Center*

### Environment
A deploy target where a version of an app runs. Each environment is a live URL backed by a Git repo.

| Value | Purpose |
|-------|---------|
| `test` | Internal validation, safe to break |
| `prod` | Public-facing, stable |

*Note: CC config has `dev` and `beta` available but only `test` and `prod` are active. Environments can expand as needed.*

### Version
A numbered snapshot of an app's code, following semver (MAJOR.MINOR.PATCH). Read from `<meta name="version">` in deployed HTML.

| Bump | When |
|------|------|
| Patch (0.0.X) | Bug fixes, text changes, tweaks |
| Minor (0.X.0) | New feature, behavior change |
| Major (X.0.0) | Breaking changes, redesign |

### Deploy
The action of pushing code to an environment. A timestamped event record.

| Field | Description |
|-------|-------------|
| What | App, version, files |
| Where | Environment, repo |
| When | Start time, completion time |
| How | Direct deploy, promotion (test→prod), rollback |
| Result | Success/failure, commit SHA |
| Why *(proposed)* | Release notes, work items completed, session reference |

### Release
A deploy that reaches production. Specifically: a promotion from test to prod, or a direct deploy to prod. A subset of deploys, not a separate entity.

### Milestone
A quality gate that an app passes through on its way to maturity. Four standard milestones, each with criteria that define "done for this level."

| Milestone | Meaning | Key Criteria |
|-----------|---------|--------------|
| **Prototype** | Prove the concept. Throwaway code OK. | Core mechanic works, hardcoded data fine, single device OK |
| **Alpha** | Core features work end-to-end with real data. | All core flows functional, real persistence, basic error handling, version tracking |
| **Beta** | Feature complete. Real users can test. | All planned features, mobile responsive, error handling, PWA if applicable, sharing/social |
| **Production** | Ship it. Stable, tested, monitored. | Edge cases handled, performance optimized, accessibility pass, error recovery |

Each milestone has a `status` (complete, current, future), `completedAt` timestamp, and a `criteria` checklist.

### Work Item
A discrete unit of planned work with a clear definition of done. The building block of project planning.

| Field | Description |
|-------|-------------|
| Identity | ID (WI-NNN), title, description |
| Classification | Type (feature/bugfix/enhancement/chore), priority (core/nice-to-have), milestone (which gate) |
| Status | idea → ready → in-progress → done → deferred |
| Sizing | quick (<1hr), session (1 session), multi-session |
| Definition of Done | Acceptance criteria (checklist) |
| AI Context | Files affected, code sections, dependencies, notes, related items |
| Tracking | Created, started, completed, version completed in, tags |

*"Work Item" chosen over Story (too prescriptive), Task (too small), Issue (already used for bugs), Ticket (too generic).*

### Issue
A bug, defect, or problem found in deployed code. Reactive (something broke) vs. Work Items which are proactive (something to build). Can be promoted to a Work Item when planned development is needed.

### Test Plan
A structured set of validation steps to verify that a work item or milestone criteria are met. Today this exists as a separate app (Test Plan tool) but conceptually it's the verification side of any work item's acceptance criteria.

| Scope | What It Covers |
|-------|---------------|
| Work Item level | Does this specific feature meet its acceptance criteria? |
| Milestone level | Does this app meet all criteria for Beta / Production? |
| Deploy level | Pre-deploy checks (meta tags, parse, size) and post-deploy verification (live URL, version match) |

---

## Layer 2: AI Engine

*How the AI builder works, what constrains it, what optimizes it. These terms apply regardless of which LLM you're using.*

### Context Window
The AI's total working memory for a single session. Everything the AI can "see" at once — your uploaded files, conversation history, system instructions, and its own responses — must fit within this fixed-size buffer.

| Model | Window Size | Approximate Capacity |
|-------|------------|---------------------|
| Claude Sonnet 4 | 200K tokens (1M beta) | ~150K words / ~11K lines of code |
| GPT-4.1 | 1M tokens | ~750K words |
| Gemini 2.5 | 2M tokens | ~1.5M words |

**Why it matters for CC:** Your single-file HTML apps (Command Center is ~18,500 lines ≈ ~330K tokens) consume a large portion of the context window just being uploaded. The remaining space is for conversation, docs, and AI reasoning. Context budgeting directly affects session productivity.

### Token
The atomic unit of AI processing. Roughly: 1 token ≈ 0.75 English words, or 1 line of code ≈ 18 tokens. Tokens are both the unit of cost (you pay per token) and the unit of capacity (context window is measured in tokens).

| Content Type | Estimation |
|-------------|-----------|
| English text | 1 word ≈ 1.3 tokens |
| Code (JS/HTML/CSS) | 1 line ≈ 18 tokens |
| Markdown doc | 1 word ≈ 1.35 tokens |

**Why it matters for CC:** A 10KB CONTEXT.md is ~3,500 tokens. A 830KB index.html is ~300K+ tokens. Understanding token cost helps decide what to include in a Claude Prep package vs. what to leave out. Targeted sessions (one work item with relevant context only) are cheaper and produce better results than "here's everything, figure it out."

### Context Budget
The allocation of tokens across a session. Not all context window space is equal — there's a practical budget.

| Budget Slice | Purpose | Typical Allocation |
|-------------|---------|-------------------|
| System instructions | CLAUDE_INSTRUCTIONS.md, skills, rules | 5-15K tokens |
| Source code | The app's current code (index.html, sw.js) | 50-350K tokens |
| Project docs | CONTEXT.md, PROJECT_PLAN.md, CHANGELOG.md | 5-20K tokens |
| Session brief | SESSION_BRIEF.md with targeted work item | 1-3K tokens |
| Conversation | Back-and-forth during development | 50-100K tokens |
| AI reasoning | Internal processing (extended thinking) | Variable |

**Why it matters for CC:** Claude Prep should be context-budget-aware. If index.html is 330K tokens and the context window is 200K, you've already blown the budget before the conversation starts. CC should warn about this and suggest strategies (targeted file sections, summarized architecture, etc.).

### Context Engineering
The practice of systematically designing and managing what information the AI receives. Not just "write a good prompt" — it's deciding what to include, what to exclude, what to summarize, and when to inject specific information.

CC's Claude Prep system IS context engineering. The enhanced setup wizard extends it by making the initial context definition structured and intentional rather than ad-hoc.

Four pillars (from Anthropic's own framework):
1. **Write** — Store information externally for later retrieval (project docs in repos)
2. **Select** — Choose what's relevant for this specific task (targeted session brief)
3. **Compress** — Summarize older/less relevant information (session brief vs. full history)
4. **Isolate** — Scope context to prevent interference (one work item per session)

### Context Package
The bundle of files prepared for an AI session. In CC, this is the Claude Prep zip. It's the physical manifestation of context engineering — a curated set of files designed to give the AI exactly what it needs.

| Component | Purpose | Token Impact |
|-----------|---------|-------------|
| Source files | Current code to modify | High (50-350K) |
| CLAUDE_INSTRUCTIONS.md | Permanent AI briefing (scope, rules, stack) | Medium (3-5K) |
| CONTEXT.md | Architecture, schemas, conventions | Medium (3-8K) |
| PROJECT_PLAN.md | Roadmap, decisions, completed work | Low-Medium (2-5K) |
| SESSION_BRIEF.md | Targeted work item, current status, recent deploys | Low (1-3K) |
| CHANGELOG.md | Version history | Low (1-3K) |
| RELEASE_NOTES.txt | Human-readable changes | Low (0.5-2K) |

### Session
A single AI interaction bounded by context preparation (start) and deliverable output (end). The fundamental unit of AI-assisted development work.

| Phase | What Happens |
|-------|-------------|
| **Prep** | Context package generated (Claude Prep), work item selected |
| **Active** | AI builds code within its context window, iterative conversation |
| **Handoff** | AI produces deliverable package (source + docs + version bump) |
| **Deploy** | Output deployed via CC, work item status updated |

**Session ≠ Sprint.** A session is typically 1-4 hours, driven by context window limits and task scope, not a calendar cadence. There's no standup, no ceremony. It's one person directing one AI to complete one or a few work items.

### Context Rot
The degradation of AI output quality as a session grows longer and the context window fills up. Early messages get pushed out, the AI loses track of decisions made earlier, and responses become less coherent or start contradicting previous work.

**Why it matters for CC:** Sessions have a natural lifespan. When you notice quality dropping, that's context rot — time to wrap up, deliver what you have, and start a fresh session. The session protocol (always produce a deployable package) ensures that context rot doesn't result in lost work.

### Prompt
A specific instruction given to the AI within a session. In CC's context, there are two types:

| Type | Purpose | Example |
|------|---------|---------|
| **System prompt** | Persistent instructions for the session | CLAUDE_INSTRUCTIONS.md content |
| **Task prompt** | Specific work direction | "Implement BL-042: sound effects for tiles" |

The enhanced setup wizard generates system prompts. The targeted SESSION_BRIEF.md generates task prompts. The human adds conversational prompts during the session.

### AI Engine Profile *(NEW concept)*
A record of which AI model is being used for development, its capabilities, and its constraints. Different engines have different strengths.

| Field | Purpose | Example |
|-------|---------|---------|
| Model | Which LLM | Claude Sonnet 4, GPT-4.1, Gemini 2.5 Pro |
| Context window | Available working memory | 200K tokens |
| Max output | How much code per response | 64K tokens |
| Cost | Price per million tokens | $3/$15 (input/output) |
| Strengths | What it's best at | "Strong at React, careful with edge cases" |
| Limitations | What to watch for | "May over-engineer, watch for verbose CSS" |

**Why it matters for CC:** If you switch between Claude and GPT for different tasks, the context package might need to be formatted differently. CC could eventually support engine-specific packaging (Claude prefers XML tags for structure, GPT prefers markdown headers, etc.).

---

## Layer 3: Integration

*External services and protocols that extend the system.*

### Integration
A connection between CC and an external service. Each integration has an authentication method, capabilities, and cost implications.

#### Current Integrations

| Service | Auth Method | Used For | Data Flow |
|---------|------------|----------|-----------|
| **GitHub** | Personal Access Token | Repo management, file CRUD, Pages deploy, version detection | Bidirectional |
| **Firebase RTDB** | Service Account JWT / API Key | Config sync, user data, game state, issues, auth | Bidirectional |
| **Firebase Auth** | API Key | User authentication (Google Sign-In) | Read |
| **Anthropic API** | API Key | AI hints in games (Quotle, etc.) | Request/Response |
| **Stripe** | API Key | Payment processing (coins) | Request/Response |

#### Potential Future Integrations

| Service | Would Enable |
|---------|-------------|
| **Anthropic API (from CC)** | Token counting for context packages, cost estimation per session, AI-powered work item generation |
| **GitHub Actions** | Automated testing, CI pipeline, deploy webhooks |
| **Analytics** | Usage tracking, player metrics, deploy impact measurement |
| **CDN / Asset hosting** | Image/icon management separate from GitHub Pages |
| **MCP (Model Context Protocol)** | Standardized way for AI tools to connect to CC data — work items, deploy history, app config could be exposed as MCP resources |

### Model Context Protocol (MCP)
An open protocol (created by Anthropic, adopted broadly) that standardizes how AI systems connect to external data sources. If CC exposed its data via MCP, any AI tool (Claude, Cursor, Copilot) could query CC's work items, deploy history, and app config natively — without needing Claude Prep zip files.

**Why it matters:** MCP is potentially the future of how CC communicates with AI engines. Instead of packaging a zip and uploading it, the AI could query CC directly: "What's the next work item for Game Shelf? What's the current deployed version? Show me the last 3 deploys."

### Service Account
A non-human identity used to authenticate with external services. CC currently uses GitHub PATs and Firebase service account keys. These are stored locally (never synced to Firebase for security).

---

## Cross-Layer Relationships

How the three layers connect:

```
PROJECT STRUCTURE              AI ENGINE                 INTEGRATION
─────────────────              ─────────────             ───────────

Project                                                  
 └─ App ──────────────────────── AI Engine Profile        
     │                           (which model, costs)     
     ├─ Milestone                                        
     │   └─ Criteria                                     
     │                                                   
     ├─ Work Item ─────────────── Task Prompt ──────────── GitHub (code)
     │   └─ Acceptance Criteria    (targeted brief)        Firebase (data)
     │   └─ Context               Context Budget           
     │       (files, sections)     (token allocation)      
     │                                                   
     ├─ Session ───────────────── Context Window ─────── AI Model API
     │   ├─ Prep ──────────────── Context Package         
     │   │   (Claude Prep zip)     (curated files)        
     │   ├─ Active ────────────── Tokens consumed         
     │   └─ Handoff ──────────── Deliverable package     
     │                                                   
     ├─ Deploy ────────────────────────────────────────── GitHub Pages
     │   (push to environment)                             (hosting)
     │                                                   
     └─ Issue ─────────────────────────────────────────── Firebase RTDB
         (bug tracking)                                    (storage)
```

---

## Term Glossary — Quick Reference

### Project Structure Terms
| Term | Definition |
|------|-----------|
| **Project** | Logical grouping of related apps sharing a purpose |
| **App** | Single deployable unit at one URL with one version |
| **Environment** | Deploy target (test, prod) |
| **Version** | Semver number identifying a code snapshot |
| **Deploy** | Action of pushing code to an environment |
| **Release** | A deploy that reaches production |
| **Milestone** | Quality gate (Prototype → Alpha → Beta → Production) |
| **Work Item** | Discrete unit of planned work with acceptance criteria |
| **Issue** | Bug or defect in deployed code |
| **Test Plan** | Structured validation steps for work items or milestones |
| **Acceptance Criteria** | Checklist defining "done" for a work item |

### AI Engine Terms
| Term | Definition |
|------|-----------|
| **Token** | Atomic unit of AI processing; unit of cost and capacity |
| **Context Window** | AI's total working memory for one session |
| **Context Budget** | Planned allocation of tokens across a session |
| **Context Engineering** | Systematic design of what information AI receives |
| **Context Package** | Curated file bundle for an AI session (Claude Prep zip) |
| **Context Rot** | Degradation of AI output as context fills up |
| **Session** | Single AI interaction: prep → build → handoff → deploy |
| **Prompt** | Instruction to the AI (system prompt or task prompt) |
| **AI Engine Profile** | Record of model capabilities, costs, and constraints |

### Integration Terms
| Term | Definition |
|------|-----------|
| **Integration** | Connection to an external service |
| **Service Account** | Non-human identity for API authentication |
| **MCP** | Model Context Protocol — standard for AI-to-data connections |

---

## What This Taxonomy Enables

### Shared language with the industry
These terms map directly to emerging standards. When someone talks about "context engineering," we mean the same thing Anthropic and Thoughtworks mean. When someone asks about "milestones," they'll recognize Prototype/Alpha/Beta/Production. When someone mentions "work items," they'll understand it's the same concept as Azure DevOps or a Jira ticket.

### Token-aware project management
By including AI Engine concepts in the taxonomy, CC can make decisions based on constraints that traditional tools ignore. How big is this context package? Will it fit in the model's window? Is this work item scoped for one session or will it require multiple sessions (and therefore multiple context reloads)?

### Integration-ready architecture
Naming the integration layer explicitly means we can plan for MCP, for multi-engine support, for cost tracking per session. These aren't afterthoughts — they're first-class concerns.

### Clear communication with AI
When CC generates a SESSION_BRIEF.md, it can use this taxonomy consistently. "This is Work Item WI-042, part of the Beta milestone, targeting one session. Your context budget is approximately 180K tokens. The source file consumes 300K tokens — here's a summarized architecture instead."
