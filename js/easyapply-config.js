// ── EasyApply runtime config (see tools/easyapply/README.md, "One-time Google setup") ──
// Safe to publish: the client ID only names EasyApply's Google sign-in app. It belongs to EasyApply's own
// Google Cloud project, separate from FairShare's, so users see "EasyApply" on Google's sign-in screen.
// Edit and push — no build step.
window.EASYAPPLY_CONFIG = {
  // Google Cloud Console (project "EasyApply") → Google Auth Platform → Clients → OAuth 2.0 Client ID (Web)
  googleClientId: "1085049551683-nboar29pqc0q04qudtkrhfsur6kc4dp7.apps.googleusercontent.com",
};
