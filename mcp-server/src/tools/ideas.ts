import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getIdeasRef, getAppIdeasRef, getIdeaRef, getConceptsRef, getJobsRef, getSessionsRef } from "../firebase.js";
import { getCurrentUid } from "../context.js";

const IDEA_TYPES = ["base", "addon"] as const;
const IDEA_STATUSES = ["active", "graduated", "archived"] as const;

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
  - "list": List ideas. Optional: appId filter (sorts by sequence when filtered).
  - "create": Create a new idea. Requires name, description. Optional: type (base/addon), appId, parentIdeaId.
  - "update": Update name, description, or status. Requires ideaId. Optional: name, description, status.
  - "graduate": Link idea to an app. Requires ideaId, appId. Auto-calculates sequence and type.
  - "archive": Archive an idea. Requires ideaId.
  - "get_active": Get the latest active idea for an app. Requires appId.
  - "list_ranked": Rank ideas by build-readiness tier. Optional: appId filter. Returns ideas sorted by 5-tier model with activity metrics.
  - "delete": Delete an idea. Requires ideaId. Also removes from appIdeas index. Use for test cleanup only.`,
    {
      action: z.enum(["list", "create", "update", "graduate", "archive", "get_active", "list_ranked", "delete"]).describe("Action to perform"),
      ideaId: z.string().optional().describe("Idea ID (required for update/graduate/archive)"),
      appId: z.string().optional().describe("App ID (optional for list/create, required for graduate/get_active)"),
      name: z.string().optional().describe("Idea name (required for create, optional for update)"),
      description: z.string().optional().describe("Idea description (required for create, optional for update)"),
      type: z.enum(IDEA_TYPES).optional().describe("Idea type: base or addon (optional for create, default: base)"),
      parentIdeaId: z.string().optional().describe("Parent idea ID for addon ideas (optional for create)"),
      status: z.enum(IDEA_STATUSES).optional().describe("New status (optional for update)"),
      limit: z.number().int().optional().describe("Max results to return for list action (default: 20)"),
      offset: z.number().int().optional().describe("Number of items to skip for pagination (default: 0)"),
    },
    async ({ action, ideaId, appId, name, description, type, parentIdeaId, status, limit, offset }) => {
      const uid = getCurrentUid();

      // ─── LIST ───
      if (action === "list") {
        const snapshot = await getIdeasRef(uid).once("value");
        const data = snapshot.val();
        if (!data) return { content: [{ type: "text", text: JSON.stringify([], null, 2) }] };

        let ideas: any[] = Object.values(data);

        if (appId) {
          ideas = ideas
            .filter((i) => i.appId === appId)
            .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
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
          appId: i.appId,
          sequence: i.sequence,
          parentIdeaId: i.parentIdeaId,
          createdAt: i.createdAt,
          updatedAt: i.updatedAt,
        }));

        return { content: [{ type: "text", text: JSON.stringify({ items: lean, total, offset: skip, limit: take }, null, 2) }] };
      }

      // ─── CREATE ───
      if (action === "create") {
        if (!name) return { content: [{ type: "text", text: "action 'create' requires name" }], isError: true };
        if (!description) return { content: [{ type: "text", text: "action 'create' requires description" }], isError: true };

        const ideaType = type || "base";

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
        const idea = {
          id: ref.key,
          name,
          description,
          type: ideaType,
          appId: appId || null,
          parentIdeaId: parentIdeaId || null,
          sequence,
          status: "active",
          createdAt: now,
          updatedAt: now,
        };
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

        return { content: [{ type: "text", text: JSON.stringify(idea, null, 2) }] };
      }

      // ─── UPDATE ───
      if (action === "update") {
        if (!ideaId) return { content: [{ type: "text", text: "action 'update' requires ideaId" }], isError: true };

        const ref = getIdeasRef(uid).child(ideaId);
        const snapshot = await ref.once("value");
        const existing = snapshot.val();
        if (!existing) return { content: [{ type: "text", text: `Idea not found: ${ideaId}` }], isError: true };

        const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
        if (name !== undefined) updates.name = name;
        if (description !== undefined) updates.description = description;
        if (status !== undefined) updates.status = status;

        await ref.update(updates);
        return { content: [{ type: "text", text: JSON.stringify({ ...existing, ...updates }, null, 2) }] };
      }

      // ─── GRADUATE ───
      if (action === "graduate") {
        if (!ideaId) return { content: [{ type: "text", text: "action 'graduate' requires ideaId" }], isError: true };
        if (!appId) return { content: [{ type: "text", text: "action 'graduate' requires appId" }], isError: true };

        const ref = getIdeasRef(uid).child(ideaId);
        const snapshot = await ref.once("value");
        const idea = snapshot.val();
        if (!idea) return { content: [{ type: "text", text: `Idea not found: ${ideaId}` }], isError: true };

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

        return { content: [{ type: "text", text: JSON.stringify({ ...idea, ...updates }, null, 2) }] };
      }

      // ─── ARCHIVE ───
      if (action === "archive") {
        if (!ideaId) return { content: [{ type: "text", text: "action 'archive' requires ideaId" }], isError: true };

        const ref = getIdeasRef(uid).child(ideaId);
        const snapshot = await ref.once("value");
        const idea = snapshot.val();
        if (!idea) return { content: [{ type: "text", text: `Idea not found: ${ideaId}` }], isError: true };

        const now = new Date().toISOString();
        await ref.update({ status: "archived", updatedAt: now });

        return { content: [{ type: "text", text: JSON.stringify({ ...idea, status: "archived", updatedAt: now }, null, 2) }] };
      }

      // ─── GET_ACTIVE ───
      if (action === "get_active") {
        if (!appId) return { content: [{ type: "text", text: "action 'get_active' requires appId" }], isError: true };

        const allSnap = await getIdeasRef(uid).once("value");
        const allData = allSnap.val() || {};
        const appIdeas: any[] = Object.values(allData)
          .filter((i: any) => i.appId === appId && i.status === "active")
          .sort((a: any, b: any) => (a.sequence || 0) - (b.sequence || 0));

        const active = appIdeas.length > 0 ? appIdeas[appIdeas.length - 1] : null;
        return { content: [{ type: "text", text: JSON.stringify(active, null, 2) }] };
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

        const allIdeas: any[] = Object.values(ideasSnap.val() || {});
        const allConcepts: any[] = Object.values(conceptsSnap.val() || {});
        const allJobs: any[] = Object.values(jobsSnap.val() || {});
        const allSessions: any[] = Object.values(sessionsSnap.val() || {});

        // Filter to non-archived ideas
        let ideas = allIdeas.filter((i) => i.status !== "archived");
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
            name: idea.name,
            appId: idea.appId || null,
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

        const result = {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ rankedIdeas, tierSummary }, null, 2),
          }],
        };

        // Cache result for 30s
        listRankedCache.set(cacheKey, { result, timestamp: Date.now() });

        return result;
      }

      // ─── DELETE ───
      if (action === "delete") {
        if (!ideaId) return { content: [{ type: "text", text: "action 'delete' requires ideaId" }], isError: true };

        const ref = getIdeaRef(uid, ideaId);
        const snapshot = await ref.once("value");
        const idea = snapshot.val();
        if (!idea) return { content: [{ type: "text", text: `Idea not found: ${ideaId}` }], isError: true };

        await ref.remove();

        // Clean up appIdeas index if this idea was linked to an app
        if (idea.appId) {
          const appIdeasRef = getAppIdeasRef(uid, idea.appId);
          const idxSnap = await appIdeasRef.once("value");
          const existing: string[] = idxSnap.val() || [];
          const updated = existing.filter((id: string) => id !== ideaId);
          await appIdeasRef.set(updated);
        }

        return { content: [{ type: "text", text: JSON.stringify({ deleted: ideaId }) }] };
      }

      return { content: [{ type: "text", text: `Unknown action: ${action}` }], isError: true };
    }
  );
}
