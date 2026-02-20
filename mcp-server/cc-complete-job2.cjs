const admin = require("firebase-admin");
const sa = require("/Users/davidstewart/Downloads/word-boxing-firebase-adminsdk-fbsvc-8319990106.json");
if (admin.apps.length === 0) admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: "https://word-boxing-default-rtdb.firebaseio.com" });
const db = admin.database();
const uid = "oUt4ba0dYVRBfPREqoJ1yIsJKjr1";
const jobId = "-Ologq8howP2Idh0XF7C";

async function run() {
    const now = new Date().toISOString();
    await db.ref(`command-center/${uid}/jobs/${jobId}`).update({
        status: "completed",
        completedAt: now,
        updatedAt: now,
        summary: `Policy pages deployed (v8.70.17). Added Privacy Policy, Terms of Service, and Acceptable Use Policy as standalone HTML pages at /privacy/, /terms/, /acceptable-use/. Added persistent footer to CC main UI with links to all three pages. Cross-links between pages verified working on aicommandcenter.dev.`
    });
    console.log("Job completed successfully");
    process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
