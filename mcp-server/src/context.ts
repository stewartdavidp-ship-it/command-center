import { AsyncLocalStorage } from "async_hooks";

// Per-request context using AsyncLocalStorage
// This lets MCP tool handlers access the authenticated user's Firebase UID
// without needing to pass it through the MCP SDK's tool registration API

export interface RequestContext {
  firebaseUid: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

// Get the current request's Firebase UID
// Falls back to FIREBASE_UID env var for dev/testing
export function getCurrentUid(): string {
  const ctx = requestContext.getStore();
  if (ctx?.firebaseUid) return ctx.firebaseUid;

  // Fallback for dev mode
  const envUid = process.env.FIREBASE_UID;
  if (envUid) return envUid;

  throw new Error("No Firebase UID in request context. User must authenticate via OAuth.");
}
