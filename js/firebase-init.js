import { firebaseConfig, isConfigured } from "./firebase-config.js";

let app = null, auth = null, db = null;

export { isConfigured };

export async function getFirebase() {
  if (!isConfigured) return null;
  if (app) return { app, auth, db };

  const [{ initializeApp }, authMod, dbMod] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"),
  ]);

  app = initializeApp(firebaseConfig);
  auth = authMod.getAuth(app);
  db = dbMod.getFirestore(app);

  return { app, auth, db, authMod, dbMod };
}
