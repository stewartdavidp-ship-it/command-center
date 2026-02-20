const admin = require("firebase-admin");
const sa = require("/Users/davidstewart/Downloads/word-boxing-firebase-adminsdk-fbsvc-8319990106.json");
if (admin.apps.length === 0) admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: "https://word-boxing-default-rtdb.firebaseio.com" });
const db = admin.database();
const uid = "oUt4ba0dYVRBfPREqoJ1yIsJKjr1";

async function run() {
    const jobs = (await db.ref("command-center/" + uid + "/jobs").once("value")).val() || {};
    const pending = Object.entries(jobs).filter(([k, v]) =>
        v.status === "draft" || v.status === "review" || v.status === "pending_review" || v.status === "pending" || v.status === "ready"
    );
    console.log("Pending jobs:", pending.length);
    for (const [k, v] of pending) {
        console.log("\n=== JOB:", k, "===");
        console.log("Title:", v.title);
        console.log("Status:", v.status);
        console.log("Type:", v.type);
        console.log("App:", v.appId);
        console.log("Created:", v.createdAt);
        console.log("Instructions:", (v.instructions || "").substring(0, 800));
        console.log("---");
    }
    process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
