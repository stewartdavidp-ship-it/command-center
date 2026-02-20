import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDocumentsRef, getDocumentRef, getConfigRef } from "../firebase.js";
import { getCurrentUid } from "../context.js";
import { isGitHubConfigured, resolveTargetPath, deliverToGitHub } from "../github.js";

// ─── Lifespan / TTL ───────────────────────────────────────────────
// Documents have a lifespan that determines cleanup behavior:
//   ephemeral  — delete from Firebase immediately after delivery/ack
//   short      — 7 day TTL (lazy-delete at list time)
//   standard   — 30 day TTL (lazy-delete at list time)
//   permanent  — no auto-delete
type Lifespan = "ephemeral" | "short" | "standard" | "permanent";

const LIFESPAN_DEFAULTS: Record<string, Lifespan> = {
  "message":       "ephemeral",
  "spec":          "short",
  "architecture":  "short",
  "test-plan":     "short",
  "design":        "short",
  "claude-md":     "permanent",
};

const TTL_MS: Record<string, number> = {
  "short":    7 * 24 * 60 * 60 * 1000,   // 7 days
  "standard": 30 * 24 * 60 * 60 * 1000,  // 30 days
};

function getDefaultLifespan(docType: string): Lifespan {
  return LIFESPAN_DEFAULTS[docType] || "standard";
}

function isExpired(doc: any): boolean {
  if (!doc.lifespan || doc.lifespan === "permanent" || doc.lifespan === "ephemeral") return false;
  const ttl = TTL_MS[doc.lifespan];
  if (!ttl) return false;
  const created = new Date(doc.createdAt).getTime();
  return Date.now() - created > ttl;
}

export function registerDocumentTools(server: McpServer): void {

  // document — Document queue tool (hold and forward) + messaging
  server.tool(
    "document",
    `Document queue tool. Firebase is hold-and-forward — documents land with metadata and routing info, consumers pick them up and write to local paths. Also supports inter-agent messaging.

Lifecycle: Documents have a lifespan (ephemeral|short|standard|permanent). Ephemeral docs are deleted after delivery/ack. Short (7d) and standard (30d) docs are lazy-deleted at list time. Messages default to ephemeral. Specs default to short. CLAUDE.md defaults to permanent.

Actions:
  - "push": Queue a document. Requires: type, appId, content, targetPath. Optional: metadata (JSON string), createdBy, lifespan, autoDeliver.
  - "list": List documents. Optional filters: appId, type, status (default: "pending"). Expired TTL docs are auto-purged. Returns newest first.
  - "get": Get a document by ID. Requires: docId.
  - "deliver": Mark delivered and delete ephemeral docs from Firebase. Requires: docId. Optional: deliveredBy.
  - "deliver-to-github": Commit to GitHub repo, then delete from Firebase on success. Requires: docId.
  - "fail": Mark as failed. Requires: docId, reason.
  - "send": Send a message (ephemeral by default). Requires: content. Optional: to, metadata.
  - "receive": Check for new messages. Optional: to (default: "claude-code").
  - "ack": Acknowledge and delete message from Firebase. Requires: docId.
  - "purge": Delete all delivered/failed docs older than 24h. Returns count deleted.
  - "delete": Delete a document by ID. Requires: docId. Use for test cleanup only.`,
    {
      action: z.enum(["push", "list", "get", "deliver", "deliver-to-github", "fail", "send", "receive", "ack", "purge", "delete"]).describe("Action to perform"),
      docId: z.string().optional().describe("Document ID (required for get/deliver/fail/ack)"),
      type: z.string().optional().describe("Document type: claude-md, spec, architecture, test-plan, design, or custom (required for push, optional filter for list)"),
      appId: z.string().optional().describe("App ID (required for push, optional filter for list)"),
      content: z.string().optional().describe("Document body (required for push/send)"),
      targetPath: z.string().optional().describe("Where to write in repo: 'CLAUDE.md', 'specs/feature-x.md', etc. (required for push)"),
      metadata: z.string().optional().describe("JSON string of type-specific metadata (optional for push/send)"),
      status: z.string().optional().describe("Filter for list: pending, delivered, failed, all (default: pending)"),
      createdBy: z.string().optional().describe("Who created: claude-chat, claude-code, user (default: claude-chat)"),
      deliveredBy: z.string().optional().describe("Who consumed: claude-code, user (default: claude-code)"),
      reason: z.string().optional().describe("Failure reason (required for fail)"),
      to: z.string().optional().describe("Message recipient: claude-chat, claude-code (for send/receive)"),
      autoDeliver: z.boolean().optional().describe("For 'push': if true, auto-deliver to GitHub (default: false)"),
      lifespan: z.enum(["ephemeral", "short", "standard", "permanent"]).optional().describe("Document lifespan. Defaults: messages=ephemeral, specs=short (7d), claude-md=permanent, other=standard (30d)."),
      limit: z.number().int().optional().describe("Max results to return for list action (default: 20)"),
      offset: z.number().int().optional().describe("Number of items to skip for pagination (default: 0)"),
    },
    async ({ action, docId, type, appId, content, targetPath, metadata, status, createdBy, deliveredBy, reason, to, autoDeliver, lifespan, limit, offset }) => {
      const uid = getCurrentUid();

      // ─── PUSH ───
      if (action === "push") {
        if (!type) return { content: [{ type: "text", text: "action 'push' requires type" }], isError: true };
        if (!appId) return { content: [{ type: "text", text: "action 'push' requires appId" }], isError: true };
        if (!content) return { content: [{ type: "text", text: "action 'push' requires content" }], isError: true };
        if (!targetPath) return { content: [{ type: "text", text: "action 'push' requires targetPath" }], isError: true };

        let parsedMetadata: Record<string, any> = {};
        if (metadata) {
          try {
            parsedMetadata = JSON.parse(metadata);
          } catch {
            return { content: [{ type: "text", text: "metadata must be a valid JSON string" }], isError: true };
          }
        }

        const effectiveLifespan = lifespan || getDefaultLifespan(type);
        const ref = getDocumentsRef(uid).push();
        const now = new Date().toISOString();
        const doc = {
          id: ref.key,
          type,
          appId,
          content,
          metadata: parsedMetadata,
          routing: {
            targetPath,
            action: "write",
          },
          lifespan: effectiveLifespan,
          status: "pending",
          createdAt: now,
          createdBy: createdBy || "claude-chat",
          deliveredAt: null,
          deliveredBy: null,
        };
        await ref.set(doc);

        // Auto-deliver to GitHub if requested
        if (autoDeliver && isGitHubConfigured()) {
          try {
            const configSnap = await getConfigRef(uid).once("value");
            const config = configSnap.val();
            const appConfig = config?.apps?.[appId];

            if (appConfig?.repos?.prod) {
              const resolvedPath = resolveTargetPath(type!, targetPath!, appConfig.subPath || null);
              const commitMsg = `docs(${appConfig.name || appId}): update ${type} via CC MCP [${new Date().toISOString()}]`;
              const result = await deliverToGitHub(appConfig.repos.prod, resolvedPath, content!, commitMsg);

              const deliveredNow = new Date().toISOString();

              // Ephemeral: delete from Firebase after successful delivery
              if (effectiveLifespan === "ephemeral") {
                await ref.remove();
              } else {
                await ref.update({
                  status: "delivered",
                  deliveredAt: deliveredNow,
                  deliveredBy: "mcp-github",
                  "metadata/githubCommit": { sha: result.commitSha, url: result.htmlUrl, path: result.path },
                });
              }

              return { content: [{ type: "text", text: JSON.stringify({
                ...doc,
                status: "delivered",
                deliveredAt: deliveredNow,
                deliveredBy: "mcp-github",
                metadata: { ...doc.metadata, githubCommit: { sha: result.commitSha, url: result.htmlUrl, path: result.path } },
                _deleted: effectiveLifespan === "ephemeral" ? true : undefined,
              }, null, 2) }] };
            }
          } catch (err: any) {
            const failedNow = new Date().toISOString();
            await ref.update({
              status: "failed",
              deliveredAt: failedNow,
              deliveredBy: "mcp-github",
              failureReason: err.message,
            });
            return { content: [{ type: "text", text: JSON.stringify({
              ...doc,
              status: "failed",
              deliveredAt: failedNow,
              failureReason: err.message,
              _note: "Auto-delivery to GitHub failed. Document is in queue for manual retry.",
            }, null, 2) }] };
          }
        }

        return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] };
      }

      // ─── LIST ───
      if (action === "list") {
        // v8.71.4: Use server-side query when filtering by status (default: pending)
        // This avoids downloading the entire collection — a major bandwidth cost driver.
        const statusFilter = status || "pending";
        const ref = getDocumentsRef(uid);
        const query = statusFilter !== "all"
          ? ref.orderByChild("status").equalTo(statusFilter)
          : ref;
        const snapshot = await query.once("value");
        const data = snapshot.val();
        if (!data) return { content: [{ type: "text", text: JSON.stringify([], null, 2) }] };

        let docs: any[] = Object.values(data);

        // Lazy-delete: find and remove expired TTL documents
        const expiredIds: string[] = [];
        docs = docs.filter((d) => {
          if (isExpired(d)) {
            expiredIds.push(d.id);
            return false;
          }
          return true;
        });
        // Delete expired docs from Firebase in background (don't await)
        for (const expId of expiredIds) {
          getDocumentRef(uid, expId).remove().catch(() => {});
        }

        if (appId) docs = docs.filter((d) => d.appId === appId);
        if (type) docs = docs.filter((d) => d.type === type);
        // Status already filtered server-side via Firebase query above

        // Newest first
        docs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        const total = docs.length;
        const skip = offset && offset > 0 ? offset : 0;
        const take = limit && limit > 0 ? limit : 20;
        docs = docs.slice(skip, skip + take);

        // Lean response: summary fields only. Use get for full record.
        const lean = docs.map((d) => ({
          id: d.id,
          type: d.type,
          appId: d.appId,
          status: d.status,
          targetPath: d.routing?.targetPath || d.targetPath || null,
          createdBy: d.createdBy,
          lifespan: d.lifespan,
          to: d.to,
          from: d.from,
          createdAt: d.createdAt,
          deliveredAt: d.deliveredAt,
        }));

        const result: any = { items: lean, total, offset: skip, limit: take };
        if (expiredIds.length > 0) result._purged = expiredIds.length;
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      // ─── GET ───
      if (action === "get") {
        if (!docId) return { content: [{ type: "text", text: "action 'get' requires docId" }], isError: true };

        const ref = getDocumentRef(uid, docId);
        const snapshot = await ref.once("value");
        const doc = snapshot.val();

        if (!doc) return { content: [{ type: "text", text: `Document not found: ${docId}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] };
      }

      // ─── DELIVER ───
      if (action === "deliver") {
        if (!docId) return { content: [{ type: "text", text: "action 'deliver' requires docId" }], isError: true };

        const ref = getDocumentRef(uid, docId);
        const snapshot = await ref.once("value");
        const doc = snapshot.val();

        if (!doc) return { content: [{ type: "text", text: `Document not found: ${docId}` }], isError: true };
        if (doc.status !== "pending") {
          return { content: [{ type: "text", text: `Cannot deliver document with status '${doc.status}' (must be pending)` }], isError: true };
        }

        const now = new Date().toISOString();
        const effectiveLifespan = doc.lifespan || getDefaultLifespan(doc.type || "");

        // Ephemeral: delete from Firebase after delivery
        if (effectiveLifespan === "ephemeral") {
          await ref.remove();
          return { content: [{ type: "text", text: JSON.stringify({ ...doc, status: "delivered", deliveredAt: now, deliveredBy: deliveredBy || "claude-code", _deleted: true }, null, 2) }] };
        }

        await ref.update({
          status: "delivered",
          deliveredAt: now,
          deliveredBy: deliveredBy || "claude-code",
        });

        return { content: [{ type: "text", text: JSON.stringify({ ...doc, status: "delivered", deliveredAt: now, deliveredBy: deliveredBy || "claude-code" }, null, 2) }] };
      }

      // ─── FAIL ───
      if (action === "fail") {
        if (!docId) return { content: [{ type: "text", text: "action 'fail' requires docId" }], isError: true };
        if (!reason) return { content: [{ type: "text", text: "action 'fail' requires reason" }], isError: true };

        const ref = getDocumentRef(uid, docId);
        const snapshot = await ref.once("value");
        const doc = snapshot.val();

        if (!doc) return { content: [{ type: "text", text: `Document not found: ${docId}` }], isError: true };
        if (doc.status !== "pending") {
          return { content: [{ type: "text", text: `Cannot fail document with status '${doc.status}' (must be pending)` }], isError: true };
        }

        const now = new Date().toISOString();
        await ref.update({
          status: "failed",
          deliveredAt: now,
          deliveredBy: deliveredBy || "claude-code",
          failureReason: reason,
        });

        return { content: [{ type: "text", text: JSON.stringify({ ...doc, status: "failed", deliveredAt: now, failureReason: reason }, null, 2) }] };
      }

      // ─── DELIVER TO GITHUB ───
      if (action === "deliver-to-github") {
        if (!docId) return { content: [{ type: "text", text: "action 'deliver-to-github' requires docId" }], isError: true };

        if (!isGitHubConfigured()) {
          return { content: [{ type: "text", text: "GitHub delivery not configured. Set GITHUB_TOKEN environment variable." }], isError: true };
        }

        const ref = getDocumentRef(uid, docId);
        const snapshot = await ref.once("value");
        const doc = snapshot.val();

        if (!doc) return { content: [{ type: "text", text: `Document not found: ${docId}` }], isError: true };
        if (doc.status !== "pending") {
          return { content: [{ type: "text", text: `Cannot deliver document with status '${doc.status}' (must be pending)` }], isError: true };
        }

        // Look up app config for repo info
        const configSnap = await getConfigRef(uid).once("value");
        const config = configSnap.val();
        const appConfig = config?.apps?.[doc.appId];

        if (!appConfig) {
          return { content: [{ type: "text", text: `App not found in config: ${doc.appId}` }], isError: true };
        }
        if (!appConfig.repos?.prod) {
          return { content: [{ type: "text", text: `No repos.prod configured for app: ${doc.appId}. Set it via app(update) with repos parameter.` }], isError: true };
        }

        const resolvedPath = resolveTargetPath(doc.type, doc.routing?.targetPath || "CLAUDE.md", appConfig.subPath || null);
        const commitMsg = `docs(${appConfig.name || doc.appId}): update ${doc.type} via CC MCP [${new Date().toISOString()}]`;

        try {
          const result = await deliverToGitHub(appConfig.repos.prod, resolvedPath, doc.content, commitMsg);
          const now = new Date().toISOString();

          // Delete from Firebase after successful GitHub delivery (per RULE)
          await ref.remove();

          return { content: [{ type: "text", text: JSON.stringify({
            status: "delivered",
            repo: appConfig.repos.prod,
            path: result.path,
            commitSha: result.commitSha,
            htmlUrl: result.htmlUrl,
            _deleted: true,
          }, null, 2) }] };
        } catch (err: any) {
          const now = new Date().toISOString();
          await ref.update({
            status: "failed",
            deliveredAt: now,
            deliveredBy: "mcp-github",
            failureReason: err.message,
          });
          return { content: [{ type: "text", text: `GitHub delivery failed: ${err.message}` }], isError: true };
        }
      }

      // ─── SEND (Message) ───
      if (action === "send") {
        if (!content) return { content: [{ type: "text", text: "action 'send' requires content" }], isError: true };

        const recipient = to || "claude-code";
        // Infer sender: if sending to claude-code, sender is claude-chat (and vice versa)
        const sender = createdBy || (recipient === "claude-code" ? "claude-chat" : "claude-code");

        let parsedMetadata: Record<string, any> = {};
        if (metadata) {
          try {
            parsedMetadata = JSON.parse(metadata);
          } catch {
            return { content: [{ type: "text", text: "metadata must be a valid JSON string" }], isError: true };
          }
        }

        const effectiveLifespan = lifespan || "ephemeral";
        const ref = getDocumentsRef(uid).push();
        const now = new Date().toISOString();
        const msg = {
          id: ref.key,
          type: "message",
          appId: appId || null,
          content,
          metadata: {
            ...parsedMetadata,
            from: sender,
            to: recipient,
          },
          routing: {
            targetPath: null,
            action: "message",
          },
          lifespan: effectiveLifespan,
          status: "pending",
          createdAt: now,
          createdBy: sender,
          deliveredAt: null,
          deliveredBy: null,
        };
        await ref.set(msg);
        return { content: [{ type: "text", text: JSON.stringify(msg, null, 2) }] };
      }

      // ─── RECEIVE (Messages) ───
      if (action === "receive") {
        const recipient = to || "claude-code";

        // v8.71.4: Server-side filter on status=pending to avoid downloading entire collection.
        // Was the #1 Firebase cost driver when polled frequently (~1MB per read).
        const snapshot = await getDocumentsRef(uid)
          .orderByChild("status")
          .equalTo("pending")
          .once("value");
        const data = snapshot.val();
        if (!data) return { content: [{ type: "text", text: JSON.stringify([], null, 2) }] };

        let msgs: any[] = Object.values(data);
        msgs = msgs.filter((d) =>
          d.type === "message" &&
          d.metadata?.to === recipient
        );

        // Oldest first (chronological order for reading)
        msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        return { content: [{ type: "text", text: JSON.stringify(msgs, null, 2) }] };
      }

      // ─── ACK (Acknowledge Message) ───
      if (action === "ack") {
        if (!docId) return { content: [{ type: "text", text: "action 'ack' requires docId" }], isError: true };

        const ref = getDocumentRef(uid, docId);
        const snapshot = await ref.once("value");
        const doc = snapshot.val();

        if (!doc) return { content: [{ type: "text", text: `Message not found: ${docId}` }], isError: true };
        if (doc.type !== "message") return { content: [{ type: "text", text: `Document ${docId} is not a message (type: ${doc.type})` }], isError: true };
        if (doc.status !== "pending") return { content: [{ type: "text", text: `Message already acknowledged (status: ${doc.status})` }], isError: true };

        const now = new Date().toISOString();
        const ackResult = { ...doc, status: "delivered", deliveredAt: now, deliveredBy: doc.metadata?.to || "unknown" };

        // Messages are ephemeral by default — delete from Firebase after ack (per RULE)
        const effectiveLifespan = doc.lifespan || "ephemeral";
        if (effectiveLifespan === "ephemeral") {
          await ref.remove();
          return { content: [{ type: "text", text: JSON.stringify({ ...ackResult, _deleted: true }, null, 2) }] };
        }

        await ref.update({
          status: "delivered",
          deliveredAt: now,
          deliveredBy: doc.metadata?.to || "unknown",
        });

        return { content: [{ type: "text", text: JSON.stringify(ackResult, null, 2) }] };
      }

      // ─── PURGE ───
      if (action === "purge") {
        const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
        let purged = 0;

        // v8.71.4: Query delivered and failed separately to avoid full collection read
        for (const purgeStatus of ["delivered", "failed"]) {
          const snapshot = await getDocumentsRef(uid)
            .orderByChild("status")
            .equalTo(purgeStatus)
            .once("value");
          const data = snapshot.val();
          if (!data) continue;

          for (const d of Object.values(data) as any[]) {
            if (d.createdAt && new Date(d.createdAt).getTime() < cutoff && d.id) {
              await getDocumentRef(uid, d.id).remove();
              purged++;
            }
          }
        }

        return { content: [{ type: "text", text: JSON.stringify({ purged, cutoff: new Date(cutoff).toISOString() }, null, 2) }] };
      }

      // ─── DELETE ───
      if (action === "delete") {
        if (!docId) return { content: [{ type: "text", text: "action 'delete' requires docId" }], isError: true };

        const ref = getDocumentRef(uid, docId);
        const snapshot = await ref.once("value");
        if (!snapshot.val()) return { content: [{ type: "text", text: `Document not found: ${docId}` }], isError: true };

        await ref.remove();
        return { content: [{ type: "text", text: JSON.stringify({ deleted: docId }) }] };
      }

      return { content: [{ type: "text", text: `Unknown action: ${action}` }], isError: true };
    }
  );
}
