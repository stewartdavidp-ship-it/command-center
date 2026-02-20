import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getConceptsRef, getIdeasRef, getAppIdeasRef, getClaudeMdRef, getDocumentsRef, getConfigRef } from "../firebase.js";
import { getCurrentUid } from "../context.js";
import { isGitHubConfigured, resolveTargetPath, deliverToGitHub } from "../github.js";

export function registerGenerateTools(server: McpServer): void {

  // generate_claude_md — Assemble CLAUDE.md from active ODRC state, persist to Firebase, or retrieve last stored version
  server.tool(
    "generate_claude_md",
    `CLAUDE.md generation, storage, and delivery tool. Actions:
  - "generate" (default): Generate a CLAUDE.md from active ODRC concepts, persist to Firebase, and return the markdown. Requires appId, appName. Optional: appDescription.
  - "push": Same as generate, but ALSO queues the document for delivery to Claude Code. Claude Code picks it up and writes it to the local repo. Requires appId, appName. Optional: appDescription.
  - "get": Retrieve the last stored CLAUDE.md for an app. Requires appId.`,
    {
      action: z.enum(["generate", "push", "get"]).optional().describe("Action: generate (default), push (generate + queue for Claude Code delivery), or get (retrieve stored)."),
      appId: z.string().describe("The app ID to generate/retrieve CLAUDE.md for"),
      appName: z.string().optional().describe("Human-readable app name (required for generate)"),
      appDescription: z.string().optional().describe("App description for the 'What This App Is' section (optional for generate)"),
    },
    async ({ action, appId, appName, appDescription }) => {
      const uid = getCurrentUid();
      const effectiveAction = action || "generate";
      const isPush = effectiveAction === "push";

      // ─── GET ───
      if (effectiveAction === "get") {
        const snap = await getClaudeMdRef(uid, appId).once("value");
        const data = snap.val();
        if (!data) {
          return {
            content: [{ type: "text", text: `No CLAUDE.md stored for app "${appId}". Use generate_claude_md to create one first.` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      // ─── GENERATE / PUSH ───
      if (!appName) {
        return { content: [{ type: "text", text: `action '${effectiveAction}' requires appName` }], isError: true };
      }

      // Get all idea IDs for this app
      const appIdeasSnap = await getAppIdeasRef(uid, appId).once("value");
      const ideaIds: string[] = appIdeasSnap.val() || [];

      if (ideaIds.length === 0) {
        return {
          content: [{ type: "text", text: `No ideas linked to app "${appId}". Create and link ideas first.` }],
          isError: true,
        };
      }

      // Get all ideas to find the latest active one
      const ideasSnap = await getIdeasRef(uid).once("value");
      const ideasData = ideasSnap.val() || {};
      const appIdeas: any[] = Object.values(ideasData)
        .filter((i: any) => i.appId === appId)
        .sort((a: any, b: any) => (a.sequence || 0) - (b.sequence || 0));

      const activeIdea = appIdeas.filter((i) => i.status === "active").pop();
      const latestIdea = activeIdea || appIdeas[appIdeas.length - 1];

      // Get all concepts
      const conceptsSnap = await getConceptsRef(uid).once("value");
      const conceptsData = conceptsSnap.val() || {};
      const allConcepts: any[] = Object.values(conceptsData);

      // Active concepts across all ideas for this app
      const appConcepts = allConcepts.filter(
        (c) => ideaIds.includes(c.ideaOrigin) && c.status === "active"
      );

      // Build idea name lookup for provenance
      const ideaNameMap: Record<string, string> = {};
      for (const idea of appIdeas) {
        ideaNameMap[idea.id] = idea.name;
      }

      // Group by type
      const rules = appConcepts.filter((c) => c.type === "RULE");
      const constraints = appConcepts.filter((c) => c.type === "CONSTRAINT");
      // DECISIONs: current idea only (per CLAUDE.md spec)
      const decisions = latestIdea
        ? appConcepts.filter((c) => c.type === "DECISION" && c.ideaOrigin === latestIdea.id)
        : [];
      const opens = appConcepts.filter((c) => c.type === "OPEN");

      // Assemble CLAUDE.md
      const lines: string[] = [];

      lines.push(`# CLAUDE.md — ${appName}`);
      lines.push("");

      lines.push("## What This App Is");
      lines.push(appDescription || "(No description provided)");
      lines.push("");

      if (latestIdea) {
        lines.push("## Current Build Objective");
        lines.push(`**${latestIdea.name}**`);
        lines.push("");
        lines.push(latestIdea.description || "");
        lines.push("");
      }

      lines.push("## RULEs — Do not violate these.");
      lines.push("");
      if (rules.length === 0) {
        lines.push("(No active RULEs)");
      } else {
        for (const r of rules) {
          const origin = ideaNameMap[r.ideaOrigin] || r.ideaOrigin;
          lines.push(`- ${r.content} _(from: ${origin})_`);
        }
      }
      lines.push("");

      lines.push("## CONSTRAINTs — External realities. Work within these.");
      lines.push("");
      if (constraints.length === 0) {
        lines.push("(No active CONSTRAINTs)");
      } else {
        for (const c of constraints) {
          const origin = ideaNameMap[c.ideaOrigin] || c.ideaOrigin;
          lines.push(`- ${c.content} _(from: ${origin})_`);
        }
      }
      lines.push("");

      lines.push("## DECISIONs — Current direction for this phase.");
      lines.push("");
      if (decisions.length === 0) {
        lines.push("(No active DECISIONs for current idea)");
      } else {
        for (const d of decisions) {
          lines.push(`- ${d.content}`);
        }
      }
      lines.push("");

      lines.push("## OPENs — Unresolved. Flag if you encounter these during build.");
      lines.push("");
      if (opens.length === 0) {
        lines.push("(No unresolved OPENs)");
      } else {
        for (const o of opens) {
          const origin = ideaNameMap[o.ideaOrigin] || o.ideaOrigin;
          lines.push(`- ${o.content} _(from: ${origin})_`);
        }
      }
      lines.push("");

      const markdown = lines.join("\n");

      // Persist to Firebase
      const record = {
        appId,
        appName,
        content: markdown,
        ideaId: latestIdea?.id || null,
        ideaName: latestIdea?.name || null,
        generatedAt: new Date().toISOString(),
        conceptCount: {
          rules: rules.length,
          constraints: constraints.length,
          decisions: decisions.length,
          opens: opens.length,
        },
      };
      await getClaudeMdRef(uid, appId).set(record);

      // If push, also queue for delivery to Claude Code
      if (isPush) {
        const docRef = getDocumentsRef(uid).push();
        const now = new Date().toISOString();
        const doc = {
          id: docRef.key,
          type: "claude-md",
          appId,
          content: markdown,
          metadata: {
            appName,
            ideaId: latestIdea?.id || null,
            ideaName: latestIdea?.name || null,
            conceptCount: {
              rules: rules.length,
              constraints: constraints.length,
              decisions: decisions.length,
              opens: opens.length,
            },
          },
          routing: {
            targetPath: "CLAUDE.md",
            action: "write",
          },
          lifespan: "permanent",
          status: "pending",
          createdAt: now,
          createdBy: "claude-chat",
          deliveredAt: null,
          deliveredBy: null,
        };
        await docRef.set(doc);

        // Attempt auto-delivery to GitHub
        let deliveryNote = `_Document queued for delivery (docId: ${docRef.key})._`;
        if (isGitHubConfigured()) {
          try {
            const configSnap = await getConfigRef(uid).once("value");
            const config = configSnap.val();
            const appConfig = config?.apps?.[appId];

            if (appConfig?.repos?.prod) {
              const targetPath = resolveTargetPath("claude-md", "CLAUDE.md", appConfig.subPath || null);
              const commitMsg = `docs(${appName}): update CLAUDE.md via CC MCP [${new Date().toISOString()}]`;
              const result = await deliverToGitHub(appConfig.repos.prod, targetPath, markdown, commitMsg);

              const deliveredNow = new Date().toISOString();
              // CLAUDE.md is permanent — keep record but mark delivered
              await docRef.update({
                status: "delivered",
                deliveredAt: deliveredNow,
                deliveredBy: "mcp-github",
                "metadata/githubCommit": { sha: result.commitSha, url: result.htmlUrl, path: result.path },
              });

              deliveryNote = `_Auto-delivered to GitHub: ${appConfig.repos.prod}/${result.path} (commit: ${result.commitSha.substring(0, 7)})._`;
            } else {
              deliveryNote += ` _No repos.prod configured for ${appId} — queued for manual delivery._`;
            }
          } catch (err: any) {
            const failedNow = new Date().toISOString();
            await docRef.update({
              status: "failed",
              deliveredAt: failedNow,
              deliveredBy: "mcp-github",
              failureReason: err.message,
            });
            deliveryNote += ` _GitHub delivery failed: ${err.message}. Queued for manual pickup._`;
          }
        } else {
          deliveryNote += ` _GitHub not configured — Claude Code will pick it up and write to CLAUDE.md._`;
        }

        return {
          content: [{ type: "text", text: `${markdown}\n\n---\n${deliveryNote}` }],
        };
      }

      return { content: [{ type: "text", text: markdown }] };
    }
  );
}
