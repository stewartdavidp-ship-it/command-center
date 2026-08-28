import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSessionsRef, getSessionRef, getPreferencesRef, getProfileRef, getAttentionQueueRef, getDb, getDocumentRef, getConfigRef, getIdeaRef, getConceptsRef, getJobsRef } from "../firebase.js";
import { isGitHubConfigured, resolveTargetRepo, resolveFilePath, deliverToGitHub } from "../github.js";
import { getCurrentUid } from "../context.js";
import { withResponseSize } from "../response-metadata.js";
import { ensureSession } from "../session-lifecycle.js";
import { INITIATOR_PARAM, resolveInitiator, parseSurface } from "../surfaces.js";
import { computeIdeaHealth, updateAppTriageFlags } from "../idea-health.js";
import { handleBootstrap, handleInit } from "../session-bootstrap.js";
import { findCandidates, formatDidYouMean } from "../fuzzy-match.js";

const SESSION_STATUSES = ["active", "completed", "abandoned"] as const;

const SESSION_EVENT_TYPES = [
  "concept_created",
  "concept_transitioned",
  "idea_created",
  "tangent_captured",
  "note",
] as const;

const SESSION_MODES = ["base", "ideation", "build-review", "debrief"] as const;
const PRESENTATION_MODES = ["interactive", "cli"] as const;

// In-memory cache of active session per user (for serverSentTotal/interactionTotal auto-increment)
const activeSessionCache = new Map<string, string>();

export function getActiveSessionId(uid: string): string | undefined {
  return activeSessionCache.get(uid);
}

export function setActiveSessionId(uid: string, sessionId: string): void {
  activeSessionCache.set(uid, sessionId);
}

export function registerSessionTools(server: McpServer): void {

  // session — Consolidated session lifecycle tool
  server.tool(
    "session",
    `Ideation session lifecycle tool. Actions:
  - "start": Create a new session. Requires ideaId, title. Optional: appId, mode, sessionGoal, presentationMode, configSnapshot, targetOpens.
  - "update": Update session fields. Requires sessionId. Optional: title, summary, mode, activeIdeaId, activeAppId, activeLens, targetOpens, sessionGoal, conceptBlockCount, presentationMode, configSnapshot, closingSummary, nextSessionRecommendation, conceptsResolved.
  - "add_event": Append an event to the session log. Requires sessionId, eventType, detail. Optional: refId.
  - "complete": Complete a session with final summary. Requires sessionId, summary. Optional: closingSummary, nextSessionRecommendation, conceptsResolved.
  - "get": Get a session record by ID. Requires sessionId.
  - "list": List sessions with optional filters. Optional: ideaId, appId, status, limit.
  - "delete": Delete a session. Requires sessionId. Use for test cleanup only.
  - "preferences": Read or update user preferences. Optional: presentationMode (to set).
  - "profile": Read or update user profile. Optional fields to set: presentationMode, clearInstructionsDirty, clearShowTutorial. Returns consolidated profile with projectInstructionsDirty flag and showTutorial flag. When clearInstructionsDirty is true, clears the dirty flag. When clearShowTutorial is true, sets showTutorial to false (call after user dismisses or completes the tutorial).
  - "bootstrap": Single-call startup replacement. Returns orientation payload with instructions, active session, active idea, jobs, and signal definitions. Requires surface parameter (e.g. initiator="claude-chat"). Call this on conversation start instead of multi-step startup checklist.
  - "init": One-time onboarding. Returns memory boot loader lines to write to Claude Memory. Sets initialized flag in profile. Idempotent. Requires surface parameter (e.g. initiator="claude-chat").`,
    {
      ...INITIATOR_PARAM,
      action: z.enum(["start", "update", "add_event", "complete", "get", "list", "delete", "preferences", "profile", "bootstrap", "init"]).describe("Action to perform"),
      sessionId: z.string().optional().describe("Session ID (required for update/add_event/complete/get)"),
      ideaId: z.string().optional().describe("Idea ID (required for start, optional filter for list)"),
      appId: z.string().optional().describe("App ID (optional for start, optional filter for list)"),
      title: z.string().optional().describe("Session title (required for start, optional for update)"),
      summary: z.string().optional().describe("Session summary (optional for update, required for complete)"),
      eventType: z.enum(SESSION_EVENT_TYPES).optional().describe("Event type (required for add_event): concept_created, concept_transitioned, idea_created, tangent_captured, or note"),
      detail: z.string().optional().describe("Event description (required for add_event)"),
      refId: z.string().optional().describe("Related concept/idea ID (optional for add_event)"),
      status: z.enum(SESSION_STATUSES).optional().describe("Status filter (optional for list): active, completed, or abandoned"),
      // Session State Machine fields
      mode: z.enum(SESSION_MODES).optional().describe("Session mode: base, ideation, build-review, or debrief"),
      activeIdeaId: z.string().optional().describe("Idea currently in focus"),
      activeAppId: z.string().optional().describe("App currently in focus"),
      activeLens: z.string().optional().describe("Active lens (technical, economics, etc.) or null"),
      targetOpens: z.array(z.string()).optional().describe("OPEN concept IDs being addressed this session"),
      sessionGoal: z.string().optional().describe("Declared purpose/focus for this session"),
      conceptBlockCount: z.number().int().optional().describe("Running count of concept blocks"),
      contextEstimate: z.number().int().optional().describe("[Deprecated — use turnDelta on every tool call instead] Legacy field, writes to interactionTotal if provided."),
      presentationMode: z.enum(PRESENTATION_MODES).optional().describe("Presentation mode: interactive or cli"),
      configSnapshot: z.string().optional().describe("JSON string snapshot of session config at start"),
      closingSummary: z.string().optional().describe("Mini-brief written on session close"),
      nextSessionRecommendation: z.string().optional().describe("What the next session should focus on"),
      conceptsResolved: z.number().int().optional().describe("Final count of concepts resolved this session"),
      clearInstructionsDirty: z.boolean().optional().describe("For profile action: set to true to clear the projectInstructionsDirty flag after user confirms they updated their project instructions"),
      clearShowTutorial: z.boolean().optional().describe("For profile action: set to true to clear the showTutorial flag after user dismisses or completes the tutorial"),
      limit: z.number().int().optional().describe("Max results to return for list action (default: 20)"),
      offset: z.number().int().optional().describe("Number of items to skip for pagination (default: 0)"),
    },
    async (args) => {
      const {
        action, sessionId, ideaId, appId, title, summary, eventType, detail, refId, status,
        mode, activeIdeaId, activeAppId, activeLens, targetOpens, sessionGoal,
        conceptBlockCount, contextEstimate, presentationMode, configSnapshot,
        closingSummary, nextSessionRecommendation, conceptsResolved, clearInstructionsDirty, clearShowTutorial, limit, offset,
      } = args;
      resolveInitiator({ initiator: (args as any).initiator });

      const uid = getCurrentUid();

      // ─── BOOTSTRAP ───
      if (action === "bootstrap") {
        const surface = parseSurface((args as any).initiator);
        if (!surface) {
          return withResponseSize({
            content: [{ type: "text" as const, text: "bootstrap requires a surface. Pass initiator parameter (e.g. initiator='claude-chat')." }],
            isError: true,
          });
        }
        return await handleBootstrap(uid, surface);
      }

      // ─── INIT ───
      if (action === "init") {
        const surface = parseSurface((args as any).initiator);
        if (!surface) {
          return withResponseSize({
            content: [{ type: "text" as const, text: "init requires a surface. Pass initiator parameter (e.g. initiator='claude-chat')." }],
            isError: true,
          });
        }
        return await handleInit(uid, surface);
      }

      // ─── PREFERENCES ───
      if (action === "preferences") {
        const prefsRef = getPreferencesRef(uid);

        if (presentationMode !== undefined) {
          // Write
          const updates: Record<string, any> = { presentationMode };
          await prefsRef.update(updates);
          const snap = await prefsRef.once("value");
          return withResponseSize({ content: [{ type: "text" as const, text: JSON.stringify(snap.val() || updates, null, 2) }] });
        }

        // Read
        const snap = await prefsRef.once("value");
        const prefs = snap.val() || { presentationMode: "interactive" };
        return withResponseSize({ content: [{ type: "text" as const, text: JSON.stringify(prefs, null, 2) }] });
      }

      // ─── PROFILE ───
      if (action === "profile") {
        const profileRef = getProfileRef(uid);
        const profileSnap = await profileRef.once("value");
        let profile = profileSnap.val();

        if (!profile) {
          // Dual-read fallback: migrate from preferences/ if profile/ doesn't exist
          const prefsSnap = await getPreferencesRef(uid).once("value");
          const prefs = prefsSnap.val();
          profile = {
            presentationMode: prefs?.presentationMode || "interactive",
            attentionCount: 0,
            showTutorial: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          // Write migrated profile
          await profileRef.set(profile);
        }

        if (presentationMode !== undefined) {
          // Write update
          const updates: Record<string, any> = {
            presentationMode,
            updatedAt: new Date().toISOString(),
          };
          await profileRef.update(updates);
          // Also sync to preferences/ for backward compat
          await getPreferencesRef(uid).update({ presentationMode });
          profile = { ...profile, ...updates };
        }

        // Clear the dirty flag if user confirmed they updated their project instructions
        if (clearInstructionsDirty === true) {
          await profileRef.update({
            projectInstructionsDirty: false,
            updatedAt: new Date().toISOString(),
          });
          profile.projectInstructionsDirty = false;
        }

        // Clear the showTutorial flag if user dismissed or completed the tutorial
        if (clearShowTutorial === true) {
          await profileRef.update({
            showTutorial: false,
            updatedAt: new Date().toISOString(),
          });
          profile.showTutorial = false;
        }

        // Include projectInstructionsDirty in response (defaults to false if not set)
        if (profile.projectInstructionsDirty === undefined) {
          profile.projectInstructionsDirty = false;
        }

        // Include showTutorial in response (defaults to false for existing users without the field)
        if (profile.showTutorial === undefined) {
          profile.showTutorial = false;
        }

        return withResponseSize({ content: [{ type: "text" as const, text: JSON.stringify(profile, null, 2) }] });
      }

      // ─── START ───
      if (action === "start") {
        if (!ideaId) return withResponseSize({ content: [{ type: "text" as const, text: "action 'start' requires ideaId" }], isError: true });
        if (!title) return withResponseSize({ content: [{ type: "text" as const, text: "action 'start' requires title" }], isError: true });

        // Mismatch detection: check if new session's context differs from active session
        // Cache hit (free) — Firebase query was done in middleware
        const sessionCheck = await ensureSession({ appId: appId || undefined, ideaId });

        const ref = getSessionsRef(uid).push();
        const now = new Date().toISOString();
        const session: Record<string, any> = {
          id: ref.key,
          ideaId,
          appId: appId || null,
          status: "active",
          title,
          startedAt: now,
          completedAt: null,
          summary: null,
          conceptsCreated: [],
          conceptsModified: [],
          events: [],
          metadata: {
            toolCallCount: 0,
            conceptCount: { OPEN: 0, DECISION: 0, RULE: 0, CONSTRAINT: 0 },
          },
          // State machine fields
          mode: mode || "base",
          activeIdeaId: activeIdeaId || ideaId,
          activeAppId: activeAppId || appId || null,
          activeLens: activeLens || null,
          targetOpens: targetOpens || [],
          sessionGoal: sessionGoal || null,
          conceptBlockCount: 0,
          contextBySurface: {},
          presentationMode: presentationMode || "interactive",
          configSnapshot: configSnapshot ? JSON.parse(configSnapshot) : null,
          closingSummary: null,
          nextSessionRecommendation: null,
          conceptsResolved: 0,
          lastActivityAt: now,
        };

        await ref.set(session);

        // Cache active session for serverSentTotal/interactionTotal auto-increment
        activeSessionCache.set(uid, ref.key!);

        const result: any = session;
        if (sessionCheck.mismatch) {
          result._sessionMismatch = {
            warning: "New session context differs from existing active session",
            activeSession: sessionCheck.existingSession,
          };
        }
        return withResponseSize({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] });
      }

      // ─── UPDATE ───
      if (action === "update") {
        if (!sessionId) return withResponseSize({ content: [{ type: "text" as const, text: "action 'update' requires sessionId" }], isError: true });

        const ref = getSessionRef(uid, sessionId);
        const snapshot = await ref.once("value");
        const session = snapshot.val();

        if (!session) return withResponseSize({ content: [{ type: "text" as const, text: `Session not found: ${sessionId}` }], isError: true });
        if (session.status !== "active") {
          return withResponseSize({ content: [{ type: "text" as const, text: `Cannot update non-active session (status: ${session.status})` }], isError: true });
        }

        const updates: Record<string, any> = {};
        // Original fields
        if (title !== undefined) updates.title = title;
        if (summary !== undefined) updates.summary = summary;
        // State machine fields
        if (mode !== undefined) updates.mode = mode;
        if (activeIdeaId !== undefined) updates.activeIdeaId = activeIdeaId;
        if (activeAppId !== undefined) updates.activeAppId = activeAppId;
        if (activeLens !== undefined) updates.activeLens = activeLens;
        if (targetOpens !== undefined) updates.targetOpens = targetOpens;
        if (sessionGoal !== undefined) updates.sessionGoal = sessionGoal;
        if (conceptBlockCount !== undefined) updates.conceptBlockCount = conceptBlockCount;
        // Legacy: contextEstimate param accepted but ignored — context now tracked per-surface via turnDelta
        if (presentationMode !== undefined) updates.presentationMode = presentationMode;
        if (configSnapshot !== undefined) updates.configSnapshot = JSON.parse(configSnapshot);
        if (closingSummary !== undefined) updates.closingSummary = closingSummary;
        if (nextSessionRecommendation !== undefined) updates.nextSessionRecommendation = nextSessionRecommendation;
        if (conceptsResolved !== undefined) updates.conceptsResolved = conceptsResolved;
        // Always update lastActivityAt
        updates.lastActivityAt = new Date().toISOString();

        await ref.update(updates);
        return withResponseSize({ content: [{ type: "text" as const, text: JSON.stringify({ ...session, ...updates }, null, 2) }] });
      }

      // ─── ADD_EVENT ───
      if (action === "add_event") {
        if (!sessionId) return withResponseSize({ content: [{ type: "text" as const, text: "action 'add_event' requires sessionId" }], isError: true });
        if (!eventType) return withResponseSize({ content: [{ type: "text" as const, text: "action 'add_event' requires eventType" }], isError: true });
        if (!detail) return withResponseSize({ content: [{ type: "text" as const, text: "action 'add_event' requires detail" }], isError: true });

        const ref = getSessionRef(uid, sessionId);
        const snapshot = await ref.once("value");
        const session = snapshot.val();

        if (!session) return withResponseSize({ content: [{ type: "text" as const, text: `Session not found: ${sessionId}` }], isError: true });

        const event = {
          timestamp: new Date().toISOString(),
          type: eventType,
          detail,
          refId: refId || null,
        };

        const events = session.events || [];
        events.push(event);

        const updates: Record<string, any> = {
          events,
          "metadata/toolCallCount": (session.metadata?.toolCallCount || 0) + 1,
          lastActivityAt: new Date().toISOString(),
        };

        await ref.update(updates);
        return withResponseSize({ content: [{ type: "text" as const, text: JSON.stringify(event, null, 2) }] });
      }

      // ─── COMPLETE ───
      // Sessions are never auto-deleted. Even empty sessions have value as records
      // with keyword-rich question summaries. See DECISION -Om11vgRb9JSmEI745f4.
      // Stale sessions (>24h) are auto-completed (not deleted) by session-lifecycle.ts.
      if (action === "complete") {
        if (!sessionId) return withResponseSize({ content: [{ type: "text" as const, text: "action 'complete' requires sessionId" }], isError: true });
        if (!summary) return withResponseSize({ content: [{ type: "text" as const, text: "action 'complete' requires summary" }], isError: true });

        // Flush any pending context totals before completing (all surfaces)
        for (const [key, pending] of pendingContextIncrements.entries()) {
          if (pending.sessionId === sessionId) {
            clearTimeout(pending.timer);
            await flushContextTotals(uid, pending.surface);
          }
        }

        const ref = getSessionRef(uid, sessionId);
        const snapshot = await ref.once("value");
        const session = snapshot.val();

        if (!session) return withResponseSize({ content: [{ type: "text" as const, text: `Session not found: ${sessionId}` }], isError: true });
        if (session.status !== "active") {
          return withResponseSize({ content: [{ type: "text" as const, text: `Cannot complete non-active session (status: ${session.status})` }], isError: true });
        }

        const now = new Date().toISOString();
        const updates: Record<string, any> = {
          status: "completed",
          completedAt: now,
          summary,
          lastActivityAt: now,
        };
        // Optional closing fields
        if (closingSummary !== undefined) updates.closingSummary = closingSummary;
        if (nextSessionRecommendation !== undefined) updates.nextSessionRecommendation = nextSessionRecommendation;
        if (conceptsResolved !== undefined) updates.conceptsResolved = conceptsResolved;

        await ref.update(updates);

        // Clear active session cache
        activeSessionCache.delete(uid);

        // ─── IDEA HEALTH: Compute health for activeIdeaId ───
        let _ideaHealth: any = null;
        try {
          const healthIdeaId = session.activeIdeaId || session.ideaId;
          const healthAppId = session.activeAppId || session.appId;

          if (healthIdeaId && healthAppId) {
            // Read BEFORE any write. RTDB update() on a missing path CREATES the
            // node, so writing lastSessionAt first would conjure a ghost idea
            // (and make the existence check below pass) whenever activeIdeaId
            // points at a deleted idea.
            const [ideaSnap, conceptsSnap, jobsSnap, sessionsSnap] = await Promise.all([
              getIdeaRef(uid, healthIdeaId).once("value"),
              getConceptsRef(uid).once("value"),
              getJobsRef(uid).once("value"),
              getSessionsRef(uid).orderByChild("status").equalTo("completed").once("value"),
            ]);

            const idea = ideaSnap.exists() ? ideaSnap.val() : null;
            if (idea) {
              const allConcepts: any[] = Object.values(conceptsSnap.val() || {});
              const allJobs: any[] = Object.values(jobsSnap.val() || {});
              const allCompletedSessions: any[] = Object.values(sessionsSnap.val() || {});

              // Count ALL completed sessions for this app (regardless of activeIdeaId)
              const appSessionCount = allCompletedSessions.filter(
                (s: any) => s.appId === healthAppId
              ).length;

              // Concept counts for this idea
              const ideaConcepts = allConcepts.filter(
                (c: any) => c.ideaOrigin === healthIdeaId && c.status === "active"
              );
              const activeOpenCount = ideaConcepts.filter((c: any) => c.type === "OPEN").length;

              // Job counts for this idea
              const ideaJobs = allJobs.filter((j: any) => j.ideaId === healthIdeaId);
              const completedJobCount = ideaJobs.filter((j: any) => j.status === "completed").length;

              const alerts = computeIdeaHealth({
                idea,
                totalAppSessionCount: appSessionCount,
                conceptCount: ideaConcepts.length,
                activeOpenCount,
                completedJobCount,
                totalJobCount: ideaJobs.length,
              });

              // Write lastSessionAt + alerts + counter back to the (confirmed
              // existing) idea record in a single update.
              const healthUpdates: Record<string, any> = {
                lastSessionAt: now,
                alerts: alerts.length > 0 ? alerts : null,
                alertCount: alerts.length,
                sessionCountAtLastHealth: appSessionCount,
              };
              await getIdeaRef(uid, healthIdeaId).update(healthUpdates);

              // Update app triage flags if alerts exist
              if (alerts.length > 0) {
                await updateAppTriageFlags(uid, healthAppId, alerts.length);
              }

              _ideaHealth = {
                ideaId: healthIdeaId,
                alertCount: alerts.length,
                alerts: alerts.length > 0 ? alerts : undefined,
              };
            }
          }
        } catch {
          // Fire-and-forget — never blocks session completion
        }

        // ─── PENDING FLUSH: Deliver queued documents to GitHub ───
        const flushResults: { docId: string; status: string; error?: string }[] = [];
        const pendingFlush = session.pendingFlush;
        if (pendingFlush && isGitHubConfigured()) {
          const token = process.env.GITHUB_TOKEN!;
          const configSnap = await getConfigRef(uid).once("value");
          const config = configSnap.val();
          const profileSnap = await getProfileRef(uid).once("value");
          const profile = profileSnap.val();
          const docsRepoName = profile?.docsRepoName || null;

          for (const flushDocId of Object.keys(pendingFlush)) {
            try {
              const docSnap = await getDocumentRef(uid, flushDocId).once("value");
              const doc = docSnap.val();
              if (!doc || doc.status !== "pending") {
                flushResults.push({ docId: flushDocId, status: "skipped" });
                continue;
              }

              const appConfig = config?.apps?.[doc.appId];
              const appRepos = appConfig?.repos || null;
              const routing = resolveTargetRepo(doc.type, appRepos, docsRepoName);

              if (!routing) {
                flushResults.push({ docId: flushDocId, status: "skipped", error: "no repo configured" });
                continue;
              }

              const docTargetPath = doc.routing?.targetPath || "CLAUDE.md";
              const filePath = resolveFilePath(docTargetPath, appConfig?.subPath || null, routing.useSubPath);
              const commitMsg = `docs(${appConfig?.name || doc.appId}): update ${doc.type} via CC MCP [session-close]`;

              const result = await deliverToGitHub(routing.repo, filePath, doc.content, commitMsg, "main", token);

              // Delete from Firebase after successful delivery
              await getDocumentRef(uid, flushDocId).remove();
              // Remove from pendingFlush
              await ref.child(`pendingFlush/${flushDocId}`).remove();

              flushResults.push({ docId: flushDocId, status: "delivered" });
            } catch (err: any) {
              // Write to attention queue on failure
              await writeAttentionEntry(uid, {
                type: "failed-delivery",
                docId: flushDocId,
                sessionId: sessionId!,
                detail: `Flush delivery failed: ${err.message}`,
              });
              flushResults.push({ docId: flushDocId, status: "failed", error: err.message });
            }
          }
        }

        const result: any = { ...session, ...updates };
        if (flushResults.length > 0) result._flushResults = flushResults;
        if (_ideaHealth) result._ideaHealth = _ideaHealth;

        return withResponseSize({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] });
      }

      // ─── GET ───
      if (action === "get") {
        if (!sessionId) return withResponseSize({ content: [{ type: "text" as const, text: "action 'get' requires sessionId" }], isError: true });

        const ref = getSessionRef(uid, sessionId);
        const snapshot = await ref.once("value");
        const session = snapshot.val();

        if (!session) {
          // Fuzzy match against recent sessions
          const allSnap = await getSessionsRef(uid).orderByKey().limitToLast(50).once("value");
          const allSessions = allSnap.val() || {};
          const entries = Object.entries(allSessions).map(([id, s]: [string, any]) => ({
            id,
            label: (s as any).title || undefined,
          }));
          const candidates = findCandidates(sessionId!, entries);
          const did_you_mean = formatDidYouMean(candidates);
          const errorObj: any = { error: `Session not found: ${sessionId}` };
          if (did_you_mean) errorObj.did_you_mean = did_you_mean;
          return withResponseSize({ content: [{ type: "text" as const, text: JSON.stringify(errorObj, null, 2) }], isError: true });
        }

        // Cap events to last 15 to save context window
        if (session.events && Array.isArray(session.events)) {
          const totalEvents = session.events.length;
          session.eventCount = totalEvents;
          if (totalEvents > 15) {
            session.events = session.events.slice(-15);
            session._eventsTruncated = `Showing last 15 of ${totalEvents} events`;
          }
        }

        return withResponseSize({ content: [{ type: "text" as const, text: JSON.stringify(session, null, 2) }] });
      }

      // ─── DELETE ───
      // WARNING: Sessions are never auto-deleted. This action is for test cleanup only.
      // Even empty sessions have value as records. See DECISION -Om11vgRb9JSmEI745f4.
      if (action === "delete") {
        if (!sessionId) return withResponseSize({ content: [{ type: "text" as const, text: "action 'delete' requires sessionId" }], isError: true });

        // Clear any pending context totals before deleting (all surfaces)
        for (const [key, pendingDel] of pendingContextIncrements.entries()) {
          if (pendingDel.sessionId === sessionId) {
            clearTimeout(pendingDel.timer);
            pendingContextIncrements.delete(key); // Don't flush — session is being deleted
          }
        }

        const ref = getSessionRef(uid, sessionId);
        const snapshot = await ref.once("value");
        if (!snapshot.val()) return withResponseSize({ content: [{ type: "text" as const, text: `Session not found: ${sessionId}` }], isError: true });

        await ref.remove();
        // Clear from cache if active
        if (activeSessionCache.get(uid) === sessionId) {
          activeSessionCache.delete(uid);
        }
        return withResponseSize({ content: [{ type: "text" as const, text: JSON.stringify({ deleted: sessionId }) }] });
      }

      // ─── LIST ───
      if (action === "list") {
        const take = limit && limit > 0 ? limit : 20;
        const skip = offset && offset > 0 ? offset : 0;

        // Use server-side query to avoid downloading the entire sessions collection.
        // Priority: status filter uses .indexOn["status"], otherwise use .indexOn["startedAt"] with limitToLast.
        let query: any = getSessionsRef(uid);
        if (status) {
          // Server-side filter on status (indexed)
          query = query.orderByChild("status").equalTo(status);
        } else {
          // No status filter — use startedAt index with bounded read
          query = query.orderByChild("startedAt").limitToLast(100);
        }

        const snapshot = await query.once("value");
        const data = snapshot.val();
        if (!data) return withResponseSize({ content: [{ type: "text" as const, text: JSON.stringify({ items: [], total: 0, offset: skip, limit: take }, null, 2) }] });

        let sessions: any[] = Object.values(data);

        // Client-side filters for fields without indexes (ideaId, appId)
        if (ideaId) sessions = sessions.filter((s) => s.ideaId === ideaId);
        if (appId) sessions = sessions.filter((s) => s.appId === appId);

        // Sort newest first
        sessions.sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime());

        const total = sessions.length;
        sessions = sessions.slice(skip, skip + take);

        // Lean response: summary fields only. Use get for full record.
        const lean = sessions.map((s) => ({
          id: s.id,
          title: s.title,
          status: s.status,
          ideaId: s.ideaId,
          appId: s.appId,
          mode: s.mode || "base",
          presentationMode: s.presentationMode,
          startedAt: s.startedAt,
          completedAt: s.completedAt,
          conceptBlockCount: s.conceptBlockCount || 0,
          contextBySurface: s.contextBySurface || {},
        }));

        const avgItemSize = lean.length > 0
          ? Math.round(lean.reduce((sum: number, item: any) => sum + JSON.stringify(item).length, 0) / lean.length)
          : 0;

        return withResponseSize(
          { content: [{ type: "text" as const, text: JSON.stringify({ items: lean, total, offset: skip, limit: take }, null, 2) }] },
          { _estimatedItemSize: avgItemSize }
        );
      }

      return withResponseSize({ content: [{ type: "text" as const, text: `Unknown action: ${action}` }], isError: true });
    }
  );
}

// ─── CONTEXT TRACKING AUTO-INCREMENT (DEBOUNCED) ───
// Accumulates serverSent and interaction totals per surface in memory,
// flushes to Firebase every 30s at contextBySurface/{surface}/.
// Per-surface scoping ensures each context window (Chat, Code, etc.)
// gets its own accurate tracking — sessions span multiple conversations.

const CONTEXT_FLUSH_INTERVAL_MS = 30_000; // 30 seconds

// Pending increments keyed by "uid:surface"
const pendingContextIncrements = new Map<string, {
  sessionId: string;
  surface: string;
  serverSentAccum: number;
  interactionAccum: number;
  timer: ReturnType<typeof setTimeout>;
}>();

function pendingKey(uid: string, surface: string): string {
  return `${uid}:${surface}`;
}

// Get pending (unflushed) serverSent accumulation for a user+surface
export function getPendingServerSentAccumulation(uid: string, surface?: string): number {
  if (!surface) return 0;
  const pending = pendingContextIncrements.get(pendingKey(uid, surface));
  return pending ? pending.serverSentAccum : 0;
}

// Get pending (unflushed) interaction accumulation for a user+surface
export function getPendingInteractionAccumulation(uid: string, surface?: string): number {
  if (!surface) return 0;
  const pending = pendingContextIncrements.get(pendingKey(uid, surface));
  return pending ? pending.interactionAccum : 0;
}

async function flushContextTotals(uid: string, surface: string): Promise<void> {
  const key = pendingKey(uid, surface);
  const pending = pendingContextIncrements.get(key);
  if (!pending || (pending.serverSentAccum === 0 && pending.interactionAccum === 0)) return;

  const { sessionId, serverSentAccum, interactionAccum } = pending;
  pendingContextIncrements.delete(key);

  try {
    const surfacePath = `contextBySurface/${surface}`;
    const ref = getSessionRef(uid, sessionId);
    // Read both totals in parallel (no latency increase)
    const [serverSentSnap, interactionSnap] = await Promise.all([
      ref.child(`${surfacePath}/serverSent`).once("value"),
      ref.child(`${surfacePath}/interaction`).once("value"),
    ]);
    const currentServerSent = serverSentSnap.val() || 0;
    const currentInteraction = interactionSnap.val() || 0;

    const updates: Record<string, any> = {
      lastActivityAt: new Date().toISOString(),
    };
    if (serverSentAccum > 0) {
      updates[`${surfacePath}/serverSent`] = currentServerSent + serverSentAccum;
    }
    if (interactionAccum > 0) {
      updates[`${surfacePath}/interaction`] = currentInteraction + interactionAccum;
    }

    await ref.update(updates);
  } catch {
    // Fire-and-forget — never block or throw
  }
}

// Called by withResponseSize() in response-metadata.ts — tracks server-sent content
export async function incrementServerSentTotal(uid: string, responseLength: number, surface?: string): Promise<void> {
  try {
    const sessionId = activeSessionCache.get(uid);
    if (!sessionId || !surface) return;

    const key = pendingKey(uid, surface);
    const existing = pendingContextIncrements.get(key);

    if (existing && existing.sessionId === sessionId) {
      existing.serverSentAccum += responseLength;
    } else {
      if (existing) {
        clearTimeout(existing.timer);
        await flushContextTotals(uid, surface);
      }

      const entry = {
        sessionId,
        surface,
        serverSentAccum: responseLength,
        interactionAccum: 0,
        timer: setTimeout(() => flushContextTotals(uid, surface), CONTEXT_FLUSH_INTERVAL_MS),
      };
      pendingContextIncrements.set(key, entry);
    }
  } catch {
    // Fire-and-forget — never block or throw
  }
}

// Called by index.ts middleware — tracks surface-reported turnDelta
export async function incrementInteractionTotal(uid: string, turnDelta: number, surface?: string): Promise<void> {
  try {
    const sessionId = activeSessionCache.get(uid);
    if (!sessionId || !surface) return;

    const key = pendingKey(uid, surface);
    const existing = pendingContextIncrements.get(key);

    if (existing && existing.sessionId === sessionId) {
      existing.interactionAccum += turnDelta;
    } else {
      if (existing) {
        clearTimeout(existing.timer);
        await flushContextTotals(uid, surface);
      }

      const entry = {
        sessionId,
        surface,
        serverSentAccum: 0,
        interactionAccum: turnDelta,
        timer: setTimeout(() => flushContextTotals(uid, surface), CONTEXT_FLUSH_INTERVAL_MS),
      };
      pendingContextIncrements.set(key, entry);
    }
  } catch {
    // Fire-and-forget — never block or throw
  }
}

// Set interactionTotal to an absolute value (called when contextEstimate is used instead of turnDelta).
// contextEstimate has absolute semantics — it IS the interaction total, not a delta to add.
// This replaces any accumulated value in Firebase with the absolute value.
export async function setInteractionAbsolute(uid: string, absolute: number, surface: string): Promise<void> {
  try {
    const sessionId = activeSessionCache.get(uid);
    if (!sessionId) return;

    // Clear any pending interaction accumulation for this surface
    const key = pendingKey(uid, surface);
    const existing = pendingContextIncrements.get(key);
    if (existing) {
      existing.interactionAccum = 0;
      // Don't clear timer — serverSentAccum may still need flushing
    }

    // Write absolute value directly to Firebase
    const surfacePath = `contextBySurface/${surface}`;
    await getSessionRef(uid, sessionId).child(`${surfacePath}/interaction`).set(absolute);
  } catch {
    // Fire-and-forget — never block or throw
  }
}

// Reset a surface's context counters (called on bootstrap = new conversation)
export async function resetSurfaceContext(uid: string, sessionId: string, surface: string): Promise<void> {
  try {
    // Clear any pending in-memory accumulation for this surface
    const key = pendingKey(uid, surface);
    const existing = pendingContextIncrements.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      pendingContextIncrements.delete(key);
    }

    // Reset in Firebase
    const ref = getSessionRef(uid, sessionId);
    await ref.child(`contextBySurface/${surface}`).set({
      serverSent: 0,
      interaction: 0,
    });
  } catch {
    // Fire-and-forget
  }
}

// ─── ATTENTION QUEUE ───
// Write entries on failure (flush failures, orphan docs) and manage profile.attentionCount.
// Fire-and-forget: never throws, never blocks calling code.

export async function writeAttentionEntry(
  uid: string,
  entry: { type: string; docId?: string; sessionId?: string; detail: string }
): Promise<void> {
  try {
    const ref = getAttentionQueueRef(uid).push();
    await ref.set({
      id: ref.key,
      type: entry.type,
      docId: entry.docId || null,
      sessionId: entry.sessionId || null,
      detail: entry.detail,
      createdAt: new Date().toISOString(),
      resolved: false,
    });

    // Increment profile.attentionCount atomically via transaction
    const profileRef = getProfileRef(uid);
    await profileRef.child("attentionCount").transaction((current: number | null) => (current || 0) + 1);
    await profileRef.update({ needsAttention: true });
  } catch {
    // Fire-and-forget — attention queue itself should never crash the system
  }
}

export async function resolveAttentionEntry(uid: string, entryId: string): Promise<void> {
  try {
    const ref = getAttentionQueueRef(uid).child(entryId);
    const snap = await ref.once("value");
    if (!snap.val() || snap.val().resolved) return;

    await ref.update({ resolved: true, resolvedAt: new Date().toISOString() });

    // Decrement profile.attentionCount atomically via transaction
    const profileRef = getProfileRef(uid);
    await profileRef.child("attentionCount").transaction((current: number | null) => Math.max((current || 0) - 1, 0));

    // Clear needsAttention if count is 0
    const countSnap = await profileRef.child("attentionCount").once("value");
    if ((countSnap.val() || 0) <= 0) {
      await profileRef.update({ needsAttention: false });
    }
  } catch {
    // Fire-and-forget
  }
}
