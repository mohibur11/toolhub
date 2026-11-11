// Production config comes from toolhub's js/fairshare-config.js (editable without rebuilding).
// Local dev falls back to frontend/.env.local.
const runtime = window.FAIRSHARE_CONFIG ?? {};
const filled = (v: string | undefined) => (v && !v.startsWith('PASTE') ? v.trim() : undefined);

export const GOOGLE_CLIENT_ID = filled(runtime.googleClientId) ?? (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined);
/** Browser API key, used only by Google's file picker. */
export const GOOGLE_API_KEY = filled(runtime.googleApiKey) ?? (import.meta.env.VITE_GOOGLE_API_KEY as string | undefined);
/** Cloud project number (the start of the client ID). The picker needs it to let FairShare open the picked sheet. */
export const GOOGLE_APP_ID = GOOGLE_CLIENT_ID?.match(/^(\d+)-/)?.[1] ?? '';

/** Address of this app, used for invite links and as Google's sign-in return address. */
export const APP_URL = window.location.origin + window.location.pathname.replace(/index\.html$/, '');

/** Link back to the Toolhub homepage (app is served from <site>/tools/fairshare/). */
export const TOOLHUB_URL = '../../';
