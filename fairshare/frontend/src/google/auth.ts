// Google sign-in for an app with no server. The browser holds a short-lived Google access token (about an hour)
// and calls Drive and Sheets with it directly.
// - Starting the app: the page goes to Google and comes back with a token (a "redirect"). This needs no click;
//   Google may show its account or permission screen the first time.
// - Mid-session renewal: Google's popup. Browsers only allow popups straight after a click, so this runs from a
//   tap (the "Continue" banner, or any tap in the last minutes before the token runs out).
import { GoogleError } from '../data/google';
import type { Account } from '../data/actions';
import { APP_URL, GOOGLE_CLIENT_ID } from '../config';

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive.appdata'];
export const SCOPES = ['openid', 'email', 'profile', ...DRIVE_SCOPES];

const TOKEN_KEY = 'fairshare.google'; // { token, expiresAt }
const HINT_KEY = 'fairshare.lastEmail'; // account to sign in to without asking, next time
const ACCOUNT_KEY = 'fairshare.account';
const REDIRECT_KEY = 'fairshare.redirect'; // sessionStorage: { state, returnTo }

interface StoredToken {
  token: string;
  expiresAt: number;
}

const storage = {
  get<T>(key: string, area: Storage = localStorage): T | null {
    try {
      const v = area.getItem(key);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown, area: Storage = localStorage) {
    try {
      if (value === null) area.removeItem(key);
      else area.setItem(key, JSON.stringify(value));
    } catch {
      // storage unavailable (private mode): sign-in lasts for this tab only
    }
  },
};

// Left over from the earlier server version of FairShare.
storage.set('fairshare.session', null);
storage.set('fairshare.ownerEmail', null);

let current: StoredToken | null = storage.get<StoredToken>(TOKEN_KEY);

export const tokenExpiresAt = () => current?.expiresAt ?? 0;
export const hasToken = (minMs = 60_000) => !!current && current.expiresAt - Date.now() > minMs;

/** The token for API calls; a 401 error (which means "sign in again") if it has run out. */
export function accessToken(): string {
  if (!current || current.expiresAt - Date.now() < 10_000) throw new GoogleError(401, 'expired', 'Google sign-in expired');
  return current.token;
}

function setToken(token: string, expiresInSeconds: number) {
  current = { token, expiresAt: Date.now() + expiresInSeconds * 1000 };
  storage.set(TOKEN_KEY, current);
}

/** Google said the token is no longer valid (expired early or access was removed). */
export function dropToken() {
  current = null;
  storage.set(TOKEN_KEY, null);
}

export const lastEmail = () => storage.get<string>(HINT_KEY) ?? '';
export const rememberEmail = (email: string) => storage.set(HINT_KEY, email);

export function signOutLocally() {
  dropToken();
  storage.set(HINT_KEY, null);
  storage.set(ACCOUNT_KEY, null);
  account = null;
}

// ---- redirect sign-in ----

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Send the page to Google and back. `chooseAccount` shows Google's account chooser (first sign-in, switching). */
export function signInWithRedirect(opts: { chooseAccount?: boolean } = {}): void {
  if (!GOOGLE_CLIENT_ID) throw new Error('FairShare is not configured (no Google client ID)');
  const state = randomState();
  storage.set(REDIRECT_KEY, { state, returnTo: window.location.hash || '#/' }, sessionStorage);
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: APP_URL,
    response_type: 'token',
    scope: SCOPES.join(' '),
    include_granted_scopes: 'true',
    state,
  });
  const hint = lastEmail();
  if (opts.chooseAccount || !hint) params.set('prompt', 'select_account');
  else params.set('login_hint', hint);
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

export type RedirectResult = { ok: true } | { ok: false; error: string } | null;

/**
 * Finish a sign-in redirect. Google puts its answer after "#" in the address, where the app's own routes also
 * live, so this must run before the router starts.
 */
export function finishRedirectSignIn(): RedirectResult {
  const hash = window.location.hash.replace(/^#/, '');
  if (!/(^|&)(access_token|error|state)=/.test(hash)) return null;
  const params = new URLSearchParams(hash);
  const saved = storage.get<{ state: string; returnTo: string }>(REDIRECT_KEY, sessionStorage);
  storage.set(REDIRECT_KEY, null, sessionStorage);
  // Remove the token from the address bar (and history) right away; go back to where the user was.
  window.history.replaceState(null, '', window.location.pathname + window.location.search + (saved?.returnTo ?? '#/'));
  if (!saved || params.get('state') !== saved.state) return { ok: false, error: 'state_mismatch' };
  const error = params.get('error');
  if (error) return { ok: false, error };
  const token = params.get('access_token');
  if (!token) return { ok: false, error: 'no_token' };
  const granted = (params.get('scope') ?? '').split(' ');
  if (!DRIVE_SCOPES.every((s) => granted.includes(s))) return { ok: false, error: 'missing_scopes' };
  setToken(token, Number(params.get('expires_in')) || 3600);
  return { ok: true };
}

/** Plain-language reason for a failed sign-in. */
export function describeSignInError(error: string): string {
  if (error === 'access_denied') return 'Sign-in was cancelled.';
  if (error === 'missing_scopes')
    return 'FairShare needs both Google Drive permissions (its own files, and its settings file). Sign in again and tick both boxes.';
  if (error === 'state_mismatch') return 'That sign-in attempt expired. Please sign in again.';
  return `Google sign-in didn't finish (${error}). Please try again.`;
}

// ---- popup renewal (from a click) ----

let tokenClient: GoogleTokenClient | null = null;
let pending: { resolve: () => void; reject: (e: Error) => void } | null = null;

function settle(err: Error | null) {
  const p = pending;
  pending = null;
  if (err) p?.reject(err);
  else p?.resolve();
}

/** Renew the token with Google's popup. Call it directly from a click, or the browser blocks the popup. */
export function renewWithPopup(): Promise<void> {
  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2 || !GOOGLE_CLIENT_ID) return reject(new Error('Google sign-in is still loading. Try again in a moment.'));
    tokenClient ??= oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES.join(' '),
      callback: (res) => {
        if (res.error) return settle(new Error(res.error_description || res.error));
        if (!oauth2.hasGrantedAllScopes(res, ...DRIVE_SCOPES)) return settle(new Error(describeSignInError('missing_scopes')));
        setToken(res.access_token, Number(res.expires_in) || 3600);
        settle(null);
      },
      error_callback: (err) =>
        settle(
          new Error(
            err.type === 'popup_failed_to_open'
              ? "The browser blocked Google's sign-in window."
              : err.type === 'popup_closed'
                ? "Google's sign-in window was closed."
                : 'Google sign-in failed.',
          ),
        ),
    });
    pending?.reject(new Error('Another sign-in started'));
    pending = { resolve, reject };
    const hint = lastEmail();
    tokenClient.requestAccessToken(hint ? { prompt: '', login_hint: hint } : { prompt: '' });
  });
}

// ---- who is signed in ----

let account: Account | null = storage.get<Account>(ACCOUNT_KEY);
let accountFor = '';

/** Email, name and photo of the signed-in Google account (read once per token). */
export async function fetchAccount(): Promise<Account> {
  const token = accessToken();
  if (account && accountFor === token) return account;
  let res: Response;
  try {
    res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new GoogleError(0, 'network', 'Network error. Check your connection and try again.');
  }
  if (res.status === 401) {
    dropToken();
    throw new GoogleError(401, 'expired', 'Google sign-in expired');
  }
  if (!res.ok) throw new GoogleError(res.status, 'userinfo', `Couldn't read your Google profile (HTTP ${res.status})`);
  const info = (await res.json()) as { email?: string; name?: string; picture?: string };
  const email = String(info.email ?? '').toLowerCase();
  account = { email, googleName: info.name || email.split('@')[0], pictureUrl: info.picture };
  accountFor = token;
  storage.set(ACCOUNT_KEY, account);
  rememberEmail(email);
  return account;
}
