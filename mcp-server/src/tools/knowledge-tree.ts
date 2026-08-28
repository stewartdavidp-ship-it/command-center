import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getForestsRef, getForestRef, getTreesRef, getTreeRef, getTreeIndexRef, getNodesRef, getSearchMissesRef, getGlobalSummaryRef, increment } from "../firebase.js";
import { getCurrentUid } from "../context.js";
import { withResponseSize } from "../response-metadata.js";
import { INITIATOR_PARAM, resolveInitiator } from "../surfaces.js";
import { tokenize, scoreEntry, buildIdf, computeStaleness, summaryLine, SCORE_FLOOR, STRONG_MATCH_SCORE, GAP_ANSWERED_SCORE, coerceArrayParam } from "../knowledge-search.js";

/** Max scored matches returned by search. Truncation is always reported via totalMatched. */
const SEARCH_RESULT_LIMIT = 15;

/** Description chars kept in list_trees. Routing needs enough to choose, not the essay. */
const LIST_DESCRIPTION_CHARS = 160;

/** Max nodes rendered into a global routing table, to bound response size. */
const GLOBAL_SUMMARY_NODE_CAP = 400;

const TRUST_LEVELS = ["authoritative", "credible", "unverified", "questionable"] as const;

function emptyTrustProfile() {
  return { authoritative: 0, credible: 0, unverified: 0, questionable: 0 };
}

export function registerKnowledgeTreeTools(server: McpServer): void {

  server.tool(
    "knowledge_tree",
    `Knowledge tree and forest management tool. Forests group related trees by domain. Trees contain indexed knowledge nodes with selective loading.

Actions:
  - "list_forests": List all forests with lean summaries.
  - "get_forest": Get full forest record by ID. Requires forestId. Returns all metadata including treeIds, tags, summary, timestamps.
  - "create_forest": Create a forest. Requires name. Optional: description, tags.
  - "update_forest": Update forest. Requires forestId. Optional: name, description, tags, treeIds.
  - "delete_forest": Delete forest (does NOT delete member trees). Requires forestId.
  - "list_trees": List trees. Optional: forestId filter. Returns summaries with token budgets and trust profiles.
  - "get_tree": Get full tree record by ID. Requires treeId. Returns all metadata including searchHistory, trustProfile, timestamps. Does NOT include the index (use get_index for that).
  - "create_tree": Create a tree. Requires name. Optional: description, forestIds, tokenBudget (default 150000), freshnessPeriodDays (default 90).
  - "update_tree": Update tree metadata. Requires treeId. Optional: name, description, forestIds, tokenBudget, freshnessPeriodDays, gaps (JSON array of {question, priority, discoveredAt, status}).
  - "delete_tree": Delete tree + all index entries + all node content. Removes from parent forests. Requires treeId.
  - "get_index": Load a tree's routing-table index — all node index entries for selective content loading. Requires treeId.
  - "add_search": Record a search query and its results on a tree. Requires treeId, query. Optional: nodeIdsProduced (array of node IDs created from this search). Appends to searchHistory with auto-timestamp.
  - "search" (alias: "search_tags"): Search across ALL trees for nodes answering a question. Pass query (free text — the question in your own words) and/or tags (exact keyword tags). AT LEAST ONE is required; passing both is best. Scores against each node's question, keyFinding and tags, returns the top matches with staleness flags. Optional: forestId or treeId filter. Zero-result searches are logged automatically (see list_misses).
  - "stats": Corpus health — what fraction of nodes has ever been READ (asset vs habit), what search keeps surfacing that nobody opens (retrieval precision), and how many questions the corpus could not answer. No args.
  - "add_gap": Append ONE open gap to a tree. Requires treeId, query (the question). Optional name = priority (high/medium/low, default medium).
  - "resolve_gap": Mark ONE gap resolved. Requires treeId and query — a substring that matches exactly one OPEN gap. Writes only that element, so it cannot clobber a concurrent add_gap. Use this instead of update_tree{gaps}: re-serializing the whole array to close one gap is the reason gap lists rot.
  - "check_gaps": Review every OPEN gap and flag any the corpus may already answer — scores each gap's question against all nodes and returns candidate answers plus gap age. A stale gap is worse than a stale node: it sends the next session to redo finished work. Recommendation only; never resolves a gap. Optional treeId to scope.
  - "repair": Recompute every tree's nodeCount / tokenUsed / trustProfile from its actual index entries. Aggregates are maintained incrementally and drift permanently if any write path misses them. Dry run by default; pass confirm:true to write.
  - "clear_misses": Reset the miss log so the demand signal stays clean. Optional query = substring; only rows whose query contains it are deleted (e.g. a test suite clearing its own probes). Omit to target ALL rows. Dry run by default; pass confirm:true to write.
  - "list_misses": Review searches that returned nothing — the retrieval gaps. Optional: limit (default 50, newest first). Use to find questions the corpus should answer but can't.
  - "generate_summary": Generate a cached flat routing table — one line per node. With forestId, covers that forest's member trees and stores on the forest. WITHOUT forestId, covers EVERY tree including those belonging to no forest, and stores globally.
  - "get_forest_summary": Get a cached routing summary + staleness check. With forestId, that forest's; without, the global one.`,
    {
      ...INITIATOR_PARAM,
      action: z.enum([
        "list_forests", "get_forest", "create_forest", "update_forest", "delete_forest",
        "list_trees", "get_tree", "create_tree", "update_tree", "delete_tree", "get_index", "add_search",
        "search", "search_tags", "list_misses", "clear_misses", "stats", "repair", "check_gaps", "add_gap", "resolve_gap", "generate_summary", "get_forest_summary",
      ]).describe("Action to perform"),
      forestId: z.string().optional().describe("Forest ID (required for update_forest/delete_forest, optional filter for list_trees)"),
      treeId: z.string().optional().describe("Tree ID (required for update_tree/delete_tree/get_index)"),
      name: z.string().optional().describe("Name (required for create_forest/create_tree, optional for updates)"),
      description: z.string().optional().describe("Description (optional for create/update)"),
      tags: z.array(z.string()).optional().describe("Tags: domain tags for forests (create_forest/update_forest) or exact keyword tags to search for (search)"),
      limit: z.number().int().optional().describe("Max rows to return (list_misses; default 50)"),
      treeIds: z.array(z.string()).optional().describe("Tree IDs for update_forest"),
      forestIds: z.array(z.string()).optional().describe("Forest IDs for create_tree/update_tree (multi-forest membership)"),
      tokenBudget: z.number().int().optional().describe("Token budget for a tree (default 150000)"),
      freshnessPeriodDays: z.number().int().optional().describe("Days before nodes are considered stale (default 90)"),
      query: z.string().optional().describe("Free-text query: the question in your own words (search), or the search query being recorded (add_search)"),
      nodeIdsProduced: z.array(z.string()).optional().describe("Node IDs created from a search (optional for add_search)"),
      confirm: z.boolean().optional().describe("Required (true) to actually write for repair / clear_misses. Without it those actions dry-run and report what they would change."),
      gaps: z.union([z.string(), z.array(z.any())]).optional().describe("Gap objects for update_tree: [{question, priority, discoveredAt?, status?}]. Accepts a REAL ARRAY (preferred — no escaping) or a JSON array string. Priority: high/medium/low. Status: open/resolved (default: open). For single-gap changes use add_gap / resolve_gap instead."),
    },
    async ({ initiator, action, forestId, treeId, name, description, tags, treeIds, forestIds, tokenBudget, freshnessPeriodDays, query, nodeIdsProduced, gaps, limit, confirm }) => {
      resolveInitiator({ initiator });
      const uid = getCurrentUid();

      // ═══════════════════════════════════════
      // FOREST ACTIONS
      // ═══════════════════════════════════════

      // ─── LIST_FORESTS ───
      if (action === "list_forests") {
        const snap = await getForestsRef(uid).once("value");
        const data = snap.val();
        if (!data) return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ forests: [], total: 0 }, null, 2) }] });

        const forests = Object.values(data).map((f: any) => ({
          id: f.id,
          name: f.name,
          description: f.description || null,
          treeCount: (f.treeIds || []).length,
          tags: f.tags || [],
        }));

        return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ forests, total: forests.length }, null, 2) }] });
      }

      // ─── GET_FOREST ───
      if (action === "get_forest") {
        if (!forestId) return withResponseSize({ content: [{ type: "text", text: "get_forest requires forestId" }], isError: true });

        const snap = await getForestRef(uid, forestId).once("value");
        const forest = snap.val();
        if (!forest) return withResponseSize({ content: [{ type: "text", text: `Forest not found: ${forestId}` }], isError: true });

        return withResponseSize({ content: [{ type: "text", text: JSON.stringify(forest, null, 2) }] });
      }

      // ─── CREATE_FOREST ───
      if (action === "create_forest") {
        if (!name) return withResponseSize({ content: [{ type: "text", text: "create_forest requires name" }], isError: true });

        const ref = getForestsRef(uid).push();
        const now = new Date().toISOString();
        const forest = {
          id: ref.key,
          name,
          description: description || null,
          treeIds: [],
          tags: tags || [],
          owner: uid,
          createdAt: now,
          updatedAt: now,
        };
        await ref.set(forest);
        return withResponseSize({ content: [{ type: "text", text: JSON.stringify(forest, null, 2) }] });
      }

      // ─── UPDATE_FOREST ───
      if (action === "update_forest") {
        if (!forestId) return withResponseSize({ content: [{ type: "text", text: "update_forest requires forestId" }], isError: true });

        const ref = getForestRef(uid, forestId);
        const snap = await ref.once("value");
        if (!snap.val()) return withResponseSize({ content: [{ type: "text", text: `Forest not found: ${forestId}` }], isError: true });

        const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
        if (name !== undefined) updates.name = name;
        if (description !== undefined) updates.description = description;
        if (tags !== undefined) updates.tags = tags;
        if (treeIds !== undefined) updates.treeIds = treeIds;

        await ref.update(updates);
        return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ ...snap.val(), ...updates }, null, 2) }] });
      }

      // ─── DELETE_FOREST ───
      if (action === "delete_forest") {
        if (!forestId) return withResponseSize({ content: [{ type: "text", text: "delete_forest requires forestId" }], isError: true });

        const ref = getForestRef(uid, forestId);
        const snap = await ref.once("value");
        if (!snap.val()) return withResponseSize({ content: [{ type: "text", text: `Forest not found: ${forestId}` }], isError: true });

        await ref.remove();
        return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ deleted: forestId }) }] });
      }

      // ═══════════════════════════════════════
      // TREE ACTIONS
      // ═══════════════════════════════════════

      // ─── LIST_TREES ───
      if (action === "list_trees") {
        const snap = await getTreesRef(uid).once("value");
        const data = snap.val();
        if (!data) return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ trees: [], total: 0 }, null, 2) }] });

        let trees: any[] = Object.values(data);

        // Filter by forest if specified
        if (forestId) {
          const forestSnap = await getForestRef(uid, forestId).once("value");
          const forest = forestSnap.val();
          if (!forest) return withResponseSize({ content: [{ type: "text", text: `Forest not found: ${forestId}` }], isError: true });
          const memberIds: string[] = forest.treeIds || [];
          trees = trees.filter((t: any) => memberIds.includes(t.id));
        }

        const summaries = trees.map((t: any) => ({
          id: t.id,
          name: t.name,
          // Truncated. list_trees is a ROUTING call — it answers "which tree do I want",
          // and full multi-paragraph descriptions made it the largest response on the whole
          // surface (51,757 chars for 62 trees, measured 2026-08-28). Same keys, shorter
          // values, so callers do not break; get_tree returns the full text.
          description: t.description
            ? (t.description.length > LIST_DESCRIPTION_CHARS
                ? t.description.slice(0, LIST_DESCRIPTION_CHARS) + "… (get_tree for full)"
                : t.description)
            : null,
          forestIds: t.forestIds || [],
          tokenUsed: t.tokenUsed || 0,
          tokenBudget: t.tokenBudget || 150000,
          nodeCount: t.nodeCount || 0,
          trustProfile: t.trustProfile || emptyTrustProfile(),
          lastVerified: t.lastVerified || null,
          freshnessPeriodDays: t.freshnessPeriodDays || 90,
        }));

        return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ trees: summaries, total: summaries.length }, null, 2) }] });
      }

      // ─── GET_TREE ───
      if (action === "get_tree") {
        if (!treeId) return withResponseSize({ content: [{ type: "text", text: "get_tree requires treeId" }], isError: true });

        const snap = await getTreeRef(uid, treeId).once("value");
        const tree = snap.val();
        if (!tree) return withResponseSize({ content: [{ type: "text", text: `Tree not found: ${treeId}` }], isError: true });

        // Return full tree record WITHOUT index (use get_index for that)
        const { index, ...treeWithoutIndex } = tree;
        return withResponseSize({ content: [{ type: "text", text: JSON.stringify(treeWithoutIndex, null, 2) }] });
      }

      // ─── CREATE_TREE ───
      if (action === "create_tree") {
        if (!name) return withResponseSize({ content: [{ type: "text", text: "create_tree requires name" }], isError: true });

        const ref = getTreesRef(uid).push();
        const now = new Date().toISOString();
        const tree = {
          id: ref.key,
          name,
          description: description || null,
          forestIds: forestIds || [],
          tokenBudget: tokenBudget || 150000,
          tokenUsed: 0,
          nodeCount: 0,
          trustProfile: emptyTrustProfile(),
          freshnessPeriodDays: freshnessPeriodDays || 90,
          lastVerified: null,
          searchHistory: [],
          visibility: "private",
          owner: uid,
          createdAt: now,
          updatedAt: now,
        };
        await ref.set(tree);

        // Update forest treeIds arrays if forestIds provided
        if (forestIds && forestIds.length > 0) {
          for (const fId of forestIds) {
            const forestSnap = await getForestRef(uid, fId).once("value");
            const forest = forestSnap.val();
            if (forest) {
              const existing: string[] = forest.treeIds || [];
              if (!existing.includes(ref.key!)) {
                existing.push(ref.key!);
                await getForestRef(uid, fId).update({ treeIds: existing, updatedAt: now });
              }
            }
          }
        }

        // Lean response: just confirm creation with key fields
        return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ treeId: ref.key, name, created: true }, null, 2) }] });
      }

      // ─── UPDATE_TREE ───
      if (action === "update_tree") {
        if (!treeId) return withResponseSize({ content: [{ type: "text", text: "update_tree requires treeId" }], isError: true });

        const ref = getTreeRef(uid, treeId);
        const snap = await ref.once("value");
        const existing = snap.val();
        if (!existing) return withResponseSize({ content: [{ type: "text", text: `Tree not found: ${treeId}` }], isError: true });

        const now = new Date().toISOString();
        const updates: Record<string, any> = { updatedAt: now };
        if (name !== undefined) updates.name = name;
        if (description !== undefined) updates.description = description;
        if (tokenBudget !== undefined) updates.tokenBudget = tokenBudget;
        if (freshnessPeriodDays !== undefined) updates.freshnessPeriodDays = freshnessPeriodDays;

        // Handle gaps field
        if (gaps !== undefined) {
          const coerced = coerceArrayParam(gaps, "gaps");
          if (!coerced.ok) {
            return withResponseSize({ content: [{ type: "text", text: coerced.error }], isError: true });
          }
          {
            const parsedGaps = coerced.value || [];
            // Validate and normalize each gap entry
            updates.gaps = parsedGaps.map((g: any) => ({
              question: g.question || "",
              priority: g.priority || "medium",
              discoveredAt: g.discoveredAt || now,
              status: g.status || "open",
            }));
          }
        }

        // Handle forestIds changes — update old and new forest treeIds arrays
        if (forestIds !== undefined) {
          const oldForestIds: string[] = existing.forestIds || [];
          const newForestIds: string[] = forestIds;
          updates.forestIds = newForestIds;

          // Remove from forests no longer referenced
          for (const fId of oldForestIds) {
            if (!newForestIds.includes(fId)) {
              const forestSnap = await getForestRef(uid, fId).once("value");
              const forest = forestSnap.val();
              if (forest) {
                const tIds: string[] = (forest.treeIds || []).filter((id: string) => id !== treeId);
                await getForestRef(uid, fId).update({ treeIds: tIds, updatedAt: now });
              }
            }
          }

          // Add to newly referenced forests
          for (const fId of newForestIds) {
            if (!oldForestIds.includes(fId)) {
              const forestSnap = await getForestRef(uid, fId).once("value");
              const forest = forestSnap.val();
              if (forest) {
                const tIds: string[] = forest.treeIds || [];
                if (!tIds.includes(treeId)) {
                  tIds.push(treeId);
                  await getForestRef(uid, fId).update({ treeIds: tIds, updatedAt: now });
                }
              }
            }
          }
        }

        await ref.update(updates);

        // Lean response: only confirm what changed
        const fieldsUpdated = Object.keys(updates).filter((k) => k !== "updatedAt");
        return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ updated: true, treeId, fieldsUpdated }, null, 2) }] });
      }

      // ─── DELETE_TREE ───
      if (action === "delete_tree") {
        if (!treeId) return withResponseSize({ content: [{ type: "text", text: "delete_tree requires treeId" }], isError: true });

        const ref = getTreeRef(uid, treeId);
        const snap = await ref.once("value");
        const tree = snap.val();
        if (!tree) return withResponseSize({ content: [{ type: "text", text: `Tree not found: ${treeId}` }], isError: true });

        const now = new Date().toISOString();

        // Remove from parent forests
        const parentForestIds: string[] = tree.forestIds || [];
        for (const fId of parentForestIds) {
          const forestSnap = await getForestRef(uid, fId).once("value");
          const forest = forestSnap.val();
          if (forest) {
            const tIds: string[] = (forest.treeIds || []).filter((id: string) => id !== treeId);
            await getForestRef(uid, fId).update({ treeIds: tIds, updatedAt: now });
          }
        }

        // Delete node content records where treeId matches
        const nodesSnap = await getNodesRef(uid).orderByChild("treeId").equalTo(treeId).once("value");
        const nodesData = nodesSnap.val();
        let deletedNodes = 0;
        if (nodesData) {
          const nodeIds = Object.keys(nodesData);
          const delUpdates: Record<string, null> = {};
          for (const nId of nodeIds) {
            delUpdates[nId] = null;
          }
          await getNodesRef(uid).update(delUpdates);
          deletedNodes = nodeIds.length;
        }

        // Delete tree record (includes index entries under trees/{treeId}/index/)
        await ref.remove();

        return withResponseSize({
          content: [{
            type: "text",
            text: JSON.stringify({
              deleted: treeId,
              deletedNodes,
              removedFromForests: parentForestIds.length,
            }),
          }],
        });
      }

      // ─── GET_INDEX ───
      if (action === "get_index") {
        if (!treeId) return withResponseSize({ content: [{ type: "text", text: "get_index requires treeId" }], isError: true });

        // Load tree metadata and index in parallel
        const [treeSnap, indexSnap] = await Promise.all([
          getTreeRef(uid, treeId).once("value"),
          getTreeIndexRef(uid, treeId).once("value"),
        ]);

        const tree = treeSnap.val();
        if (!tree) return withResponseSize({ content: [{ type: "text", text: `Tree not found: ${treeId}` }], isError: true });

        const indexData = indexSnap.val();
        const entries: any[] = indexData ? Object.values(indexData) : [];

        // Sort by hierarchy: root nodes first (parentId null), then by order
        entries.sort((a, b) => {
          // Root nodes first
          if (!a.parentId && b.parentId) return -1;
          if (a.parentId && !b.parentId) return 1;
          // Then by order within same parent
          if (a.parentId === b.parentId) return (a.order || 0) - (b.order || 0);
          return 0;
        });

        const freshnessPeriodDays = tree.freshnessPeriodDays || 90;
        const freshnessMs = freshnessPeriodDays * 24 * 60 * 60 * 1000;
        const nowMs = Date.now();

        const result: Record<string, any> = {
          tree: {
            id: tree.id,
            name: tree.name,
            description: tree.description || null,
            tokenUsed: tree.tokenUsed || 0,
            tokenBudget: tree.tokenBudget || 150000,
            nodeCount: tree.nodeCount || 0,
            trustProfile: tree.trustProfile || emptyTrustProfile(),
            lastVerified: tree.lastVerified || null,
            freshnessPeriodDays,
            searchHistory: tree.searchHistory || [],
          },
          index: entries.map((e: any) => ({
            id: e.id,
            question: e.question,
            keyFinding: e.keyFinding,
            tokenCost: e.tokenCost || 0,
            trust: e.trust || "unverified",
            lastVerified: e.lastVerified || null,
            parentId: e.parentId || null,
            childIds: e.childIds || [],
            tags: e.tags || [],
            order: e.order || 0,
            contradictedBy: e.contradictedBy || [],
          })),
          nodeCount: entries.length,
        };

        // ─── Health Advisory ───
        // Compute stale nodes, contradictions, gaps — only include if something to report
        const staleNodes: any[] = [];
        const contradictions: any[] = [];

        for (const e of entries) {
          // Staleness check
          const verifiedAt = e.lastVerified ? new Date(e.lastVerified).getTime() : 0;
          if (verifiedAt > 0 && (nowMs - verifiedAt) > freshnessMs) {
            staleNodes.push({
              nodeId: e.id,
              question: e.question,
              lastVerified: e.lastVerified,
              daysSinceVerified: Math.floor((nowMs - verifiedAt) / (24 * 60 * 60 * 1000)),
            });
          }

          // Contradiction check
          const contradictedBy: string[] = e.contradictedBy || [];
          if (contradictedBy.length > 0) {
            contradictions.push({
              nodeId: e.id,
              question: e.question,
              contradictedBy,
            });
          }
        }

        // Gaps from tree record
        const openGaps: any[] = (tree.gaps || []).filter((g: any) => (g.status || "open") === "open");

        const hasIssues = staleNodes.length > 0 || contradictions.length > 0 || openGaps.length > 0;
        if (hasIssues) {
          const summaryParts: string[] = [];
          if (staleNodes.length > 0) summaryParts.push(`${staleNodes.length} stale node(s)`);
          if (contradictions.length > 0) summaryParts.push(`${contradictions.length} contradiction(s)`);
          if (openGaps.length > 0) summaryParts.push(`${openGaps.length} open gap(s)`);

          result.healthAdvisory = {
            staleNodes,
            contradictions,
            gaps: openGaps,
            summary: summaryParts.join(", "),
          };
        }

        const budgetRemaining = (tree.tokenBudget || 150000) - (tree.tokenUsed || 0);

        return withResponseSize(
          { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
          { _treeBudgetRemaining: budgetRemaining }
        );
      }

      // ─── ADD_SEARCH ───
      if (action === "add_search") {
        if (!treeId) return withResponseSize({ content: [{ type: "text", text: "add_search requires treeId" }], isError: true });
        if (!query) return withResponseSize({ content: [{ type: "text", text: "add_search requires query" }], isError: true });

        const ref = getTreeRef(uid, treeId);
        const snap = await ref.once("value");
        const tree = snap.val();
        if (!tree) return withResponseSize({ content: [{ type: "text", text: `Tree not found: ${treeId}` }], isError: true });

        const now = new Date().toISOString();
        const searchEntry = {
          query,
          nodeIdsProduced: nodeIdsProduced || [],
          searchedAt: now,
        };

        const history: any[] = tree.searchHistory || [];
        history.push(searchEntry);

        await ref.update({ searchHistory: history, updatedAt: now });

        return withResponseSize({
          content: [{ type: "text", text: JSON.stringify({ added: searchEntry, totalSearches: history.length }, null, 2) }],
        });
      }

      // ─── SEARCH_TAGS ───
      if (action === "search" || action === "search_tags") {
        const hasTags = !!(tags && tags.length > 0);
        const hasQuery = !!(query && query.trim().length > 0);
        if (!hasTags && !hasQuery) {
          return withResponseSize({ content: [{ type: "text", text: "search requires query (free text) and/or tags (non-empty array)" }], isError: true });
        }

        // Determine which trees to search
        let treeIdsToSearch: string[] = [];

        if (treeId) {
          // Single tree filter
          treeIdsToSearch = [treeId];
        } else if (forestId) {
          // Forest filter — get member tree IDs
          const forestSnap = await getForestRef(uid, forestId).once("value");
          const forest = forestSnap.val();
          if (!forest) return withResponseSize({ content: [{ type: "text", text: `Forest not found: ${forestId}` }], isError: true });
          treeIdsToSearch = forest.treeIds || [];
        } else {
          // All trees
          const treesSnap = await getTreesRef(uid).once("value");
          const treesData = treesSnap.val();
          if (treesData) treeIdsToSearch = Object.keys(treesData);
        }

        if (treeIdsToSearch.length === 0) {
          return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ matches: [], total: 0 }, null, 2) }] });
        }

        // Load all tree records in parallel to get names + index entries
        const treeSnaps = await Promise.all(
          treeIdsToSearch.map((tid) => getTreeRef(uid, tid).once("value"))
        );

        const searchTagsLower = (tags || []).map((t) => t.toLowerCase());
        const queryTokens = tokenize(query || "");

        // Term rarity is measured against the corpus actually being searched, from the
        // index entries already loaded above — no extra reads. Without it, a word like
        // "work" (ubiquitous in both queries and node questions) scores like a rare term
        // and drags a dozen unrelated nodes into every result.
        const allEntries = treeSnaps.flatMap((s) => Object.values(s.val()?.index || {}) as any[]);
        const idf = buildIdf(allEntries);

        const matches: any[] = [];

        for (let i = 0; i < treeIdsToSearch.length; i++) {
          const tree = treeSnaps[i].val();
          if (!tree) continue;

          const { staleDays, stale } = computeStaleness(tree.lastVerified, tree.freshnessPeriodDays);

          const indexData = tree.index || {};
          for (const entry of Object.values(indexData) as any[]) {
            const { score, matchingTags, matchedTerms } = scoreEntry(queryTokens, searchTagsLower, entry, tree, idf);
            if (score < SCORE_FLOOR) continue;

            matches.push({
              nodeId: entry.id,
              treeId: treeIdsToSearch[i],
              treeName: tree.name,
              question: entry.question,
              keyFinding: entry.keyFinding,
              tags: entry.tags || [],
              matchingTags,
              matchCount: matchingTags.length,
              matchedTerms,
              score,
              tokenCost: entry.tokenCost || 0,
              trust: entry.trust || "unverified",
              // Surfaced at the point of use — a finding past its own freshness window
              // should carry that warning into the result, not sit in a health advisory.
              staleDays,
              ...(stale ? { stale: true } : {}),
            });
          }
        }

        // Most relevant first; exact-tag hits break ties, preserving the old ordering
        // intent for callers that pass tags and no query.
        matches.sort((a, b) => (b.score - a.score) || (b.matchCount - a.matchCount));

        const totalMatched = matches.length;
        const returned = matches.slice(0, SEARCH_RESULT_LIMIT);

        // Does a returned node answer an OPEN gap on its own tree?
        //
        // This lives in the search response, not only in get_index's healthAdvisory,
        // because search is where sessions actually arrive. A peer session that followed
        // the CLAUDE.md search rule to the letter still never called get_index all session
        // — its entry points were search and list_trees. A flag only in the advisory would
        // have missed it completely, and on current read numbers that is nearly every
        // session.
        const gapHits: any[] = [];
        for (const m of returned) {
          const tree = treeSnaps[treeIdsToSearch.indexOf(m.treeId)]?.val();
          for (const g of (tree?.gaps || []) as any[]) {
            if ((g.status || "open") !== "open") continue;
            const { score } = scoreEntry(tokenize(g.question || ""), [], {
              question: m.question, keyFinding: m.keyFinding, tags: m.tags,
            }, tree, idf);
            if (score >= GAP_ANSWERED_SCORE) {
              gapHits.push({ treeId: m.treeId, treeName: m.treeName, gap: g.question,
                             possiblyAnsweredBy: m.nodeId, score });
            }
          }
        }

        // Count what search PUT IN FRONT of a caller, separately from what the caller then
        // chose to load (knowledge_node load increments `reads`). The gap between the two
        // is the only measure of retrieval precision available: a node surfaced repeatedly
        // and never read is one search keeps recommending and no one wants.
        // One multi-path update, fire-and-forget — never make a read path fail on a metric.
        if (returned.length > 0) {
          const counterUpdates: Record<string, any> = {};
          for (const m of returned) {
            counterUpdates[`${m.treeId}/index/${m.nodeId}/surfaced`] = increment(1);
          }
          getTreesRef(uid).update(counterUpdates).catch(() => {});
        }

        // A miss is invisible by default: the caller simply researches the question again.
        // Record it so the gap is reviewable via list_misses.
        //
        // "Miss" means nothing CONFIDENT came back — not merely an empty result. A lone
        // incidental term overlap would otherwise make a real gap look answered and the
        // miss log would under-report exactly the cases it exists to catch.
        const hasStrongMatch = returned.some(
          (m) => m.score >= STRONG_MATCH_SCORE || m.matchCount > 0
        );
        if (!hasStrongMatch) {
          try {
            await getSearchMissesRef(uid).push({
              query: query || null,
              tags: tags || [],
              initiator: initiator || null,
              searchedTrees: treeIdsToSearch.length,
              weakMatches: totalMatched,
              timestamp: new Date().toISOString(),
            });
          } catch {
            // Logging is best-effort — a failed write must not fail the search.
          }
        }

        return withResponseSize({
          content: [{ type: "text", text: JSON.stringify({
            matches: returned,
            total: returned.length,
            totalMatched,
            ...(totalMatched > returned.length ? { truncated: true, note: `${totalMatched} nodes matched; showing top ${returned.length} by score.` } : {}),
            searchedTrees: treeIdsToSearch.length,
            ...(gapHits.length > 0 ? {
              openGapsPossiblyAnswered: gapHits,
              gapNote: "A returned node scores high against an OPEN gap on its tree — that gap may already be answered. Verify, then close it with resolve_gap. Left open, it sends the next session to redo finished work.",
            } : {}),
            // Tags-only retrieval depends on guessing the vocabulary a past session chose.
            // Surfaced here rather than only in the tool description because a peer session
            // whose instructions bold "always pass query" still called tags-only first —
            // the action name beat the instruction.
            ...(!hasQuery ? {
              hint: "Called with tags only. Pass `query` (the question in your own words) — it scores against every node's question and keyFinding instead of requiring an exact tag match.",
            } : {}),
          }, null, 2) }],
        });
      }

      // ─── ADD_GAP / RESOLVE_GAP ───
      // Single-gap writes. update_tree takes the WHOLE gaps array as one JSON string, so
      // closing one gap means re-serializing all of them and risking clobbering the rest.
      // That cost is why gaps rot: a session that answers its own gap mid-session skips
      // the update. Observed 2026-08-28 — a freshly written 7-gap list was ~30% stale
      // within hours of creation, by construction. check_gaps flags that rot; these two
      // actions prevent it.
      if (action === "add_gap" || action === "resolve_gap") {
        if (!treeId) return withResponseSize({ content: [{ type: "text", text: `${action} requires treeId` }], isError: true });
        if (!query) return withResponseSize({ content: [{ type: "text", text: `${action} requires query (the gap question${action === "resolve_gap" ? ", or enough of it to match exactly one open gap" : ""})` }], isError: true });

        const treeSnap = await getTreeRef(uid, treeId).once("value");
        const tree = treeSnap.val();
        if (!tree) return withResponseSize({ content: [{ type: "text", text: `Tree not found: ${treeId}` }], isError: true });

        const existing: any[] = tree.gaps || [];
        const now = new Date().toISOString();

        if (action === "add_gap") {
          const gap = { question: query, priority: name || "medium", discoveredAt: now, status: "open" };
          await getTreeRef(uid, treeId).update({ gaps: [...existing, gap], updatedAt: now });
          return withResponseSize({ content: [{ type: "text", text: JSON.stringify({
            added: gap, totalGaps: existing.length + 1,
            openGaps: existing.filter((g) => (g.status || "open") === "open").length + 1,
          }, null, 2) }] });
        }

        // resolve_gap — match on a substring of the question, so callers never need an id.
        const needle = query.toLowerCase();
        const matches = existing
          .map((g, i) => ({ g, i }))
          .filter(({ g }) => (g.status || "open") === "open" &&
                             String(g.question || "").toLowerCase().includes(needle));

        if (matches.length === 0) {
          return withResponseSize({ content: [{ type: "text", text: JSON.stringify({
            resolved: false, reason: "no OPEN gap on this tree matches that text",
            openGaps: existing.filter((g) => (g.status || "open") === "open").map((g) => g.question),
          }, null, 2) }], isError: true });
        }
        if (matches.length > 1) {
          return withResponseSize({ content: [{ type: "text", text: JSON.stringify({
            resolved: false, reason: `matched ${matches.length} open gaps — narrow the query`,
            candidates: matches.map(({ g }) => g.question),
          }, null, 2) }], isError: true });
        }

        // Write only the one element's status. No re-serialization of the array, so a
        // concurrent add_gap on the same tree cannot be clobbered by this call.
        const { i, g } = matches[0];
        await getTreeRef(uid, treeId).update({
          [`gaps/${i}/status`]: "resolved",
          [`gaps/${i}/resolvedAt`]: now,
          updatedAt: now,
        });
        return withResponseSize({ content: [{ type: "text", text: JSON.stringify({
          resolved: true, gap: g.question,
          openGapsRemaining: existing.filter((x) => (x.status || "open") === "open").length - 1,
        }, null, 2) }] });
      }

      // ─── CHECK_GAPS ───
      if (action === "check_gaps") {
        // A gap is an open question filed against a tree. Nothing ever re-checks whether
        // the corpus has since answered it, so a gap can outlive its own answer — and
        // unlike a stale node, which merely might be outdated, a stale gap actively sends
        // the next session to redo finished work.
        const treesSnap = await getTreesRef(uid).once("value");
        const treesData = treesSnap.val() || {};
        const scope = treeId ? { [treeId]: treesData[treeId] } : treesData;

        // IDF over the whole corpus regardless of scope — term rarity is a property of the
        // corpus, not of the subset being checked.
        const allEntries = (Object.values(treesData) as any[])
          .flatMap((t) => Object.values(t?.index || {}) as any[]);
        const idf = buildIdf(allEntries);

        const now = Date.now();
        const answered: any[] = [];
        const openStill: any[] = [];

        for (const [tid, tree] of Object.entries(scope) as [string, any][]) {
          if (!tree) continue;
          for (const g of (tree.gaps || []) as any[]) {
            if ((g.status || "open") !== "open") continue;

            const ageDays = g.discoveredAt
              ? Math.max(0, Math.floor((now - new Date(g.discoveredAt).getTime()) / 86400000))
              : null;

            // Score this gap's question against every node in the corpus.
            const qt = tokenize(g.question || "");
            const cands: any[] = [];
            if (qt.length >= 2) {
              for (const [otid, otree] of Object.entries(treesData) as [string, any][]) {
                for (const e of Object.values(otree?.index || {}) as any[]) {
                  const { score } = scoreEntry(qt, [], e, otree, idf);
                  if (score >= GAP_ANSWERED_SCORE) {
                    cands.push({ nodeId: e.id, treeId: otid, treeName: otree.name,
                                 question: e.question, score, trust: e.trust || "unverified" });
                  }
                }
              }
            }
            cands.sort((a, b) => b.score - a.score);

            const row = { treeId: tid, treeName: tree.name, gap: g.question,
                          priority: g.priority || "medium", ageDays };
            if (cands.length > 0) answered.push({ ...row, candidates: cands.slice(0, 3) });
            else openStill.push(row);
          }
        }

        answered.sort((a, b) => b.candidates[0].score - a.candidates[0].score);
        openStill.sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0));

        return withResponseSize({ content: [{ type: "text", text: JSON.stringify({
          scope: treeId ? `tree ${treeId}` : "all trees",
          openGaps: answered.length + openStill.length,
          possiblyAnswered: answered.length,
          // RECOMMENDATION ONLY. Nothing here resolves a gap: a false positive would tell
          // someone work is done when it is not, which is worse than leaving it open.
          // Review the candidate, then resolve via update_tree if it genuinely answers.
          possiblyAnsweredGaps: answered,
          stillOpen: openStill,
          note: "possiblyAnswered means an existing node scores high against the gap's question. Verify before resolving — this never closes a gap for you.",
        }, null, 2) }] });
      }

      // ─── REPAIR ───
      if (action === "repair") {
        // Per-tree aggregates (nodeCount / tokenUsed / trustProfile) are maintained by
        // incrementing on create and decrementing on delete. Any path that writes an index
        // entry without updating them — a failed partial write, an older code path, a
        // manual edit — drifts the aggregate permanently, and nothing recomputes it.
        // Observed 2026-08-28: 309 real entries vs 299 counted.
        //
        // dryRun by default: this rewrites tree records on the shared prod RTDB.
        const apply = confirm === true;
        const treesSnap = await getTreesRef(uid).once("value");
        const treesData = treesSnap.val() || {};

        const drift: any[] = [];
        const updates: Record<string, any> = {};

        for (const [tid, tree] of Object.entries(treesData) as [string, any][]) {
          const entries = Object.values(tree?.index || {}) as any[];
          const realCount = entries.length;
          const realTokens = entries.reduce((s, e) => s + (e.tokenCost || 0), 0);
          const realTrust = emptyTrustProfile() as Record<string, number>;
          for (const e of entries) {
            const t = e.trust || "unverified";
            if (t in realTrust) realTrust[t] += 1;
          }

          const storedCount = tree?.nodeCount || 0;
          const storedTokens = tree?.tokenUsed || 0;
          const storedTrust = tree?.trustProfile || emptyTrustProfile();
          const trustDiffers = TRUST_LEVELS.some(
            (l) => (storedTrust[l] || 0) !== realTrust[l]
          );

          if (storedCount !== realCount || storedTokens !== realTokens || trustDiffers) {
            drift.push({
              treeId: tid, name: tree?.name,
              nodeCount: { stored: storedCount, actual: realCount },
              tokenUsed: { stored: storedTokens, actual: realTokens },
              ...(trustDiffers ? { trustProfile: { stored: storedTrust, actual: realTrust } } : {}),
            });
            updates[`${tid}/nodeCount`] = realCount;
            updates[`${tid}/tokenUsed`] = realTokens;
            updates[`${tid}/trustProfile`] = realTrust;
          }
        }

        if (apply && drift.length > 0) await getTreesRef(uid).update(updates);

        const totalReal = (Object.values(treesData) as any[])
          .reduce((s, t) => s + Object.keys(t?.index || {}).length, 0);
        const totalStored = (Object.values(treesData) as any[])
          .reduce((s, t) => s + (t?.nodeCount || 0), 0);

        return withResponseSize({ content: [{ type: "text", text: JSON.stringify({
          applied: apply,
          treesWithDrift: drift.length,
          totals: { actualNodes: totalReal, storedNodeCount: totalStored, drift: totalReal - totalStored },
          trees: drift,
          ...(apply ? {} : { note: "Dry run — no writes. Pass confirm:true to apply." }),
        }, null, 2) }] });
      }

      // ─── CLEAR_MISSES ───
      if (action === "clear_misses") {
        // The miss log is the demand signal, so it has to be resettable — otherwise test
        // traffic (e2e appends a probe row per run) permanently dilutes it. `match` scopes
        // the delete to rows whose query contains a substring, so a test suite can clean up
        // after itself without touching real signal.
        const snap = await getSearchMissesRef(uid).once("value");
        const data = snap.val() || {};
        const needle = (query || "").trim().toLowerCase();

        const doomed = Object.entries(data).filter(([, m]: [string, any]) =>
          !needle || String(m?.query ?? "").toLowerCase().includes(needle)
        );

        if (confirm !== true) {
          return withResponseSize({ content: [{ type: "text", text: JSON.stringify({
            applied: false, wouldDelete: doomed.length, totalRows: Object.keys(data).length,
            scope: needle ? `query contains "${needle}"` : "ALL rows",
            sample: doomed.slice(0, 5).map(([, m]: [string, any]) => m?.query ?? null),
            note: "Dry run — no writes. Pass confirm:true to apply.",
          }, null, 2) }] });
        }

        const updates: Record<string, any> = {};
        for (const [k] of doomed) updates[k] = null;
        if (doomed.length > 0) await getSearchMissesRef(uid).update(updates);

        return withResponseSize({ content: [{ type: "text", text: JSON.stringify({
          applied: true, deleted: doomed.length, remaining: Object.keys(data).length - doomed.length,
        }, null, 2) }] });
      }

      // ─── STATS ───
      if (action === "stats") {
        const [treesSnap, missSnap] = await Promise.all([
          getTreesRef(uid).once("value"),
          getSearchMissesRef(uid).once("value"),
        ]);
        const trees = Object.values(treesSnap.val() || {}) as any[];
        const misses = Object.values(missSnap.val() || {}) as any[];

        let total = 0, everRead = 0, everSurfaced = 0, surfacedNeverRead = 0;
        let totalReads = 0, totalSurfaced = 0;
        let openGaps = 0;
        let oldestGapDays: number | null = null;
        const nowMs = Date.now();
        const perNode: any[] = [];

        for (const tree of trees) {
          // Gap counting is cheap (no scoring) — check_gaps does the expensive part.
          for (const g of (tree?.gaps || []) as any[]) {
            if ((g.status || "open") !== "open") continue;
            openGaps++;
            if (g.discoveredAt) {
              const age = Math.max(0, Math.floor((nowMs - new Date(g.discoveredAt).getTime()) / 86400000));
              if (oldestGapDays === null || age > oldestGapDays) oldestGapDays = age;
            }
          }
          for (const e of Object.values(tree?.index || {}) as any[]) {
            const reads = e.reads || 0;
            const surfaced = e.surfaced || 0;
            total++;
            totalReads += reads;
            totalSurfaced += surfaced;
            if (reads > 0) everRead++;
            if (surfaced > 0) everSurfaced++;
            if (surfaced > 0 && reads === 0) surfacedNeverRead++;
            perNode.push({ question: e.question, treeName: tree.name, reads, surfaced, lastRead: e.lastRead || null });
          }
        }

        const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);
        perNode.sort((a, b) => (b.reads - a.reads) || (b.surfaced - a.surfaced));

        return withResponseSize({ content: [{ type: "text", text: JSON.stringify({
          corpus: { nodes: total, trees: trees.length },
          // The headline question: is this corpus an asset or a habit?
          usage: {
            everRead, pctEverRead: pct(everRead),
            neverRead: total - everRead, pctNeverRead: pct(total - everRead),
            totalReads, totalSurfaced,
          },
          // Surfaced but never opened. NOT labelled "precision" — the number cannot be read
          // in one direction. It counts both the best outcome (the keyFinding in the search
          // result already answered the question, so the caller got it for ~40 tokens
          // instead of loading ~1,200) and the worst (an irrelevant hit nobody wanted).
          // Those are indistinguishable from the counters alone. Treat as a bucket to
          // investigate, never as an error rate.
          surfacedNotOpened: {
            count: surfacedNeverRead, pct: pct(surfacedNeverRead), everSurfaced,
            note: "Ambiguous by construction: includes both 'keyFinding was enough' and 'irrelevant hit'. Sample surfacedNotOpenedSample before drawing conclusions.",
          },
          // Demand: questions the corpus could not answer. This is the build queue.
          // openGaps counted here (cheap); run check_gaps to score them against the corpus
          // and find the ones it may already answer.
          demand: {
            missesLogged: misses.length,
            openGaps,
            oldestGapDays: oldestGapDays,
            ...(oldestGapDays !== null && oldestGapDays > 90
              ? { hint: "Gaps older than the corpus freshness default — run check_gaps; a stale gap sends the next session to redo finished work." }
              : {}),
          },
          mostRead: perNode.slice(0, 10),
          surfacedNotOpenedSample: perNode.filter((n) => n.surfaced > 0 && n.reads === 0).slice(0, 10),
          note: "Counters start at instrumentation deploy; nodes written earlier show 0 until next used.",
        }, null, 2) }] });
      }

      // ─── LIST_MISSES ───
      if (action === "list_misses") {
        const cap = limit && limit > 0 ? limit : 50;
        const snap = await getSearchMissesRef(uid).once("value");
        const data = snap.val();
        if (!data) return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ misses: [], total: 0 }, null, 2) }] });

        const all = (Object.values(data) as any[])
          .sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));

        return withResponseSize({
          content: [{ type: "text", text: JSON.stringify({
            misses: all.slice(0, cap),
            total: all.length,
            ...(all.length > cap ? { truncated: true } : {}),
          }, null, 2) }],
        });
      }

      // ─── GENERATE_SUMMARY ───
      if (action === "generate_summary") {
        // No forestId → global routing table across EVERY tree. Forest-scoped summaries
        // iterate forest.treeIds and so cannot see trees belonging to no forest, which is
        // most of the recently-active corpus.
        if (!forestId) {
          const treesSnap = await getTreesRef(uid).once("value");
          const treesData = treesSnap.val() || {};
          const allTrees = Object.values(treesData) as any[];

          const lines: string[] = [];
          let totalNodes = 0;
          let capped = false;

          for (const tree of allTrees) {
            if (!tree) continue;
            for (const entry of Object.values(tree.index || {}) as any[]) {
              totalNodes++;
              if (lines.length >= GLOBAL_SUMMARY_NODE_CAP) { capped = true; continue; }
              // Compact rendering: the global table spans every tree, so it is the one
              // response where size matters. The routing signal is the question — the
              // keyFinding is a preview and long tag lists add bulk without routing value.
              lines.push(summaryLine(tree.name, entry, { findingChars: 60, maxTags: 5 }));
            }
          }

          const summary = lines.join("\n");
          const now = new Date().toISOString();

          await getGlobalSummaryRef(uid).set({
            summary,
            summaryGeneratedAt: now,
            summaryNodeCount: totalNodes,
            treeCount: allTrees.length,
          });

          return withResponseSize({
            content: [{ type: "text", text: JSON.stringify({
              scope: "global",
              summary,
              nodeCount: totalNodes,
              treeCount: allTrees.length,
              ...(capped ? { capped: true, note: `Rendered ${lines.length} of ${totalNodes} nodes (cap ${GLOBAL_SUMMARY_NODE_CAP}).` } : {}),
              generatedAt: now,
            }, null, 2) }],
          });
        }

        const forestSnap = await getForestRef(uid, forestId).once("value");
        const forest = forestSnap.val();
        if (!forest) return withResponseSize({ content: [{ type: "text", text: `Forest not found: ${forestId}` }], isError: true });

        const memberTreeIds: string[] = forest.treeIds || [];
        if (memberTreeIds.length === 0) {
          const emptySummary = "(empty forest — no trees)";
          const now = new Date().toISOString();
          await getForestRef(uid, forestId).update({ summary: emptySummary, summaryGeneratedAt: now, summaryNodeCount: 0, updatedAt: now });
          return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ summary: emptySummary, nodeCount: 0, treeCount: 0 }, null, 2) }] });
        }

        // Load all member trees in parallel
        const treeSnaps = await Promise.all(
          memberTreeIds.map((tid) => getTreeRef(uid, tid).once("value"))
        );

        const lines: string[] = [];
        let totalNodes = 0;

        for (let i = 0; i < memberTreeIds.length; i++) {
          const tree = treeSnaps[i].val();
          if (!tree) continue;

          const indexData = tree.index || {};
          const entries = Object.values(indexData) as any[];

          for (const entry of entries) {
            lines.push(summaryLine(tree.name, entry));
            totalNodes++;
          }
        }

        const summary = lines.join("\n");
        const now = new Date().toISOString();

        await getForestRef(uid, forestId).update({
          summary,
          summaryGeneratedAt: now,
          summaryNodeCount: totalNodes,
          updatedAt: now,
        });

        return withResponseSize({
          content: [{ type: "text", text: JSON.stringify({ summary, nodeCount: totalNodes, treeCount: memberTreeIds.length, generatedAt: now }, null, 2) }],
        });
      }

      // ─── GET_FOREST_SUMMARY ───
      if (action === "get_forest_summary") {
        // No forestId → the cached global routing table.
        if (!forestId) {
          const snap = await getGlobalSummaryRef(uid).once("value");
          const cached = snap.val();
          if (!cached || !cached.summary) {
            return withResponseSize({ content: [{ type: "text", text: JSON.stringify({ scope: "global", summary: null, stale: true, reason: "no global summary generated yet — run generate_summary with no forestId" }, null, 2) }] });
          }

          const treesSnap = await getTreesRef(uid).once("value");
          // Count real index entries, NOT the tree.nodeCount aggregate. generate_summary
          // counts by iterating entries, so comparing against the aggregate compares unlike
          // with unlike — and the aggregate has drifted (309 real vs 299 stored on
          // 2026-08-28), which pinned this to stale:true regardless of state. Run
          // action:"repair" to reconcile the aggregates themselves.
          const currentNodeCount = (Object.values(treesSnap.val() || {}) as any[])
            .reduce((sum, t) => sum + Object.keys(t?.index || {}).length, 0);
          const isStale = currentNodeCount !== (cached.summaryNodeCount || 0);

          return withResponseSize({
            content: [{ type: "text", text: JSON.stringify({
              scope: "global",
              summary: cached.summary,
              generatedAt: cached.summaryGeneratedAt,
              summaryNodeCount: cached.summaryNodeCount || 0,
              currentNodeCount,
              stale: isStale,
              ...(isStale ? { reason: `Node count changed: ${cached.summaryNodeCount || 0} → ${currentNodeCount}. Run generate_summary to refresh.` } : {}),
            }, null, 2) }],
          });
        }

        const forestSnap = await getForestRef(uid, forestId).once("value");
        const forest = forestSnap.val();
        if (!forest) return withResponseSize({ content: [{ type: "text", text: `Forest not found: ${forestId}` }], isError: true });

        if (!forest.summary) {
          return withResponseSize({
            content: [{ type: "text", text: JSON.stringify({ summary: null, stale: true, reason: "no summary generated yet" }, null, 2) }],
          });
        }

        // Check staleness: count current total nodes across member trees
        const memberTreeIds: string[] = forest.treeIds || [];
        let currentNodeCount = 0;

        if (memberTreeIds.length > 0) {
          const treeSnaps = await Promise.all(
            memberTreeIds.map((tid) => getTreeRef(uid, tid).once("value"))
          );
          for (const snap of treeSnaps) {
            const tree = snap.val();
            // Real index entries, not the aggregate — see the global branch above.
            if (tree) currentNodeCount += Object.keys(tree.index || {}).length;
          }
        }

        const isStale = currentNodeCount !== (forest.summaryNodeCount || 0);

        return withResponseSize({
          content: [{ type: "text", text: JSON.stringify({
            summary: forest.summary,
            generatedAt: forest.summaryGeneratedAt,
            summaryNodeCount: forest.summaryNodeCount || 0,
            currentNodeCount,
            stale: isStale,
            ...(isStale ? { reason: `Node count changed: ${forest.summaryNodeCount || 0} → ${currentNodeCount}. Run generate_summary to refresh.` } : {}),
          }, null, 2) }],
        });
      }

      return withResponseSize({ content: [{ type: "text", text: `Unknown action: ${action}` }], isError: true });
    }
  );
}
