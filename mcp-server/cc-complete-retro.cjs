const admin = require("firebase-admin");
const sa = require("/Users/davidstewart/Downloads/word-boxing-firebase-adminsdk-fbsvc-8319990106.json");
if (admin.apps.length === 0) admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: "https://word-boxing-default-rtdb.firebaseio.com" });
const db = admin.database();
const uid = "oUt4ba0dYVRBfPREqoJ1yIsJKjr1";
const jobId = "-OlocSpBLMj25wvtz0Jj";

async function run() {
    const now = new Date().toISOString();
    await db.ref(`command-center/${uid}/jobs/${jobId}`).update({
        status: "completed",
        completedAt: now,
        updatedAt: now,
        summary: `Bootstrapped cc-retro-journal as skill #27. Created SKILL_RETRO_JOURNAL constant with 5 seed entries (3 from Chat's Nav Redesign + 2 from Code's Phase 2 build). Registered in SKILL_REGISTRY, added to cc-skill-router startup tier for both Chat and Code cold starts. Added Step 7 (Retrospective Check) to cc-build-protocol with guidance on what makes a good Code journal entry. Added retro-journal mention to cc-session-protocol's guidance section. TypeScript compiles clean, all cross-references verified.`
    });
    console.log("Job completed successfully");
    process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
