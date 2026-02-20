const admin = require("firebase-admin");
const sa = require("/Users/davidstewart/Downloads/word-boxing-firebase-adminsdk-fbsvc-8319990106.json");
if (admin.apps.length === 0) admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: "https://word-boxing-default-rtdb.firebaseio.com" });
const db = admin.database();
const uid = "oUt4ba0dYVRBfPREqoJ1yIsJKjr1";

async function run() {
    const snap = await db.ref(`command-center/${uid}/jobs`).orderByChild("createdAt").limitToLast(10).once("value");
    const data = snap.val();
    if (!data) { console.log("No jobs found."); process.exit(0); }
    const jobs = Object.entries(data).map(([id, j]) => ({ id, ...j }));
    jobs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    jobs.forEach(j => {
        console.log("---");
        console.log("ID:", j.id);
        console.log("Title:", j.title);
        console.log("Status:", j.status);
        console.log("Type:", j.type);
        console.log("Created:", j.createdAt);
        console.log("Agent:", j.assignedTo);
    });
    process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
