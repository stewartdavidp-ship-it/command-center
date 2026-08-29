import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getIdeasRef, getAppIdeasRef, getIdeaRef, getConceptsRef, getJobsRef, getSessionsRef, getConfigRef } from "../firebase.js";
import { getCurrentUid } from "../context.js";
import { withResponseSize } from "../response-metadata.js";
import { INITIATOR_PARAM, resolveInitiator } from "../surfaces.js";
import { computeIdeaHealth, updateAppTriageFlags } from "../idea-health.js";
import { findCandidates, formatDidYouMean } from "../fuzzy-match.js";

const IDEA_TYPES = ["base", "addon"] as const;
const IDEA_STATUSES = ["active", "graduated", "archived", "completed"] as const;
const IDEA_TYPE_CLASSES = ["primary", "auxiliary", "placeholder"] as const;
const INTENTIONS = ["new", "add", "fix"] as const;
const PRIMARY_OUTPUTS = ["code", "presentation", "spreadsheet", "document", "analysis"] as const;

// ─── list_ranked cache ───
// Avoids 4 full-collection Firebase reads on rapid repeat calls.
// Cache key: `${uid}:${appId || ''}`, TTL: 30 seconds.
const LIST_RANKED_CACHE_TTL_MS = 30_000;
const listRankedCache = new Map<string, { result: any; timestamp: number }>();

export function registerIdeaTools(server: McpServer): void {

  // idea — Consolidated idea lifecycle tool
  server.tool(
    "idea",
    `Idea lifecycle tool. Actions:
  - "list": List ideas. Optional: appId, status, ideaType, intention, primaryOutput, initiative, hasAlerts filters. Sorts by sequence when appId filtered. By default excludes completed and archived ideas.
  - "get": Get a single idea by ID. Requires ideaId. Returns full record including alerts.
  - "create": Create a new idea. Requires name, description. Optional: type (base/addon), appId, parentIdeaId, externalProjectKey, ideaType, intention, primaryOutput, initiative.
  - "update": Update name, description, or status. Requires ideaId. Optional: name, description, status, externalProjectKey, externalRefs, ideaType, intention, primaryOutput, initiative.
  - "graduate": Link idea to an app. Requires ideaId, appId. Auto-calculates sequence and type.
  - "archive": Archive an idea. Requires ideaId.
  - "get_active": Get the latest active idea for an app. Requires appId.
  - "list_ranked": Rank ideas by build-readiness tier. Optional: appId filter. Returns ideas sorted by 5-tier model with activity metrics.
  - "triage": Run full-app health computation across all active ideas. Requires appId. Returns ideas with alerts grouped by severity. Updates app triage flags.
  - "delete": Delete an idea. Requires ideaId. Also removes from appIdeas index. Use for test cleanup only.`,
    {
      ...INITIATOR_PARAM,
      action: z.enum(["list", "get", "create", "update", "graduate", "archive", "get_active", "list_ranked", "triage", "delete"]).describe("Action to perform"),
      hasAlerts: z.boolean().optional().describe("For list: filter to only ideas with active alerts (alertCount > 0)"),
      ideaId: z.string().optional().describe("Idea ID (required for update/graduate/archive)"),
      appId: z.string().optional().describe("App ID (optional for list/create, required for graduate/get_active)"),
      name: z.string().optional().describe("Idea name (required for create, optional for update)"),
      description: z.string().optional().describe("Idea description (required for create, optional for update)"),
      type: z.enum(IDEA_TYPES).optional().describe("Idea type: base or addon (optional for create, default: base)"),
      parentIdeaId: z.string().optional().describe("Parent idea ID for addon ideas (optional for create)"),
      status: z.enum(IDEA_STATUSES).optional().describe("For update: new status. For list: filter by status (overrides default exclusion of completed/archived)."),
      ideaType: z.enum(IDEA_TYPE_CLASSES).optional().describe("Idea classification: primary (core platform), auxiliary (supporting/maintenance), or placeholder (parked/future). Default: primary on create. Also used as list filter."),
      intention: z.enum(INTENTIONS).optional().describe("What this idea intends to do: new (greenfield), add (extend existing), fix (correct/repair). Optional for create/update. Also used as list filter."),
      primaryOutput: z.enum(PRIMARY_OUTPUTS).optional().describe("Primary deliverable type: code, presentation, spreadsheet, document, or analysis. Optional for create/update. Also used as list filter."),
      initiative: z.string().optional().describe("Freeform initiative label for grouping related ideas (e.g., 'Q1 platform hardening'). Optional for create/update. Also used as list filter (case-insensitive exact match)."),
      externalProjectKey: z.string().optional().describe("External project identifier, e.g. Jira project key 'ENG' or Linear team ID (optional for create/update)"),
      externalRefs: z.array(z.object({
        system: z.string().describe("External system identifier (e.g., 'jira', 'linear', 'github')"),
        externalId: z.string().describe("ID in the external system"),
        externalUrl: z.string().optional().describe("Direct link to the external item"),
        refType: z.string().optional().describe("Type of external item (e.g., 'epic', 'project', 'milestone')"),
        syncDirection: z.enum(["push", "pull", "bidirectional"]).optional().describe("Sync direction"),
        lastSyncedAt: z.string().optional().describe("ISO timestamp of last sync"),
        syncStatus: z.enum(["current", "stale", "conflict"]).optional().describe("Current sync status"),
      })).max(50).optional().describe("External system references (optional for update). Max 50 entries."),
      limit: z.number().int().optional().describe("Max results to return for list action (default: 20)"),
      offset: z.number().int().optional().describe("Number of items to skip for pagination (default: 0)"),
    },
    async ({ initiator, action, ideaId, appId, name, description, type, parentIdeaId, status, ideaType, intention, primaryOutput, initiative, externalProjectKey, externalRefs, hasAlerts, limit, offset }) => {
      resolveInitiator({ initiator });
      const uid = getCurrentUid();

      // ─── LIST ───
      if (action === "list") {
        const snapshot = await getIdeasRef(uid).once("value");
        const data = snapshot.val();
        if (!data) return withResponseSize({ content: [{ type: "text", text: JSON.stringify([], null, 2) }] });

        // Derive id from the RTDB key, not the embedded `id` field — records
        // written without one (e.g. legacy or partially-written nodes) would
        // otherwise ship with id: undefined.
        let ideas: any[] = Object.entries(data).map(([key, i]: [string, any]) => ({
          ...(i as any),
          id: (i as any)?.id || key,
        }));

        // Status filter: if provided, show only that status. Otherwise exclude completed and archived.
        if (status) {
          ideas = ideas.filter((i) => i.status === status);
        } else {
          ideas = ideas.filter((i) => i.status !== "completed" && i.status !== "archived");
        }

        if (appId) {
          ideas = ideas
            .filter((i) => i.appId === appId)
            .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
        } else {
          // Unfiltered: RTDB hands back push-key order, which is oldest-first.
          // With hundreds of active ideas that made the default page the OLDEST
          // 20 — and made "is my new idea in the list?" depend on the caller
          // guessing a limit above the collection size. Sort newest-first, the
          // same convention job/session/document list already use. Ideas scoped
          // to an app keep sequence order, which is the meaningful one there.
          ideas.sort(
            (a, b) =>
              new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
          );
        }
        if (ideaType) {
          ideas = ideas.filter((i) => i.ideaType === ideaType);
        }
        if (intention) {
          ideas = ideas.filter((i) => i.intention === intention);
        }
        if (primaryOutput) {
          ideas = ideas.filter((i) => i.primaryOutput === primaryOutput);
        }
        if (initiative) {
          ideas = ideas.filter((i) => i.initiative && i.initiative.toLowerCase() === initiative.toLowerCase());
        }
        if (hasAlerts) {
          ideas = ideas.filter((i) => (i.alertCount || 0) > 0);
        }

        const total = ideas.length;
        const skip = offset && offset > 0 ? offset : 0;
        const take = limit && limit > 0 ? limit : 20;
        ideas = ideas.slice(skip, skip + take);

        // Lean response: summary fields only. Use get/get_active for full record.
        const lean = ideas.map((i) => ({
          id: i.id,
          name: i.name,
          status: i.status,
          type: i.type,
          ideaType: i.ideaType || null,
          intention: i.intention || null,
          primaryOutput: i.primaryOutput || null,
          initiative: i.initiative || null,
          appId: i.appId,
          sequence: i.sequence,
          parentIdeaId: i.parentIdeaId,
          alertCount: i.alertCount || 0,
          lastSessionAt: i.lastSessionAt || null,
          createdAt: i.createdAt,
          updatedAt: i.updatedAt,
        }));

        const avgItemSize = lean.length > 0
          ? Math.round(lean.reduce((sum, item) => sum + JSON.stringify(item).length, 0) / lean.length)
          : 0;

        return withResponseSize(
          { content: [{ type: "text", text: JSON.stringify({ items: lean, total, offset: skip, limit: take }, null, 2) }] },
          { _estimatedItemSize: avgItemSize }
        );
      }

      // ─── GET ───
      if (action === "get") {
        if (!ideaId) return withResponseSize({ content: [{ type: "text", text: "action 'get' requires ideaId" }], isError: true });

        const ref = getIdeaRef(uid, ideaId);
        const snapshot = await ref.once("value");
        const idea = snapshot.val();
        if (!idea) {
          // Fuzzy match against recent ideas
          const allSnap = await getIdeasRef(uid).orderByKey().limitToLast(50).once("value");
          const allIdeas = allSnap.val() || {};
          const entries = Object.entries(allIdeas).map(([id, i]: [string, any]) => ({
            id,
            label: (i as any).name || undefined,
          }));
          const candidates = findCandidates(ideaId!, entries);
          const did_you_mean = formatDidYouMean(candidates);
          const errorObj: any = { error: `Idea not found: ${ideaId}` };
          if (did_you_mean) errorObj.did_you_mean = did_you_mean;
          return withResponseSize({ content: [{ type: "text", text: JSON.stringify(errorObj, null, 2) }], isError: true });
        }

        return withResponseSize({ content: [{ type: "text", text: JSON.stringify(idea, null, 2) }] });
      }

      // ─── CREATE ───
      if (action === "create") {
        if (!name) return withResponseSize({ content: [{ type: "text", text: "action 'create' requires name" }], isError: true });
        if (!description) return withResponseSize({ content: [{ type: "text", text: "action 'create' requires description" }], isError: true });

        const ideaTypeChain = type || "base";

        // Calculate sequence if linked to an app
        let sequence = 1;
        if (appId) {
          const allSnap = await getIdeasRef(uid).once("value");
          const allData = allSnap.val() || {};
          const appIdeas: any[] = Object.values(allData)
            .filter((i: any) => i.appId === appId)
            .sort((a: any, b: any) => (a.sequence || 0) - (b.sequence || 0));
          sequence = appIdeas.length > 0 ? Math.max(...appIdeas.map((i: any) => i.sequence || 0)) + 1 : 1;
        }

        const ref = getIdeasRef(uid).push();
        const now = new Date().toISOString();
        const idea: Record<string, any> = {
          id: ref.key,
          name,
          description,
          type: ideaTypeChain,
          ideaType: ideaType || "primary",
          appId: appId || null,
          parentIdeaId: parentIdeaId || null,
          sequence,
          status: "active",
          createdAt: now,
          updatedAt: now,
        };
        if (intention) idea.intention = intention;
        if (primaryOutput) idea.primaryOutput = primaryOutput;
        if (initiative) idea.initiative = initiative;
        if (externalProjectKey) idea.externalProjectKey = externalProjectKey;
        await ref.set(idea);

        // Update app's ideas index if linked
        if (appId) {
          const appIdeasRef = getAppIdeasRef(uid, appId);
          const snap = await appIdeasRef.once("value");
          const existing: string[] = snap.val() || [];
          if (!existing.includes(ref.key!)) {
            existing.push(ref.key!);
            await appIdeasRef.set(existing);
          }
        }

        return withResponseSize({ content: [{ type: "text", text: JSON.stringify(idea, null, 2) }] });
      }

      // ─── UPDATE ───
      if (action === "update") {
        if (!ideaId) return withResponseSize({ content: [{ type: "text", text: "action 'update' requires ideaId" }], isError: true });

        const ref = getIdeasRef(uid).child(ideaId);
        const snapshot = await ref.once("value");
        const existing = snapshot.val();
        if (!existing) return withResponseSize({ content: [{ type: "text", text: `Idea not found: ${ideaId}` }], isError: true });

        const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
        if (name !== undefined) updates.name = name;
        if (description !== undefined) updates.description = description;
        if (status !== undefined) updates.status = status;
        if (ideaType !== undefined) updates.ideaType = ideaType;
        if (intention !== undefined) updates.intention = intention;
        if (primaryOutput !== undefined) updates.primaryOutput = primaryOutput;
        if (initiative !== undefined) updates.initiative = initiative;
        if (externalProjectKey !== undefined) updates.externalProjectKey = externalProjectKey;
        if (externalRefs !== undefined) updates.externalRefs = externalRefs;

        await ref.update(updates);
        return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ ...existing, ...updates }, null, 2) }] });
      }

      // ─── GRADUATE ───
      if (action === "graduate") {
        if (!ideaId) return withResponseSize({ content: [{ type: "text", text: "action 'graduate' requires ideaId" }], isError: true });
        if (!appId) return withResponseSize({ content: [{ type: "text", text: "action 'graduate' requires appId" }], isError: true });

        const ref = getIdeasRef(uid).child(ideaId);
        const snapshot = await ref.once("value");
        const idea = snapshot.val();
        if (!idea) return withResponseSize({ content: [{ type: "text", text: `Idea not found: ${ideaId}` }], isError: true });

        // Get existing ideas for this app
        const allSnap = await getIdeasRef(uid).once("value");
        const allData = allSnap.val() || {};
        const appIdeas: any[] = Object.values(allData)
          .filter((i: any) => i.appId === appId)
          .sort((a: any, b: any) => (a.sequence || 0) - (b.sequence || 0));

        const sequence = appIdeas.length > 0 ? Math.max(...appIdeas.map((i: any) => i.sequence || 0)) + 1 : 1;
        const ideaType = appIdeas.length === 0 ? "base" : "addon";
        const parent = appIdeas.length > 0 ? appIdeas[appIdeas.length - 1].id : null;

        const now = new Date().toISOString();
        const updates = {
          appId,
          sequence,
          type: ideaType,
          parentIdeaId: parent,
          status: "graduated",
          updatedAt: now,
        };
        await ref.update(updates);

        // Update app's ideas index
        const appIdeasRef = getAppIdeasRef(uid, appId);
        const idxSnap = await appIdeasRef.once("value");
        const existing: string[] = idxSnap.val() || [];
        if (!existing.includes(ideaId)) {
          existing.push(ideaId);
          await appIdeasRef.set(existing);
        }

        return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ ...idea, ...updates }, null, 2) }] });
      }

      // ─── ARCHIVE ───
      if (action === "archive") {
        if (!ideaId) return withResponseSize({ content: [{ type: "text", text: "action 'archive' requires ideaId" }], isError: true });

        const ref = getIdeasRef(uid).child(ideaId);
        const snapshot = await ref.once("value");
        const idea = snapshot.val();
        if (!idea) return withResponseSize({ content: [{ type: "text", text: `Idea not found: ${ideaId}` }], isError: true });

        const now = new Date().toISOString();
        await ref.update({ status: "archived", updatedAt: now });

        return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ ...idea, status: "archived", updatedAt: now }, null, 2) }] });
      }

      // ─── GET_ACTIVE ───
      if (action === "get_active") {
        if (!appId) return withResponseSize({ content: [{ type: "text", text: "action 'get_active' requires appId" }], isError: true });

        const allSnap = await getIdeasRef(uid).once("value");
        const allData = allSnap.val() || {};
        const appIdeas: any[] = Object.values(allData)
          .filter((i: any) => i.appId === appId && i.status === "active")
          .sort((a: any, b: any) => (a.sequence || 0) - (b.sequence || 0));

        const active = appIdeas.length > 0 ? appIdeas[appIdeas.length - 1] : null;
        return withResponseSize({ content: [{ type: "text", text: JSON.stringify(active, null, 2) }] });
      }

      // ─── LIST_RANKED ───
      if (action === "list_ranked") {
        const uid2 = uid; // avoid shadowing
        const now = new Date();

        // Check cache — avoid 4 full-collection reads on rapid repeat calls
        const cacheKey = `${uid2}:${appId || ""}`;
        const cached = listRankedCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < LIST_RANKED_CACHE_TTL_MS) {
          return cached.result;
        }

        // Fetch all data in parallel
        const [ideasSnap, conceptsSnap, jobsSnap, sessionsSnap] = await Promise.all([
          getIdeasRef(uid2).once("value"),
          getConceptsRef(uid2).once("value"),
          getJobsRef(uid2).once("value"),
          getSessionsRef(uid2).once("value"),
        ]);

        // The RTDB key is the authoritative id. A stored record can lose its embedded `id`
        // field — a partial `update()` against a deleted idea path recreates the node with
        // only the written fields — and `Object.values` would then produce an entry whose
        // `id` is undefined. JSON.stringify drops undefined keys, so the entry ships with no
        // `id` at all and every consumer indexing it breaks. Falling back to the key also
        // keeps the per-idea counters honest: with an undefined ideaId, the job filter below
        // matches every job that has no ideaId.
        const allIdeas: any[] = Object.entries(ideasSnap.val() || {}).map(
          ([key, value]: [string, any]) => ({ ...(value || {}), id: (value && value.id) || key })
        );
        const allConcepts: any[] = Object.values(conceptsSnap.val() || {});
        const allJobs: any[] = Object.values(jobsSnap.val() || {});
        const allSessions: any[] = Object.values(sessionsSnap.val() || {});

        // Filter to non-archived, non-completed ideas
        let ideas = allIdeas.filter((i) => i.status !== "archived" && i.status !== "completed");
        if (appId) {
          ideas = ideas.filter((i) => i.appId === appId);
        }

        const TIER_LABELS: Record<number, string> = {
          0: "Delivered",
          1: "Build-Ready",
          2: "Nearly-Ready",
          3: "Progressing",
          4: "Early",
          5: "Exploratory",
        };

        const rankedIdeas = ideas.map((idea) => {
          const ideaId2 = idea.id;

          // Concept counts
          const ideaConcepts = allConcepts.filter((c) => c.ideaOrigin === ideaId2 && c.status === "active");
          const openCount = ideaConcepts.filter((c) => c.type === "OPEN").length;
          const decisionCount = ideaConcepts.filter((c) => c.type === "DECISION").length;
          const ruleCount = ideaConcepts.filter((c) => c.type === "RULE").length;
          const constraintCount = ideaConcepts.filter((c) => c.type === "CONSTRAINT").length;

          // Unbuilt = active DECISIONs (built ones are already filtered out by status=active)
          const unbuiltDecisionCount = decisionCount;

          // Last activity: max across sessions, concepts, jobs
          const timestamps: number[] = [];

          // Session activity
          allSessions
            .filter((s) => s.ideaId === ideaId2)
            .forEach((s) => {
              if (s.startedAt) timestamps.push(new Date(s.startedAt).getTime());
              if (s.completedAt) timestamps.push(new Date(s.completedAt).getTime());
            });

          // Concept activity
          allConcepts
            .filter((c) => c.ideaOrigin === ideaId2)
            .forEach((c) => {
              if (c.createdAt) timestamps.push(new Date(c.createdAt).getTime());
              if (c.updatedAt) timestamps.push(new Date(c.updatedAt).getTime());
            });

          // Job activity
          allJobs
            .filter((j) => j.ideaId === ideaId2)
            .forEach((j) => {
              if (j.createdAt) timestamps.push(new Date(j.createdAt).getTime());
              if (j.completedAt) timestamps.push(new Date(j.completedAt).getTime());
            });

          const lastActivityMs = timestamps.length > 0 ? Math.max(...timestamps) : new Date(idea.createdAt).getTime();
          const lastActivity = new Date(lastActivityMs).toISOString();
          const daysSinceActivity = Math.floor((now.getTime() - lastActivityMs) / (1000 * 60 * 60 * 24));

          // Completed job count
          const completedJobCount = idea.completedJobCount || allJobs.filter((j) => j.ideaId === ideaId2 && j.status === "completed").length;

          // Tier assignment
          let tier: number;
          if (completedJobCount > 0 && unbuiltDecisionCount === 0) {
            tier = 0; // Delivered
          } else if (decisionCount >= 5 && openCount === 0) {
            tier = 1; // Build-Ready
          } else if (decisionCount >= 3 && (decisionCount / Math.max(openCount, 1)) >= 3) {
            tier = 2; // Nearly-Ready
          } else if (decisionCount > openCount) {
            tier = 3; // Progressing
          } else if (decisionCount > 0) {
            tier = 4; // Early
          } else {
            tier = 5; // Exploratory
          }

          // Neglect overlay: tiers 2-4 with >= 7 days inactive
          const neglected = tier >= 2 && tier <= 4 && daysSinceActivity >= 7;

          return {
            id: ideaId2,
            name: idea.name || null,
            appId: idea.appId || null,
            ideaType: idea.ideaType || null,
            intention: idea.intention || null,
            primaryOutput: idea.primaryOutput || null,
            initiative: idea.initiative || null,
            tier,
            tierLabel: TIER_LABELS[tier],
            neglected,
            openCount,
            decisionCount,
            unbuiltDecisionCount,
            ruleCount,
            constraintCount,
            completedJobCount,
            lastActivity,
            daysSinceActivity,
          };
        });

        // Sort: by tier asc, within tier neglected first, then openCount desc
        rankedIdeas.sort((a, b) => {
          if (a.tier !== b.tier) return a.tier - b.tier;
          if (a.neglected !== b.neglected) return a.neglected ? -1 : 1;
          return b.openCount - a.openCount;
        });

        // Tier summary
        const tierSummary = {
          buildReady: rankedIdeas.filter((i) => i.tier === 1).length,
          nearlyReady: rankedIdeas.filter((i) => i.tier === 2).length,
          progressing: rankedIdeas.filter((i) => i.tier === 3).length,
          early: rankedIdeas.filter((i) => i.tier === 4).length,
          exploratory: rankedIdeas.filter((i) => i.tier === 5).length,
          delivered: rankedIdeas.filter((i) => i.tier === 0).length,
        };

        const result = withResponseSize({
          content: [{
            type: "text" as const,
            text: JSON.stringify({ rankedIdeas, tierSummary }, null, 2),
          }],
        });

        // Cache result for 30s
        listRankedCache.set(cacheKey, { result, timestamp: Date.now() });

        return result;
      }

      // ─── TRIAGE ───
      if (action === "triage") {
        if (!appId) return withResponseSize({ content: [{ type: "text", text: "action 'triage' requires appId" }], isError: true });

        // 4 parallel Firebase reads
        const [ideasSnap, conceptsSnap, jobsSnap, sessionsSnap] = await Promise.all([
          getIdeasRef(uid).once("value"),
          getConceptsRef(uid).once("value"),
          getJobsRef(uid).once("value"),
          getSessionsRef(uid).orderByChild("status").equalTo("completed").once("value"),
        ]);

        const allIdeas: any[] = Object.values(ideasSnap.val() || {});
        const allConcepts: any[] = Object.values(conceptsSnap.val() || {});
        const allJobs: any[] = Object.values(jobsSnap.val() || {});
        const allCompletedSessions: any[] = Object.values(sessionsSnap.val() || {});

        // Count ALL completed sessions for this app
        const appSessionCount = allCompletedSessions.filter(
          (s: any) => s.appId === appId
        ).length;

        // Filter to active app ideas
        const appIdeas = allIdeas.filter(
          (i: any) => i.appId === appId && i.status !== "completed" && i.status !== "archived"
        );

        // Compute health for each idea
        const triageResults: any[] = [];
        const multiPathUpdates: Record<string, any> = {};
        let totalAlertCount = 0;

        for (const idea of appIdeas) {
          const ideaConcepts = allConcepts.filter(
            (c: any) => c.ideaOrigin === idea.id && c.status === "active"
          );
          const activeOpenCount = ideaConcepts.filter((c: any) => c.type === "OPEN").length;
          const ideaJobs = allJobs.filter((j: any) => j.ideaId === idea.id);
          const completedJobCount = ideaJobs.filter((j: any) => j.status === "completed").length;

          const alerts = computeIdeaHealth({
            idea,
            totalAppSessionCount: appSessionCount,
            conceptCount: ideaConcepts.length,
            activeOpenCount,
            completedJobCount,
            totalJobCount: ideaJobs.length,
          });

          // Stage multi-path update for this idea
          multiPathUpdates[`${idea.id}/alerts`] = alerts.length > 0 ? alerts : null;
          multiPathUpdates[`${idea.id}/alertCount`] = alerts.length;
          multiPathUpdates[`${idea.id}/sessionCountAtLastHealth`] = appSessionCount;

          totalAlertCount += alerts.length;

          if (alerts.length > 0) {
            triageResults.push({
              id: idea.id,
              name: idea.name,
              ideaType: idea.ideaType || null,
              intention: idea.intention || null,
              alertCount: alerts.length,
              alerts,
            });
          }
        }

        // Atomic multi-path write to update all idea alerts
        if (Object.keys(multiPathUpdates).length > 0) {
          await getIdeasRef(uid).update(multiPathUpdates);
        }

        // Update app triage flags
        await updateAppTriageFlags(uid, appId, totalAlertCount);

        // Sort by severity: high first
        const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
        triageResults.sort((a, b) => {
          const aMax = Math.min(...a.alerts.map((al: any) => severityOrder[al.severity] ?? 3));
          const bMax = Math.min(...b.alerts.map((al: any) => severityOrder[al.severity] ?? 3));
          return aMax - bMax;
        });

        return withResponseSize({
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              appId,
              totalIdeasScanned: appIdeas.length,
              totalAlertCount,
              ideasWithAlerts: triageResults.length,
              appSessionCount,
              ideas: triageResults,
            }, null, 2),
          }],
        });
      }

      // ─── DELETE ───
      if (action === "delete") {
        if (!ideaId) return withResponseSize({ content: [{ type: "text", text: "action 'delete' requires ideaId" }], isError: true });

        const ref = getIdeaRef(uid, ideaId);
        const snapshot = await ref.once("value");
        const idea = snapshot.val();
        if (!idea) return withResponseSize({ content: [{ type: "text", text: `Idea not found: ${ideaId}` }], isError: true });

        await ref.remove();

        // Clean up appIdeas index if this idea was linked to an app
        if (idea.appId) {
          const appIdeasRef = getAppIdeasRef(uid, idea.appId);
          const idxSnap = await appIdeasRef.once("value");
          const existing: string[] = idxSnap.val() || [];
          const updated = existing.filter((id: string) => id !== ideaId);
          await appIdeasRef.set(updated);
        }

        return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ deleted: ideaId }) }] });
      }

      return withResponseSize({ content: [{ type: "text", text: `Unknown action: ${action}` }], isError: true });
    }
  );
}
