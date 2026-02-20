import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { getDb } from "../firebase.js";

// In-memory store for OAuth clients, tokens, and user mappings
// Upgrade to Firebase-backed store for persistence across deploys

export interface OAuthClient {
  client_id: string;
  client_secret: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  created_at: number;
}

export interface AuthCode {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge?: string;
  code_challenge_method?: string;
  firebase_uid: string; // The CC user's Firebase UID
  expires_at: number;
}

export interface AccessToken {
  access_token: string;
  token_type: string;
  client_id: string;
  firebase_uid: string; // The CC user's Firebase UID
  expires_at: number;
}

const clients = new Map<string, OAuthClient>();
const authCodes = new Map<string, AuthCode>();
const accessTokens = new Map<string, AccessToken>();

// Dynamic Client Registration (RFC 7591)
export function registerClient(registration: {
  client_name?: string;
  redirect_uris?: string[];
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
}): OAuthClient {
  const client: OAuthClient = {
    client_id: uuidv4(),
    client_secret: uuidv4(),
    client_name: registration.client_name || "Unknown Client",
    redirect_uris: registration.redirect_uris || [],
    grant_types: registration.grant_types || ["authorization_code"],
    response_types: registration.response_types || ["code"],
    token_endpoint_auth_method: registration.token_endpoint_auth_method || "client_secret_post",
    created_at: Date.now(),
  };
  clients.set(client.client_id, client);
  return client;
}

export function getClient(clientId: string): OAuthClient | undefined {
  return clients.get(clientId);
}

// Create authorization code — now includes the user's Firebase UID
export function createAuthCode(
  clientId: string,
  redirectUri: string,
  firebaseUid: string,
  codeChallenge?: string,
  codeChallengeMethod?: string
): string {
  const code = uuidv4();
  authCodes.set(code, {
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    firebase_uid: firebaseUid,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    expires_at: Date.now() + 10 * 60 * 1000, // 10 minutes
  });
  return code;
}

export function consumeAuthCode(code: string): AuthCode | undefined {
  const authCode = authCodes.get(code);
  if (!authCode) return undefined;
  if (authCode.expires_at < Date.now()) {
    authCodes.delete(code);
    return undefined;
  }
  authCodes.delete(code); // One-time use
  return authCode;
}

// Create access token — carries the user's Firebase UID
export function createAccessToken(clientId: string, firebaseUid: string): AccessToken {
  const token: AccessToken = {
    access_token: uuidv4(),
    token_type: "Bearer",
    client_id: clientId,
    firebase_uid: firebaseUid,
    expires_at: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
  };
  accessTokens.set(token.access_token, token);
  return token;
}

export function validateAccessToken(token: string): AccessToken | undefined {
  const at = accessTokens.get(token);
  if (!at) return undefined;
  if (at.expires_at < Date.now()) {
    accessTokens.delete(token);
    return undefined;
  }
  return at;
}

// Hash a token with SHA-256
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Validate a CC API key (format: cc_{uid}_{secret})
// Firebase stores the SHA-256 hash — the plaintext key never touches the database
// Persistent — survives Cloud Run cold starts
export async function validateApiKey(token: string): Promise<{ uid: string } | null> {
  // Parse: cc_{uid}_{secret}
  // Firebase UIDs don't contain underscores, so split safely
  const match = token.match(/^cc_([^_]+)_(.+)$/);
  if (!match) return null;

  const uid = match[1];
  if (!uid || uid.length < 10) return null;

  try {
    const db = getDb();
    const snapshot = await db.ref(`command-center/${uid}/apiKeyHash`).once("value");
    const storedHash = snapshot.val();

    if (!storedHash) return null;

    // Compare SHA-256 hash of incoming token to stored hash
    const incomingHash = hashToken(token);
    if (incomingHash !== storedHash) return null;

    return { uid };
  } catch (err) {
    console.error("API key validation error:", err);
    return null;
  }
}
