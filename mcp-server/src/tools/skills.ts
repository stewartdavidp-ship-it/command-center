import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSkillContent, getSkillNames } from "../skills.js";

/**
 * Registers the `skill` tool — allows Claude Chat (or any MCP client)
 * to retrieve skill prompt content by name.
 *
 * This exists because Claude.ai Chat surfaces MCP tools but not MCP prompts.
 * The skill tool bridges the gap: call it with a skill name, get back the
 * full prompt content.
 */
export function registerSkillTools(server: McpServer): void {
  server.tool(
    "skill",
    "Retrieve a CC skill/protocol by name. Returns the full skill prompt content. Call with action='list' to see available skills, or action='get' with a skillName to retrieve one.",
    {
      action: z.enum(["list", "get"]).describe("'list' to see all skills, 'get' to retrieve a specific skill"),
      skillName: z.string().optional().describe("The skill name (e.g., 'cc-session-protocol'). Required for action='get'."),
    },
    async ({ action, skillName }) => {
      if (action === "list") {
        const skills = getSkillNames();
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              count: skills.length,
              skills: skills.map(s => ({ name: s.name, description: s.description })),
              usage: "Call skill with action='get' and skillName='<name>' to retrieve the full prompt content.",
            }, null, 2),
          }],
        };
      }

      // action === "get"
      if (!skillName) {
        return {
          content: [{ type: "text" as const, text: "Error: skillName is required for action='get'" }],
          isError: true,
        };
      }

      const content = getSkillContent(skillName);
      if (!content) {
        const available = getSkillNames().map(s => s.name).join(", ");
        return {
          content: [{ type: "text" as const, text: `Error: Unknown skill '${skillName}'. Available skills: ${available}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text" as const, text: content }],
      };
    }
  );
}
