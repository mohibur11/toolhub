// Login = verify a Google ID token once, then hand out our own signed session token
// (HMAC-SHA256, 30 days) so users don't have to re-authenticate every hour.
import type { User } from '../../shared/types';
import { prop } from './config';
import { ApiError } from './errors';

const SESSION_DAYS = 30;

interface SessionPayload {
  e: string; // email
  n: string; // name
  p: string; // picture
  x: number; // expiry, epoch seconds
}

export function verifyGoogleIdToken(idToken: string): User {
  if (!idToken || typeof idToken !== 'string') throw new ApiError('UNAUTHENTICATED', 'Missing Google credential');
  const res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true },
  );
  if (res.getResponseCode() !== 200) throw new ApiError('UNAUTHENTICATED', 'Google sign-in could not be verified');
  const info = JSON.parse(res.getContentText()) as Record<string, string>;
  const issuerOk = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
  if (info.aud !== prop('GOOGLE_CLIENT_ID') || !issuerOk)
    throw new ApiError('UNAUTHENTICATED', 'Credential was issued for another app');
  if (info.email_verified !== 'true') throw new ApiError('UNAUTHENTICATED', 'Google email is not verified');
  if (Number(info.exp) * 1000 < Date.now()) throw new ApiError('UNAUTHENTICATED', 'Google credential expired');
  return { email: info.email.toLowerCase(), name: info.name || info.email.split('@')[0], pictureUrl: info.picture };
}

function sign(data: string): string {
  const sig = Utilities.computeHmacSha256Signature(data, prop('SESSION_SECRET'));
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');
}

export function issueSession(user: User): string {
  const payload: SessionPayload = {
    e: user.email,
    n: user.name,
    p: user.pictureUrl ?? '',
    x: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400,
  };
  const body = Utilities.base64EncodeWebSafe(JSON.stringify(payload), Utilities.Charset.UTF_8).replace(/=+$/, '');
  return `${body}.${sign(body)}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function verifySession(token: unknown): User {
  if (typeof token !== 'string' || !token.includes('.')) throw new ApiError('UNAUTHENTICATED', 'Please sign in');
  const [body, sig] = token.split('.');
  if (!constantTimeEqual(sign(body), sig)) throw new ApiError('UNAUTHENTICATED', 'Session is invalid, please sign in again');
  const padded = body + '='.repeat((4 - (body.length % 4)) % 4);
  const payload = JSON.parse(
    Utilities.newBlob(Utilities.base64DecodeWebSafe(padded, Utilities.Charset.UTF_8)).getDataAsString('UTF-8'),
  ) as SessionPayload;
  if (payload.x * 1000 < Date.now()) throw new ApiError('UNAUTHENTICATED', 'Session expired, please sign in again');
  return { email: payload.e, name: payload.n, pictureUrl: payload.p || undefined };
}
