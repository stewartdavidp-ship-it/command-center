const admin = require("firebase-admin");
const sa = require("/Users/davidstewart/Downloads/word-boxing-firebase-adminsdk-fbsvc-8319990106.json");
if (admin.apps.length === 0) admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: "https://word-boxing-default-rtdb.firebaseio.com" });
const db = admin.database();
const uid = "oUt4ba0dYVRBfPREqoJ1yIsJKjr1";

async function run() {
    // Check both jobs for full details
    const job1 = (await db.ref("command-center/" + uid + "/jobs/-OlocSpBLMj25wvtz0Jj").once("value")).val();
    const job2 = (await db.ref("command-center/" + uid + "/jobs/-Ologq8howP2Idh0XF7C").once("value")).val();

    console.log("=== JOB 1: Skill-Update ===");
    console.log("Priority:", job1.priority);
    console.log("Source:", job1.source);
    console.log("Attachments:", job1.attachments ? Object.keys(job1.attachments).length + " attachments" : "none");
    console.log();

    console.log("=== JOB 2: Policy Pages ===");
    console.log("Priority:", job2.priority);
    console.log("Source:", job2.source);
    console.log("Attachments:", job2.attachments ? Object.keys(job2.attachments).length + " attachments" : "none");
    if (job2.attachments) {
        for (const [k, v] of Object.entries(job2.attachments)) {
            console.log("  -", k, ":", v.name || v.filename || "(no name)", "|", (v.content || "").substring(0, 100) + "...");
        }
    }
    process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
