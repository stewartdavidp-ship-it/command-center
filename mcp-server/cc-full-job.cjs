const admin = require("firebase-admin");
const sa = require("/Users/davidstewart/Downloads/word-boxing-firebase-adminsdk-fbsvc-8319990106.json");
if (admin.apps.length === 0) admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: "https://word-boxing-default-rtdb.firebaseio.com" });
const db = admin.database();
const uid = "oUt4ba0dYVRBfPREqoJ1yIsJKjr1";

async function run() {
    const job = (await db.ref("command-center/" + uid + "/jobs/-OlocSpBLMj25wvtz0Jj").once("value")).val();
    console.log("Title:", job.title);
    console.log("Status:", job.status);
    console.log("App:", job.appId);
    console.log("Idea:", job.ideaId);
    console.log("Created:", job.createdAt);
    console.log("\n=== FULL INSTRUCTIONS ===\n");
    console.log(job.instructions);
    if (job.attachments) {
        console.log("\n=== ATTACHMENTS ===");
        const atts = Array.isArray(job.attachments) ? job.attachments : Object.values(job.attachments);
        for (let i = 0; i < atts.length; i++) {
            const a = atts[i];
            console.log("\nAttachment " + i + ": " + (a.name || a.filename || "unnamed") + " (" + (a.content || "").length + " chars)");
            console.log(a.content);
        }
    }
    process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
