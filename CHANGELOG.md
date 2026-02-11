# Command Center — Changelog

## [8.46.0] — 2026-02-11

### Added
- **Activity Feed View (Phase 5.6)** — Full-page activity timeline as new sub-tab in Session Log
- Activity stats row: total events, contributors count, deploy count, session count
- Team Activity panel with per-actor summaries, avatars, and event breakdowns
- Activity filters by actor, app, action type, and stream (combinable with clear button)
- Day-grouped timeline with action-colored entries, hover metadata, and timestamps
- **TeamService (Phase 5.7)** — Multi-person workspace management via Firebase
- Team invite by email with pending/active status lifecycle
- Role-based access: owner (full + team management), editor (create/edit), viewer (read-only)
- Membership pointer system: member's node points to owner's workspace UID
- Team Management section in Settings with member list, role management, invite form
- Firebase security rules template generator with copy button
- `workspaceUid` computed value for shared data path access
- `canEdit` permission flag for viewer-mode enforcement
- Header workspace indicators: team count for owners, role badge for members

## [8.45.0] — 2026-02-10

### Added
- **ProductBriefGenerator** — Auto-generates PRODUCT_BRIEF.md from scope data, work items, deploys, streams, and lifecycle metadata. PM-language product description for cross-stream context sharing.
- **PRODUCT_BRIEF.md in Claude Prep packages** — Auto-generated and included in every session package. Design/Research sessions always include it; other session types prefer-include it.
- **ProductBriefModal** — Lightweight viewer (📄 button on app rows in Projects view) with rendered markdown and copy-to-clipboard
- **Product decisions formatting** — Scoping category answers translated to human-readable decisions (e.g. dataPersistence: firebase → "Saves to cloud, syncs across devices")
- **Feature inventory by status** — Shipped, In Progress, Planned, Ideas sections from work items with fallback to scope v1Features
- **Token estimation** — PRODUCT_BRIEF.md added to Environment Optimization doc listing (~3,000 tokens)

### Changed
- All 8 SESSION_TYPES context strategies updated to include PRODUCT_BRIEF.md (alwaysInclude for design/research, preferInclude for others)
- classifyFileAction treats PRODUCT_BRIEF.md as 'skip' (auto-generated, not pushed to repo)
- alreadyFetched set includes PRODUCT_BRIEF.md to avoid duplicate scanning

## [8.44.0] — 2026-02-10

### Added
- **DependencyAlertService** — Firebase service for dependency alert lifecycle (pending → updated/no_impact) with full CRUD, session/stream filtering, and getNextId
- **triggerAlerts()** — Orchestrated auto-remediation: detects dependencies on changed interface → creates work items in dependent streams → creates alert records → marks dependencies as 'changed' → logs to activity feed
- **Interface change detection in Post-Session Review** — Step 1 shows checklist of provided interfaces with dependents; user checks what changed, describes the change, and triggers alerts
- **Prompt chaining in SessionBriefGenerator** — dependency_update work items inject "Dependency Changes — Context from Source Session" section into session briefs with change description, affected interfaces, and source session notes
- **Pending alerts on stream cards** — Amber badge showing pending dependency updates count with change details
- **Pending Alerts summary stat** — WorkStreamsView summary row shows alert count when > 0
- **handleResolveAlert()** — Resolve alerts as 'updated' (verifies dependency) or 'no_impact' (dismisses)
- **globalDependencyAlerts** state — App component state with Firebase listener for `command-center/{uid}/dependencyAlerts`

### Changed
- PostSessionReviewModal receives streams, interfaces, dependencies, dependencyAlerts props
- SessionLogView passes stream/dependency props to PostSessionReviewModal
- WorkStreamsView accepts and uses globalDependencyAlerts prop
- Summary stats grid dynamically shows 5 columns when alerts pending

## [8.43.0] — 2026-02-10

### Added
- **WorkStreamService** — Firebase CRUD for work streams (Phase 5.2)
- **StreamInterfaceService** — Stream-provided interface contracts (Phase 5.4 foundation)
- **DependencyService** — Cross-stream dependency declarations (Phase 5.4 foundation)
- **WorkStreamsView** — Stream board view with cards, completion bars, items, interfaces, dependencies
- **StreamEditModal** — Create/edit streams with full metadata
- **Unified Work Item Model** — streamId field on work items (Phase 5.3)
- **BacklogView stream grouping** — group by stream, stream badges
- **ClaudePrepModal stream filter** — filter work items by stream
- **SessionBriefGenerator stream context** — stream details in briefs
- **Phase 5.1 decoupling** — skills recommendations now project-aware
- **Extensible categories** — getAllCategories() merges built-in + custom

## [8.42.0] — 2026-02-10

### Added
- Release Coordination View (Phase 4.4)
- Release Test Checklist (Phase 4.5)
- Per-app readiness assessment with go/no-go summary
- Auto-generated test checklists from work items and acceptance criteria

## [8.41.0] — 2026-02-10

### Added
- Product Health dashboard (Phase 4.1)
- Smart Quick Actions alignment (Phase 4.2)
- Progressive Disclosure (Phase 4.3)
- Pipeline Health panel
- Recent Activity feed in sidebar

## [8.40.0] — 2026-02-10

### Added
- Work Item Lifecycle Automation (Phase 3.3)
- Review status between in-progress and done
- Stale item detection badges
- Idea → Ready auto-suggest on criteria addition

## [8.39.0] — 2026-02-10

### Added
- Post-Session Review Flow (Phase 3.1)
- Activity Logging via ActivityLogService (Phase 3.4)
- Session pipeline: Prep → Review → Deploy

## [8.38.0] — 2026-02-10

### Changed
- PM-First Language rewrite (Phase 2) — all scoping questions, labels, outcome statements

## [8.37.0] — 2026-02-10

### Removed
- Scoping Step 4 (Standards checkboxes) — auto-assembled silently
- Session wizard Step 3 merged into Step 2

### Added
- Quick Build bypass for 0 work items
- "Your Name" field in Settings

## [8.36.5] — 2026-02-10

### Added
- StorageManager with priority-based localStorage cleanup

## [8.36.3] — 2026-02-10

### Fixed
- Version downgrade protection covers all deploy types

## [8.36.0] — 2026-02-10

### Added
- Unified Package Validation Engine

### Removed
- validateDocPackage, extraction-time showAlerts, deploy-time confirms, VersionWarningModal trigger
