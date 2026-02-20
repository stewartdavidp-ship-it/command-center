import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getConfigRef } from "../firebase.js";
import { getCurrentUid } from "../context.js";

// Summarize an app config into the fields useful for chat-first discovery
function summarizeApp(id: string, app: any, project?: any): any {
  return {
    id,
    name: app.name || id,
    icon: app.icon || null,
    project: app.project || null,
    projectName: project?.name || app.project || null,
    description: app.description || app.lifecycle?.problemStatement || null,
    appType: app.appType || null,
    repos: app.repos || {},
    versions: app.versions || {},
    lifecycle: app.lifecycle
      ? {
          currentMaturity: app.lifecycle.currentMaturity || app.lifecycle.maturity || null,
          maturityTarget: app.lifecycle.maturityTarget || null,
          problemStatement: app.lifecycle.problemStatement || null,
          targetAudience: app.lifecycle.targetAudience || null,
          userGoal: app.lifecycle.userGoal || null,
          successMetric: app.lifecycle.successMetric || null,
          category: app.lifecycle.category || null,
        }
      : null,
    targetPath: app.targetPath || "index.html",
    subPath: app.subPath || null,
  };
}

export function registerAppTools(server: McpServer): void {
  // app — Consolidated app discovery tool (list or get)
  server.tool(
    "app",
    `App discovery and management tool. Actions:
  - "list": List all apps with name, icon, project, description, repos, versions, lifecycle. No extra params needed.
  - "get": Get detailed info about a specific app. Requires appId (exact ID or partial name for fuzzy match).
  - "create": Create a new app. Requires appId and name. Optional: icon, project, projectName (creates project if new), description, appType, repos (JSON string), subPath, targetPath, lifecycleFields (JSON string).
  - "update": Update app metadata. Requires appId. Optional: description, appType, repos (JSON string e.g. {"prod":"owner/repo","test":"owner/testrepo"}), subPath (string), lifecycleFields (JSON string with currentMaturity, maturityTarget, problemStatement, targetAudience, userGoal, successMetric, category).`,
    {
      action: z.enum(["list", "get", "create", "update"]).describe("Action: list (all apps), get (specific app), create (new app), or update (modify app metadata)"),
      appId: z.string().optional().describe("For 'get'/'create'/'update': the app ID (e.g. 'floorplan') or partial name for get"),
      name: z.string().optional().describe("For 'create': display name of the app"),
      icon: z.string().optional().describe("For 'create': emoji icon for the app"),
      project: z.string().optional().describe("For 'create': project ID to group under (e.g. 'basement')"),
      projectName: z.string().optional().describe("For 'create': display name for a new project (creates it if it doesn't exist)"),
      description: z.string().optional().describe("For 'create'/'update': app description"),
      appType: z.string().optional().describe("For 'create'/'update': app type (public/internal/other)"),
      repos: z.string().optional().describe("For 'create'/'update': JSON string of repos (e.g. {\"prod\":\"owner/repo\"})"),
      subPath: z.string().optional().describe("For 'create'/'update': subPath within the repo"),
      targetPath: z.string().optional().describe("For 'create': target file path (default: 'index.html')"),
      lifecycleFields: z.string().optional().describe("For 'create'/'update': JSON string of lifecycle fields (currentMaturity, maturityTarget, problemStatement, targetAudience, userGoal, successMetric, category)"),
    },
    async ({ action, appId, name: appName, icon, project, projectName, description, appType, repos, subPath, targetPath, lifecycleFields }) => {
      const uid = getCurrentUid();
      const snapshot = await getConfigRef(uid).once("value");
      const config = snapshot.val();

      if (action === "list") {
        if (!config || !config.apps) {
          return {
            content: [{ type: "text", text: JSON.stringify({ apps: [], projects: [] }, null, 2) }],
          };
        }

        const projects = config.projects || {};
        const apps = Object.entries(config.apps).map(([id, app]: [string, any]) => {
          const project = app.project ? projects[app.project] : null;
          return summarizeApp(id, app, project);
        });

        const projectList = Object.entries(projects).map(([id, p]: [string, any]) => ({
          id,
          name: p.name || id,
          appCount: apps.filter((a) => a.project === id).length,
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ apps, projects: projectList }, null, 2),
            },
          ],
        };
      }

      // ─── CREATE ───
      if (action === "create") {
        if (!appId) {
          return { content: [{ type: "text", text: "action 'create' requires appId" }], isError: true };
        }
        if (!appName) {
          return { content: [{ type: "text", text: "action 'create' requires name" }], isError: true };
        }
        if (config?.apps?.[appId]) {
          return { content: [{ type: "text", text: `App already exists: ${appId}. Use action 'update' to modify it.` }], isError: true };
        }

        // Build the new app object
        const newApp: Record<string, any> = {
          name: appName,
          icon: icon || "🚀",
          project: project || "other",
          appType: appType || "public",
          targetPath: targetPath || "index.html",
          subPath: subPath || null,
          repos: {},
          versions: {},
          lifecycle: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        if (description) newApp.description = description;

        // Parse repos
        if (repos) {
          try {
            newApp.repos = JSON.parse(repos);
          } catch {
            return { content: [{ type: "text", text: "repos must be a valid JSON string" }], isError: true };
          }
        }

        // Parse lifecycle
        if (lifecycleFields) {
          try {
            const parsed = JSON.parse(lifecycleFields);
            const allowedKeys = [
              "currentMaturity", "maturityTarget", "problemStatement",
              "targetAudience", "userGoal", "successMetric", "category",
            ];
            for (const key of allowedKeys) {
              if (parsed[key] !== undefined) {
                newApp.lifecycle[key] = parsed[key];
              }
            }
          } catch {
            return { content: [{ type: "text", text: "lifecycleFields must be a valid JSON string" }], isError: true };
          }
        }

        // Create the app
        await getConfigRef(uid).child("apps").child(appId).set(newApp);

        // Create the project if it doesn't exist
        const projectId = project || "other";
        const projects = config?.projects || {};
        if (!projects[projectId] && projectId !== "other") {
          await getConfigRef(uid).child("projects").child(projectId).set({
            name: projectName || projectId,
            createdAt: Date.now(),
          });
        }

        // Read back and return
        const createdSnap = await getConfigRef(uid).child("apps").child(appId).once("value");
        const createdApp = createdSnap.val();
        const allProjects = { ...projects };
        if (!allProjects[projectId] && projectName) {
          allProjects[projectId] = { name: projectName };
        }
        const proj = allProjects[projectId] || null;

        return {
          content: [{ type: "text", text: JSON.stringify({ created: true, app: summarizeApp(appId, createdApp, proj) }, null, 2) }],
        };
      }

      // ─── UPDATE ───
      if (action === "update") {
        if (!appId) {
          return { content: [{ type: "text", text: "action 'update' requires appId" }], isError: true };
        }
        if (!config || !config.apps || !config.apps[appId]) {
          return { content: [{ type: "text", text: `App not found: ${appId}. Use exact app ID for updates.` }], isError: true };
        }

        const updates: Record<string, any> = { updatedAt: Date.now() };

        if (description !== undefined) updates.description = description;
        if (appType !== undefined) updates.appType = appType;
        if (subPath !== undefined) updates.subPath = subPath;

        // Merge repos without clobbering existing ones
        if (repos !== undefined) {
          let parsedRepos: Record<string, any>;
          try {
            parsedRepos = JSON.parse(repos);
          } catch {
            return { content: [{ type: "text", text: "repos must be a valid JSON string" }], isError: true };
          }
          const existingRepos = config.apps[appId].repos || {};
          updates.repos = { ...existingRepos, ...parsedRepos };
        }

        // Merge lifecycle fields without clobbering existing ones
        if (lifecycleFields !== undefined) {
          let parsed: Record<string, any>;
          try {
            parsed = JSON.parse(lifecycleFields);
          } catch {
            return { content: [{ type: "text", text: "lifecycleFields must be a valid JSON string" }], isError: true };
          }

          const allowedLifecycleKeys = [
            "currentMaturity", "maturityTarget", "problemStatement",
            "targetAudience", "userGoal", "successMetric", "category",
          ];
          const existingLifecycle = config.apps[appId].lifecycle || {};
          const mergedLifecycle = { ...existingLifecycle };

          for (const key of allowedLifecycleKeys) {
            if (parsed[key] !== undefined) {
              mergedLifecycle[key] = parsed[key];
            }
          }
          updates.lifecycle = mergedLifecycle;
        }

        // Write to user's config
        const appRef = getConfigRef(uid).child("apps").child(appId);
        await appRef.update(updates);

        // Read back and return
        const updatedSnap = await appRef.once("value");
        const updatedApp = updatedSnap.val();
        const projects = config.projects || {};
        const project = updatedApp.project ? projects[updatedApp.project] : null;

        return {
          content: [{ type: "text", text: JSON.stringify(summarizeApp(appId, updatedApp, project), null, 2) }],
        };
      }

      // ─── GET ───
      if (!appId) {
        return { content: [{ type: "text", text: "action 'get' requires appId" }], isError: true };
      }

      if (!config || !config.apps) {
        return { content: [{ type: "text", text: "No apps found in config" }], isError: true };
      }

      const projects = config.projects || {};

      // Try exact ID match first
      if (config.apps[appId]) {
        const app = config.apps[appId];
        const project = app.project ? projects[app.project] : null;
        return {
          content: [{ type: "text", text: JSON.stringify(summarizeApp(appId, app, project), null, 2) }],
        };
      }

      // Fuzzy match: search by name (case-insensitive, partial)
      const searchLower = appId.toLowerCase();
      const matches = Object.entries(config.apps)
        .filter(([id, app]: [string, any]) => {
          const name = (app.name || id).toLowerCase();
          return id.toLowerCase().includes(searchLower) || name.includes(searchLower);
        })
        .map(([id, app]: [string, any]) => {
          const project = app.project ? projects[app.project] : null;
          return summarizeApp(id, app, project);
        });

      if (matches.length === 0) {
        return {
          content: [{ type: "text", text: `No app found matching "${appId}". Use app with action "list" to see all available apps.` }],
          isError: true,
        };
      }

      if (matches.length === 1) {
        return { content: [{ type: "text", text: JSON.stringify(matches[0], null, 2) }] };
      }

      // Multiple matches — return all and let the caller pick
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { message: `Found ${matches.length} apps matching "${appId}"`, matches },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
