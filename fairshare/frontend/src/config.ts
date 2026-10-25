// Production config comes from toolhub's js/fairshare-config.js (editable without rebuilding).
// Local dev falls back to frontend/.env.local.
const runtime = window.FAIRSHARE_CONFIG ?? {};
const filled = (v: string | undefined) => (v && !v.startsWith('PASTE') ? v : undefined);

export const GOOGLE_CLIENT_ID = filled(runtime.googleClientId) ?? (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined);
export const API_URL = filled(runtime.apiUrl) ?? (import.meta.env.VITE_API_URL as string | undefined);

/** Link back to the Toolhub homepage (app is served from <site>/tools/fairshare/). */
export const TOOLHUB_URL = '../../';
