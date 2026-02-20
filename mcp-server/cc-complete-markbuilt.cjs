const admin = require("firebase-admin");
const sa = require("/Users/davidstewart/Downloads/word-boxing-firebase-adminsdk-fbsvc-8319990106.json");
if (admin.apps.length === 0) admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: "https://word-boxing-default-rtdb.firebaseio.com" });
const db = admin.database();
const uid = "oUt4ba0dYVRBfPREqoJ1yIsJKjr1";
const jobId = "-OloxO9NaKs4PQTipL35";

async function run() {
    const now = new Date().toISOString();
    // First claim the job
    await db.ref(`command-center/${uid}/jobs/${jobId}`).update({
        status: "active",
        assignedTo: "code",
        startedAt: now,
        updatedAt: now
    });
    console.log("Job claimed");

    // Then complete it
    await db.ref(`command-center/${uid}/jobs/${jobId}`).update({
        status: "completed",
        completedAt: now,
        updatedAt: now,
        summary: `Updated cc-build-protocol Step 6. Split into Step 6a (Mark Concepts Built — call concept mark_built for every ID in "Concepts Addressed") and Step 6b (Complete the Job — now includes conceptsAddressed array). Added "Don't skip mark_built" to What NOT to Do section. TypeScript compiles clean.`
    });
    console.log("Job completed successfully");
    process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
