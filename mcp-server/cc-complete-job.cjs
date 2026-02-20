const admin = require("firebase-admin");
const sa = require("/Users/davidstewart/Downloads/word-boxing-firebase-adminsdk-fbsvc-8319990106.json");
if (admin.apps.length === 0) admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: "https://word-boxing-default-rtdb.firebaseio.com" });
const db = admin.database();
const uid = "oUt4ba0dYVRBfPREqoJ1yIsJKjr1";
const jobId = "-Olo_jzRcs_GJvQBXig5";

async function run() {
    const now = new Date().toISOString();
    await db.ref(`command-center/${uid}/jobs/${jobId}`).update({
        status: "completed",
        completedAt: now,
        updatedAt: now,
        summary: `Phase 1 Cleanup complete (v8.70.16). Removed ~11,800 lines (45.5%) from index.html — deploy pipeline, ingestion pipeline, completion file system, DashboardView, BacklogView, session workflow UI, and all associated state/services/modals. File reduced from 25,926 to 14,120 lines. All views verified working: Projects, Ideas, Settings. Two hotfixes applied: JSX comment syntax (bare // in JSX blocks) and missing dialog state declaration.`
    });
    console.log("Job completed successfully");
    process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
