import admin from "firebase-admin";
import { readFileSync } from "fs";

let app: admin.app.App;
let db: admin.database.Database;


export function initFirebase(): void {
  if (app) return;

  const projectId = process.env.FIREBASE_PROJECT_ID || "word-boxing";
  const databaseURL =
    process.env.FIREBASE_DATABASE_URL ||
    `https://${projectId}-default-rtdb.firebaseio.com`;

  // Local dev: use service account key file
  const keyPath = process.env.SERVICE_ACCOUNT_KEY_PATH;
  if (keyPath) {
    const serviceAccount = JSON.parse(readFileSync(keyPath, "utf8"));
    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL,
    });
  } else {
    // Cloud Run: use Application Default Credentials
    app = admin.initializeApp({
      projectId,
      databaseURL,
    });
  }

  db = admin.database();
}

// getUid is no longer used — UID comes from per-request context via getCurrentUid()
// Kept for backward compatibility in dev/testing
export function getUid(): string {
  const uid = process.env.FIREBASE_UID;
  if (!uid) throw new Error("FIREBASE_UID environment variable is required");
  return uid;
}

// Firebase RTDB references matching CC's path structure
export function getConceptsRef(uid: string) {
  return db.ref(`command-center/${uid}/concepts`);
}

export function getIdeasRef(uid: string) {
  return db.ref(`command-center/${uid}/ideas`);
}

export function getAppIdeasRef(uid: string, appId: string) {
  return db.ref(`command-center/${uid}/appIdeas/${appId}`);
}

export function getSessionsRef(uid: string) {
  return db.ref(`command-center/${uid}/sessions`);
}

export function getSessionRef(uid: string, sessionId: string) {
  return db.ref(`command-center/${uid}/sessions/${sessionId}`);
}

export function getJobsRef(uid: string) {
  return db.ref(`command-center/${uid}/jobs`);
}

export function getJobRef(uid: string, jobId: string) {
  return db.ref(`command-center/${uid}/jobs/${jobId}`);
}

// Config is per-user — contains apps and projects scoped to each user.
// v8.70.9: Changed from shared path to UID-scoped path to prevent data leaks
// between users. The old shared path `command-center/config` must not be used.
export function getConfigRef(uid: string) {
  return db.ref(`command-center/${uid}/config`);
}

export function getClaudeMdRef(uid: string, appId: string) {
  return db.ref(`command-center/${uid}/claudeMd/${appId}`);
}

export function getDocumentsRef(uid: string) {
  return db.ref(`command-center/${uid}/documents`);
}

export function getDocumentRef(uid: string, docId: string) {
  return db.ref(`command-center/${uid}/documents/${docId}`);
}

export function getPreferencesRef(uid: string) {
  return db.ref(`command-center/${uid}/preferences`);
}

export function getIdeaRef(uid: string, ideaId: string) {
  return db.ref(`command-center/${uid}/ideas/${ideaId}`);
}

export function getConceptRef(uid: string, conceptId: string) {
  return db.ref(`command-center/${uid}/concepts/${conceptId}`);
}

export function getProfileRef(uid: string) {
  return db.ref(`command-center/${uid}/profile`);
}

export function getAttentionQueueRef(uid: string) {
  return db.ref(`command-center/${uid}/attentionQueue`);
}

// ─── Signal refs (signal registry for _signals piggybacking) ───
export function getSignalsRef(uid: string) {
  return db.ref(`command-center/${uid}/signals`);
}

export function getSignalRef(uid: string, codeName: string) {
  return db.ref(`command-center/${uid}/signals/${codeName}`);
}

// ─── Skill refs (Firebase-backed skill storage) ───
export function getSkillsRef(uid: string) {
  return db.ref(`command-center/${uid}/skills`);
}

export function getSkillRef(uid: string, skillName: string) {
  return db.ref(`command-center/${uid}/skills/${skillName}`);
}

// ─── Knowledge Tree refs ───
export function getForestsRef(uid: string) {
  return db.ref(`command-center/${uid}/knowledge/forests`);
}

export function getForestRef(uid: string, forestId: string) {
  return db.ref(`command-center/${uid}/knowledge/forests/${forestId}`);
}

export function getTreesRef(uid: string) {
  return db.ref(`command-center/${uid}/knowledge/trees`);
}

export function getTreeRef(uid: string, treeId: string) {
  return db.ref(`command-center/${uid}/knowledge/trees/${treeId}`);
}

export function getTreeIndexRef(uid: string, treeId: string) {
  return db.ref(`command-center/${uid}/knowledge/trees/${treeId}/index`);
}

export function getNodesRef(uid: string) {
  return db.ref(`command-center/${uid}/knowledge/nodes`);
}

// Zero-result searches. A retrieval miss produces no error — the session just
// re-researches — so misses are recorded here to make them reviewable.
export function getSearchMissesRef(uid: string) {
  return db.ref(`command-center/${uid}/knowledge/searchMisses`);
}

// Cached global routing table (all trees, including those in no forest).
export function getGlobalSummaryRef(uid: string) {
  return db.ref(`command-center/${uid}/knowledge/globalSummary`);
}

export function getNodeContentRef(uid: string, nodeId: string) {
  return db.ref(`command-center/${uid}/knowledge/nodes/${nodeId}`);
}

// System-wide config (shared across all users)
export function getSystemRef() {
  return db.ref("command-center/system");
}

// ─── OAuth refs (system-wide + per-user) ───
export function getOAuthClientsRef() {
  return db.ref("command-center/system/oauth/clients");
}

export function getOAuthClientRef(clientId: string) {
  return db.ref(`command-center/system/oauth/clients/${clientId}`);
}

export function getTokenIndexRef() {
  return db.ref("command-center/system/oauth/tokenIndex");
}

export function getTokenIndexEntryRef(tokenHash: string) {
  return db.ref(`command-center/system/oauth/tokenIndex/${tokenHash}`);
}

export function getAuditLogRef() {
  return db.ref("command-center/system/oauth/auditLog");
}

export function getUserTokensRef(uid: string) {
  return db.ref(`command-center/${uid}/oauth/tokens`);
}

export function getUserTokenRef(uid: string, tokenHash: string) {
  return db.ref(`command-center/${uid}/oauth/tokens/${tokenHash}`);
}

// ─── Refresh Token refs (system-wide + per-user) ───
export function getRefreshTokenIndexRef() {
  return db.ref("command-center/system/oauth/refreshTokenIndex");
}

export function getRefreshTokenIndexEntryRef(tokenHash: string) {
  return db.ref(`command-center/system/oauth/refreshTokenIndex/${tokenHash}`);
}

export function getUserRefreshTokensRef(uid: string) {
  return db.ref(`command-center/${uid}/oauth/refreshTokens`);
}

export function getUserRefreshTokenRef(uid: string, tokenHash: string) {
  return db.ref(`command-center/${uid}/oauth/refreshTokens/${tokenHash}`);
}

export function getDb(): admin.database.Database {
  return db;
}

