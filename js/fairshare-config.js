// ── FairShare runtime config (see fairshare/README.md, "One-time setup") ──
// Safe to publish: the client ID only identifies the Google sign-in app, and the
// API key is a browser key for Google's file picker, locked to this site's
// addresses in Google Cloud. FairShare has no server.
// Edit and push — no rebuild needed.
window.FAIRSHARE_CONFIG = {
  // Google Cloud Console → Google Auth Platform → Clients → OAuth 2.0 Client ID (Web)
  googleClientId:
    "758605914606-fu4tss4o1fqijep0b1spvispfhgemkhm.apps.googleusercontent.com",
  // Google Cloud Console → APIs & Services → Credentials → API key (website-restricted)
  googleApiKey: "AIzaSyCrFx2XklUqaTJQl-mZFXhePXcu5w1gn5U",
};
