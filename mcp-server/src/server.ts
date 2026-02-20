import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getConceptsRef, getIdeasRef, getAppIdeasRef } from "./firebase.js";
import { getCurrentUid } from "./context.js";
import { registerConceptTools } from "./tools/concepts.js";
import { registerIdeaTools } from "./tools/ideas.js";
import { registerGenerateTools } from "./tools/generate.js";
import { registerSessionTools } from "./tools/sessions.js";
import { registerAppTools } from "./tools/apps.js";
import { registerJobTools } from "./tools/jobs.js";
import { registerDocumentTools } from "./tools/documents.js";
import { registerSkillTools } from "./tools/skills.js";
import { registerRepoTools } from "./tools/repo.js";
import { registerSkillPrompts } from "./skills.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "cc-mcp-server",
    version: "1.0.0",
  });

  // Register all tools
  registerConceptTools(server);
  registerIdeaTools(server);
  registerGenerateTools(server);
  registerSessionTools(server);
  registerAppTools(server);
  registerJobTools(server);
  registerDocumentTools(server);
  registerSkillTools(server);
  registerRepoTools(server);

  // Register resources
  registerResources(server);

  // Register prompts (workflow entry points)
  registerPrompts(server);

  // Register CC skills as prompts
  registerSkillPrompts(server);

  return server;
}

function registerResources(server: McpServer): void {

  // Active ODRC state for an app
  server.resource(
    "app-odrc-state",
    new ResourceTemplate("cc://apps/{appId}/state", { list: undefined }),
    async (uri, { appId }) => {
      const uid = getCurrentUid();
      const appIdeasSnap = await getAppIdeasRef(uid, appId as string).once("value");
      const ideaIds: string[] = appIdeasSnap.val() || [];

      const conceptsSnap = await getConceptsRef(uid).once("value");
      const conceptsData = conceptsSnap.val() || {};
      const allConcepts: any[] = Object.values(conceptsData);

      const active = allConcepts.filter(
        (c) => ideaIds.includes(c.ideaOrigin) && c.status === "active"
      );

      const grouped = {
        rules: active.filter((c) => c.type === "RULE"),
        constraints: active.filter((c) => c.type === "CONSTRAINT"),
        decisions: active.filter((c) => c.type === "DECISION"),
        opens: active.filter((c) => c.type === "OPEN"),
        totalActive: active.length,
      };

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(grouped, null, 2),
          },
        ],
      };
    }
  );
}

function registerPrompts(server: McpServer): void {
  // start-ideation-session prompt
  server.prompt(
    "start-ideation-session",
    "Start an ideation session for an app. Loads current ODRC state and session protocol.",
    {
      appId: z.string().describe("The app ID to ideate on"),
      appName: z.string().describe("Human-readable app name"),
      focusArea: z.string().optional().describe("Specific area to focus the session on"),
    },
    async ({ appId, appName, focusArea }) => {
      const uid = getCurrentUid();

      // Load current state
      const appIdeasSnap = await getAppIdeasRef(uid, appId).once("value");
      const ideaIds: string[] = appIdeasSnap.val() || [];

      const conceptsSnap = await getConceptsRef(uid).once("value");
      const conceptsData = conceptsSnap.val() || {};
      const allConcepts: any[] = Object.values(conceptsData);

      const active = allConcepts.filter(
        (c) => ideaIds.includes(c.ideaOrigin) && c.status === "active"
      );

      const ideasSnap = await getIdeasRef(uid).once("value");
      const ideasData = ideasSnap.val() || {};
      const appIdeas: any[] = Object.values(ideasData)
        .filter((i: any) => i.appId === appId)
        .sort((a: any, b: any) => (a.sequence || 0) - (b.sequence || 0));

      const activeIdea = appIdeas.filter((i) => i.status === "active").pop();
      const allOpens = active.filter((c) => c.type === "OPEN");

      const stateContext = {
        app: appName,
        activeIdea: activeIdea ? { name: activeIdea.name, description: activeIdea.description } : null,
        ideaHistory: appIdeas.map((i) => ({ name: i.name, status: i.status, sequence: i.sequence })),
        activeConcepts: {
          rules: active.filter((c) => c.type === "RULE").length,
          constraints: active.filter((c) => c.type === "CONSTRAINT").length,
          decisions: active.filter((c) => c.type === "DECISION").length,
          opens: active.filter((c) => c.type === "OPEN").length,
        },
        opens: allOpens.slice(0, 10).map((c) => {
          const text = c.content || "";
          return text.length > 120 ? text.substring(0, 120) + "..." : text;
        }),
        opensTotal: allOpens.length,
      };

      const opensNote = allOpens.length > 10
        ? `\n*(Showing 10 of ${allOpens.length} OPENs. Use get_active_concepts for full list.)*`
        : "";

      const prompt = `You are starting a live ideation session for **${appName}**.

## Current State
${JSON.stringify(stateContext, null, 2)}

## Session Protocol — IMPORTANT: Follow these steps

### 1. Start the session
Call \`session\` with action="start", ideaId="${activeIdea?.id || ""}", appId="${appId}", and a brief title describing the session focus. Save the returned sessionId — you'll pass it to every concept tool call.

### 2. During the session
- Use the ODRC framework: every insight should be captured as an OPEN, DECISION, RULE, or CONSTRAINT
- Create concepts immediately using \`concept\` with action="create" and the \`sessionId\` parameter — this automatically tracks everything in the session record
- OPENs are questions/unknowns. DECISIONs are chosen directions. RULEs are invariants. CONSTRAINTs are external realities.
- State machine: OPEN→DECISION/RULE/CONSTRAINT, DECISION→RULE, CONSTRAINT→DECISION/RULE, RULE→OPEN
- All data persists in Firebase in real-time — no need to produce documents or artifacts

### 3. Tangent handling (Idea Affinity)
When you identify a concept that doesn't fit the current idea's scope:
- Ask the user: "This seems outside the current idea. Should I assign it to: (a) current idea, (b) an existing idea, or (c) create a new idea?"
- If they choose (c), call \`idea\` with action="create" first, then create the concept linked to the new idea
- Log the tangent with \`session\` action="add_event" (eventType: "tangent_captured")

### 4. End the session
Call \`session\` with action="complete", the sessionId, and a summary of what was accomplished.
${focusArea ? `\n## Focus Area\n${focusArea}` : ""}
${stateContext.opens.length > 0 ? `\n## Unresolved OPENs to consider\n${stateContext.opens.map((o: string) => `- ${o}`).join("\n")}${opensNote}` : ""}

Begin by calling \`session\` with action="start", then review the current state and identify what to explore.`;

      return {
        messages: [{ role: "user", content: { type: "text", text: prompt } }],
      };
    }
  );

  // generate-claude-md prompt
  server.prompt(
    "generate-claude-md",
    "Generate a CLAUDE.md for an app and push it to the document queue for Claude Code delivery.",
    {
      appId: z.string().describe("The app ID"),
      appName: z.string().describe("Human-readable app name"),
    },
    async ({ appId, appName }) => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Use the generate_claude_md tool with action="push", appId="${appId}", and appName="${appName}" to generate the CLAUDE.md document and queue it for delivery to Claude Code. Show me the generated spec and confirm it was queued.`,
            },
          },
        ],
      };
    }
  );
}
