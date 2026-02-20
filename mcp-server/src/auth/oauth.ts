import { Router, Request, Response } from "express";
import crypto from "crypto";
import admin from "firebase-admin";
import {
  registerClient,
  getClient,
  createAuthCode,
  consumeAuthCode,
  createAccessToken,
  validateApiKey,
} from "./store.js";

export function createOAuthRouter(baseUrl: string): Router {
  const router = Router();

  // OAuth Authorization Server Metadata (RFC 8414)
  router.get("/.well-known/oauth-authorization-server", (_req: Request, res: Response) => {
    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      registration_endpoint: `${baseUrl}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256", "plain"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    });
  });

  // Protected Resource Metadata (RFC 9728) — Claude.ai checks this first
  router.get("/.well-known/oauth-protected-resource", (_req: Request, res: Response) => {
    res.json({
      resource: baseUrl,
      authorization_servers: [baseUrl],
    });
  });

  // Dynamic Client Registration (RFC 7591)
  router.post("/register", (req: Request, res: Response) => {
    const client = registerClient(req.body);
    res.status(201).json({
      client_id: client.client_id,
      client_secret: client.client_secret,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      grant_types: client.grant_types,
      response_types: client.response_types,
      token_endpoint_auth_method: client.token_endpoint_auth_method,
    });
  });

  // Authorization Endpoint — Google Sign-In to auto-resolve Firebase UID
  router.get("/authorize", (req: Request, res: Response) => {
    const {
      client_id,
      redirect_uri,
      response_type,
      state,
      code_challenge,
      code_challenge_method,
    } = req.query as Record<string, string>;

    if (response_type !== "code") {
      res.status(400).json({ error: "unsupported_response_type" });
      return;
    }

    const client = getClient(client_id);
    if (!client) {
      res.status(400).json({ error: "invalid_client" });
      return;
    }

    const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || "word-boxing";
    const firebaseApiKey = process.env.FIREBASE_WEB_API_KEY || "";

    // Render sign-in page — uses Firebase Auth client SDK for Google Sign-In
    // The ID token is sent to our server to verify and extract the Firebase UID
    res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connect to Command Center</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f1117;
      color: #e0e0e0;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    .card {
      background: #1a1d27;
      border: 1px solid #2a2d37;
      border-radius: 12px;
      padding: 40px;
      max-width: 440px;
      width: 100%;
      text-align: center;
    }
    h1 { font-size: 20px; margin-bottom: 8px; color: #fff; }
    .subtitle { font-size: 14px; color: #888; margin-bottom: 32px; }
    .google-btn {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      padding: 12px 24px;
      background: #fff;
      color: #333;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      margin-bottom: 16px;
    }
    .google-btn:hover { background: #f0f0f0; }
    .google-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .google-btn svg { width: 20px; height: 20px; }
    .status { font-size: 13px; color: #888; margin-top: 16px; }
    .status.error { color: #ef4444; }
    .status.success { color: #22c55e; }
    .divider { border-top: 1px solid #2a2d37; margin: 24px 0; }
    .manual-section { text-align: left; }
    .manual-section label { display: block; font-size: 13px; color: #aaa; margin-bottom: 6px; }
    .manual-section input {
      width: 100%;
      padding: 10px 14px;
      background: #0f1117;
      border: 1px solid #2a2d37;
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      font-family: 'SF Mono', 'Fira Code', monospace;
      margin-bottom: 8px;
    }
    .manual-section input:focus { outline: none; border-color: #5b6ef5; }
    .manual-section .hint { font-size: 12px; color: #666; margin-bottom: 16px; }
    .manual-section .hint code { background: #252830; padding: 2px 6px; border-radius: 4px; font-size: 11px; }
    .manual-btn {
      width: 100%;
      padding: 10px;
      background: #2a2d37;
      color: #e0e0e0;
      border: 1px solid #3a3d47;
      border-radius: 8px;
      font-size: 13px;
      cursor: pointer;
    }
    .manual-btn:hover { background: #333640; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect to Command Center</h1>
    <p class="subtitle">Sign in with the same Google account you use in CC</p>

    <button class="google-btn" id="googleBtn" onclick="signInWithGoogle()">
      <svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
      Sign in with Google
    </button>

    <p class="status" id="status"></p>

    <div class="divider"></div>

    <div class="manual-section">
      <label>Or connect with your CC API key</label>
      <input type="text" id="apiKeyInput" placeholder="cc_xxxxxxx_xxxxxxxxxx">
      <p class="hint">Settings → CC API Key in Command Center</p>
      <button class="manual-btn" onclick="submitApiKey()">Connect with API Key</button>
    </div>
  </div>

  <script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js"></script>
  <script>
    const params = {
      client_id: "${client_id}",
      redirect_uri: "${redirect_uri}",
      state: "${state || ""}",
      code_challenge: "${code_challenge || ""}",
      code_challenge_method: "${code_challenge_method || ""}"
    };

    // Initialize Firebase client for Google Sign-In
    firebase.initializeApp({
      apiKey: "${firebaseApiKey}",
      authDomain: "${firebaseProjectId}.firebaseapp.com",
      projectId: "${firebaseProjectId}",
    });

    async function signInWithGoogle() {
      const btn = document.getElementById('googleBtn');
      const status = document.getElementById('status');
      btn.disabled = true;
      status.className = 'status';
      status.textContent = 'Signing in...';

      try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const result = await firebase.auth().signInWithPopup(provider);
        const idToken = await result.user.getIdToken();

        status.textContent = 'Verifying identity...';

        // Send ID token to server to verify and get Firebase UID
        const res = await fetch('/authorize/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...params, id_token: idToken })
        });

        if (res.ok) {
          const data = await res.json();
          status.className = 'status success';
          status.textContent = 'Connected! Redirecting...';
          window.location.href = data.redirect;
        } else {
          const err = await res.json();
          status.className = 'status error';
          status.textContent = err.error_description || 'Verification failed';
          btn.disabled = false;
        }
      } catch (err) {
        status.className = 'status error';
        status.textContent = 'Sign-in failed: ' + err.message;
        btn.disabled = false;
      }
    }

    async function submitApiKey() {
      const apiKey = document.getElementById('apiKeyInput').value.trim();
      const status = document.getElementById('status');

      if (!apiKey) {
        status.className = 'status error';
        status.textContent = 'Please enter your CC API key';
        return;
      }

      if (!apiKey.startsWith('cc_')) {
        status.className = 'status error';
        status.textContent = 'Invalid key format. Expected: cc_xxxxxxx_xxxxxxxxxx';
        return;
      }

      status.className = 'status';
      status.textContent = 'Validating API key...';

      try {
        const res = await fetch('/authorize/api-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...params, api_key: apiKey })
        });

        if (res.ok) {
          const data = await res.json();
          status.className = 'status success';
          status.textContent = 'Connected! Redirecting...';
          window.location.href = data.redirect;
        } else {
          const err = await res.json();
          status.className = 'status error';
          status.textContent = err.error_description || 'Invalid API key';
        }
      } catch (err) {
        status.className = 'status error';
        status.textContent = 'Connection failed: ' + err.message;
      }
    }

  </script>
</body>
</html>`);
  });

  // Verify Google ID token → extract Firebase UID → create auth code → redirect
  router.post("/authorize/verify", async (req: Request, res: Response) => {
    const { client_id, redirect_uri, state, code_challenge, code_challenge_method, id_token } = req.body;

    if (!id_token) {
      res.status(400).json({ error: "invalid_request", error_description: "ID token required" });
      return;
    }

    const client = getClient(client_id);
    if (!client) {
      res.status(400).json({ error: "invalid_client" });
      return;
    }

    try {
      // Verify the Firebase ID token and extract the UID
      const decodedToken = await admin.auth().verifyIdToken(id_token);
      const firebaseUid = decodedToken.uid;

      const code = createAuthCode(
        client_id,
        redirect_uri,
        firebaseUid,
        code_challenge || undefined,
        code_challenge_method || undefined
      );

      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set("code", code);
      if (state) redirectUrl.searchParams.set("state", state);

      res.json({ redirect: redirectUrl.toString() });
    } catch (err: any) {
      res.status(401).json({
        error: "invalid_token",
        error_description: `Firebase token verification failed: ${err.message}`,
      });
    }
  });

  // API Key authentication — validates CC API key against Firebase RTDB hash
  // Secure alternative to Google Sign-In for environments where popups don't work (e.g., Claude.ai)
  router.post("/authorize/api-key", async (req: Request, res: Response) => {
    const { client_id, redirect_uri, state, code_challenge, code_challenge_method, api_key } = req.body;

    if (!api_key) {
      res.status(400).json({ error: "invalid_request", error_description: "API key required" });
      return;
    }

    const client = getClient(client_id);
    if (!client) {
      res.status(400).json({ error: "invalid_client" });
      return;
    }

    try {
      // Validate API key against SHA-256 hash stored in Firebase
      const result = await validateApiKey(api_key);
      if (!result) {
        res.status(401).json({
          error: "invalid_token",
          error_description: "Invalid or expired API key. Generate a new one in CC Settings.",
        });
        return;
      }

      const code = createAuthCode(
        client_id,
        redirect_uri,
        result.uid,
        code_challenge || undefined,
        code_challenge_method || undefined
      );

      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set("code", code);
      if (state) redirectUrl.searchParams.set("state", state);

      res.json({ redirect: redirectUrl.toString() });
    } catch (err: any) {
      res.status(500).json({
        error: "server_error",
        error_description: `API key validation failed: ${err.message}`,
      });
    }
  });

  // Token Endpoint
  router.post("/token", (req: Request, res: Response) => {
    const { grant_type, code, redirect_uri, client_id, client_secret, code_verifier } = req.body;

    if (grant_type !== "authorization_code") {
      res.status(400).json({ error: "unsupported_grant_type" });
      return;
    }

    // Validate auth code
    const authCode = consumeAuthCode(code);
    if (!authCode) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }

    // Validate client
    const resolvedClientId = client_id || authCode.client_id;
    const client = getClient(resolvedClientId);
    if (!client) {
      res.status(401).json({ error: "invalid_client" });
      return;
    }

    // Validate redirect_uri matches
    if (redirect_uri && redirect_uri !== authCode.redirect_uri) {
      res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri mismatch" });
      return;
    }

    // Validate PKCE code_verifier if code_challenge was used
    if (authCode.code_challenge) {
      if (!code_verifier) {
        res.status(400).json({ error: "invalid_grant", error_description: "code_verifier required" });
        return;
      }

      let computedChallenge: string;
      if (authCode.code_challenge_method === "S256") {
        computedChallenge = crypto
          .createHash("sha256")
          .update(code_verifier)
          .digest("base64url");
      } else {
        computedChallenge = code_verifier; // plain method
      }

      if (computedChallenge !== authCode.code_challenge) {
        res.status(400).json({ error: "invalid_grant", error_description: "code_verifier mismatch" });
        return;
      }
    }

    // Issue access token — carries the user's Firebase UID from the auth code
    const token = createAccessToken(resolvedClientId, authCode.firebase_uid);

    res.json({
      access_token: token.access_token,
      token_type: "Bearer",
      expires_in: 86400, // 24 hours
    });
  });

  return router;
}
