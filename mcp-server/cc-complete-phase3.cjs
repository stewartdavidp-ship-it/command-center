const admin = require("firebase-admin");
const sa = require("/Users/davidstewart/Downloads/word-boxing-firebase-adminsdk-fbsvc-8319990106.json");
if (admin.apps.length === 0) admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: "https://word-boxing-default-rtdb.firebaseio.com" });
const db = admin.database();
const uid = "oUt4ba0dYVRBfPREqoJ1yIsJKjr1";
const jobId = "-OlozUuDW92ewQWmBL55";

// Step 6a: Mark concepts as built
const conceptIds = [
    "-OloFjuj6FsZhhXSE6tS",   // Projects drill-down hierarchy
    "-OloFlLO_jgH03xBpvoj",   // Projects → Apps → Ideas → Concepts
    "-OlWG37xa9-Qv_sRMDpm",   // Projects tab adds ideas layer
    "-OlWG36tAtJTN2eTds91",   // Idea belongs to Project, optionally to App
    "-OlWG396FUTVBWfjQtKx",   // Ideas tab shows positions + activity
    "-OloIBq9sbP0tO5hZ-R4",   // Ideas as accordion within App drill-down
    "-OlWG34cRBJOoYGpYFwf",   // Rename Concepts to Positions
    "-OloHQ9EaIEQ5BRcf9eS"    // Light edits only
];

async function run() {
    const now = new Date().toISOString();

    // Step 6a: Mark each concept as built
    console.log("Step 6a: Marking concepts as built...");
    for (const conceptId of conceptIds) {
        try {
            await db.ref(`command-center/${uid}/concepts/${conceptId}`).update({
                status: "built",
                updatedAt: now
            });
            console.log(`  ✓ ${conceptId}`);
        } catch (e) {
            console.log(`  ✗ ${conceptId}: ${e.message}`);
        }
    }
    console.log(`Marked ${conceptIds.length} concepts as built.`);

    // Step 6b: Complete the job
    console.log("\nStep 6b: Completing job...");
    await db.ref(`command-center/${uid}/jobs/${jobId}`).update({
        status: "completed",
        completedAt: now,
        updatedAt: now,
        conceptsAddressed: conceptIds,
        summary: `Phase 3 deployed (v8.70.19). Built ProjectsDrillDown component (~640 lines) implementing 4-level drill-down: Projects → Apps → Ideas → Positions. Nav reduced from 5 to 4 tabs (Projects | Jobs | Sessions | Settings). Ideas tab absorbed into Projects. IdeasView concept rendering reused as read-only position cards with type/status badges, search, and filters. Idea archive/status-change writes via IdeaManager. Activity section shows linked sessions + jobs. All data derived from existing global state — no new Firebase listeners. Breadcrumb navigation at every level. 8 concepts marked built. File grew from 14,625 to 15,264 lines.`
    });
    console.log("Job completed successfully.");
    process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
