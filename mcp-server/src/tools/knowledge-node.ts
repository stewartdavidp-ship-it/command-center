import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getTreeRef, getTreeIndexRef, getNodeContentRef, getNodesRef, getTreesRef, increment } from "../firebase.js";
import { coerceArrayParam } from "../knowledge-search.js";
import { getCurrentUid } from "../context.js";
import { withResponseSize } from "../response-metadata.js";
import { INITIATOR_PARAM, resolveInitiator } from "../surfaces.js";

const TRUST_LEVELS = ["authoritative", "credible", "unverified", "questionable"] as const;

/**
 * Record that a node's full content was actually loaded.
 *
 * A load is the only evidence a node was USED. Everything else the corpus tracks is
 * evidence it was written. Without this, a node nobody has opened in six months is
 * indistinguishable from the one that saves an hour a week, and there is no way to tell
 * whether the corpus is an asset or a habit.
 *
 * Deliberately distinct from `surfaced` (incremented by search): surfaced-but-never-read
 * measures retrieval precision, reads measure value delivered.
 *
 * Fire-and-forget, one multi-path write. A metric must never fail a read.
 */
function recordReads(uid: string, nodes: any[]): void {
  const now = new Date().toISOString();
  const updates: Record<string, any> = {};
  for (const n of nodes) {
    // treeId lives on the content record; without it the index entry is unreachable.
    if (!n?.treeId || !n?.id) continue;
    updates[`${n.treeId}/index/${n.id}/reads`] = increment(1);
    updates[`${n.treeId}/index/${n.id}/lastRead`] = now;
  }
  if (Object.keys(updates).length > 0) {
    getTreesRef(uid).update(updates).catch(() => {});
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export function registerKnowledgeNodeTools(server: McpServer): void {

  server.tool(
    "knowledge_node",
    `WRITE AND READ RESEARCH FINDINGS. Companion to knowledge_tree — load this whenever you load research or web-search tools. Use it to RECORD what you learned (a measured platform behaviour, an investigation result, a competitive finding) so the next session anywhere finds it instead of re-deriving it, and to LOAD the full content behind a knowledge_tree search hit.

  knowledge_node{action:"create", treeId, question:"<the question a future session would type>", content:"<what you found>"}

Only treeId, question and content are required; trust defaults to unverified and keyFinding auto-generates. A three-field write beats no write.

Knowledge node content CRUD with selective loading. Nodes contain the actual knowledge — curated findings, sources, and cross-references. Each node has an index entry (cheap, always loaded with tree) and a content record (expensive, loaded on demand).

Actions:
  - "create": Create a node in a tree. Requires treeId, question, content. Optional: trust, parentId, keyFinding, sources, consensusNotes, crossRefs. sources/crossRefs accept a REAL ARRAY (preferred) or a JSON array string. Auto-computes tokenCount. Creates index entry + content record atomically. Updates tree aggregates.
  - "update": Update a node. Requires nodeId. Optional: question, content, trust, keyFinding, parentId, sources, consensusNotes, crossRefs, lastVerified. Recomputes token cost if content changes. Updates tree aggregates if trust/content changes.
  - "delete": Delete a node. Requires nodeId. Removes index entry + content record. Updates tree aggregates and parent childIds.
  - "load": Load a single node's full content. Requires nodeId. Returns content, sources, crossRefs, tokenCount.
  - "load_batch": Load multiple nodes in parallel. Requires nodeIds (array, max 10). Returns map of nodeId → content record.
  - "move": Reparent a node. Requires nodeId, newParentId (use "root" to make a root node). Updates hierarchy.
  - "add_cross_ref": Add a cross-reference between two nodes with reciprocal creation. Requires nodeId, targetNodeId, relationship. If relationship is "contradicts", also updates contradictedBy index on both nodes. Max 50 crossRefs per node.
  - "remove_cross_ref": Remove a cross-reference between two nodes with reciprocal removal. Requires nodeId, targetNodeId. Cleans up contradictedBy index if applicable.
  - "bulk_verify": Mark multiple nodes as verified (refreshes lastVerified). Requires treeId, nodeIds (max 20). Atomic multi-path update.`,
    {
      ...INITIATOR_PARAM,
      action: z.enum(["create", "update", "delete", "load", "load_batch", "move", "add_cross_ref", "remove_cross_ref", "bulk_verify"]).describe("Action to perform"),
      treeId: z.string().optional().describe("Tree ID (required for create)"),
      nodeId: z.string().optional().describe("Node ID (required for update/delete/load/move)"),
      nodeIds: z.array(z.string()).optional().describe("Node IDs for load_batch (max 10)"),
      question: z.string().optional().describe("Routing question the node answers (required for create, optional for update)"),
      content: z.string().optional().describe("Full curated findings in markdown (required for create, optional for update)"),
      keyFinding: z.string().optional().describe("One-line key finding summary (auto-generated from content if not provided on create)"),
      trust: z.enum(TRUST_LEVELS).optional().describe("Trust rating (default: unverified)"),
      parentId: z.string().optional().describe("Parent node ID for hierarchy (optional for create, update)"),
      newParentId: z.string().optional().describe("New parent node ID for move (use 'root' to make a root node)"),
      sources: z.union([z.string(), z.array(z.any())]).optional().describe("JSON array of source objects: [{url, document, section, credibility, credibilityRationale, discoveryQuery?}]. discoveryQuery records the search query that surfaced this source."),
      consensusNotes: z.string().optional().describe("Agreement/divergence notes across sources"),
      crossRefs: z.union([z.string(), z.array(z.any())]).optional().describe("JSON array of cross-references: [{nodeId, treeId, relationship}]"),
      lastVerified: z.string().optional().describe("ISO date when node was last verified (optional for update)"),
      tags: z.array(z.string()).optional().describe("SECONDARY booster, NOT the index. Retrieval scores primarily against `question` and `keyFinding` — so write THOSE in the words a future session would actually type ('Resend returned 200 but the email never arrived' beats 'Resend delivery semantics'). Tags help only when someone guesses the same tag you chose. Measured 2026-08-28: rewriting a node's question into searcher vocabulary moved it from 0.77 (missed, wrong node ranked first) to 3.05 (top hit) with no change to the scorer."),
      targetNodeId: z.string().optional().describe("Target node ID for add_cross_ref/remove_cross_ref"),
      relationship: z.string().optional().describe("Cross-ref relationship type (e.g., 'supports', 'contradicts', 'extends', 'qualifies'). Required for add_cross_ref."),
    },
    async ({ initiator, action, treeId, nodeId, nodeIds, question, content, keyFinding, trust, parentId, newParentId, sources, consensusNotes, crossRefs, lastVerified, tags, targetNodeId, relationship }) => {
      resolveInitiator({ initiator });
      const uid = getCurrentUid();

      // Parse JSON string params
      // Both accept a real array OR a JSON-encoded string. They were string-only while
      // `tags` and `nodeIds` on the same call were real arrays — two conventions in one
      // tool, which callers reliably get wrong. See coerceArrayParam for the evidence.
      const srcCoerced = coerceArrayParam(sources, "sources");
      if (!srcCoerced.ok) {
        return withResponseSize({ content: [{ type: "text", text: srcCoerced.error }], isError: true });
      }
      const xrefCoerced = coerceArrayParam(crossRefs, "crossRefs");
      if (!xrefCoerced.ok) {
        return withResponseSize({ content: [{ type: "text", text: xrefCoerced.error }], isError: true });
      }
      const parsedSources: any[] | undefined = srcCoerced.value;
      const parsedCrossRefs: any[] | undefined = xrefCoerced.value;

      // ─── CREATE ───
      if (action === "create") {
        if (!treeId) return withResponseSize({ content: [{ type: "text", text: "create requires treeId" }], isError: true });
        if (!question) return withResponseSize({ content: [{ type: "text", text: "create requires question" }], isError: true });
        if (!content) return withResponseSize({ content: [{ type: "text", text: "create requires content" }], isError: true });

        // Verify tree exists
        const treeSnap = await getTreeRef(uid, treeId).once("value");
        const tree = treeSnap.val();
        if (!tree) return withResponseSize({ content: [{ type: "text", text: `Tree not found: ${treeId}` }], isError: true });

        const tokenCount = estimateTokens(content);
        const effectiveTrust = trust || "unverified";
        const now = new Date().toISOString();
        const autoKeyFinding = keyFinding || content.substring(0, 120) + (content.length > 120 ? "..." : "");

        // Generate node ID via push
        const nodeRef = getNodesRef(uid).push();
        const nId = nodeRef.key!;

        // Build index entry
        const indexEntry: Record<string, any> = {
          id: nId,
          question,
          keyFinding: autoKeyFinding,
          tokenCost: tokenCount,
          trust: effectiveTrust,
          lastVerified: now,
          parentId: parentId || null,
          childIds: [],
          tags: tags || [],
          order: 0,
          createdAt: now,
          updatedAt: now,
        };

        // Build content record
        const contentRecord: Record<string, any> = {
          id: nId,
          treeId,
          content,
          sources: parsedSources || [],
          consensusNotes: consensusNotes || null,
          crossRefs: parsedCrossRefs || [],
          tokenCount,
          createdAt: now,
          updatedAt: now,
        };

        // Aggregates move by atomic DELTA, never read-modify-write.
        //
        // These used to be computed as `(tree.nodeCount || 0) + 1` from a snapshot read
        // above. Creating several nodes in one tree concurrently means every call reads the
        // same starting value and writes read+1, so N parallel creates advance the counter
        // by 1. That is exactly what happened to the three Mast Social trees on 2026-05-23
        // (6 real nodes each, counters stuck at 3/2/3) and it drifts permanently, because
        // nothing recomputes. Run action:"repair" on knowledge_tree to reconcile.
        //
        // Estimated locally only for the budget warning below; the WRITE is the delta.
        const newTokenUsed = (tree.tokenUsed || 0) + tokenCount;

        // Multi-path atomic update: index entry + content record + tree aggregates
        // Index is under trees/{treeId}/index/{nodeId}
        // Content is under nodes/{nodeId}
        // We need two separate updates since they're in different top-level paths
        const treeUpdates: Record<string, any> = {
          [`index/${nId}`]: indexEntry,
          tokenUsed: increment(tokenCount),
          nodeCount: increment(1),
          [`trustProfile/${effectiveTrust}`]: increment(1),
          updatedAt: now,
        };

        // Update lastVerified on tree if this is newer
        if (!tree.lastVerified || now > tree.lastVerified) {
          treeUpdates.lastVerified = now;
        }

        // Update parent's childIds if parentId specified
        if (parentId) {
          const parentIndexSnap = await getTreeIndexRef(uid, treeId).child(parentId).once("value");
          const parentIndex = parentIndexSnap.val();
          if (parentIndex) {
            const childIds: string[] = parentIndex.childIds || [];
            if (!childIds.includes(nId)) {
              childIds.push(nId);
              treeUpdates[`index/${parentId}/childIds`] = childIds;
            }
          }
          // Compute order as last among siblings
          indexEntry.order = parentIndex ? (parentIndex.childIds || []).length : 0;
        }

        await Promise.all([
          getTreeRef(uid, treeId).update(treeUpdates),
          getNodeContentRef(uid, nId).set(contentRecord),
        ]);

        // Build response
        const result: any = { indexEntry, contentRecord };
        const budgetRemaining = (tree.tokenBudget || 150000) - newTokenUsed;
        if (budgetRemaining < 0) {
          result.warning = `Tree token budget exceeded! Used: ${newTokenUsed}, Budget: ${tree.tokenBudget || 150000}. Consider splitting the tree.`;
        }

        return withResponseSize(
          { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
          { _nodeTokenCost: tokenCount, _treeBudgetRemaining: budgetRemaining }
        );
      }

      // ─── UPDATE ───
      if (action === "update") {
        if (!nodeId) return withResponseSize({ content: [{ type: "text", text: "update requires nodeId" }], isError: true });

        // Load existing content record to find treeId
        const contentSnap = await getNodeContentRef(uid, nodeId).once("value");
        const existing = contentSnap.val();
        if (!existing) return withResponseSize({ content: [{ type: "text", text: `Node not found: ${nodeId}` }], isError: true });

        const nodeTreeId = existing.treeId;
        const now = new Date().toISOString();

        // Load current index entry
        const indexSnap = await getTreeIndexRef(uid, nodeTreeId).child(nodeId).once("value");
        const currentIndex = indexSnap.val();
        if (!currentIndex) return withResponseSize({ content: [{ type: "text", text: `Index entry not found for node: ${nodeId}` }], isError: true });

        // Build content updates
        const contentUpdates: Record<string, any> = { updatedAt: now };
        if (content !== undefined) {
          contentUpdates.content = content;
          contentUpdates.tokenCount = estimateTokens(content);
        }
        if (parsedSources !== undefined) contentUpdates.sources = parsedSources;
        if (consensusNotes !== undefined) contentUpdates.consensusNotes = consensusNotes;
        if (parsedCrossRefs !== undefined) contentUpdates.crossRefs = parsedCrossRefs;

        // Build index updates
        const indexUpdates: Record<string, any> = { updatedAt: now };
        if (question !== undefined) indexUpdates.question = question;
        if (keyFinding !== undefined) indexUpdates.keyFinding = keyFinding;
        if (lastVerified !== undefined) indexUpdates.lastVerified = lastVerified;
        if (parentId !== undefined) indexUpdates.parentId = parentId;
        if (tags !== undefined) indexUpdates.tags = tags;

        // Tree aggregate updates
        const treeUpdates: Record<string, any> = { updatedAt: now };
        let needTreeUpdate = false;

        // Handle token cost change
        if (content !== undefined) {
          const oldTokenCost = currentIndex.tokenCost || 0;
          const newTokenCost = contentUpdates.tokenCount;
          indexUpdates.tokenCost = newTokenCost;

          // Atomic delta — no snapshot read needed, and no race with a concurrent write.
          treeUpdates.tokenUsed = increment(newTokenCost - oldTokenCost);
          needTreeUpdate = true;
        }

        // Handle trust change
        if (trust !== undefined && trust !== currentIndex.trust) {
          indexUpdates.trust = trust;
          // Move one count between two buckets atomically. The previous version read the
          // whole trustProfile and wrote it back, which both raced with concurrent writes
          // and clobbered the other buckets with a stale snapshot.
          const oldTrust = currentIndex.trust || "unverified";
          treeUpdates[`trustProfile/${oldTrust}`] = increment(-1);
          treeUpdates[`trustProfile/${trust}`] = increment(1);
          needTreeUpdate = true;
        }

        // Apply updates
        const promises: Promise<void>[] = [
          getNodeContentRef(uid, nodeId).update(contentUpdates),
          getTreeIndexRef(uid, nodeTreeId).child(nodeId).update(indexUpdates),
        ];
        if (needTreeUpdate) {
          promises.push(getTreeRef(uid, nodeTreeId).update(treeUpdates));
        }
        await Promise.all(promises);

        return withResponseSize({
          content: [{ type: "text", text: JSON.stringify({ updated: nodeId, contentUpdates, indexUpdates, treeUpdated: needTreeUpdate }, null, 2) }],
        });
      }

      // ─── DELETE ───
      if (action === "delete") {
        if (!nodeId) return withResponseSize({ content: [{ type: "text", text: "delete requires nodeId" }], isError: true });

        // Load content record to find treeId
        const contentSnap = await getNodeContentRef(uid, nodeId).once("value");
        const existing = contentSnap.val();
        if (!existing) return withResponseSize({ content: [{ type: "text", text: `Node not found: ${nodeId}` }], isError: true });

        const nodeTreeId = existing.treeId;
        const now = new Date().toISOString();

        // Load index entry for aggregate adjustments
        const indexSnap = await getTreeIndexRef(uid, nodeTreeId).child(nodeId).once("value");
        const indexEntry = indexSnap.val();

        // Load tree for aggregate updates
        const treeSnap = await getTreeRef(uid, nodeTreeId).once("value");
        const tree = treeSnap.val();

        const treeUpdates: Record<string, any> = { updatedAt: now };

        if (tree && indexEntry) {
          // Atomic deltas. This drops the Math.max(0, …) floor, which was masking rather
          // than preventing drift — a counter that would have gone negative was already
          // wrong, and silently clamping it hid that. action:"repair" on knowledge_tree
          // recomputes every aggregate from the real index entries.
          treeUpdates.nodeCount = increment(-1);
          treeUpdates.tokenUsed = increment(-(indexEntry.tokenCost || 0));
          treeUpdates[`trustProfile/${indexEntry.trust || "unverified"}`] = increment(-1);
        }

        // Remove from parent's childIds
        if (indexEntry?.parentId) {
          const parentSnap = await getTreeIndexRef(uid, nodeTreeId).child(indexEntry.parentId).once("value");
          const parentIndex = parentSnap.val();
          if (parentIndex) {
            const childIds: string[] = (parentIndex.childIds || []).filter((id: string) => id !== nodeId);
            treeUpdates[`index/${indexEntry.parentId}/childIds`] = childIds;
          }
        }

        // Delete index entry by setting to null in tree update
        treeUpdates[`index/${nodeId}`] = null;

        // Atomic: update tree (removes index entry + adjusts aggregates) + delete content
        await Promise.all([
          getTreeRef(uid, nodeTreeId).update(treeUpdates),
          getNodeContentRef(uid, nodeId).remove(),
        ]);

        return withResponseSize({
          content: [{ type: "text", text: JSON.stringify({ deleted: nodeId, treeId: nodeTreeId }, null, 2) }],
        });
      }

      // ─── LOAD ───
      if (action === "load") {
        if (!nodeId) return withResponseSize({ content: [{ type: "text", text: "load requires nodeId" }], isError: true });

        const snap = await getNodeContentRef(uid, nodeId).once("value");
        const node = snap.val();
        if (!node) return withResponseSize({ content: [{ type: "text", text: `Node not found: ${nodeId}` }], isError: true });

        recordReads(uid, [node]);

        return withResponseSize(
          { content: [{ type: "text", text: JSON.stringify(node, null, 2) }] },
          { _nodeTokenCost: node.tokenCount || 0 }
        );
      }

      // ─── LOAD_BATCH ───
      if (action === "load_batch") {
        if (!nodeIds || nodeIds.length === 0) return withResponseSize({ content: [{ type: "text", text: "load_batch requires nodeIds (non-empty array)" }], isError: true });
        if (nodeIds.length > 10) return withResponseSize({ content: [{ type: "text", text: `load_batch capped at 10 nodes. Requested: ${nodeIds.length}. Split into multiple calls.` }], isError: true });

        // Parallel load
        const snaps = await Promise.all(
          nodeIds.map((nId) => getNodeContentRef(uid, nId).once("value"))
        );

        const results: Record<string, any> = {};
        let totalTokenCost = 0;
        let found = 0;
        for (let i = 0; i < nodeIds.length; i++) {
          const val = snaps[i].val();
          if (val) {
            results[nodeIds[i]] = val;
            totalTokenCost += val.tokenCount || 0;
            found++;
          } else {
            results[nodeIds[i]] = null;
          }
        }

        recordReads(uid, Object.values(results).filter(Boolean));

        return withResponseSize(
          { content: [{ type: "text", text: JSON.stringify({ nodes: results, found, requested: nodeIds.length }, null, 2) }] },
          { _totalNodeTokenCost: totalTokenCost }
        );
      }

      // ─── MOVE ───
      if (action === "move") {
        if (!nodeId) return withResponseSize({ content: [{ type: "text", text: "move requires nodeId" }], isError: true });

        // Load content record to get treeId
        const contentSnap = await getNodeContentRef(uid, nodeId).once("value");
        const existing = contentSnap.val();
        if (!existing) return withResponseSize({ content: [{ type: "text", text: `Node not found: ${nodeId}` }], isError: true });

        const nodeTreeId = existing.treeId;
        const now = new Date().toISOString();

        // Load current index entry
        const indexSnap = await getTreeIndexRef(uid, nodeTreeId).child(nodeId).once("value");
        const currentIndex = indexSnap.val();
        if (!currentIndex) return withResponseSize({ content: [{ type: "text", text: `Index entry not found: ${nodeId}` }], isError: true });

        const oldParentId = currentIndex.parentId || null;
        // "root" sentinel means make a root node (no parent)
        const effectiveNewParentId = newParentId === undefined ? oldParentId : (newParentId === "root" ? null : newParentId);

        if (oldParentId === effectiveNewParentId) {
          return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ moved: nodeId, parentId: effectiveNewParentId, note: "No change — same parent" }, null, 2) }] });
        }

        const treeUpdates: Record<string, any> = {
          [`index/${nodeId}/parentId`]: effectiveNewParentId,
          [`index/${nodeId}/updatedAt`]: now,
          updatedAt: now,
        };

        // Remove from old parent's childIds
        if (oldParentId) {
          const oldParentSnap = await getTreeIndexRef(uid, nodeTreeId).child(oldParentId).once("value");
          const oldParent = oldParentSnap.val();
          if (oldParent) {
            treeUpdates[`index/${oldParentId}/childIds`] = (oldParent.childIds || []).filter((id: string) => id !== nodeId);
          }
        }

        // Add to new parent's childIds
        if (effectiveNewParentId) {
          const newParentSnap = await getTreeIndexRef(uid, nodeTreeId).child(effectiveNewParentId).once("value");
          const newParent = newParentSnap.val();
          if (newParent) {
            const childIds: string[] = newParent.childIds || [];
            if (!childIds.includes(nodeId)) {
              childIds.push(nodeId);
              treeUpdates[`index/${effectiveNewParentId}/childIds`] = childIds;
            }
          }
        }

        await getTreeRef(uid, nodeTreeId).update(treeUpdates);

        return withResponseSize({
          content: [{ type: "text", text: JSON.stringify({ moved: nodeId, oldParentId, newParentId: effectiveNewParentId }, null, 2) }],
        });
      }

      // ─── ADD_CROSS_REF ───
      if (action === "add_cross_ref") {
        if (!nodeId) return withResponseSize({ content: [{ type: "text", text: "add_cross_ref requires nodeId" }], isError: true });
        if (!targetNodeId) return withResponseSize({ content: [{ type: "text", text: "add_cross_ref requires targetNodeId" }], isError: true });
        if (!relationship) return withResponseSize({ content: [{ type: "text", text: "add_cross_ref requires relationship" }], isError: true });
        if (nodeId === targetNodeId) return withResponseSize({ content: [{ type: "text", text: "Cannot cross-reference a node to itself" }], isError: true });

        // Load both nodes' content records in parallel
        const [sourceSnap, targetSnap] = await Promise.all([
          getNodeContentRef(uid, nodeId).once("value"),
          getNodeContentRef(uid, targetNodeId).once("value"),
        ]);
        const sourceNode = sourceSnap.val();
        const targetNode = targetSnap.val();
        if (!sourceNode) return withResponseSize({ content: [{ type: "text", text: `Source node not found: ${nodeId}` }], isError: true });
        if (!targetNode) return withResponseSize({ content: [{ type: "text", text: `Target node not found: ${targetNodeId}` }], isError: true });

        // Check cap
        const sourceCrossRefs: any[] = sourceNode.crossRefs || [];
        if (sourceCrossRefs.length >= 50) {
          return withResponseSize({ content: [{ type: "text", text: `Cross-ref cap (50) reached on source node ${nodeId}. Remove existing refs first.` }], isError: true });
        }
        const targetCrossRefs: any[] = targetNode.crossRefs || [];
        if (targetCrossRefs.length >= 50) {
          return withResponseSize({ content: [{ type: "text", text: `Cross-ref cap (50) reached on target node ${targetNodeId}. Remove existing refs first.` }], isError: true });
        }

        // Check for duplicate
        if (sourceCrossRefs.some((r: any) => r.nodeId === targetNodeId)) {
          return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ warning: "Cross-ref already exists", nodeId, targetNodeId }, null, 2) }] });
        }

        const now = new Date().toISOString();

        // Build reciprocal cross-ref entries
        const sourceRef = { nodeId: targetNodeId, treeId: targetNode.treeId, relationship, addedAt: now };
        const targetRef = { nodeId, treeId: sourceNode.treeId, relationship, addedAt: now };

        sourceCrossRefs.push(sourceRef);
        targetCrossRefs.push(targetRef);

        // Build updates for content records
        const sourceUpdates: Record<string, any> = { crossRefs: sourceCrossRefs, updatedAt: now };
        const targetUpdates: Record<string, any> = { crossRefs: targetCrossRefs, updatedAt: now };

        // Contradiction index denormalization — update contradictedBy on both index entries
        const indexPromises: Promise<void>[] = [];
        if (relationship === "contradicts") {
          // Update source node's index: add targetNodeId to contradictedBy
          const sourceIndexSnap = await getTreeIndexRef(uid, sourceNode.treeId).child(nodeId).once("value");
          const sourceIndex = sourceIndexSnap.val();
          if (sourceIndex) {
            const contradictedBy: string[] = sourceIndex.contradictedBy || [];
            if (!contradictedBy.includes(targetNodeId)) {
              contradictedBy.push(targetNodeId);
              indexPromises.push(getTreeIndexRef(uid, sourceNode.treeId).child(nodeId).update({ contradictedBy, updatedAt: now }));
            }
          }

          // Update target node's index: add nodeId to contradictedBy
          const targetIndexSnap = await getTreeIndexRef(uid, targetNode.treeId).child(targetNodeId).once("value");
          const targetIndex = targetIndexSnap.val();
          if (targetIndex) {
            const contradictedBy: string[] = targetIndex.contradictedBy || [];
            if (!contradictedBy.includes(nodeId)) {
              contradictedBy.push(nodeId);
              indexPromises.push(getTreeIndexRef(uid, targetNode.treeId).child(targetNodeId).update({ contradictedBy, updatedAt: now }));
            }
          }
        }

        await Promise.all([
          getNodeContentRef(uid, nodeId).update(sourceUpdates),
          getNodeContentRef(uid, targetNodeId).update(targetUpdates),
          ...indexPromises,
        ]);

        return withResponseSize({
          content: [{ type: "text", text: JSON.stringify({ added: sourceRef, reciprocal: targetRef, isContradiction: relationship === "contradicts" }, null, 2) }],
        });
      }

      // ─── REMOVE_CROSS_REF ───
      if (action === "remove_cross_ref") {
        if (!nodeId) return withResponseSize({ content: [{ type: "text", text: "remove_cross_ref requires nodeId" }], isError: true });
        if (!targetNodeId) return withResponseSize({ content: [{ type: "text", text: "remove_cross_ref requires targetNodeId" }], isError: true });

        // Load both nodes' content records in parallel
        const [sourceSnap, targetSnap] = await Promise.all([
          getNodeContentRef(uid, nodeId).once("value"),
          getNodeContentRef(uid, targetNodeId).once("value"),
        ]);
        const sourceNode = sourceSnap.val();
        const targetNode = targetSnap.val();
        if (!sourceNode) return withResponseSize({ content: [{ type: "text", text: `Source node not found: ${nodeId}` }], isError: true });

        const now = new Date().toISOString();
        const sourceCrossRefs: any[] = sourceNode.crossRefs || [];
        const removedRef = sourceCrossRefs.find((r: any) => r.nodeId === targetNodeId);

        if (!removedRef) {
          return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ warning: "Cross-ref not found", nodeId, targetNodeId }, null, 2) }] });
        }

        const filteredSource = sourceCrossRefs.filter((r: any) => r.nodeId !== targetNodeId);
        const promises: Promise<void>[] = [
          getNodeContentRef(uid, nodeId).update({ crossRefs: filteredSource, updatedAt: now }),
        ];

        // Remove reciprocal from target
        if (targetNode) {
          const targetCrossRefs: any[] = targetNode.crossRefs || [];
          const filteredTarget = targetCrossRefs.filter((r: any) => r.nodeId !== nodeId);
          promises.push(getNodeContentRef(uid, targetNodeId).update({ crossRefs: filteredTarget, updatedAt: now }));
        }

        // Clean up contradictedBy index entries if it was a contradiction
        if (removedRef.relationship === "contradicts") {
          // Remove targetNodeId from source's contradictedBy
          const sourceIndexSnap = await getTreeIndexRef(uid, sourceNode.treeId).child(nodeId).once("value");
          const sourceIndex = sourceIndexSnap.val();
          if (sourceIndex?.contradictedBy) {
            const cleaned = (sourceIndex.contradictedBy as string[]).filter((id: string) => id !== targetNodeId);
            promises.push(getTreeIndexRef(uid, sourceNode.treeId).child(nodeId).update({ contradictedBy: cleaned, updatedAt: now }));
          }

          // Remove nodeId from target's contradictedBy
          if (targetNode) {
            const targetIndexSnap = await getTreeIndexRef(uid, targetNode.treeId).child(targetNodeId).once("value");
            const targetIndex = targetIndexSnap.val();
            if (targetIndex?.contradictedBy) {
              const cleaned = (targetIndex.contradictedBy as string[]).filter((id: string) => id !== nodeId);
              promises.push(getTreeIndexRef(uid, targetNode.treeId).child(targetNodeId).update({ contradictedBy: cleaned, updatedAt: now }));
            }
          }
        }

        await Promise.all(promises);

        return withResponseSize({
          content: [{ type: "text", text: JSON.stringify({ removed: { nodeId, targetNodeId }, wasContradiction: removedRef.relationship === "contradicts" }, null, 2) }],
        });
      }

      // ─── BULK_VERIFY ───
      if (action === "bulk_verify") {
        if (!treeId) return withResponseSize({ content: [{ type: "text", text: "bulk_verify requires treeId" }], isError: true });
        if (!nodeIds || nodeIds.length === 0) return withResponseSize({ content: [{ type: "text", text: "bulk_verify requires nodeIds (non-empty array)" }], isError: true });
        if (nodeIds.length > 20) return withResponseSize({ content: [{ type: "text", text: `bulk_verify capped at 20 nodes. Requested: ${nodeIds.length}. Split into multiple calls.` }], isError: true });

        // Verify tree exists
        const treeSnap = await getTreeRef(uid, treeId).once("value");
        const tree = treeSnap.val();
        if (!tree) return withResponseSize({ content: [{ type: "text", text: `Tree not found: ${treeId}` }], isError: true });

        const now = new Date().toISOString();

        // Multi-path atomic update: set lastVerified on each index entry
        const treeUpdates: Record<string, any> = { lastVerified: now, updatedAt: now };
        for (const nId of nodeIds) {
          treeUpdates[`index/${nId}/lastVerified`] = now;
          treeUpdates[`index/${nId}/updatedAt`] = now;
        }
        await getTreeRef(uid, treeId).update(treeUpdates);

        return withResponseSize({
          content: [{ type: "text", text: JSON.stringify({ verified: nodeIds.length, treeId, lastVerified: now }, null, 2) }],
        });
      }

      return withResponseSize({ content: [{ type: "text", text: `Unknown action: ${action}` }], isError: true });
    }
  );
}
