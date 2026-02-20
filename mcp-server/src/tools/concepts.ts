import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getConceptsRef, getConceptRef, getAppIdeasRef, getSessionRef, getJobRef } from "../firebase.js";
import { getCurrentUid } from "../context.js";

// Mirrors CC's ODRC_TYPES (index.html:4772)
const ODRC_TYPES = ["OPEN", "DECISION", "RULE", "CONSTRAINT"] as const;

// Mirrors CC's CONCEPT_STATUSES (index.html:4775)
const CONCEPT_STATUSES = ["active", "superseded", "resolved", "transitioned", "built"] as const;

// Mirrors CC's ODRC_TRANSITIONS (index.html:4778)
const ODRC_TRANSITIONS: Record<string, string[]> = {
  OPEN: ["DECISION", "RULE", "CONSTRAINT"],
  DECISION: ["RULE"],
  CONSTRAINT: ["DECISION", "RULE"],
  RULE: ["OPEN"],
};

function isValidTransition(fromType: string, toType: string): boolean {
  return ODRC_TRANSITIONS[fromType]?.includes(toType) ?? false;
}

// Helper: update job record when concept tools are called with jobId
async function updateJobRecord(
  uid: string,
  jobId: string,
  action: { type: "created" | "modified"; conceptId: string; eventType: string; detail: string; odrcType?: string }
): Promise<void> {
  const jobRef = getJobRef(uid, jobId);
  const jobSnap = await jobRef.once("value");
  const job = jobSnap.val();
  if (!job) return;

  const now = new Date().toISOString();
  const updates: Record<string, any> = {
    "metadata/toolCallCount": (job.metadata?.toolCallCount || 0) + 1,
  };

  if (action.type === "created") {
    const created = job.conceptsCreated || [];
    created.push(action.conceptId);
    updates.conceptsCreated = created;
  } else {
    const modified = job.conceptsModified || [];
    modified.push(action.conceptId);
    updates.conceptsModified = modified;
  }

  const events = job.events || [];
  events.push({
    timestamp: now,
    type: action.eventType,
    detail: action.detail,
    refId: action.conceptId,
  });
  updates.events = events;

  await jobRef.update(updates);
}

export function registerConceptTools(server: McpServer): void {

  // list_concepts — kept standalone (most frequent read, simple schema)
  server.tool(
    "list_concepts",
    "List ODRC concepts. Filter by ideaId, appId, type, or status. Returns all concepts if no filters provided.",
    {
      ideaId: z.string().optional().describe("Filter by origin idea ID"),
      appId: z.string().optional().describe("Filter by app ID (returns concepts from all ideas linked to this app)"),
      type: z.enum(ODRC_TYPES).optional().describe("Filter by concept type: OPEN, DECISION, RULE, or CONSTRAINT"),
      status: z.enum(CONCEPT_STATUSES).optional().describe("Filter by status: active, superseded, resolved, or transitioned"),
      limit: z.number().int().optional().describe("Max results to return (default: 20)"),
      offset: z.number().int().optional().describe("Number of items to skip for pagination (default: 0)"),
    },
    async ({ ideaId, appId, type, status, limit, offset }) => {
      const uid = getCurrentUid();
      const snapshot = await getConceptsRef(uid).once("value");
      const data = snapshot.val();
      if (!data) return { content: [{ type: "text", text: JSON.stringify([], null, 2) }] };

      let concepts: any[] = Object.values(data);

      // Filter by app — get all idea IDs for this app first
      if (appId) {
        const appIdeasSnap = await getAppIdeasRef(uid, appId).once("value");
        const ideaIds: string[] = appIdeasSnap.val() || [];
        concepts = concepts.filter((c) => ideaIds.includes(c.ideaOrigin));
      }

      if (ideaId) concepts = concepts.filter((c) => c.ideaOrigin === ideaId);
      if (type) concepts = concepts.filter((c) => c.type === type);
      if (status) concepts = concepts.filter((c) => c.status === status);

      const total = concepts.length;
      const skip = offset && offset > 0 ? offset : 0;
      const take = limit && limit > 0 ? limit : 20;
      concepts = concepts.slice(skip, skip + take);

      // Lean response: summary fields with truncated content. Use concept(get) for full record.
      const lean = concepts.map((c) => ({
        id: c.id,
        type: c.type,
        status: c.status,
        ideaOrigin: c.ideaOrigin,
        content: c.content?.length > 100 ? c.content.substring(0, 100) + "..." : c.content,
        scopeTags: c.scopeTags,
        createdAt: c.createdAt,
      }));

      return { content: [{ type: "text", text: JSON.stringify({ items: lean, total, offset: skip, limit: take }, null, 2) }] };
    }
  );

  // concept — Consolidated ODRC concept mutation tool
  server.tool(
    "concept",
    `ODRC concept mutation tool. Actions:
  - "create": Create a new concept. Requires type (OPEN/DECISION/RULE/CONSTRAINT), content, ideaOrigin. Optional: scopeTags, sessionId, jobId.
  - "update": Update content or scopeTags on an active concept. Requires conceptId. Optional: content, scopeTags.
  - "transition": Transition to a new type following state machine (OPEN→DECISION/RULE/CONSTRAINT, DECISION→RULE, CONSTRAINT→DECISION/RULE, RULE→OPEN). Requires conceptId, newType. Optional: sessionId, jobId.
  - "supersede": Replace content, same type. Requires conceptId, newContent. Optional: sessionId, jobId.
  - "resolve": Mark as resolved (typically OPENs). Requires conceptId. Optional: sessionId, jobId.
  - "mark_built": Mark a DECISION as "built" (implemented in code). Requires conceptId. Only valid for active DECISIONs.
  - "migrate": Re-parent a concept to a different idea. Requires conceptId, newIdeaId. Updates ideaOrigin.
  - "delete": Delete a concept. Requires conceptId. Use for test cleanup only.`,
    {
      action: z.enum(["create", "update", "transition", "supersede", "resolve", "mark_built", "migrate", "delete"]).describe("Action to perform"),
      conceptId: z.string().optional().describe("Concept ID (required for update/transition/supersede/resolve/mark_built/migrate)"),
      type: z.enum(ODRC_TYPES).optional().describe("Concept type (required for create): OPEN, DECISION, RULE, or CONSTRAINT"),
      content: z.string().optional().describe("Concept text (required for create, optional for update)"),
      newContent: z.string().optional().describe("Replacement text (required for supersede)"),
      newType: z.enum(ODRC_TYPES).optional().describe("Target type (required for transition)"),
      ideaOrigin: z.string().optional().describe("Origin idea ID (required for create)"),
      newIdeaId: z.string().optional().describe("New idea ID to migrate concept to (required for migrate)"),
      scopeTags: z.array(z.string()).optional().describe("Scope tags (optional for create/update)"),
      sessionId: z.string().optional().describe("Active session ID for tracking (optional for create/transition/supersede/resolve)"),
      jobId: z.string().optional().describe("Active job ID for tracking (optional for create/transition/supersede/resolve)"),
    },
    async ({ action, conceptId, type, content, newContent, newType, ideaOrigin, newIdeaId, scopeTags, sessionId, jobId }) => {
      const uid = getCurrentUid();

      // ─── CREATE ───
      if (action === "create") {
        if (!type) return { content: [{ type: "text", text: "action 'create' requires type (OPEN/DECISION/RULE/CONSTRAINT)" }], isError: true };
        if (!content) return { content: [{ type: "text", text: "action 'create' requires content" }], isError: true };
        if (!ideaOrigin) return { content: [{ type: "text", text: "action 'create' requires ideaOrigin" }], isError: true };

        const ref = getConceptsRef(uid).push();
        const now = new Date().toISOString();
        const concept = {
          id: ref.key,
          type,
          content,
          ideaOrigin,
          status: "active",
          resolvedBy: null,
          transitionedFrom: null,
          scopeTags: scopeTags || [],
          createdAt: now,
          updatedAt: now,
        };
        await ref.set(concept);

        // Update session record if sessionId provided
        if (sessionId) {
          const sessionRef = getSessionRef(uid, sessionId);
          const sessionSnap = await sessionRef.once("value");
          const session = sessionSnap.val();
          if (session) {
            const created = session.conceptsCreated || [];
            created.push(ref.key!);
            const events = session.events || [];
            events.push({
              timestamp: now,
              type: "concept_created",
              detail: `Created ${type}: ${content.substring(0, 80)}${content.length > 80 ? "..." : ""}`,
              refId: ref.key,
            });
            const conceptCount = session.metadata?.conceptCount || { OPEN: 0, DECISION: 0, RULE: 0, CONSTRAINT: 0 };
            conceptCount[type] = (conceptCount[type] || 0) + 1;
            await sessionRef.update({
              conceptsCreated: created,
              events,
              "metadata/toolCallCount": (session.metadata?.toolCallCount || 0) + 1,
              "metadata/conceptCount": conceptCount,
            });
          }
        }

        // Update job record if jobId provided
        if (jobId) {
          await updateJobRecord(uid, jobId, {
            type: "created",
            conceptId: ref.key!,
            eventType: "concept_created",
            detail: `Created ${type}: ${content.substring(0, 80)}${content.length > 80 ? "..." : ""}`,
            odrcType: type,
          });
        }

        return { content: [{ type: "text", text: JSON.stringify(concept, null, 2) }] };
      }

      // ─── UPDATE ───
      if (action === "update") {
        if (!conceptId) return { content: [{ type: "text", text: "action 'update' requires conceptId" }], isError: true };

        const ref = getConceptsRef(uid).child(conceptId);
        const snapshot = await ref.once("value");
        const existing = snapshot.val();
        if (!existing) return { content: [{ type: "text", text: `Concept not found: ${conceptId}` }], isError: true };

        const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
        if (content !== undefined) updates.content = content;
        if (scopeTags !== undefined) updates.scopeTags = scopeTags;

        await ref.update(updates);
        return { content: [{ type: "text", text: JSON.stringify({ ...existing, ...updates }, null, 2) }] };
      }

      // ─── TRANSITION ───
      if (action === "transition") {
        if (!conceptId) return { content: [{ type: "text", text: "action 'transition' requires conceptId" }], isError: true };
        if (!newType) return { content: [{ type: "text", text: "action 'transition' requires newType" }], isError: true };

        const ref = getConceptsRef(uid).child(conceptId);
        const snapshot = await ref.once("value");
        const concept = snapshot.val();

        if (!concept) return { content: [{ type: "text", text: `Concept not found: ${conceptId}` }], isError: true };
        if (concept.status !== "active") {
          return { content: [{ type: "text", text: `Cannot transition non-active concept (status: ${concept.status})` }], isError: true };
        }
        if (!isValidTransition(concept.type, newType)) {
          return {
            content: [{ type: "text", text: `Invalid transition: ${concept.type} → ${newType}. Allowed: ${ODRC_TRANSITIONS[concept.type].join(", ")}` }],
            isError: true,
          };
        }

        const now = new Date().toISOString();
        const newRef = getConceptsRef(uid).push();
        const newConcept = {
          id: newRef.key,
          type: newType,
          content: concept.content,
          ideaOrigin: concept.ideaOrigin,
          status: "active",
          resolvedBy: null,
          transitionedFrom: conceptId,
          scopeTags: concept.scopeTags || [],
          createdAt: now,
          updatedAt: now,
        };

        // Flag related concepts if CONSTRAINT transitions
        let flaggedConcepts: any[] = [];
        if (concept.type === "CONSTRAINT" && concept.scopeTags?.length > 0) {
          const allSnap = await getConceptsRef(uid).once("value");
          const allData = allSnap.val() || {};
          const allConcepts: any[] = Object.values(allData);
          flaggedConcepts = allConcepts.filter(
            (c) =>
              c.id !== conceptId &&
              c.status === "active" &&
              (c.type === "DECISION" || c.type === "RULE") &&
              (c.scopeTags || []).some((tag: string) => concept.scopeTags.includes(tag))
          );
        }

        // Atomic multi-path update
        const fbUpdates: Record<string, any> = {};
        fbUpdates[`${conceptId}/status`] = "transitioned";
        fbUpdates[`${conceptId}/resolvedBy`] = newRef.key;
        fbUpdates[`${conceptId}/updatedAt`] = now;
        fbUpdates[newRef.key!] = newConcept;
        await getConceptsRef(uid).update(fbUpdates);

        // Update session record if sessionId provided
        if (sessionId) {
          const sessionRef = getSessionRef(uid, sessionId);
          const sessionSnap = await sessionRef.once("value");
          const session = sessionSnap.val();
          if (session) {
            const modified = session.conceptsModified || [];
            modified.push(conceptId);
            const created = session.conceptsCreated || [];
            created.push(newRef.key!);
            const events = session.events || [];
            events.push({
              timestamp: now,
              type: "concept_transitioned",
              detail: `Transitioned ${concept.type} → ${newType}: ${concept.content.substring(0, 80)}${concept.content.length > 80 ? "..." : ""}`,
              refId: newRef.key,
            });
            const conceptCount = session.metadata?.conceptCount || { OPEN: 0, DECISION: 0, RULE: 0, CONSTRAINT: 0 };
            conceptCount[newType] = (conceptCount[newType] || 0) + 1;
            await sessionRef.update({
              conceptsModified: modified,
              conceptsCreated: created,
              events,
              "metadata/toolCallCount": (session.metadata?.toolCallCount || 0) + 1,
              "metadata/conceptCount": conceptCount,
            });
          }
        }

        // Update job record if jobId provided
        if (jobId) {
          await updateJobRecord(uid, jobId, {
            type: "modified",
            conceptId,
            eventType: "concept_transitioned",
            detail: `Transitioned ${concept.type} → ${newType}: ${concept.content.substring(0, 80)}${concept.content.length > 80 ? "..." : ""}`,
          });
          await updateJobRecord(uid, jobId, {
            type: "created",
            conceptId: newRef.key!,
            eventType: "concept_created",
            detail: `Created ${newType} (from transition): ${concept.content.substring(0, 80)}${concept.content.length > 80 ? "..." : ""}`,
          });
        }

        const result: any = { newConcept };
        if (flaggedConcepts.length > 0) {
          result.flaggedForReview = flaggedConcepts;
          result.warning = `${flaggedConcepts.length} related DECISION/RULE concepts share scope tags with this CONSTRAINT and should be reviewed.`;
        }

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      // ─── SUPERSEDE ───
      if (action === "supersede") {
        if (!conceptId) return { content: [{ type: "text", text: "action 'supersede' requires conceptId" }], isError: true };
        if (!newContent) return { content: [{ type: "text", text: "action 'supersede' requires newContent" }], isError: true };

        const ref = getConceptsRef(uid).child(conceptId);
        const snapshot = await ref.once("value");
        const concept = snapshot.val();

        if (!concept) return { content: [{ type: "text", text: `Concept not found: ${conceptId}` }], isError: true };

        const now = new Date().toISOString();
        const newRef = getConceptsRef(uid).push();
        const newConcept = {
          id: newRef.key,
          type: concept.type,
          content: newContent,
          ideaOrigin: concept.ideaOrigin,
          status: "active",
          resolvedBy: null,
          transitionedFrom: conceptId,
          scopeTags: concept.scopeTags || [],
          createdAt: now,
          updatedAt: now,
        };

        const fbUpdates: Record<string, any> = {};
        fbUpdates[`${conceptId}/status`] = "superseded";
        fbUpdates[`${conceptId}/resolvedBy`] = newRef.key;
        fbUpdates[`${conceptId}/updatedAt`] = now;
        fbUpdates[newRef.key!] = newConcept;
        await getConceptsRef(uid).update(fbUpdates);

        // Update session record if sessionId provided
        if (sessionId) {
          const sessionRef = getSessionRef(uid, sessionId);
          const sessionSnap = await sessionRef.once("value");
          const session = sessionSnap.val();
          if (session) {
            const modified = session.conceptsModified || [];
            modified.push(conceptId);
            const created = session.conceptsCreated || [];
            created.push(newRef.key!);
            const events = session.events || [];
            events.push({
              timestamp: now,
              type: "concept_transitioned",
              detail: `Superseded ${concept.type}: ${newContent.substring(0, 80)}${newContent.length > 80 ? "..." : ""}`,
              refId: newRef.key,
            });
            await sessionRef.update({
              conceptsModified: modified,
              conceptsCreated: created,
              events,
              "metadata/toolCallCount": (session.metadata?.toolCallCount || 0) + 1,
            });
          }
        }

        // Update job record if jobId provided
        if (jobId) {
          await updateJobRecord(uid, jobId, {
            type: "modified",
            conceptId,
            eventType: "concept_transitioned",
            detail: `Superseded ${concept.type}: ${newContent.substring(0, 80)}${newContent.length > 80 ? "..." : ""}`,
          });
          await updateJobRecord(uid, jobId, {
            type: "created",
            conceptId: newRef.key!,
            eventType: "concept_created",
            detail: `Created ${concept.type} (superseded): ${newContent.substring(0, 80)}${newContent.length > 80 ? "..." : ""}`,
          });
        }

        return { content: [{ type: "text", text: JSON.stringify(newConcept, null, 2) }] };
      }

      // ─── RESOLVE ───
      if (action === "resolve") {
        if (!conceptId) return { content: [{ type: "text", text: "action 'resolve' requires conceptId" }], isError: true };

        const ref = getConceptsRef(uid).child(conceptId);
        const snapshot = await ref.once("value");
        const concept = snapshot.val();

        if (!concept) return { content: [{ type: "text", text: `Concept not found: ${conceptId}` }], isError: true };

        const now = new Date().toISOString();
        await ref.update({ status: "resolved", updatedAt: now });

        // Update session record if sessionId provided
        if (sessionId) {
          const sessionRef = getSessionRef(uid, sessionId);
          const sessionSnap = await sessionRef.once("value");
          const session = sessionSnap.val();
          if (session) {
            const modified = session.conceptsModified || [];
            modified.push(conceptId);
            const events = session.events || [];
            events.push({
              timestamp: now,
              type: "concept_transitioned",
              detail: `Resolved ${concept.type}: ${concept.content.substring(0, 80)}${concept.content.length > 80 ? "..." : ""}`,
              refId: conceptId,
            });
            await sessionRef.update({
              conceptsModified: modified,
              events,
              "metadata/toolCallCount": (session.metadata?.toolCallCount || 0) + 1,
            });
          }
        }

        // Update job record if jobId provided
        if (jobId) {
          await updateJobRecord(uid, jobId, {
            type: "modified",
            conceptId,
            eventType: "concept_transitioned",
            detail: `Resolved ${concept.type}: ${concept.content.substring(0, 80)}${concept.content.length > 80 ? "..." : ""}`,
          });
        }

        return { content: [{ type: "text", text: JSON.stringify({ ...concept, status: "resolved", updatedAt: now }, null, 2) }] };
      }

      // ─── MARK_BUILT ───
      if (action === "mark_built") {
        if (!conceptId) return { content: [{ type: "text", text: "action 'mark_built' requires conceptId" }], isError: true };

        const ref = getConceptsRef(uid).child(conceptId);
        const snapshot = await ref.once("value");
        const concept = snapshot.val();

        if (!concept) return { content: [{ type: "text", text: `Concept not found: ${conceptId}` }], isError: true };
        if (concept.status !== "active") {
          return { content: [{ type: "text", text: `Cannot mark non-active concept as built (status: ${concept.status})` }], isError: true };
        }
        if (concept.type !== "DECISION") {
          return { content: [{ type: "text", text: `Only DECISIONs can be marked as built (type: ${concept.type}). RULEs/CONSTRAINTs are ongoing governance, OPENs get resolved.` }], isError: true };
        }

        const now = new Date().toISOString();
        await ref.update({ status: "built", updatedAt: now });

        return { content: [{ type: "text", text: JSON.stringify({ ...concept, status: "built", updatedAt: now }, null, 2) }] };
      }

      // ─── MIGRATE ───
      if (action === "migrate") {
        if (!conceptId) return { content: [{ type: "text", text: "action 'migrate' requires conceptId" }], isError: true };
        if (!newIdeaId) return { content: [{ type: "text", text: "action 'migrate' requires newIdeaId" }], isError: true };

        const ref = getConceptsRef(uid).child(conceptId);
        const snapshot = await ref.once("value");
        const concept = snapshot.val();

        if (!concept) return { content: [{ type: "text", text: `Concept not found: ${conceptId}` }], isError: true };
        if (concept.status !== "active") {
          return { content: [{ type: "text", text: `Cannot migrate non-active concept (status: ${concept.status})` }], isError: true };
        }

        const now = new Date().toISOString();
        const oldIdeaOrigin = concept.ideaOrigin;
        await ref.update({ ideaOrigin: newIdeaId, updatedAt: now });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ...concept,
              ideaOrigin: newIdeaId,
              updatedAt: now,
              migratedFrom: oldIdeaOrigin,
            }, null, 2),
          }],
        };
      }

      // ─── DELETE ───
      if (action === "delete") {
        if (!conceptId) return { content: [{ type: "text", text: "action 'delete' requires conceptId" }], isError: true };

        const ref = getConceptRef(uid, conceptId);
        const snapshot = await ref.once("value");
        if (!snapshot.val()) return { content: [{ type: "text", text: `Concept not found: ${conceptId}` }], isError: true };

        await ref.remove();
        return { content: [{ type: "text", text: JSON.stringify({ deleted: conceptId }) }] };
      }

      return { content: [{ type: "text", text: `Unknown action: ${action}` }], isError: true };
    }
  );

  // get_active_concepts — kept standalone (computed aggregate, different return shape)
  server.tool(
    "get_active_concepts",
    `Get all active ODRC concepts across all ideas for an app. This is the 'current truth' view — all active RULEs, CONSTRAINTs, DECISIONs, and unresolved OPENs.
By default returns summary fields (content truncated to 150 chars, timestamps stripped). Set summary=false for full objects.`,
    {
      appId: z.string().describe("The app ID to get active concepts for"),
      summary: z.boolean().optional().describe("If true (default), return lean summary with truncated content. Set false for full objects."),
    },
    async ({ appId, summary }) => {
      const useSummary = summary !== false; // default true
      const uid = getCurrentUid();
      const appIdeasSnap = await getAppIdeasRef(uid, appId).once("value");
      const ideaIds: string[] = appIdeasSnap.val() || [];

      if (ideaIds.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ rules: [], constraints: [], decisions: [], opens: [], totalCount: 0 }, null, 2) }] };
      }

      const allSnap = await getConceptsRef(uid).once("value");
      const allData = allSnap.val() || {};
      const allConcepts: any[] = Object.values(allData);

      const active = allConcepts.filter((c) => ideaIds.includes(c.ideaOrigin) && c.status === "active");

      const project = useSummary
        ? (c: any) => ({
            id: c.id,
            type: c.type,
            content: c.content?.length > 150 ? c.content.substring(0, 150) + "..." : c.content,
            status: c.status,
            scopeTags: c.scopeTags || [],
            ideaOrigin: c.ideaOrigin,
          })
        : (c: any) => c;

      const grouped = {
        rules: active.filter((c) => c.type === "RULE").map(project),
        constraints: active.filter((c) => c.type === "CONSTRAINT").map(project),
        decisions: active.filter((c) => c.type === "DECISION").map(project),
        opens: active.filter((c) => c.type === "OPEN").map(project),
        totalCount: active.length,
      };

      return { content: [{ type: "text", text: JSON.stringify(grouped, null, 2) }] };
    }
  );
}
