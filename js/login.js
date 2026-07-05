import { getFirebase, isConfigured } from "./firebase-init.js";

const btn = document.getElementById("login-btn");
const errEl = document.getElementById("login-error");

function showError(msg) {
  errEl.textContent = msg;
  errEl.hidden = false;
}

const FRIENDLY = {
  "auth/invalid-credential": "Wrong email or password.",
  "auth/invalid-email": "That doesn't look like a valid email.",
  "auth/user-not-found": "Wrong email or password.",
  "auth/wrong-password": "Wrong email or password.",
  "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
  "auth/network-request-failed": "Network problem. Check your connection.",
};

async function main() {
  if (!isConfigured) {
    btn.disabled = true;
    document.getElementById("config-warning").hidden = false;
    return;
  }

  const { auth, authMod } = await getFirebase();
  const { signInWithEmailAndPassword, onAuthStateChanged } = authMod;

  // Already signed in? Go straight to the panel.
  onAuthStateChanged(auth, (user) => {
    if (user) window.location.replace("admin.html");
  });

  async function attempt() {
    errEl.hidden = true;
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    if (!email || !password) return showError("Enter your email and password.");

    btn.disabled = true;
    btn.textContent = "Signing in…";
    try {
      await signInWithEmailAndPassword(auth, email, password);
      window.location.replace("admin.html");
    } catch (err) {
      showError(FRIENDLY[err.code] || "Sign-in failed. Try again.");
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
  }

  btn.addEventListener("click", attempt);
  document.getElementById("password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") attempt();
  });
}

main();
