# Command Center Evolution: AI Development Orchestrator

## The Vision

Command Center today: middleware between GitHub and HTML that Claude generates.

Command Center tomorrow: **the intelligence layer that makes every AI development session more efficient, targeted, and cost-effective.** It understands what you're building, knows the constraints of your AI engine, recommends the optimal approach for each task, and tracks everything.

The shift: from "deploy tool" to "session orchestrator."

---

## Building Block 1: Token Analyzer

### What It Does
Every artifact in the CC ecosystem gets a persistent token count. When you generate a Claude Prep package, CC shows you exactly how much of the AI's context window you're consuming — and what's left for actual work.

### Token Registry
A new data structure tracking token counts for every trackable artifact:

```javascript
// Stored in Firebase: command-center/{uid}/token-registry/{appId}
{
    appId: 'game-shelf',
    lastScanned: '2026-02-10T...',
    
    artifacts: {
        'index.html': {
            path: 'index.html',
            type: 'source',
            bytes: 849920,              // Raw file size
            tokens: {
                estimated: 312000,       // Fast heuristic (bytes * 0.37)
                claude: 308500,          // Claude-specific count (if API-counted)
                gpt: 315200,             // GPT-specific count (if calculated)
            },
            lastUpdated: '2026-02-09T...',
            version: '2.3.1'
        },
        'sw.js': {
            path: 'sw.js',
            type: 'source',
            bytes: 4200,
            tokens: { estimated: 1550 },
            version: '2.3.1'
        },
        'CONTEXT.md': {
            path: 'docs/CONTEXT.md',
            type: 'documentation',
            bytes: 12800,
            tokens: { estimated: 4300 },
            lastUpdated: '2026-02-08T...'
        },
        'PROJECT_PLAN.md': {
            path: 'docs/PROJECT_PLAN.md',
            type: 'documentation',
            bytes: 8400,
            tokens: { estimated: 2800 },
        },
        'CLAUDE_INSTRUCTIONS.md': {
            path: 'docs/CLAUDE_INSTRUCTIONS.md',
            type: 'instructions',
            bytes: 6200,
            tokens: { estimated: 2100 },
        },
        'CHANGELOG.md': {
            path: 'docs/CHANGELOG.md',
            type: 'documentation',
            bytes: 15600,
            tokens: { estimated: 5200 },
        },
        // Test plans, data models, etc.
    },
    
    totals: {
        source: 313550,
        documentation: 14400,
        instructions: 2100,
        total: 330050
    }
}
```

### Token Estimation Approaches

Three tiers, from fast/approximate to slow/precise:

**Tier 1: Heuristic (instant, no API needed)**
Run in the browser during Claude Prep. Good enough for budgeting.
```javascript
function estimateTokens(text, contentType) {
    // Based on empirical ratios from tokenizer research
    const ratios = {
        code:          0.37,   // ~18 tokens per line, ~49 chars/line
        markdown:      0.35,   // ~1.35 tokens per word, ~3.8 chars/word
        prose:         0.33,   // ~1.3 tokens per word, ~4 chars/word
        json:          0.40,   // Higher due to structural characters
    };
    const ratio = ratios[contentType] || 0.35;
    return Math.ceil(text.length * ratio);
}
```

**Tier 2: js-tiktoken (browser, accurate for GPT models)**
Load the WASM-based tokenizer for precise counts. Works entirely client-side.
```javascript
import { encoding_for_model } from "js-tiktoken";
const enc = encoding_for_model("gpt-4o");
const tokens = enc.encode(text).length;
enc.free();
```
Note: This gives exact GPT counts. Claude uses a different tokenizer, so these are approximate for Claude (~5-10% variance). Still much better than heuristic.

**Tier 3: Anthropic API countTokens (exact, requires API key)**
If the user has configured an Anthropic API key, CC can call the official counter.
```javascript
const count = await anthropic.messages.countTokens({
    model: "claude-sonnet-4-5-20250929",
    messages: [{ role: "user", content: packageContent }]
});
// Returns: { input_tokens: 308500 }
```
This is the gold standard for Claude, but requires network access and an API key. Use for final pre-session validation, not for every file scan.

### Context Budget Visualizer

When Claude Prep generates a package, show a visual budget breakdown:

```
┌─────────────────────────────────────────────────────────┐
│  Context Budget: Game Shelf → Claude Sonnet 4.5 (200K)  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ████████████████████████████░░░░░░░░░░  308.5K / 200K  │
│  ⚠️  OVER BUDGET by 108.5K tokens                       │
│                                                         │
│  Source Code                                            │
│  ██████████████████████████████  308.5K (index.html)    │
│                                                         │
│  Documentation                                          │
│  ██  14.4K (CONTEXT + PLAN + CHANGELOG + RELEASE_NOTES) │
│                                                         │
│  Session Brief                                          │
│  ░  1.8K (SESSION_BRIEF.md + work item context)         │
│                                                         │
│  Conversation Room                                      │
│  ░░░░░░░░  ~0K remaining (NONE)                        │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  ⚡ Recommendations:                             │    │
│  │  • Switch to 1M context ($6/$22.50 per MTok)    │    │
│  │  • Use architecture summary instead of full     │    │
│  │    source (est. ~40K tokens)                    │    │
│  │  • Include only relevant sections for WI-042    │    │
│  │    (AudioManager + GameBoard ≈ 15K tokens)      │    │
│  │  • Skip CHANGELOG.md (5.2K tokens, low value)  │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  [Package as-is]  [Apply recommendations]  [Custom]     │
└─────────────────────────────────────────────────────────┘
```

This is the moment CC stops being passive middleware and starts being an **advisor**. It knows the file sizes, knows the model limits, and recommends specific actions.

---

## Building Block 2: AI Engine Registry

### What It Does
Tracks the AI models available, their capabilities, costs, and constraints. Enables CC to recommend the right engine for each task.

### Engine Data Model

```javascript
// Stored in CC config (not Firebase — this is reference data)
const AI_ENGINES = {
    'claude-sonnet-4.5': {
        id: 'claude-sonnet-4.5',
        provider: 'anthropic',
        name: 'Claude Sonnet 4.5',
        tier: 'balanced',
        
        // Capacity
        contextWindow: 200000,        // Standard (tokens)
        contextWindowExtended: 1000000, // Beta, tier 4+
        maxOutput: 64000,             // Max tokens per response
        
        // Cost (per million tokens, USD)
        cost: {
            input: 3.00,
            output: 15.00,
            cacheWrite: 3.75,          // 1.25x input
            cacheRead: 0.30,           // 0.1x input
            longContextInput: 6.00,    // >200K tokens: 2x input
            longContextOutput: 22.50,  // >200K tokens: 1.5x output
        },
        
        // Capabilities
        strengths: [
            'Coding and refactoring',
            'Agentic workflows',
            'Multi-step reasoning',
            'Extended thinking available'
        ],
        bestFor: ['coding', 'architecture', 'testing', 'complex-features'],
        
        // Practical limits for CC workflow
        notes: 'Default recommendation for most sessions. Best coding model per benchmarks. Use extended context for large apps (Game Shelf, CC).',
        
        // Platform capabilities
        features: {
            projects: true,            // Claude Projects for persistent context
            skills: true,              // Custom skills
            artifacts: true,           // React/HTML artifact preview
            extendedThinking: true,    // Deep reasoning mode
            computerUse: true,         // File creation, code execution
            webSearch: true,
            memory: true,              // Cross-session memory
        }
    },
    
    'claude-haiku-4.5': {
        id: 'claude-haiku-4.5',
        provider: 'anthropic',
        name: 'Claude Haiku 4.5',
        tier: 'fast',
        contextWindow: 200000,
        maxOutput: 64000,
        cost: { input: 1.00, output: 5.00 },
        strengths: ['Speed', 'Cost efficiency', 'Classification'],
        bestFor: ['quick-fixes', 'text-changes', 'chores', 'research'],
        notes: 'Use for simple bug fixes, text updates, research tasks. 5x cheaper than Sonnet.',
        features: { projects: true, skills: true, artifacts: true, extendedThinking: true, computerUse: true, webSearch: true, memory: true }
    },
    
    'claude-opus-4.5': {
        id: 'claude-opus-4.5',
        provider: 'anthropic',
        name: 'Claude Opus 4.5',
        tier: 'flagship',
        contextWindow: 200000,
        contextWindowExtended: 1000000,
        maxOutput: 64000,
        cost: { input: 5.00, output: 25.00 },
        strengths: ['Most intelligent', 'Complex architecture', 'Novel problem solving'],
        bestFor: ['design', 'architecture', 'complex-debugging', 'research'],
        notes: 'Reserve for high-complexity work: architecture design, novel patterns, difficult debugging. 67% cheaper than legacy Opus.',
        features: { projects: true, skills: true, artifacts: true, extendedThinking: true, computerUse: true, webSearch: true, memory: true }
    },

    'gpt-4.1': {
        id: 'gpt-4.1',
        provider: 'openai',
        name: 'GPT-4.1',
        tier: 'balanced',
        contextWindow: 1000000,
        maxOutput: 32768,
        cost: { input: 2.00, output: 8.00 },
        strengths: ['Large context native', 'Good at instruction following'],
        bestFor: ['large-codebase-review', 'migration'],
        notes: 'Useful when full source file must be in context without summarization. Cheaper per token but lower coding quality than Sonnet.',
        features: { projects: false, skills: false, artifacts: false }
    },

    'gemini-2.5-pro': {
        id: 'gemini-2.5-pro',
        provider: 'google',
        name: 'Gemini 2.5 Pro',
        tier: 'balanced',
        contextWindow: 2000000,
        maxOutput: 65536,
        cost: { input: 1.25, output: 10.00 },
        strengths: ['Largest context window', 'Multimodal', 'Competitive coding'],
        bestFor: ['full-codebase-analysis', 'design-review', 'documentation'],
        notes: '2M tokens means entire CC codebase fits in one session. Good for architectural review.',
        features: { projects: false, skills: false, artifacts: false }
    }
};
```

### Engine Comparison View (new Settings sub-section)

```
┌───────────────────────────────────────────────────────────────┐
│  AI Engines                                                   │
├───────────┬──────────┬──────────┬──────────┬─────────────────┤
│           │ Sonnet   │ Haiku    │ Opus     │ GPT-4.1        │
│           │ 4.5      │ 4.5      │ 4.5      │                │
├───────────┼──────────┼──────────┼──────────┼─────────────────┤
│ Context   │ 200K/1M  │ 200K     │ 200K/1M  │ 1M             │
│ Cost/MTok │ $3/$15   │ $1/$5    │ $5/$25   │ $2/$8          │
│ Speed     │ ●●●○     │ ●●●●    │ ●●○○     │ ●●●○           │
│ Coding    │ ●●●●     │ ●●●○    │ ●●●●    │ ●●●○           │
│ Reasoning │ ●●●●     │ ●●○○    │ ●●●●●   │ ●●●○           │
│ Projects  │ ✅        │ ✅       │ ✅        │ ❌              │
│ Skills    │ ✅        │ ✅       │ ✅        │ ❌              │
│ Artifacts │ ✅        │ ✅       │ ✅        │ ❌              │
├───────────┼──────────┼──────────┼──────────┼─────────────────┤
│ Best for  │ Most     │ Quick    │ Complex  │ Large context  │
│           │ sessions │ fixes    │ design   │ review         │
└───────────┴──────────┴──────────┴──────────┴─────────────────┘
│ [Set Default: Sonnet 4.5 ▾]  [Add Custom Engine]             │
└───────────────────────────────────────────────────────────────┘
```

---

## Building Block 3: Session Types

### Why Session Types Matter
Not every AI interaction is the same. A bug fix session needs different context, a different engine, and a different prompt structure than an architecture design session. By classifying sessions, CC can optimize everything upstream.

### Session Type Definitions

| Session Type | Purpose | Typical Engine | Context Strategy | Output |
|-------------|---------|---------------|------------------|--------|
| **Build** | Implement a defined work item | Sonnet 4.5 | Full source + targeted brief + work item context | Updated source + version bump |
| **Design** | Architect a new feature or system | Opus 4.5 | CONTEXT.md + PROJECT_PLAN.md + problem statement (NOT full source) | Design doc, data model, approach |
| **Fix** | Address a specific bug or issue | Sonnet 4.5 or Haiku 4.5 | Full source + issue details + repro steps | Patched source + version bump |
| **Test** | Write or execute test plans | Sonnet 4.5 | Source + test plan + acceptance criteria | Test results, identified issues |
| **Research** | Explore approaches, compare options | Haiku 4.5 or Opus 4.5 | Minimal source, heavy on problem context | Analysis doc, recommendations |
| **Review** | Code review, quality assessment | Sonnet 4.5 | Full source + quality criteria + milestone definition | Review findings, suggested fixes |
| **Polish** | UI refinement, copy editing, accessibility | Haiku 4.5 | Full source + specific polish targets | Updated source + version bump |
| **Document** | Update docs, write guides | Haiku 4.5 | Existing docs + source architecture summary | Updated docs |

### What Changes Per Session Type

**Context Package differs:**

| Session Type | Source Code | Docs | Session Brief | Extra |
|-------------|------------|------|---------------|-------|
| Build | Full or relevant sections | CONTEXT + PLAN + INSTRUCTIONS | Work item + criteria | Related work items |
| Design | Architecture summary only | CONTEXT + PLAN | Problem statement + constraints | Reference apps, patterns |
| Fix | Full (bug could be anywhere) | CONTEXT only | Issue details + repro | Error logs, screenshots |
| Test | Full | Test plan | Milestone criteria | Test data, edge cases |
| Research | Minimal | Problem statement | Open questions | External references |
| Review | Full | Quality standards | Milestone criteria | Style guide |
| Polish | Full | Design notes | Polish targets | Accessibility checklist |
| Document | Architecture summary | All existing docs | What needs updating | Audience definition |

**Prompt Template differs:**
Each session type gets a tailored system prompt prefix in SESSION_BRIEF.md:

```markdown
## Session Type: Build
You are implementing a specific feature. Focus on the work item below.
Do NOT refactor unrelated code. Do NOT add features beyond scope.
Deliver: updated source files, version bump, changelog entry.

## Session Type: Design  
You are designing, not coding. Produce a written design document.
Consider alternatives. Identify risks and tradeoffs.
Do NOT write implementation code unless specifically asked.
Deliver: design document with architecture decisions.

## Session Type: Fix
You are fixing a specific bug. Focus on root cause analysis first.
Minimize changes — surgical fix preferred over refactor.
Deliver: patched source files, version bump, issue reference.

## Session Type: Test
You are validating that acceptance criteria are met.
Walk through each criterion systematically. Report pass/fail.
Identify edge cases not covered by current criteria.
Deliver: test results document, new issues if found.
```

### Session Type Selection in Claude Prep

The Claude Prep modal gets a session type selector as the first step:

```
┌─────────────────────────────────────────────────────┐
│  Claude Prep — Game Shelf                           │
├─────────────────────────────────────────────────────┤
│                                                     │
│  What type of session?                              │
│                                                     │
│  🔨 Build    Implement a work item                  │
│  🎨 Design   Architect a feature or system    ← CC  │
│  🔧 Fix      Address a bug or issue             picks│
│  🧪 Test     Write or run tests                default│
│  🔍 Research Explore, compare, analyze          based│
│  📋 Review   Code review, quality check         on   │
│  ✨ Polish   UI refinement, accessibility       work │
│  📝 Document Update docs                        item │
│                                                     │
│  [Continue →]                                       │
└─────────────────────────────────────────────────────┘
```

If a work item is selected, CC auto-suggests the session type:
- Work item type `feature` → Build
- Work item type `bugfix` → Fix  
- Work item type `enhancement` → Build or Polish (based on tags)
- Work item type `chore` → Build or Document
- No work item, milestone selected → Test or Review

---

## Building Block 4: Session Recommendation Engine

### What It Does
Given a work item (or session intent), CC recommends the optimal combination of: engine, context package contents, session type, prompt strategy, and estimated cost.

### Recommendation Flow

```
Input: Work Item WI-042 (Sound effects, Build session)
  │
  ├── 1. Calculate token budget
  │    ├── Source: index.html = 308.5K tokens
  │    ├── Docs: 14.4K tokens  
  │    ├── Brief: 1.8K tokens
  │    └── Total: 324.7K tokens
  │
  ├── 2. Check against engines
  │    ├── Sonnet 4.5 (200K): ❌ Over by 124.7K
  │    ├── Sonnet 4.5 (1M extended): ✅ Fits, $6/$22.50 per MTok
  │    ├── Haiku 4.5 (200K): ❌ Over + lower coding quality
  │    ├── GPT-4.1 (1M): ✅ Fits, $2/$8 per MTok
  │    └── Gemini 2.5 Pro (2M): ✅ Fits easily, $1.25/$10
  │
  ├── 3. Consider alternatives
  │    ├── Trim to relevant sections only:
  │    │    AudioManager + GameBoard ≈ 15K tokens
  │    │    + docs + brief = ~32K tokens
  │    │    → Sonnet 4.5 (200K) works ✅
  │    └── Use architecture summary:
  │         ~40K tokens + docs + brief = ~56K
  │         → Sonnet 4.5 (200K) works ✅
  │
  ├── 4. Score options
  │    ├── Option A: Sonnet 4.5 + section extraction
  │    │    Quality: ●●●● | Cost: $~0.50 | Risk: May miss dependencies
  │    ├── Option B: Sonnet 4.5 + architecture summary  
  │    │    Quality: ●●●○ | Cost: $~0.85 | Risk: Less precise edits
  │    ├── Option C: Sonnet 4.5 (1M extended) + full source
  │    │    Quality: ●●●●● | Cost: $~4.50 | Risk: None
  │    └── Option D: GPT-4.1 + full source
  │         Quality: ●●●○ | Cost: $~1.50 | Risk: Lower code quality
  │
  └── 5. Recommend
       "Recommended: Sonnet 4.5 with relevant sections extracted.
        WI-042 affects AudioManager and GameBoard components.
        Estimated package: 32K tokens. Estimated session cost: ~$0.50.
        
        Alternative: Use 1M extended context for full source access.
        Higher cost (~$4.50) but zero risk of missing dependencies."
```

### Recommendation Display

```
┌─────────────────────────────────────────────────────────┐
│  Session Plan: WI-042 — Sound effects                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  📊 Recommended Setup                                    │
│                                                         │
│  Engine:    Claude Sonnet 4.5 (200K)                    │
│  Type:      🔨 Build                                     │
│  Strategy:  Section extraction (AudioManager + GameBoard)│
│  Package:   ~32K tokens (16% of context)                │
│  Room:      ~168K tokens for conversation               │
│  Est. cost: ~$0.50                                      │
│                                                         │
│  📦 Package Contents                                     │
│  ├── index.html (sections only)      15,200 tokens      │
│  ├── CLAUDE_INSTRUCTIONS.md           2,100 tokens      │
│  ├── CONTEXT.md                       4,300 tokens      │
│  ├── SESSION_BRIEF.md (targeted)      1,800 tokens      │
│  ├── CHANGELOG.md (last 5 entries)    1,200 tokens      │
│  └── Total                           24,600 tokens      │
│                                                         │
│  💡 Alternative: Full source + 1M context ($4.50)        │
│                                                         │
│  [Generate Package]  [Customize]  [Switch Engine]        │
└─────────────────────────────────────────────────────────┘
```

---

## Building Block 5: Environment Optimization

### Claude Projects
Claude Projects allow persistent context that doesn't consume tokens from each conversation. This is significant for CC: if CLAUDE_INSTRUCTIONS.md and CONTEXT.md live in a Project, they're "free" — always available without eating into the session's token budget.

**CC should recommend and help configure Claude Projects:**
- One Project per CC App (Game Shelf Project, LabelKeeper Project, etc.)
- Project Knowledge: CLAUDE_INSTRUCTIONS.md, CONTEXT.md, DATA_MODEL.md
- Project Instructions: session protocol, version rules, delivery expectations
- Benefit: ~10-20K tokens of context becomes persistent and free

**CC could generate a "Project Setup Guide":**
```markdown
## Setting Up Claude Project: Game Shelf

1. Create a new Project in Claude named "Game Shelf Development"
2. Upload these files to Project Knowledge:
   - CLAUDE_INSTRUCTIONS.md (2,100 tokens — saved every session)
   - CONTEXT.md (4,300 tokens — saved every session)
   - DATA_MODEL.md (3,200 tokens — saved every session)
3. Set Project Instructions to: [CC generates this]
4. Savings: ~9,600 tokens per session = ~$0.03 input saved per session

Now when you start a session, only upload:
   - index.html (source code)
   - SESSION_BRIEF.md (targeted work item)
```

### Claude Skills
Skills are instruction sets that Claude reads before performing tasks. CC already leverages skills (docx, xlsx, pdf, etc.). For the CC ecosystem:

- **Game Shelf Skill**: Firebase patterns, UI components, game rules
- **CC Skill**: Deployment conventions, version management, session protocol
- **Session Continuity Skill**: How to recover context after compaction

CC could manage skill files and include them in packages or recommend which skills to enable for a given session type.

### Platform Feature Matrix

Different session types benefit from different platform features:

| Session Type | Projects | Skills | Artifacts | Computer Use | Web Search | Extended Thinking |
|-------------|----------|--------|-----------|-------------|------------|-------------------|
| Build | ✅ Always | Game-specific | Preview UI | Create files | Rarely | Complex logic |
| Design | ✅ Always | Architecture | Diagrams | Docs | Research | ✅ Always |
| Fix | ✅ Always | Debug | Preview fix | Test code | Stack Overflow | Root cause |
| Test | ✅ Always | Test frameworks | Test results | Run tests | Reference | Edge cases |
| Research | Optional | Domain-specific | Comparisons | Prototypes | ✅ Always | Analysis |
| Review | ✅ Always | Quality standards | Code diff | Linting | Best practices | Deep review |
| Polish | ✅ Always | Accessibility | Live preview | Generate assets | A11y standards | Rarely |
| Document | ✅ Always | Doc standards | Rendered docs | Create docs | Reference | Rarely |

CC could show this as a "recommended environment" alongside the engine and package recommendations.

---

## Building Block 6: Cost Tracking

### Per-Session Cost Estimation
Before a session starts, CC estimates the cost based on engine + package size:

```javascript
function estimateSessionCost(engine, packageTokens, estimatedConversationTokens) {
    const inputTokens = packageTokens + (estimatedConversationTokens * 0.3); // user messages ~30%
    const outputTokens = estimatedConversationTokens * 0.7; // AI output ~70%
    
    const inputCost = (inputTokens / 1_000_000) * engine.cost.input;
    const outputCost = (outputTokens / 1_000_000) * engine.cost.output;
    
    return {
        inputCost,
        outputCost,
        total: inputCost + outputCost,
        breakdown: {
            package: (packageTokens / 1_000_000) * engine.cost.input,
            conversation: inputCost + outputCost - (packageTokens / 1_000_000) * engine.cost.input
        }
    };
}
```

### Cumulative Cost Tracking
Over time, CC tracks estimated costs per app, per session type:

```
┌─────────────────────────────────────────────────────────┐
│  Cost Summary — January 2026                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Total estimated: $47.20 across 23 sessions             │
│                                                         │
│  By App:                                                │
│  🎮 Game Shelf      $22.50  (12 sessions)               │
│  🏗️ Command Center  $14.80  (6 sessions)                │
│  🏷️ LabelKeeper      $6.40  (3 sessions)               │
│  📖 Quotle            $3.50  (2 sessions)               │
│                                                         │
│  By Session Type:                                       │
│  🔨 Build    $31.00  (15 sessions)  avg $2.07/session   │
│  🎨 Design    $8.20  (3 sessions)   avg $2.73/session   │
│  🔧 Fix       $4.50  (3 sessions)   avg $1.50/session   │
│  📝 Document  $3.50  (2 sessions)   avg $1.75/session   │
│                                                         │
│  💡 Tip: 4 Build sessions used full source (1M context). │
│     Section extraction would have saved ~$12.00.         │
└─────────────────────────────────────────────────────────┘
```

Note: These are estimates based on package size and typical conversation length. CC doesn't have visibility into actual API usage (that's in Anthropic's dashboard). But the estimates help you understand relative costs and identify optimization opportunities.

---

## Building Block 7: Prompt Templates

### What It Does
Pre-built, session-type-aware prompt templates that CC injects into SESSION_BRIEF.md. These aren't just instructions — they're the accumulated wisdom of what makes AI sessions productive.

### Template Structure

Each template has three sections:

**1. Role Frame** — Tell the AI what it is for this session
**2. Task Scope** — What to do and what NOT to do  
**3. Delivery Requirements** — What must be produced

### Example: Build Session Template

```markdown
## Session Protocol: Build

### Role
You are building a specific feature for {appName}. You have access to 
the current source code and project documentation. Focus exclusively 
on the work item described below.

### Scope Rules
- ✅ Implement the work item as described
- ✅ Follow acceptance criteria exactly
- ✅ Use the established tech stack and patterns from CONTEXT.md
- ✅ Increment version (minor for new feature, patch for refinement)
- ❌ Do NOT refactor code unrelated to this work item
- ❌ Do NOT add features not listed in acceptance criteria
- ❌ Do NOT upgrade dependencies unless required by this work item
- ❌ Do NOT over-engineer past {maturityLevel} quality level

### Maturity Constraint: {maturityLevel}
{maturityCriteria — what to build to, what NOT to include}

### Delivery Requirements
Every session MUST produce:
1. Updated source file(s) with version incremented
2. Updated CHANGELOG.md with new entry
3. Updated RELEASE_NOTES.txt
4. Updated PROJECT_PLAN.md if status changed
5. All files packaged as {appId}-project-v{version}.zip
```

### Template Variables
CC fills these automatically from the work item + app config:
- `{appName}`, `{appId}`, `{version}`
- `{maturityLevel}`, `{maturityCriteria}`
- `{workItemTitle}`, `{workItemDescription}`, `{acceptanceCriteria}`
- `{filesAffected}`, `{sectionsAffected}`, `{dependencies}`
- `{sessionType}`, `{engineName}`

---

## How It All Comes Together

### The Orchestrated Session Flow

```
1. SELECT WORK ITEM
   User picks WI-042 from backlog (or CC suggests next item)
   
2. CC ANALYZES
   ├── Token count: index.html = 308.5K, docs = 14.4K
   ├── Work item context: files = AudioManager, GameBoard
   ├── Milestone: Beta
   └── Default session type: Build (feature work item)

3. CC RECOMMENDS
   ├── Engine: Sonnet 4.5 (200K standard)
   ├── Strategy: Section extraction (32K package)
   ├── Estimated cost: ~$0.50
   ├── Platform: Use Game Shelf Project for persistent docs
   ├── Features: Artifacts for UI preview, Computer Use for file creation
   └── Alternative: 1M context for full source ($4.50)

4. USER CONFIRMS / ADJUSTS
   ├── Accepts recommendation, or
   ├── Switches to full source, or
   ├── Changes engine, or
   └── Adjusts package contents

5. CC GENERATES PACKAGE
   ├── Extracts relevant source sections
   ├── Includes targeted SESSION_BRIEF.md with:
   │    ├── Session type prompt template (Build)
   │    ├── Work item details + acceptance criteria
   │    ├── Context hints (files, sections, deps)
   │    ├── Maturity constraints (Beta level)
   │    └── Delivery requirements
   ├── Includes project docs (or notes they're in Project Knowledge)
   ├── Shows token budget visualization
   └── Produces downloadable zip

6. USER RUNS SESSION
   ├── Uploads package to Claude (or AI engine of choice)
   ├── Claude reads targeted brief, knows exactly what to build
   ├── Iterative development within session
   └── Produces deliverable package

7. USER RETURNS TO CC
   ├── Drags package to CC
   ├── CC detects app, version, validates
   ├── Deploys to test environment
   ├── CC asks: "Does this complete WI-042?"
   ├── If yes: WI-042 → done, milestone progress updated
   └── Session logged with estimated cost, duration, outcome

8. CYCLE REPEATS
   └── Next work item ready, CC has learned:
       actual session duration, package size that worked,
       work items completed per session
```

---

## Implementation Roadmap

### Phase 1: Token Awareness (1-2 sessions)
- Heuristic token estimator function
- Token count display on Claude Prep package files
- Context budget visualization (bar chart)
- Warning when package exceeds model context window

### Phase 2: Engine Registry (1 session)  
- Engine data model in CC config
- Engine comparison view in Settings
- Default engine selection per user
- Engine recommendation based on package size vs. context window

### Phase 3: Session Types (1-2 sessions)
- Session type enum and selection in Claude Prep modal
- Auto-suggest session type from work item type
- Session-type-specific prompt templates in SESSION_BRIEF.md
- Context package content varies by session type

### Phase 4: Recommendation Engine (2-3 sessions)
- Section extraction logic (parse source for relevant components)
- Architecture summary generator
- Full recommendation pipeline: analyze → score → recommend
- Recommendation UI in Claude Prep modal

### Phase 5: Cost Tracking & Environment Optimization (1-2 sessions)
- Per-session cost estimation
- Cumulative cost tracking in Firebase
- Claude Projects setup guide generator
- Platform feature recommendations per session type

### Phase 6: Backlog + Milestone Integration (from earlier design)
- Work items, milestone tracking, targeted sessions
- Deploy close-the-loop
- Velocity metrics

**Total: 8-12 sessions to build the full orchestrator.**

---

## The Pitch

**Before (CC today):**
"I need to work on Game Shelf. Let me generate a Claude Prep package. [Gets 330K token zip.] Upload to Claude. Hope it fits. Spend 10 minutes explaining what to build. Hope Claude doesn't over-engineer. Deploy result. Manually track what I did."

**After (CC as orchestrator):**
"I select WI-042 from the backlog. CC tells me it's a Build session, recommends Sonnet 4.5 with section extraction at ~32K tokens, estimates $0.50, and notes my Game Shelf Project already has the persistent docs loaded. I click Generate. The SESSION_BRIEF.md tells Claude exactly what to build, what quality level to hit, and what to deliver. Claude is productive from the first message. The result comes back, I deploy it, CC marks the work item done and updates my milestone progress. Total friction: about 30 seconds of setup for a fully optimized AI development session."

That's the value. Every session better than the last, because the orchestrator is learning what works.
