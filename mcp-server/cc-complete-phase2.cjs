const admin = require("firebase-admin");
const sa = require("/Users/davidstewart/Downloads/word-boxing-firebase-adminsdk-fbsvc-8319990106.json");
if (admin.apps.length === 0) admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: "https://word-boxing-default-rtdb.firebaseio.com" });
const db = admin.database();
const uid = "oUt4ba0dYVRBfPREqoJ1yIsJKjr1";
const jobId = "-Olom5T1A0670QkoIiQV";

async function run() {
    const now = new Date().toISOString();
    await db.ref(`command-center/${uid}/jobs/${jobId}`).update({
        status: "completed",
        completedAt: now,
        updatedAt: now,
        summary: `Phase 2 deployed (v8.70.18). Added Jobs tab (26 jobs from Firebase, read-only) and Sessions tab (20 sessions, read-only). Created JobService with Firebase listener at command-center/{uid}/jobs. Both views feature filter bars (app, status, type/mode), color-coded badges, expandable detail rows, and relative timestamps. Nav now shows: Projects | Jobs | Sessions | Ideas | Settings. One hotfix applied: apps object lookup (apps[id] not apps.find). File grew from 14,120 to 14,625 lines.`
    });
    console.log("Job completed successfully");
    process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
