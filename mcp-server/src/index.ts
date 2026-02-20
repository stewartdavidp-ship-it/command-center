import express, { Request, Response, NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { initFirebase } from "./firebase.js";
import { createServer } from "./server.js";
import { createOAuthRouter } from "./auth/oauth.js";
import { validateAccessToken, validateApiKey } from "./auth/store.js";
import { requestContext } from "./context.js";
import { incrementContextEstimate } from "./tools/sessions.js";

// Initialize Firebase before anything else
initFirebase();

const PORT = parseInt(process.env.PORT || "8080");

// SAFETY: Block SKIP_AUTH in production — prevents accidental auth bypass on Cloud Run
if (process.env.K_SERVICE && process.env.SKIP_AUTH === "true") {
  console.error("🛑 FATAL: SKIP_AUTH=true is set in a Cloud Run environment. This would bypass all authentication. Exiting.");
  process.exit(1);
}

// BASE_URL is REQUIRED for production — OAuth metadata endpoints use it.
// Cloud Run does not expose the service URL as an env var, so it must be set explicitly.
// Without it, OAuth endpoints return localhost URLs and Claude.ai cannot authenticate.
if (!process.env.BASE_URL && process.env.K_SERVICE) {
  console.error(
    "⚠️  CRITICAL: BASE_URL env var is not set! OAuth will not work.\n" +
    "   Claude.ai will see localhost URLs in OAuth metadata and cannot authenticate.\n" +
    "   Set BASE_URL to the Cloud Run service URL in your deploy command:\n" +
    "   --set-env-vars=\"BASE_URL=https://<service>-<project-number>.<region>.run.app\"\n" +
    "   See deploy.sh for the correct command."
  );
}

// Warn if FIREBASE_WEB_API_KEY is missing in production — Google Sign-In will silently fail
if (!process.env.FIREBASE_WEB_API_KEY && process.env.K_SERVICE) {
  console.error("⚠️  WARNING: FIREBASE_WEB_API_KEY env var is not set. Google Sign-In on the OAuth page will not work.");
}

const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Create MCP server
const mcpServer = createServer();

// Create Express app
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// CORS — allow Claude.ai origins
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    "https://claude.ai",
    "https://claude.com",
    "https://www.claude.ai",
    "https://www.claude.com",
  ];

  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }

  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Mcp-Session-Id"
  );
  res.header("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// Mount OAuth routes
const oauthRouter = createOAuthRouter(BASE_URL);
app.use(oauthRouter);

// Health check
app.get("/", (_req: Request, res: Response) => {
  res.json({
    name: "cc-mcp-server",
    version: "1.0.0",
    description: "Command Center MCP Server — ODRC concept management for Claude.ai",
    status: "ok",
  });
});

// Auth middleware — extracts Firebase UID from bearer token and stores in request
// Supports two token types:
//   1. CC API keys (cc_{uid}_{secret}) — persistent, stored in Firebase RTDB, for Claude Code
//   2. OAuth access tokens (UUID) — in-memory, for Claude.ai Chat
async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Dev mode: use FIREBASE_UID env var
  if (process.env.NODE_ENV === "development" || process.env.SKIP_AUTH === "true") {
    const uid = process.env.FIREBASE_UID;
    if (uid) {
      (req as any).firebaseUid = uid;
    }
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({
      error: "unauthorized",
      error_description: "Bearer token required",
    });
    return;
  }

  const token = authHeader.slice(7);

  // CC API key path — persistent keys stored in Firebase RTDB (survives cold starts)
  if (token.startsWith("cc_")) {
    try {
      const apiKeyResult = await validateApiKey(token);
      if (apiKeyResult) {
        (req as any).firebaseUid = apiKeyResult.uid;
        next();
        return;
      }
    } catch (err) {
      console.error("API key validation error:", err);
    }
    res.status(401).json({
      error: "invalid_token",
      error_description: "API key invalid or not found",
    });
    return;
  }

  // OAuth token path — in-memory store (for Claude.ai Chat)
  const validToken = validateAccessToken(token);
  if (!validToken) {
    res.status(401).json({
      error: "invalid_token",
      error_description: "Token expired or invalid",
    });
    return;
  }

  // Attach the user's Firebase UID to the request
  (req as any).firebaseUid = validToken.firebase_uid;
  next();
}

// MCP endpoint — Streamable HTTP (stateless)
// Wraps the handler in AsyncLocalStorage so tools can access the UID
// Also intercepts response to auto-increment contextEstimate on active sessions
app.post("/mcp", authMiddleware, async (req: Request, res: Response) => {
  const firebaseUid = (req as any).firebaseUid;

  // Track response size for contextEstimate auto-increment
  let responseSize = 0;
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  res.write = function(chunk: any, ...args: any[]) {
    if (chunk) {
      responseSize += typeof chunk === "string" ? chunk.length : chunk.byteLength || 0;
    }
    return originalWrite(chunk, ...args);
  } as any;

  res.end = function(chunk?: any, ...args: any[]) {
    if (chunk) {
      responseSize += typeof chunk === "string" ? chunk.length : chunk.byteLength || 0;
    }
    // Fire-and-forget: increment contextEstimate after response completes
    if (firebaseUid && responseSize > 0) {
      incrementContextEstimate(firebaseUid, responseSize).catch(() => {});
    }
    return originalEnd(chunk, ...args);
  } as any;

  // Run the MCP handler within the user's context
  requestContext.run({ firebaseUid }, async () => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });

    res.on("close", () => {
      transport.close();
    });

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("MCP request error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });
});

// GET /mcp — required for SSE transport fallback
app.get("/mcp", authMiddleware, async (req: Request, res: Response) => {
  const firebaseUid = (req as any).firebaseUid;

  requestContext.run({ firebaseUid }, async () => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close();
    });

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error("MCP GET error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });
});

// DELETE /mcp — session cleanup (no-op for stateless)
app.delete("/mcp", (_req: Request, res: Response) => {
  res.sendStatus(200);
});

// HEAD /mcp — capability check
app.head("/mcp", (_req: Request, res: Response) => {
  res.header("MCP-Protocol-Version", "2025-06-18");
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`CC MCP Server listening on :${PORT}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`MCP endpoint: ${BASE_URL}/mcp`);
  console.log(`OAuth metadata: ${BASE_URL}/.well-known/oauth-authorization-server`);
  console.log(`Auth: ${process.env.SKIP_AUTH === "true" || process.env.NODE_ENV === "development" ? "DISABLED (dev mode)" : "OAuth 2.1"}`);
  console.log(`GitHub delivery: ${process.env.GITHUB_TOKEN ? "ENABLED" : "DISABLED (no GITHUB_TOKEN)"}`);
});
