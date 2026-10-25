// ── FairShare runtime config (see fairshare/README.md, "One-time setup") ──
// Safe to publish: the client ID only identifies the Google sign-in app, and the
// Apps Script URL rejects every request without a valid signed-in session.
// Edit and push — no rebuild needed.
window.FAIRSHARE_CONFIG = {
  // Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID (Web)
  googleClientId:
    "758605914606-fu4tss4o1fqijep0b1spvispfhgemkhm.apps.googleusercontent.com",
  // Apps Script → Deploy → Manage deployments → Web app URL (ends with /exec)
  apiUrl:
    "https://script.google.com/macros/s/AKfycbxwEUHaAwd6a3PL8fnjVm8bad5OZgombIzr_JxpkvpCXTX6LylLEzVHjXpMuxJt_s5sVw/exec",
};
