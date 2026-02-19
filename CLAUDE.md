<!-- cc-meta
appId: command-center
targetPath: CLAUDE.md
generatedAt: 2026-02-19
-->

# CLAUDE.md — Command Center

## What This Is
CC is a single-file HTML app (~24K lines). AI ideation and deployment management platform.
React via CDN, Firebase RTDB, GitHub API. All state: command-center/{uid}/

## Bootstrap Protocol
On every fresh start, do these in order:
1. Call `skill get cc-build-protocol` — your master build protocol, follow it
2. Call `skill get cc-skill-router` — discover all 26 available skills
3. Call `document list` with appId="command-center", status="pending" — check for queued docs
4. Call `document receive` — check for messages from Chat
5. Call `job list` with appId="command-center", status="draft" — check for work to claim

## Compaction Recovery
If you lost context mid-build (no jobId, user says "continue", or you don't remember loading skills):
1. Call `skill get cc-build-resume` — compaction recovery procedure for Code
2. Call `skill get cc-skill-router` — re-read the routing table
3. Call `job list` with status="active" — find the orphaned job
4. Do NOT start a new job — recover the existing one

## Critical Rules
- Single-file HTML app. All features in index.html
- Firebase RTDB under command-center/{uid}/
- Version bump on every deploy (meta tag in index.html)
- Deploy flow: test repo first, then promote to prod
- Every E2E test must clean up all Firebase data it creates
- Every token in a tool response is a token you pay for — keep responses lean

## Reference
- cc-project-instructions.md — full operational reference (Chat-side bootstrap)
- docs/logo-spec.md — logo architecture spec
