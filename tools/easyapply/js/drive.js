// Google sign-in and the profile file in the user's own Google Drive.
// - Sign-in uses Google's popup (always started by a tap, so browsers allow it).
// - The profile is one JSON file in Drive's hidden "app data" folder: only EasyApply (with the user's
//   permission) can read it, and only from the user's account. EasyApply has no server.
// - Token lasts about an hour; after that a tap on "Sync" renews it.
// Pattern ported from fairshare/frontend/src/google/auth.ts and api.ts.
// Dev: on localhost, add ?mock=1 to use a fake Drive kept in this browser (no Google project needed).

const SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.appdata'];
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FILE_NAME = 'easyapply-profile.json';
const TOKEN_KEY = 'easyapply.google'; // { token, expiresAt }
const HINT_KEY = 'easyapply.lastEmail';

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
if (isLocal && new URLSearchParams(location.search).has('mock')) sessionStorage.setItem('easyapply.mock', '1');
export const MOCK = isLocal && sessionStorage.getItem('easyapply.mock') === '1';

export const CLIENT_ID = (window.EASYAPPLY_CONFIG && window.EASYAPPLY_CONFIG.googleClientId) || '';
export const configured = () => MOCK || !!CLIENT_ID;

const ls = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem(k) || 'null');
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* storage blocked: sign-in lasts for this page only */
    }
  },
};

let current = ls.get(TOKEN_KEY);
export const hasToken = (minMs = 30000) => MOCK || (!!current && current.expiresAt - Date.now() > minMs);

export class DriveError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---- Google Identity Services ----
let gisPromise = null;
export function loadGis() {
  if (MOCK) return Promise.resolve();
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        gisPromise = null;
        reject(new Error('Could not load Google sign-in. Check your internet connection.'));
      };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

let tokenClient = null;
let pending = null;

/** Sign in (or renew) with Google's popup. Must be called straight from a tap. */
export function signIn({ chooseAccount = false } = {}) {
  if (MOCK) {
    ls.set(HINT_KEY, 'test.user@example.com');
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!CLIENT_ID) return reject(new Error('EasyApply sign-in is not set up yet.'));
    if (!oauth2) return reject(new Error('Google sign-in is still loading. Try again in a moment.'));
    tokenClient ??= oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES.join(' '),
      callback: (res) => {
        const p = pending;
        pending = null;
        if (res.error) return p?.reject(new Error(res.error_description || res.error));
        if (!oauth2.hasGrantedAllScopes(res, DRIVE_SCOPE))
          return p?.reject(new Error('EasyApply needs permission to keep its file in your Google Drive. Please sign in again and allow it.'));
        current = { token: res.access_token, expiresAt: Date.now() + (Number(res.expires_in) || 3600) * 1000 };
        ls.set(TOKEN_KEY, current);
        p?.resolve();
      },
      error_callback: (err) => {
        const p = pending;
        pending = null;
        p?.reject(new Error(err.type === 'popup_failed_to_open' ? "The browser blocked Google's sign-in window. Allow pop-ups and try again." : err.type === 'popup_closed' ? 'The Google sign-in window was closed.' : 'Google sign-in failed.'));
      },
    });
    pending?.reject(new Error('Another sign-in started'));
    pending = { resolve, reject };
    const hint = ls.get(HINT_KEY);
    tokenClient.requestAccessToken(chooseAccount || !hint ? { prompt: 'select_account' } : { prompt: '', login_hint: hint });
  });
}

function token() {
  if (!hasToken(5000)) throw new DriveError(401, 'Google sign-in expired');
  return current.token;
}

async function call(method, url, { json, raw } = {}) {
  for (let attempt = 0; ; attempt++) {
    const headers = { Authorization: `Bearer ${token()}` };
    let body;
    if (raw !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = raw;
    } else if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    }
    let res;
    try {
      res = await fetch(url, { method, headers, body });
    } catch {
      throw new DriveError(0, 'No internet connection.');
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (res.ok) return data;
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt + Math.random() * 300));
      continue;
    }
    if (res.status === 401) {
      current = null;
      ls.set(TOKEN_KEY, null);
    }
    throw new DriveError(res.status, data?.error?.message || `Google Drive error (HTTP ${res.status})`);
  }
}

/** { email, name, picture } of the signed-in account. */
export async function fetchAccount() {
  if (MOCK) return { email: 'test.user@example.com', name: 'Test User', picture: '' };
  const info = await call('GET', 'https://www.googleapis.com/oauth2/v3/userinfo');
  const email = String(info?.email || '').toLowerCase();
  ls.set(HINT_KEY, email);
  return { email, name: info?.name || email.split('@')[0], picture: info?.picture || '' };
}

let fileId = null;
async function findFile() {
  if (fileId) return fileId;
  const q = new URLSearchParams({ spaces: 'appDataFolder', q: `name = '${FILE_NAME}' and trashed = false`, fields: 'files(id,modifiedTime)', orderBy: 'modifiedTime desc', pageSize: '1' });
  const r = await call('GET', `${DRIVE}/files?${q}`);
  fileId = r?.files?.[0]?.id || null;
  return fileId;
}

/** The profile saved in Drive, or null if there is none yet. */
export async function readProfile() {
  if (MOCK) return ls.get('easyapply.mockDrive');
  const id = await findFile();
  return id ? call('GET', `${DRIVE}/files/${id}?alt=media`) : null;
}

let queue = Promise.resolve();
/** Save the profile to Drive (one save at a time, so quick saves never make two files). */
export function writeProfile(profile) {
  const run = queue.then(async () => {
    if (MOCK) {
      await new Promise((r) => setTimeout(r, 300));
      ls.set('easyapply.mockDrive', profile);
      return;
    }
    let id = await findFile();
    if (!id) {
      id = (await call('POST', `${DRIVE}/files?fields=id`, { json: { name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' } })).id;
      fileId = id;
    }
    await call('PATCH', `${UPLOAD}/files/${id}?uploadType=media&fields=id`, { raw: JSON.stringify(profile) });
  });
  queue = run.catch(() => undefined);
  return run;
}

/** Forget the token on this device and tell Google to revoke it. */
export function signOut() {
  const t = current?.token;
  current = null;
  fileId = null;
  tokenClient = null;
  ls.set(TOKEN_KEY, null);
  ls.set(HINT_KEY, null);
  try {
    if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t, () => {});
  } catch {
    /* ignore */
  }
}
