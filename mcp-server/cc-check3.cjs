const admin = require("firebase-admin");
const sa = require("/Users/davidstewart/Downloads/word-boxing-firebase-adminsdk-fbsvc-8319990106.json");
if (admin.apps.length === 0) admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: "https://word-boxing-default-rtdb.firebaseio.com" });
const db = admin.database();
const uid = "oUt4ba0dYVRBfPREqoJ1yIsJKjr1";

async function run() {
    const job = (await db.ref("command-center/" + uid + "/jobs/-Olo_jzRcs_GJvQBXig5").once("value")).val();
    console.log(JSON.stringify(job, null, 2));
    process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
