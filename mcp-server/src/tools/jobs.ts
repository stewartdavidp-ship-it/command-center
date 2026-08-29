import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getJobsRef, getJobRef, getConceptsRef, getIdeasRef, getAppIdeasRef, getDocumentsRef } from "../firebase.js";
import { getCurrentUid } from "../context.js";
import { withResponseSize } from "../response-metadata.js";
import { ensureSession } from "../session-lifecycle.js";
import { SURFACES, INITIATOR_PARAM, resolveInitiator } from "../surfaces.js";
import { findCandidates, formatDidYouMean } from "../fuzzy-match.js";

const JOB_STATUSES = ["draft", "active", "review", "approved", "completed", "failed", "abandoned"] as const;
const TERMINAL_STATUSES = ["completed", "failed", "abandoned"];

const JOB_TYPES = ["build", "maintenance", "test", "skill-update", "cleanup"] as const;

const JOB_EVENT_TYPES = [
  "open_encountered",
  "decision_made",
  "file_changed",
  "test_result",
  "blocker",
  "deviation",
  "concept_addressed",
  "concept_created",
  "concept_transitioned",
  "note",
  "question",
  "answer",
] as const;

export function registerJobTools(server: McpServer): void {

  // job — Universal work order lifecycle tool
  server.tool(
    "job",
    `Universal work order lifecycle tool. Jobs are the single handoff artifact between Claude Chat and Claude Code.

State machine: draft → active → review → approved → completed/failed/abandoned
                                  review → draft (via revise)
                         active → completed/failed/abandoned (direct)

Chat creates draft jobs with instructions, attachments, and concept snapshots. Code discovers drafts via list(status="draft"), claims them (draft→active), and executes.

Actions:
  - "start": Create a new job. Requires appId, title. Optional: ideaId, claudeMdSnapshot, preConditions, exceptionsNoted, instructions, attachments (JSON string), conceptSnapshot (JSON string), jobType, createdBy, reviewTier, reviewLenses. Creator is resolved as createdBy || initiator || "unknown". If that resolves to "claude-chat", initial status is "draft". Otherwise "active" (backward compat).
  - "claim": Code claims a draft job to start work. Requires jobId. Validates status=draft. For build jobs, rejects if another active build exists for the same appId. Sets status=active, claimedAt, claimedBy.
  - "revise": Send a reviewed job back to draft for Chat revision. Requires jobId. Validates status=review. Sets status=draft.
  - "review": Flag spec concerns. Requires jobId, concerns. Validates status=active. Sets status=review.
  - "approve": Approve a reviewed job. Requires jobId. Optional: resolutions. Validates status=review. Sets status=approved.
  - "update": Update job fields. Requires jobId. instructions and attachments can only be updated on draft jobs. externalRefs can be updated on any non-terminal job.
  - "add_event": Append event to job log. Requires jobId, eventType, detail. Optional: refId, lens.
  - "complete": Finalize job. Requires jobId, status (completed/failed/abandoned), summary. Optional: filesChanged, testsRun, testsPassed, testsFailed, buildSuccess, linesAdded, linesRemoved, deployId.
  - "get": Get job by ID. Requires jobId. Returns lean response by default (instructions and attachments excluded). Use includeInstructions=true to include full content.
  - "list": List jobs. Optional filters: appId, ideaId, status, createdBy, jobType, limit.
  - "delete": Delete a job. Requires jobId. Use for test cleanup only.`,
    {
      ...INITIATOR_PARAM,
      action: z.enum(["start", "claim", "revise", "review", "approve", "update", "add_event", "complete", "get", "list", "delete"]).describe("Action to perform"),
      jobId: z.string().optional().describe("Job ID (required for claim/revise/review/approve/update/add_event/complete/get)"),
      appId: z.string().optional().describe("App ID (required for start, optional filter for list)"),
      ideaId: z.string().optional().describe("Idea ID (optional for start, optional filter for list)"),
      title: z.string().optional().describe("Job title (required for start, optional for update)"),
      instructions: z.string().optional().describe("What to build — task description from Chat (optional for start/update, only editable on draft)"),
      attachments: z.string().optional().describe("JSON string: array of {type, label, content, targetPath?, action?} content blocks (optional for start/update, only editable on draft)"),
      conceptSnapshot: z.string().optional().describe("JSON string: {rules, constraints, decisions, opens} ODRC state at creation (optional for start)"),
      jobType: z.string().optional().describe("Job type: build|maintenance|test|skill-update|cleanup (optional for start, default: build)"),
      createdBy: z.string().optional().describe(`Creator surface for start. Falls back to initiator, then "unknown" — pass one of them so the job can be attributed and its completion notice routed. claude-chat creates drafts, others create active. Valid: ${SURFACES.join(", ")}`),
      claudeMdSnapshot: z.string().optional().describe("CLAUDE.md content being executed (optional for start — prefer attachments)"),
      preConditions: z.string().optional().describe("Notes on state going in (optional for start/update)"),
      exceptionsNoted: z.array(z.string()).optional().describe("Things flagged before starting (optional for start/update)"),
      concerns: z.array(z.string()).optional().describe("Spec concerns (required for review)"),
      resolutions: z.string().optional().describe("How concerns were resolved (optional for approve)"),
      eventType: z.enum(JOB_EVENT_TYPES).optional().describe("Event type (required for add_event)"),
      detail: z.string().optional().describe("Event description (required for add_event)"),
      refId: z.string().optional().describe("Related concept/file ID (optional for add_event)"),
      lens: z.string().optional().describe("Review lens that produced this event (e.g., 'technical', 'security', 'economics'). For lens-based reviews. Optional for add_event."),
      reviewTier: z.enum(["basic", "intermediate", "full"]).optional().describe("Review depth: basic (1 lens), intermediate (3 lenses), full (all 6 review lenses). Optional for start/update."),
      reviewLenses: z.array(z.string()).optional().describe("Specific review lenses to apply (e.g., ['technical', 'security', 'economics']). Overrides tier defaults. Optional for start/update."),
      status: z.enum(JOB_STATUSES).optional().describe("Final status (required for complete: completed/failed/abandoned, optional filter for list: any status including draft)"),
      summary: z.string().optional().describe("Final summary (required for complete)"),
      conceptsAddressed: z.array(z.string()).optional().describe("Concept IDs addressed (optional for complete)"),
      filesChanged: z.array(z.string()).optional().describe("Files changed (optional for complete)"),
      testsRun: z.number().optional().describe("Total tests run (optional for complete)"),
      testsPassed: z.number().optional().describe("Tests passed (optional for complete)"),
      testsFailed: z.number().optional().describe("Tests failed (optional for complete)"),
      buildSuccess: z.boolean().optional().describe("Build success (optional for complete)"),
      linesAdded: z.number().optional().describe("Lines added (optional for complete)"),
      linesRemoved: z.number().optional().describe("Lines removed (optional for complete)"),
      deployId: z.string().optional().describe("Deploy record ID (optional for complete)"),
      limit: z.number().int().optional().describe("Max results to return for list action (default: 20)"),
      offset: z.number().int().optional().describe("Number of items to skip for pagination (default: 0)"),
      externalRefs: z.array(z.object({
        system: z.string().describe("External system identifier (e.g., 'jira', 'linear', 'github')"),
        externalId: z.string().describe("ID in the external system"),
        externalUrl: z.string().optional().describe("Direct link to the external item"),
        refType: z.string().optional().describe("Type of external item (e.g., 'issue', 'pr', 'ticket')"),
        syncDirection: z.enum(["push", "pull", "bidirectional"]).optional().describe("Sync direction"),
        lastSyncedAt: z.string().optional().describe("ISO timestamp of last sync"),
        syncStatus: z.enum(["current", "stale", "conflict"]).optional().describe("Current sync status"),
      })).max(50).optional().describe("External system references (optional for update). Max 50 entries."),
      includeSnapshot: z.boolean().optional().describe("For 'get': include claudeMdSnapshot in response (default: false — saves context window)"),
      includeInstructions: z.boolean().optional().describe("For 'get': include instructions and attachments in response (default: false — saves context window)"),
    },
    async ({ initiator, action, jobId, appId, ideaId, title, instructions, attachments, conceptSnapshot, jobType, createdBy, claudeMdSnapshot, preConditions, exceptionsNoted, concerns, resolutions, eventType, detail, refId, lens, reviewTier, reviewLenses, status, summary, conceptsAddressed, filesChanged, testsRun, testsPassed, testsFailed, buildSuccess, linesAdded, linesRemoved, deployId, externalRefs, limit, offset, includeSnapshot, includeInstructions }) => {
      resolveInitiator({ initiator, createdBy });
      const uid = getCurrentUid();

      // ─── START ───
      if (action === "start") {
        if (!appId) return withResponseSize({ content: [{ type: "text", text: "action 'start' requires appId" }], isError: true });
        if (!title) return withResponseSize({ content: [{ type: "text", text: "action 'start' requires title" }], isError: true });

        // Mismatch detection: check if job's appId/ideaId matches active session context
        // This is a cache hit (free) — Firebase query was done in middleware
        const sessionCheck = await ensureSession({ appId, ideaId: ideaId || undefined });

        // Parse attachments JSON if provided
        let parsedAttachments: any[] | null = null;
        if (attachments) {
          try {
            parsedAttachments = JSON.parse(attachments);
            if (!Array.isArray(parsedAttachments)) {
              return withResponseSize({ content: [{ type: "text", text: "attachments must be a JSON array" }], isError: true });
            }
          } catch {
            return withResponseSize({ content: [{ type: "text", text: "attachments must be valid JSON" }], isError: true });
          }
        }

        // Parse conceptSnapshot JSON if provided
        let parsedSnapshot: any | null = null;
        if (conceptSnapshot) {
          try {
            parsedSnapshot = JSON.parse(conceptSnapshot);
          } catch {
            return withResponseSize({ content: [{ type: "text", text: "conceptSnapshot must be valid JSON" }], isError: true });
          }
        }

        // Determine initial status: claude-chat creates drafts, everything else creates active.
        // Honour `initiator` as well as the legacy `createdBy`. Every current surface
        // sends `initiator` (the shared INITIATOR_PARAM) and many send nothing else —
        // reading only `createdBy` recorded those jobs as "unknown" AND skipped the
        // draft branch, so a Chat-created job came back as an active build and its
        // review/complete notification was addressed to the non-existent "unknown"
        // surface. `claim` already resolved through the same chain; `start` did not.
        // Explicit createdBy still wins, so a caller can attribute on behalf of another surface.
        const effectiveCreatedBy = createdBy || initiator || "unknown";
        const initialStatus = effectiveCreatedBy === "claude-chat" ? "draft" : "active";

        const ref = getJobsRef(uid).push();
        const now = new Date().toISOString();
        const job: Record<string, any> = {
          id: ref.key,
          appId,
          ideaId: ideaId || null,
          status: initialStatus,
          title,
          jobType: jobType || "build",
          createdBy: effectiveCreatedBy,
          instructions: instructions || null,
          attachments: parsedAttachments || [],
          conceptSnapshot: parsedSnapshot || null,
          claudeMdSnapshot: claudeMdSnapshot || null,
          claudeMdGeneratedAt: null,
          preConditions: preConditions || null,
          exceptionsNoted: exceptionsNoted || [],
          events: [],
          conceptsAddressed: [],
          conceptsCreated: [],
          conceptsModified: [],
          filesChanged: [],
          concerns: [],
          reviewTier: reviewTier || null,
          reviewLenses: reviewLenses || [],
          reviewedAt: null,
          approvedAt: null,
          resolutions: null,
          claimedAt: null,
          claimedBy: null,
          summary: null,
          outcome: {
            testsRun: null,
            testsPassed: null,
            testsFailed: null,
            buildSuccess: null,
            deployId: null,
          },
          startedAt: initialStatus === "active" ? now : null,
          createdAt: now,
          completedAt: null,
          duration: null,
          metadata: {
            toolCallCount: 0,
            linesAdded: null,
            linesRemoved: null,
          },
        };
        await ref.set(job);

        // Increment idea jobCount if linked to an idea
        if (ideaId) {
          const ideaRef = getIdeasRef(uid).child(ideaId);
          const ideaSnap = await ideaRef.once("value");
          const idea = ideaSnap.val();
          if (idea) {
            await ideaRef.update({
              jobCount: (idea.jobCount || 0) + 1,
              updatedAt: new Date().toISOString(),
            });
          }
        }

        const result: any = job;
        if (sessionCheck.mismatch) {
          result._sessionMismatch = {
            warning: "Job appId/ideaId does not match active session context",
            activeSession: sessionCheck.existingSession,
          };
        }
        return withResponseSize({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      }

      // ─── CLAIM ───
      if (action === "claim") {
        if (!jobId) return withResponseSize({ content: [{ type: "text", text: "action 'claim' requires jobId" }], isError: true });

        const ref = getJobRef(uid, jobId);
        const snapshot = await ref.once("value");
        const job = snapshot.val();

        if (!job) return withResponseSize({ content: [{ type: "text", text: `Job not found: ${jobId}` }], isError: true });
        if (job.status !== "draft") {
          return withResponseSize({ content: [{ type: "text", text: `Can only claim a draft job (current status: ${job.status})` }], isError: true });
        }

        // For build jobs, enforce one active build per app
        if (job.jobType === "build" || !job.jobType) {
          const allJobsSnap = await getJobsRef(uid).once("value");
          const allJobs = allJobsSnap.val();
          if (allJobs) {
            const activeBuilds = Object.values(allJobs as Record<string, any>).filter(
              (j: any) => j.appId === job.appId && j.status === "active" && (j.jobType === "build" || !j.jobType) && j.id !== jobId
            );
            if (activeBuilds.length > 0) {
              return withResponseSize({ content: [{ type: "text", text: `Cannot claim: an active build job already exists for app '${job.appId}' (jobId: ${(activeBuilds[0] as any).id})` }], isError: true });
            }
          }
        }

        const now = new Date().toISOString();
        const updates = {
          status: "active",
          claimedAt: now,
          claimedBy: initiator || createdBy || "claude-code",
          startedAt: now,
        };
        await ref.update(updates);

        // Lean response: confirmation fields only
        const claimConfirmation = {
          id: job.id,
          title: job.title,
          status: "active",
          appId: job.appId,
          ideaId: job.ideaId,
          jobType: job.jobType || "build",
          claimedAt: updates.claimedAt,
          claimedBy: updates.claimedBy,
          startedAt: updates.startedAt,
          instructions: job.instructions || null,
          attachments: job.attachments || [],
          conceptSnapshot: job.conceptSnapshot || null,
          preConditions: job.preConditions || null,
          exceptionsNoted: job.exceptionsNoted || [],
        };
        return withResponseSize({ content: [{ type: "text", text: JSON.stringify(claimConfirmation, null, 2) }] });
      }

      // ─── REVISE ───
      if (action === "revise") {
        if (!jobId) return withResponseSize({ content: [{ type: "text", text: "action 'revise' requires jobId" }], isError: true });

        const ref = getJobRef(uid, jobId);
        const snapshot = await ref.once("value");
        const job = snapshot.val();

        if (!job) return withResponseSize({ content: [{ type: "text", text: `Job not found: ${jobId}` }], isError: true });
        if (job.status !== "review") {
          return withResponseSize({ content: [{ type: "text", text: `Can only revise a job in review (current status: ${job.status})` }], isError: true });
        }

        const updates = {
          status: "draft",
        };
        await ref.update(updates);
        return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ ...job, ...updates }, null, 2) }] });
      }

      // ─── REVIEW ───
      if (action === "review") {
        if (!jobId) return withResponseSize({ content: [{ type: "text", text: "action 'review' requires jobId" }], isError: true });
        if (!concerns || concerns.length === 0) return withResponseSize({ content: [{ type: "text", text: "action 'review' requires concerns (non-empty array)" }], isError: true });

        const ref = getJobRef(uid, jobId);
        const snapshot = await ref.once("value");
        const job = snapshot.val();

        if (!job) return withResponseSize({ content: [{ type: "text", text: `Job not found: ${jobId}` }], isError: true });
        if (job.status !== "active") {
          return withResponseSize({ content: [{ type: "text", text: `Can only review an active job (current status: ${job.status})` }], isError: true });
        }

        const now = new Date().toISOString();
        const updates = {
          status: "review",
          concerns,
          reviewedAt: now,
        };
        await ref.update(updates);

        // Auto-notify: send lightweight message to the job creator
        const reviewSurface = initiator || "unknown";
        if (job.createdBy && job.createdBy !== reviewSurface) {
          const notifyRef = getDocumentsRef(uid).push();
          const msg = {
            id: notifyRef.key,
            type: "message",
            appId: null,
            subject: `Job "${job.title}" — review`,
            content: `Job ${jobId} moved to review. ${concerns.length} concern(s) flagged.${job.reviewTier ? ` Review tier: ${job.reviewTier}.` : ""}`,
            metadata: {
              from: reviewSurface,
              to: job.createdBy,
              jobId,
              reviewTier: job.reviewTier || null,
            },
            routing: { targetPath: null, action: "message" },
            lifespan: "ephemeral",
            status: "pending",
            createdAt: now,
            createdBy: reviewSurface,
            deliveredAt: null,
            deliveredBy: null,
          };
          await notifyRef.set(msg);
        }

        return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ ...job, ...updates }, null, 2) }] });
      }

      // ─── APPROVE ───
      if (action === "approve") {
        if (!jobId) return withResponseSize({ content: [{ type: "text", text: "action 'approve' requires jobId" }], isError: true });

        const ref = getJobRef(uid, jobId);
        const snapshot = await ref.once("value");
        const job = snapshot.val();

        if (!job) return withResponseSize({ content: [{ type: "text", text: `Job not found: ${jobId}` }], isError: true });
        if (job.status !== "review") {
          return withResponseSize({ content: [{ type: "text", text: `Can only approve a job in review (current status: ${job.status})` }], isError: true });
        }

        const now = new Date().toISOString();
        const updates: Record<string, any> = {
          status: "approved",
          approvedAt: now,
        };
        if (resolutions !== undefined) updates.resolutions = resolutions;
        await ref.update(updates);
        return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ ...job, ...updates }, null, 2) }] });
      }

      // ─── UPDATE ───
      if (action === "update") {
        if (!jobId) return withResponseSize({ content: [{ type: "text", text: "action 'update' requires jobId" }], isError: true });

        const ref = getJobRef(uid, jobId);
        const snapshot = await ref.once("value");
        const job = snapshot.val();

        if (!job) return withResponseSize({ content: [{ type: "text", text: `Job not found: ${jobId}` }], isError: true });
        if (TERMINAL_STATUSES.includes(job.status)) {
          return withResponseSize({ content: [{ type: "text", text: `Cannot update terminal job (status: ${job.status})` }], isError: true });
        }

        const updates: Record<string, any> = {};
        if (title !== undefined) updates.title = title;
        if (preConditions !== undefined) updates.preConditions = preConditions;
        if (exceptionsNoted !== undefined) updates.exceptionsNoted = exceptionsNoted;

        // instructions and attachments can only be updated on draft jobs
        if (instructions !== undefined) {
          if (job.status !== "draft") {
            return withResponseSize({ content: [{ type: "text", text: "instructions can only be updated on draft jobs" }], isError: true });
          }
          updates.instructions = instructions;
        }
        if (attachments !== undefined) {
          if (job.status !== "draft") {
            return withResponseSize({ content: [{ type: "text", text: "attachments can only be updated on draft jobs" }], isError: true });
          }
          try {
            const parsed = JSON.parse(attachments);
            if (!Array.isArray(parsed)) {
              return withResponseSize({ content: [{ type: "text", text: "attachments must be a JSON array" }], isError: true });
            }
            updates.attachments = parsed;
          } catch {
            return withResponseSize({ content: [{ type: "text", text: "attachments must be valid JSON" }], isError: true });
          }
        }
        if (externalRefs !== undefined) updates.externalRefs = externalRefs;
        if (reviewTier !== undefined) updates.reviewTier = reviewTier;
        if (reviewLenses !== undefined) updates.reviewLenses = reviewLenses;

        await ref.update(updates);
        return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ ...job, ...updates }, null, 2) }] });
      }

      // ─── ADD_EVENT ───
      if (action === "add_event") {
        if (!jobId) return withResponseSize({ content: [{ type: "text", text: "action 'add_event' requires jobId" }], isError: true });
        if (!eventType) return withResponseSize({ content: [{ type: "text", text: "action 'add_event' requires eventType" }], isError: true });
        if (!detail) return withResponseSize({ content: [{ type: "text", text: "action 'add_event' requires detail" }], isError: true });

        const ref = getJobRef(uid, jobId);
        const snapshot = await ref.once("value");
        const job = snapshot.val();

        if (!job) return withResponseSize({ content: [{ type: "text", text: `Job not found: ${jobId}` }], isError: true });

        const event: Record<string, any> = {
          timestamp: new Date().toISOString(),
          type: eventType,
          detail,
          refId: refId || null,
          surface: initiator || null,
        };
        if (lens) event.lens = lens;

        const events = job.events || [];
        events.push(event);

        const updates: Record<string, any> = {
          events,
          "metadata/toolCallCount": (job.metadata?.toolCallCount || 0) + 1,
        };

        // Auto-track file changes and concept addresses
        if (eventType === "file_changed" && refId) {
          const fc = job.filesChanged || [];
          if (!fc.includes(refId)) {
            fc.push(refId);
            updates.filesChanged = fc;
          }
        }
        if (eventType === "concept_addressed" && refId) {
          const ca = job.conceptsAddressed || [];
          if (!ca.includes(refId)) {
            ca.push(refId);
            updates.conceptsAddressed = ca;
          }
        }

        await ref.update(updates);
        return withResponseSize({ content: [{ type: "text", text: JSON.stringify(event, null, 2) }] });
      }

      // ─── COMPLETE ───
      if (action === "complete") {
        if (!jobId) return withResponseSize({ content: [{ type: "text", text: "action 'complete' requires jobId" }], isError: true });
        if (!status) return withResponseSize({ content: [{ type: "text", text: "action 'complete' requires status (completed/failed/abandoned)" }], isError: true });
        if (!TERMINAL_STATUSES.includes(status)) {
          return withResponseSize({ content: [{ type: "text", text: `action 'complete' requires terminal status (completed/failed/abandoned), got: ${status}` }], isError: true });
        }
        if (!summary) return withResponseSize({ content: [{ type: "text", text: "action 'complete' requires summary" }], isError: true });

        const ref = getJobRef(uid, jobId);
        const snapshot = await ref.once("value");
        const job = snapshot.val();

        if (!job) return withResponseSize({ content: [{ type: "text", text: `Job not found: ${jobId}` }], isError: true });
        if (TERMINAL_STATUSES.includes(job.status)) {
          return withResponseSize({ content: [{ type: "text", text: `Cannot complete terminal job (status: ${job.status})` }], isError: true });
        }

        const now = new Date().toISOString();
        const startTime = new Date(job.startedAt || job.createdAt).getTime();
        const duration = Date.now() - startTime;

        // Merge accumulated arrays with completion params
        const mergedConceptsAddressed = [...new Set([...(job.conceptsAddressed || []), ...(conceptsAddressed || [])])];
        const mergedFilesChanged = [...new Set([...(job.filesChanged || []), ...(filesChanged || [])])];

        const updates: Record<string, any> = {
          status,
          completedAt: now,
          duration,
          summary,
          conceptsAddressed: mergedConceptsAddressed,
          filesChanged: mergedFilesChanged,
          "outcome/testsRun": testsRun ?? null,
          "outcome/testsPassed": testsPassed ?? null,
          "outcome/testsFailed": testsFailed ?? null,
          "outcome/buildSuccess": buildSuccess ?? null,
          "outcome/deployId": deployId ?? null,
          "metadata/linesAdded": linesAdded ?? null,
          "metadata/linesRemoved": linesRemoved ?? null,
        };

        await ref.update(updates);

        // ── Post-completion: auto-notify job creator ──
        const completeSurface = initiator || "unknown";
        if (job.createdBy && job.createdBy !== completeSurface) {
          const notifyRef = getDocumentsRef(uid).push();
          const notifyMsg = {
            id: notifyRef.key,
            type: "message",
            appId: null,
            subject: `Job "${job.title}" — ${status}`,
            content: `Job ${jobId} ${status}.${summary ? ` Summary: ${summary.substring(0, 200)}` : ""}`,
            metadata: {
              from: completeSurface,
              to: job.createdBy,
              jobId,
              status,
            },
            routing: { targetPath: null, action: "message" },
            lifespan: "ephemeral",
            status: "pending",
            createdAt: now,
            createdBy: completeSurface,
            deliveredAt: null,
            deliveredBy: null,
          };
          await notifyRef.set(notifyMsg);
        }

        // ── Post-completion: auto-transition concepts to "built" ──
        let conceptsBuilt: string[] = [];
        if (status === "completed" && mergedConceptsAddressed.length > 0) {
          const conceptsSnap = await getConceptsRef(uid).once("value");
          const conceptsData = conceptsSnap.val() || {};
          const conceptUpdates: Record<string, any> = {};

          for (const cid of mergedConceptsAddressed) {
            const concept = conceptsData[cid];
            if (concept && concept.status === "active" && concept.type === "DECISION") {
              conceptUpdates[`${cid}/status`] = "built";
              conceptUpdates[`${cid}/updatedAt`] = now;
              conceptsBuilt.push(cid);
            }
          }

          if (Object.keys(conceptUpdates).length > 0) {
            await getConceptsRef(uid).update(conceptUpdates);
          }
        }

        // ── Post-completion: update idea job counters ──
        let ideaSignal: any = null;
        if (job.ideaId) {
          const ideaRef = getIdeasRef(uid).child(job.ideaId);
          const ideaSnap = await ideaRef.once("value");
          const idea = ideaSnap.val();

          if (idea) {
            const ideaUpdates: Record<string, any> = {
              updatedAt: now,
            };

            if (status === "completed") {
              ideaUpdates.completedJobCount = (idea.completedJobCount || 0) + 1;
              ideaUpdates.lastJobCompletedAt = now;
            }

            await ideaRef.update(ideaUpdates);

            // ── Post-completion: compute idea readiness signal ──
            if (status === "completed") {
              // Get all concepts for this idea
              const allConceptsSnap = await getConceptsRef(uid).once("value");
              const allConceptsData = allConceptsSnap.val() || {};
              const ideaConcepts: any[] = Object.values(allConceptsData)
                .filter((c: any) => c.ideaOrigin === job.ideaId && c.status === "active");

              const activeDecisions = ideaConcepts.filter((c: any) => c.type === "DECISION").length;
              const activeOpens = ideaConcepts.filter((c: any) => c.type === "OPEN").length;

              // Check for pending jobs on this idea
              const allJobsSnap = await getJobsRef(uid).once("value");
              const allJobsData = allJobsSnap.val() || {};
              const pendingJobs = Object.values(allJobsData)
                .filter((j: any) => j.ideaId === job.ideaId && !["completed", "failed", "abandoned"].includes(j.status) && j.id !== jobId).length;

              const readyForClose = activeDecisions === 0 && activeOpens === 0 && pendingJobs === 0;

              ideaSignal = {
                ideaId: job.ideaId,
                ideaName: idea.name,
                ideaReadyForClose: readyForClose,
                remainingWork: {
                  activeDecisions,
                  activeOpens,
                  pendingJobs,
                  activeRules: ideaConcepts.filter((c: any) => c.type === "RULE").length,
                  activeConstraints: ideaConcepts.filter((c: any) => c.type === "CONSTRAINT").length,
                },
              };
            }
          }
        }

        // Lean response: confirmation fields only
        const completionConfirmation: any = {
          id: job.id,
          title: job.title,
          status,
          completedAt: now,
          duration,
          summary,
          conceptsAddressed: mergedConceptsAddressed,
          filesChanged: mergedFilesChanged,
          outcome: { testsRun: testsRun ?? null, testsPassed: testsPassed ?? null, testsFailed: testsFailed ?? null, buildSuccess: buildSuccess ?? null, deployId: deployId ?? null },
        };
        if (conceptsBuilt.length > 0) completionConfirmation.conceptsBuilt = conceptsBuilt;
        if (ideaSignal) completionConfirmation.ideaSignal = ideaSignal;
        return withResponseSize({ content: [{ type: "text", text: JSON.stringify(completionConfirmation, null, 2) }] });
      }

      // ─── GET ───
      if (action === "get") {
        if (!jobId) return withResponseSize({ content: [{ type: "text", text: "action 'get' requires jobId" }], isError: true });

        const ref = getJobRef(uid, jobId);
        const snapshot = await ref.once("value");
        const job = snapshot.val();

        if (!job) {
          // Fuzzy match against recent jobs
          const allSnap = await getJobsRef(uid).orderByKey().limitToLast(50).once("value");
          const allJobs = allSnap.val() || {};
          const entries = Object.entries(allJobs).map(([id, j]: [string, any]) => ({
            id,
            label: (j as any).title || undefined,
          }));
          const candidates = findCandidates(jobId!, entries);
          const did_you_mean = formatDidYouMean(candidates);
          const errorObj: any = { error: `Job not found: ${jobId}` };
          if (did_you_mean) errorObj.did_you_mean = did_you_mean;
          return withResponseSize({ content: [{ type: "text", text: JSON.stringify(errorObj, null, 2) }], isError: true });
        }

        // Strip large claudeMdSnapshot by default to save context window
        if (!includeSnapshot && job.claudeMdSnapshot) {
          const snapshotLen = job.claudeMdSnapshot.length;
          delete job.claudeMdSnapshot;
          job._snapshotExcluded = `claudeMdSnapshot (${snapshotLen} chars) excluded. Use includeSnapshot=true to include.`;
        }

        // Strip instructions and attachments by default to save context window
        if (!includeInstructions) {
          if (job.instructions) {
            const instrLen = job.instructions.length;
            delete job.instructions;
            job._instructionsExcluded = `instructions (${instrLen} chars) excluded. Use includeInstructions=true to include.`;
          }
          if (job.attachments && Array.isArray(job.attachments) && job.attachments.length > 0) {
            const attachLen = JSON.stringify(job.attachments).length;
            const attachCount = job.attachments.length;
            delete job.attachments;
            job._attachmentsExcluded = `${attachCount} attachments (${attachLen} chars) excluded. Use includeInstructions=true to include.`;
          }
          if (job.conceptSnapshot) {
            const snapLen = JSON.stringify(job.conceptSnapshot).length;
            delete job.conceptSnapshot;
            job._conceptSnapshotExcluded = `conceptSnapshot (${snapLen} chars) excluded. Use includeInstructions=true to include.`;
          }
        }

        // Cap events to last 20 to save context window
        if (job.events && Array.isArray(job.events)) {
          const totalEvents = job.events.length;
          job.eventCount = totalEvents;
          if (totalEvents > 20) {
            job.events = job.events.slice(-20);
            job._eventsTruncated = `Showing last 20 of ${totalEvents} events`;
          }
        }

        return withResponseSize({ content: [{ type: "text", text: JSON.stringify(job, null, 2) }] });
      }

      // ─── LIST ───
      if (action === "list") {
        const snapshot = await getJobsRef(uid).once("value");
        const data = snapshot.val();
        if (!data) return withResponseSize({ content: [{ type: "text", text: JSON.stringify([], null, 2) }] });

        let jobs: any[] = Object.values(data);

        if (appId) jobs = jobs.filter((j) => j.appId === appId);
        if (ideaId) jobs = jobs.filter((j) => j.ideaId === ideaId);
        if (status) jobs = jobs.filter((j) => j.status === status);
        if (createdBy) jobs = jobs.filter((j) => j.createdBy === createdBy);
        if (jobType) jobs = jobs.filter((j) => j.jobType === jobType);

        // Sort newest first (use createdAt if available, fall back to startedAt)
        jobs.sort((a, b) => {
          const aTime = new Date(a.createdAt || a.startedAt).getTime();
          const bTime = new Date(b.createdAt || b.startedAt).getTime();
          return bTime - aTime;
        });

        const total = jobs.length;
        const skip = offset && offset > 0 ? offset : 0;
        const take = limit && limit > 0 ? limit : 20;
        jobs = jobs.slice(skip, skip + take);

        // Lean response: summary fields only. Use get for full record.
        const lean = jobs.map((j) => ({
          id: j.id,
          title: j.title,
          status: j.status,
          appId: j.appId,
          ideaId: j.ideaId,
          jobType: j.jobType,
          createdBy: j.createdBy,
          claimedBy: j.claimedBy,
          createdAt: j.createdAt,
          startedAt: j.startedAt,
          completedAt: j.completedAt,
        }));

        const avgItemSize = lean.length > 0
          ? Math.round(lean.reduce((sum: number, item: any) => sum + JSON.stringify(item).length, 0) / lean.length)
          : 0;

        return withResponseSize(
          { content: [{ type: "text", text: JSON.stringify({ items: lean, total, offset: skip, limit: take }, null, 2) }] },
          { _estimatedItemSize: avgItemSize }
        );
      }

      // ─── DELETE ───
      if (action === "delete") {
        if (!jobId) return withResponseSize({ content: [{ type: "text", text: "action 'delete' requires jobId" }], isError: true });

        const ref = getJobRef(uid, jobId);
        const snapshot = await ref.once("value");
        if (!snapshot.val()) return withResponseSize({ content: [{ type: "text", text: `Job not found: ${jobId}` }], isError: true });

        await ref.remove();
        return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ deleted: jobId }) }] });
      }

      return withResponseSize({ content: [{ type: "text", text: `Unknown action: ${action}` }], isError: true });
    }
  );
}
