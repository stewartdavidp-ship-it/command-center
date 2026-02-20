import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getJobsRef, getJobRef, getConceptsRef, getIdeasRef, getAppIdeasRef } from "../firebase.js";
import { getCurrentUid } from "../context.js";

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
  - "start": Create a new job. Requires appId, title. Optional: ideaId, claudeMdSnapshot, preConditions, exceptionsNoted, instructions, attachments (JSON string), conceptSnapshot (JSON string), jobType, createdBy. If createdBy="claude-chat", initial status is "draft". Otherwise "active" (backward compat).
  - "claim": Code claims a draft job to start work. Requires jobId. Validates status=draft. For build jobs, rejects if another active build exists for the same appId. Sets status=active, claimedAt, claimedBy.
  - "revise": Send a reviewed job back to draft for Chat revision. Requires jobId. Validates status=review. Sets status=draft.
  - "review": Flag spec concerns. Requires jobId, concerns. Validates status=active. Sets status=review.
  - "approve": Approve a reviewed job. Requires jobId. Optional: resolutions. Validates status=review. Sets status=approved.
  - "update": Update job fields. Requires jobId. instructions and attachments can only be updated on draft jobs.
  - "add_event": Append event to job log. Requires jobId, eventType, detail. Optional: refId.
  - "complete": Finalize job. Requires jobId, status (completed/failed/abandoned), summary. Optional: filesChanged, testsRun, testsPassed, testsFailed, buildSuccess, linesAdded, linesRemoved, deployId.
  - "get": Get job by ID. Requires jobId.
  - "list": List jobs. Optional filters: appId, ideaId, status, createdBy, jobType, limit.
  - "delete": Delete a job. Requires jobId. Use for test cleanup only.`,
    {
      action: z.enum(["start", "claim", "revise", "review", "approve", "update", "add_event", "complete", "get", "list", "delete"]).describe("Action to perform"),
      jobId: z.string().optional().describe("Job ID (required for claim/revise/review/approve/update/add_event/complete/get)"),
      appId: z.string().optional().describe("App ID (required for start, optional filter for list)"),
      ideaId: z.string().optional().describe("Idea ID (optional for start, optional filter for list)"),
      title: z.string().optional().describe("Job title (required for start, optional for update)"),
      instructions: z.string().optional().describe("What to build — task description from Chat (optional for start/update, only editable on draft)"),
      attachments: z.string().optional().describe("JSON string: array of {type, label, content, targetPath?, action?} content blocks (optional for start/update, only editable on draft)"),
      conceptSnapshot: z.string().optional().describe("JSON string: {rules, constraints, decisions, opens} ODRC state at creation (optional for start)"),
      jobType: z.string().optional().describe("Job type: build|maintenance|test|skill-update|cleanup (optional for start, default: build)"),
      createdBy: z.string().optional().describe("Creator: claude-chat|claude-code (optional for start; claude-chat creates drafts, claude-code creates active)"),
      claudeMdSnapshot: z.string().optional().describe("CLAUDE.md content being executed (optional for start — prefer attachments)"),
      preConditions: z.string().optional().describe("Notes on state going in (optional for start/update)"),
      exceptionsNoted: z.array(z.string()).optional().describe("Things flagged before starting (optional for start/update)"),
      concerns: z.array(z.string()).optional().describe("Spec concerns (required for review)"),
      resolutions: z.string().optional().describe("How concerns were resolved (optional for approve)"),
      eventType: z.enum(JOB_EVENT_TYPES).optional().describe("Event type (required for add_event)"),
      detail: z.string().optional().describe("Event description (required for add_event)"),
      refId: z.string().optional().describe("Related concept/file ID (optional for add_event)"),
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
      includeSnapshot: z.boolean().optional().describe("For 'get': include claudeMdSnapshot in response (default: false — saves context window)"),
    },
    async ({ action, jobId, appId, ideaId, title, instructions, attachments, conceptSnapshot, jobType, createdBy, claudeMdSnapshot, preConditions, exceptionsNoted, concerns, resolutions, eventType, detail, refId, status, summary, conceptsAddressed, filesChanged, testsRun, testsPassed, testsFailed, buildSuccess, linesAdded, linesRemoved, deployId, limit, offset, includeSnapshot }) => {
      const uid = getCurrentUid();

      // ─── START ───
      if (action === "start") {
        if (!appId) return { content: [{ type: "text", text: "action 'start' requires appId" }], isError: true };
        if (!title) return { content: [{ type: "text", text: "action 'start' requires title" }], isError: true };

        // Parse attachments JSON if provided
        let parsedAttachments: any[] | null = null;
        if (attachments) {
          try {
            parsedAttachments = JSON.parse(attachments);
            if (!Array.isArray(parsedAttachments)) {
              return { content: [{ type: "text", text: "attachments must be a JSON array" }], isError: true };
            }
          } catch {
            return { content: [{ type: "text", text: "attachments must be valid JSON" }], isError: true };
          }
        }

        // Parse conceptSnapshot JSON if provided
        let parsedSnapshot: any | null = null;
        if (conceptSnapshot) {
          try {
            parsedSnapshot = JSON.parse(conceptSnapshot);
          } catch {
            return { content: [{ type: "text", text: "conceptSnapshot must be valid JSON" }], isError: true };
          }
        }

        // Determine initial status: claude-chat creates drafts, everything else creates active
        const initialStatus = createdBy === "claude-chat" ? "draft" : "active";

        const ref = getJobsRef(uid).push();
        const now = new Date().toISOString();
        const job: Record<string, any> = {
          id: ref.key,
          appId,
          ideaId: ideaId || null,
          status: initialStatus,
          title,
          jobType: jobType || "build",
          createdBy: createdBy || "claude-code",
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

        return { content: [{ type: "text", text: JSON.stringify(job, null, 2) }] };
      }

      // ─── CLAIM ───
      if (action === "claim") {
        if (!jobId) return { content: [{ type: "text", text: "action 'claim' requires jobId" }], isError: true };

        const ref = getJobRef(uid, jobId);
        const snapshot = await ref.once("value");
        const job = snapshot.val();

        if (!job) return { content: [{ type: "text", text: `Job not found: ${jobId}` }], isError: true };
        if (job.status !== "draft") {
          return { content: [{ type: "text", text: `Can only claim a draft job (current status: ${job.status})` }], isError: true };
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
              return { content: [{ type: "text", text: `Cannot claim: an active build job already exists for app '${job.appId}' (jobId: ${(activeBuilds[0] as any).id})` }], isError: true };
            }
          }
        }

        const now = new Date().toISOString();
        const updates = {
          status: "active",
          claimedAt: now,
          claimedBy: "claude-code",
          startedAt: now,
        };
        await ref.update(updates);
        return { content: [{ type: "text", text: JSON.stringify({ ...job, ...updates }, null, 2) }] };
      }

      // ─── REVISE ───
      if (action === "revise") {
        if (!jobId) return { content: [{ type: "text", text: "action 'revise' requires jobId" }], isError: true };

        const ref = getJobRef(uid, jobId);
        const snapshot = await ref.once("value");
        const job = snapshot.val();

        if (!job) return { content: [{ type: "text", text: `Job not found: ${jobId}` }], isError: true };
        if (job.status !== "review") {
          return { content: [{ type: "text", text: `Can only revise a job in review (current status: ${job.status})` }], isError: true };
        }

        const updates = {
          status: "draft",
        };
        await ref.update(updates);
        return { content: [{ type: "text", text: JSON.stringify({ ...job, ...updates }, null, 2) }] };
      }

      // ─── REVIEW ───
      if (action === "review") {
        if (!jobId) return { content: [{ type: "text", text: "action 'review' requires jobId" }], isError: true };
        if (!concerns || concerns.length === 0) return { content: [{ type: "text", text: "action 'review' requires concerns (non-empty array)" }], isError: true };

        const ref = getJobRef(uid, jobId);
        const snapshot = await ref.once("value");
        const job = snapshot.val();

        if (!job) return { content: [{ type: "text", text: `Job not found: ${jobId}` }], isError: true };
        if (job.status !== "active") {
          return { content: [{ type: "text", text: `Can only review an active job (current status: ${job.status})` }], isError: true };
        }

        const now = new Date().toISOString();
        const updates = {
          status: "review",
          concerns,
          reviewedAt: now,
        };
        await ref.update(updates);
        return { content: [{ type: "text", text: JSON.stringify({ ...job, ...updates }, null, 2) }] };
      }

      // ─── APPROVE ───
      if (action === "approve") {
        if (!jobId) return { content: [{ type: "text", text: "action 'approve' requires jobId" }], isError: true };

        const ref = getJobRef(uid, jobId);
        const snapshot = await ref.once("value");
        const job = snapshot.val();

        if (!job) return { content: [{ type: "text", text: `Job not found: ${jobId}` }], isError: true };
        if (job.status !== "review") {
          return { content: [{ type: "text", text: `Can only approve a job in review (current status: ${job.status})` }], isError: true };
        }

        const now = new Date().toISOString();
        const updates: Record<string, any> = {
          status: "approved",
          approvedAt: now,
        };
        if (resolutions !== undefined) updates.resolutions = resolutions;
        await ref.update(updates);
        return { content: [{ type: "text", text: JSON.stringify({ ...job, ...updates }, null, 2) }] };
      }

      // ─── UPDATE ───
      if (action === "update") {
        if (!jobId) return { content: [{ type: "text", text: "action 'update' requires jobId" }], isError: true };

        const ref = getJobRef(uid, jobId);
        const snapshot = await ref.once("value");
        const job = snapshot.val();

        if (!job) return { content: [{ type: "text", text: `Job not found: ${jobId}` }], isError: true };
        if (TERMINAL_STATUSES.includes(job.status)) {
          return { content: [{ type: "text", text: `Cannot update terminal job (status: ${job.status})` }], isError: true };
        }

        const updates: Record<string, any> = {};
        if (title !== undefined) updates.title = title;
        if (preConditions !== undefined) updates.preConditions = preConditions;
        if (exceptionsNoted !== undefined) updates.exceptionsNoted = exceptionsNoted;

        // instructions and attachments can only be updated on draft jobs
        if (instructions !== undefined) {
          if (job.status !== "draft") {
            return { content: [{ type: "text", text: "instructions can only be updated on draft jobs" }], isError: true };
          }
          updates.instructions = instructions;
        }
        if (attachments !== undefined) {
          if (job.status !== "draft") {
            return { content: [{ type: "text", text: "attachments can only be updated on draft jobs" }], isError: true };
          }
          try {
            const parsed = JSON.parse(attachments);
            if (!Array.isArray(parsed)) {
              return { content: [{ type: "text", text: "attachments must be a JSON array" }], isError: true };
            }
            updates.attachments = parsed;
          } catch {
            return { content: [{ type: "text", text: "attachments must be valid JSON" }], isError: true };
          }
        }

        await ref.update(updates);
        return { content: [{ type: "text", text: JSON.stringify({ ...job, ...updates }, null, 2) }] };
      }

      // ─── ADD_EVENT ───
      if (action === "add_event") {
        if (!jobId) return { content: [{ type: "text", text: "action 'add_event' requires jobId" }], isError: true };
        if (!eventType) return { content: [{ type: "text", text: "action 'add_event' requires eventType" }], isError: true };
        if (!detail) return { content: [{ type: "text", text: "action 'add_event' requires detail" }], isError: true };

        const ref = getJobRef(uid, jobId);
        const snapshot = await ref.once("value");
        const job = snapshot.val();

        if (!job) return { content: [{ type: "text", text: `Job not found: ${jobId}` }], isError: true };

        const event = {
          timestamp: new Date().toISOString(),
          type: eventType,
          detail,
          refId: refId || null,
        };

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
        return { content: [{ type: "text", text: JSON.stringify(event, null, 2) }] };
      }

      // ─── COMPLETE ───
      if (action === "complete") {
        if (!jobId) return { content: [{ type: "text", text: "action 'complete' requires jobId" }], isError: true };
        if (!status) return { content: [{ type: "text", text: "action 'complete' requires status (completed/failed/abandoned)" }], isError: true };
        if (!TERMINAL_STATUSES.includes(status)) {
          return { content: [{ type: "text", text: `action 'complete' requires terminal status (completed/failed/abandoned), got: ${status}` }], isError: true };
        }
        if (!summary) return { content: [{ type: "text", text: "action 'complete' requires summary" }], isError: true };

        const ref = getJobRef(uid, jobId);
        const snapshot = await ref.once("value");
        const job = snapshot.val();

        if (!job) return { content: [{ type: "text", text: `Job not found: ${jobId}` }], isError: true };
        if (TERMINAL_STATUSES.includes(job.status)) {
          return { content: [{ type: "text", text: `Cannot complete terminal job (status: ${job.status})` }], isError: true };
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

        const completed: any = { ...job, ...updates, outcome: { ...job.outcome, testsRun, testsPassed, testsFailed, buildSuccess, deployId }, metadata: { ...job.metadata, linesAdded, linesRemoved } };
        if (conceptsBuilt.length > 0) completed.conceptsBuilt = conceptsBuilt;
        if (ideaSignal) completed.ideaSignal = ideaSignal;
        return { content: [{ type: "text", text: JSON.stringify(completed, null, 2) }] };
      }

      // ─── GET ───
      if (action === "get") {
        if (!jobId) return { content: [{ type: "text", text: "action 'get' requires jobId" }], isError: true };

        const ref = getJobRef(uid, jobId);
        const snapshot = await ref.once("value");
        const job = snapshot.val();

        if (!job) return { content: [{ type: "text", text: `Job not found: ${jobId}` }], isError: true };

        // Strip large claudeMdSnapshot by default to save context window
        if (!includeSnapshot && job.claudeMdSnapshot) {
          const snapshotLen = job.claudeMdSnapshot.length;
          delete job.claudeMdSnapshot;
          job._snapshotExcluded = `claudeMdSnapshot (${snapshotLen} chars) excluded. Use includeSnapshot=true to include.`;
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

        return { content: [{ type: "text", text: JSON.stringify(job, null, 2) }] };
      }

      // ─── LIST ───
      if (action === "list") {
        const snapshot = await getJobsRef(uid).once("value");
        const data = snapshot.val();
        if (!data) return { content: [{ type: "text", text: JSON.stringify([], null, 2) }] };

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

        return { content: [{ type: "text", text: JSON.stringify({ items: lean, total, offset: skip, limit: take }, null, 2) }] };
      }

      // ─── DELETE ───
      if (action === "delete") {
        if (!jobId) return { content: [{ type: "text", text: "action 'delete' requires jobId" }], isError: true };

        const ref = getJobRef(uid, jobId);
        const snapshot = await ref.once("value");
        if (!snapshot.val()) return { content: [{ type: "text", text: `Job not found: ${jobId}` }], isError: true };

        await ref.remove();
        return { content: [{ type: "text", text: JSON.stringify({ deleted: jobId }) }] };
      }

      return { content: [{ type: "text", text: `Unknown action: ${action}` }], isError: true };
    }
  );
}
