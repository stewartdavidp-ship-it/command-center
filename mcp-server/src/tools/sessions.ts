import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSessionsRef, getSessionRef, getPreferencesRef } from "../firebase.js";
import { getCurrentUid } from "../context.js";

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

// In-memory cache of active session per user (for contextEstimate auto-increment)
const activeSessionCache = new Map<string, string>();

export function getActiveSessionId(uid: string): string | undefined {
  return activeSessionCache.get(uid);
}

export function registerSessionTools(server: McpServer): void {

  // session — Consolidated session lifecycle tool
  server.tool(
    "session",
    `Ideation session lifecycle tool. Actions:
  - "start": Create a new session. Requires ideaId, title. Optional: appId, mode, sessionGoal, presentationMode, configSnapshot, targetOpens.
  - "update": Update session fields. Requires sessionId. Optional: title, summary, mode, activeIdeaId, activeAppId, activeLens, targetOpens, sessionGoal, conceptBlockCount, contextEstimate, presentationMode, configSnapshot, closingSummary, nextSessionRecommendation, conceptsResolved.
  - "add_event": Append an event to the session log. Requires sessionId, eventType, detail. Optional: refId.
  - "complete": Complete a session with final summary. Requires sessionId, summary. Optional: closingSummary, nextSessionRecommendation, conceptsResolved.
  - "get": Get a session record by ID. Requires sessionId.
  - "list": List sessions with optional filters. Optional: ideaId, appId, status, limit.
  - "delete": Delete a session. Requires sessionId. Use for test cleanup only.
  - "preferences": Read or update user preferences. Optional: presentationMode (to set).`,
    {
      action: z.enum(["start", "update", "add_event", "complete", "get", "list", "delete", "preferences"]).describe("Action to perform"),
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
      contextEstimate: z.number().int().optional().describe("Cumulative approximate character count of tool responses"),
      presentationMode: z.enum(PRESENTATION_MODES).optional().describe("Presentation mode: interactive or cli"),
      configSnapshot: z.string().optional().describe("JSON string snapshot of session config at start"),
      closingSummary: z.string().optional().describe("Mini-brief written on session close"),
      nextSessionRecommendation: z.string().optional().describe("What the next session should focus on"),
      conceptsResolved: z.number().int().optional().describe("Final count of concepts resolved this session"),
      limit: z.number().int().optional().describe("Max results to return for list action (default: 20)"),
      offset: z.number().int().optional().describe("Number of items to skip for pagination (default: 0)"),
    },
    async (args) => {
      const {
        action, sessionId, ideaId, appId, title, summary, eventType, detail, refId, status,
        mode, activeIdeaId, activeAppId, activeLens, targetOpens, sessionGoal,
        conceptBlockCount, contextEstimate, presentationMode, configSnapshot,
        closingSummary, nextSessionRecommendation, conceptsResolved, limit, offset,
      } = args;

      const uid = getCurrentUid();

      // ─── PREFERENCES ───
      if (action === "preferences") {
        const prefsRef = getPreferencesRef(uid);

        if (presentationMode !== undefined) {
          // Write
          const updates: Record<string, any> = { presentationMode };
          await prefsRef.update(updates);
          const snap = await prefsRef.once("value");
          return { content: [{ type: "text" as const, text: JSON.stringify(snap.val() || updates, null, 2) }] };
        }

        // Read
        const snap = await prefsRef.once("value");
        const prefs = snap.val() || { presentationMode: "interactive" };
        return { content: [{ type: "text" as const, text: JSON.stringify(prefs, null, 2) }] };
      }

      // ─── START ───
      if (action === "start") {
        if (!ideaId) return { content: [{ type: "text" as const, text: "action 'start' requires ideaId" }], isError: true };
        if (!title) return { content: [{ type: "text" as const, text: "action 'start' requires title" }], isError: true };

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
          contextEstimate: 0,
          presentationMode: presentationMode || "interactive",
          configSnapshot: configSnapshot ? JSON.parse(configSnapshot) : null,
          closingSummary: null,
          nextSessionRecommendation: null,
          conceptsResolved: 0,
          lastActivityAt: now,
        };

        await ref.set(session);

        // Cache active session for contextEstimate auto-increment
        activeSessionCache.set(uid, ref.key!);

        return { content: [{ type: "text" as const, text: JSON.stringify(session, null, 2) }] };
      }

      // ─── UPDATE ───
      if (action === "update") {
        if (!sessionId) return { content: [{ type: "text" as const, text: "action 'update' requires sessionId" }], isError: true };

        const ref = getSessionRef(uid, sessionId);
        const snapshot = await ref.once("value");
        const session = snapshot.val();

        if (!session) return { content: [{ type: "text" as const, text: `Session not found: ${sessionId}` }], isError: true };
        if (session.status !== "active") {
          return { content: [{ type: "text" as const, text: `Cannot update non-active session (status: ${session.status})` }], isError: true };
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
        if (contextEstimate !== undefined) updates.contextEstimate = contextEstimate;
        if (presentationMode !== undefined) updates.presentationMode = presentationMode;
        if (configSnapshot !== undefined) updates.configSnapshot = JSON.parse(configSnapshot);
        if (closingSummary !== undefined) updates.closingSummary = closingSummary;
        if (nextSessionRecommendation !== undefined) updates.nextSessionRecommendation = nextSessionRecommendation;
        if (conceptsResolved !== undefined) updates.conceptsResolved = conceptsResolved;
        // Always update lastActivityAt
        updates.lastActivityAt = new Date().toISOString();

        await ref.update(updates);
        return { content: [{ type: "text" as const, text: JSON.stringify({ ...session, ...updates }, null, 2) }] };
      }

      // ─── ADD_EVENT ───
      if (action === "add_event") {
        if (!sessionId) return { content: [{ type: "text" as const, text: "action 'add_event' requires sessionId" }], isError: true };
        if (!eventType) return { content: [{ type: "text" as const, text: "action 'add_event' requires eventType" }], isError: true };
        if (!detail) return { content: [{ type: "text" as const, text: "action 'add_event' requires detail" }], isError: true };

        const ref = getSessionRef(uid, sessionId);
        const snapshot = await ref.once("value");
        const session = snapshot.val();

        if (!session) return { content: [{ type: "text" as const, text: `Session not found: ${sessionId}` }], isError: true };

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
        return { content: [{ type: "text" as const, text: JSON.stringify(event, null, 2) }] };
      }

      // ─── COMPLETE ───
      if (action === "complete") {
        if (!sessionId) return { content: [{ type: "text" as const, text: "action 'complete' requires sessionId" }], isError: true };
        if (!summary) return { content: [{ type: "text" as const, text: "action 'complete' requires summary" }], isError: true };

        // Flush any pending context estimate before completing
        const pending = pendingContextIncrements.get(uid);
        if (pending && pending.sessionId === sessionId) {
          clearTimeout(pending.timer);
          await flushContextEstimate(uid);
        }

        const ref = getSessionRef(uid, sessionId);
        const snapshot = await ref.once("value");
        const session = snapshot.val();

        if (!session) return { content: [{ type: "text" as const, text: `Session not found: ${sessionId}` }], isError: true };
        if (session.status !== "active") {
          return { content: [{ type: "text" as const, text: `Cannot complete non-active session (status: ${session.status})` }], isError: true };
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

        return { content: [{ type: "text" as const, text: JSON.stringify({ ...session, ...updates }, null, 2) }] };
      }

      // ─── GET ───
      if (action === "get") {
        if (!sessionId) return { content: [{ type: "text" as const, text: "action 'get' requires sessionId" }], isError: true };

        const ref = getSessionRef(uid, sessionId);
        const snapshot = await ref.once("value");
        const session = snapshot.val();

        if (!session) return { content: [{ type: "text" as const, text: `Session not found: ${sessionId}` }], isError: true };
        return { content: [{ type: "text" as const, text: JSON.stringify(session, null, 2) }] };
      }

      // ─── DELETE ───
      if (action === "delete") {
        if (!sessionId) return { content: [{ type: "text" as const, text: "action 'delete' requires sessionId" }], isError: true };

        // Flush any pending context estimate before deleting
        const pendingDel = pendingContextIncrements.get(uid);
        if (pendingDel && pendingDel.sessionId === sessionId) {
          clearTimeout(pendingDel.timer);
          pendingContextIncrements.delete(uid); // Don't flush — session is being deleted
        }

        const ref = getSessionRef(uid, sessionId);
        const snapshot = await ref.once("value");
        if (!snapshot.val()) return { content: [{ type: "text" as const, text: `Session not found: ${sessionId}` }], isError: true };

        await ref.remove();
        // Clear from cache if active
        if (activeSessionCache.get(uid) === sessionId) {
          activeSessionCache.delete(uid);
        }
        return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: sessionId }) }] };
      }

      // ─── LIST ───
      if (action === "list") {
        const snapshot = await getSessionsRef(uid).once("value");
        const data = snapshot.val();
        if (!data) return { content: [{ type: "text" as const, text: JSON.stringify([], null, 2) }] };

        let sessions: any[] = Object.values(data);

        if (ideaId) sessions = sessions.filter((s) => s.ideaId === ideaId);
        if (appId) sessions = sessions.filter((s) => s.appId === appId);
        if (status) sessions = sessions.filter((s) => s.status === status);

        // Sort newest first
        sessions.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

        const total = sessions.length;
        const skip = offset && offset > 0 ? offset : 0;
        const take = limit && limit > 0 ? limit : 20;
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
          contextEstimate: s.contextEstimate || 0,
        }));

        return { content: [{ type: "text" as const, text: JSON.stringify({ items: lean, total, offset: skip, limit: take }, null, 2) }] };
      }

      return { content: [{ type: "text" as const, text: `Unknown action: ${action}` }], isError: true };
    }
  );
}

// ─── CONTEXT ESTIMATE AUTO-INCREMENT (DEBOUNCED) ───
// Accumulates response sizes in memory and flushes to Firebase every 30s.
// This avoids a read+write on every single tool call, which was the #1
// source of Firebase bandwidth (each write triggered a full sessions
// collection re-sync to all open browser tabs via realtime listeners).

const CONTEXT_FLUSH_INTERVAL_MS = 30_000; // 30 seconds

// Pending increments per uid: { sessionId, accumulated, timer }
const pendingContextIncrements = new Map<string, {
  sessionId: string;
  accumulated: number;
  timer: ReturnType<typeof setTimeout>;
}>();

async function flushContextEstimate(uid: string): Promise<void> {
  const pending = pendingContextIncrements.get(uid);
  if (!pending || pending.accumulated === 0) return;

  const { sessionId, accumulated } = pending;
  pendingContextIncrements.delete(uid);

  try {
    const ref = getSessionRef(uid, sessionId);
    const snap = await ref.child("contextEstimate").once("value");
    const current = snap.val() || 0;
    await ref.update({
      contextEstimate: current + accumulated,
      lastActivityAt: new Date().toISOString(),
    });
  } catch {
    // Fire-and-forget — never block or throw
  }
}

export async function incrementContextEstimate(uid: string, responseLength: number): Promise<void> {
  try {
    const sessionId = activeSessionCache.get(uid);
    if (!sessionId) return;

    const existing = pendingContextIncrements.get(uid);

    if (existing && existing.sessionId === sessionId) {
      // Accumulate into existing pending flush
      existing.accumulated += responseLength;
    } else {
      // New session or first call — flush any stale pending and start fresh
      if (existing) {
        clearTimeout(existing.timer);
        await flushContextEstimate(uid);
      }

      const entry = {
        sessionId,
        accumulated: responseLength,
        timer: setTimeout(() => flushContextEstimate(uid), CONTEXT_FLUSH_INTERVAL_MS),
      };
      pendingContextIncrements.set(uid, entry);
    }
  } catch {
    // Fire-and-forget — never block or throw
  }
}
