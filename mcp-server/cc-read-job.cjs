const admin = require("firebase-admin");
const sa = require("/Users/davidstewart/Downloads/word-boxing-firebase-adminsdk-fbsvc-8319990106.json");
if (admin.apps.length === 0) admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: "https://word-boxing-default-rtdb.firebaseio.com" });
const db = admin.database();
const uid = "oUt4ba0dYVRBfPREqoJ1yIsJKjr1";
const jobId = process.argv[2];

async function run() {
    if (!jobId) { console.log("Usage: node cc-read-job.cjs <jobId>"); process.exit(1); }
    const job = (await db.ref(`command-center/${uid}/jobs/${jobId}`).once("value")).val();
    if (!job) { console.log("Job not found:", jobId); process.exit(1); }
    console.log("=== JOB:", job.title, "===");
    console.log("Status:", job.status);
    console.log("Created:", job.createdAt);
    console.log("\n=== INSTRUCTIONS ===\n");
    console.log(job.instructions || "(none)");
    if (job.attachments) {
        console.log("\n=== ATTACHMENTS ===");
        const atts = Array.isArray(job.attachments) ? job.attachments : Object.values(job.attachments);
        for (let i = 0; i < atts.length; i++) {
            const a = atts[i];
            console.log(`\nAttachment ${i}: ${a.name || a.filename || "unnamed"} (${(a.content || "").length} chars)`);
            if (a.content && a.content.length < 5000) console.log(a.content);
            else if (a.content) console.log(a.content.substring(0, 3000) + "\n... (truncated)");
        }
    }
    process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
