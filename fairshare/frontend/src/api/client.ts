import type { ApiAction, ApiActions, ApiErrorCode, ApiResponse } from '@shared/types';
import { API_URL } from '../config';

const TOKEN_KEY = 'fairshare.session';

export class ApiCallError extends Error {
  constructor(
    public code: ApiErrorCode | 'NETWORK',
    message: string,
  ) {
    super(message);
  }
}

let unauthenticatedHandler: (() => void) | null = null;
export function onUnauthenticated(fn: () => void) {
  unauthenticatedHandler = fn;
}

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable (private mode); session lasts for this tab only
  }
}

export async function api<A extends ApiAction>(action: A, payload: ApiActions[A]['req']): Promise<ApiActions[A]['res']> {
  if (!API_URL) throw new ApiCallError('INTERNAL', 'VITE_API_URL is not configured');
  let res: Response;
  try {
    // text/plain keeps this a "simple" request: Apps Script cannot answer CORS preflights.
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: getSessionToken(), payload }),
      redirect: 'follow',
    });
  } catch {
    throw new ApiCallError('NETWORK', 'Network error. Check your connection and try again.');
  }
  if (!res.ok) throw new ApiCallError('NETWORK', `Server error (${res.status})`);
  const body = (await res.json()) as ApiResponse<ApiActions[A]['res']>;
  if (!body.ok) {
    if (body.error.code === 'UNAUTHENTICATED' && action !== 'login') unauthenticatedHandler?.();
    throw new ApiCallError(body.error.code, body.error.message);
  }
  return body.data;
}
