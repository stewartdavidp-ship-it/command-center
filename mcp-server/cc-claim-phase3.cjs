const admin = require("firebase-admin");
const sa = require("/Users/davidstewart/Downloads/word-boxing-firebase-adminsdk-fbsvc-8319990106.json");
if (admin.apps.length === 0) admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: "https://word-boxing-default-rtdb.firebaseio.com" });
const db = admin.database();
const uid = "oUt4ba0dYVRBfPREqoJ1yIsJKjr1";
const jobId = "-OlozUuDW92ewQWmBL55";

async function run() {
    const now = new Date().toISOString();
    await db.ref(`command-center/${uid}/jobs/${jobId}`).update({
        status: "active",
        assignedTo: "code",
        startedAt: now,
        updatedAt: now
    });
    console.log("Phase 3 job claimed");
    process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
