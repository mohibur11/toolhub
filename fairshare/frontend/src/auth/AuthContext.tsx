import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from '@shared/types';
import { api, ApiCallError, onNeedsSignIn, resetApi } from '../api/client';
import { forgetCachedGroups } from '../api/hooks';
import {
  describeSignInError,
  dropToken,
  hasToken,
  lastEmail,
  renewWithPopup,
  signInWithRedirect,
  signOutLocally,
  tokenExpiresAt,
  type RedirectResult,
} from '../google/auth';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: Status;
  user: User | null;
  /** Google access ran out during use; tapping "Continue" (reconnect) renews it. */
  needsReconnect: boolean;
  /** Why the last sign-in failed, for the login page. */
  signInError: string;
  /** Go to Google to sign in (choose the account). */
  signIn: () => void;
  /** Renew Google access with a popup. Call from a click. */
  reconnect: () => Promise<void>;
  signOut: () => void;
  /** Replace the signed-in user's profile (e.g. after changing their name). */
  updateUser: (u: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);
const USER_KEY = 'fairshare.user';

function readUser(): User | null {
  try {
    const v = localStorage.getItem(USER_KEY);
    return v ? (JSON.parse(v) as User) : null;
  } catch {
    return null;
  }
}

function saveUser(u: User | null) {
  try {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
  } catch {
    // ignore
  }
}

export function AuthProvider({ children, redirect }: { children: ReactNode; redirect: RedirectResult }) {
  const queryClient = useQueryClient();
  // With Google access still valid, paint straight away with the last known profile; `me` confirms it.
  const cachedUser = hasToken() ? readUser() : null;
  const [user, setUser] = useState<User | null>(cachedUser);
  const [status, setStatus] = useState<Status>(cachedUser ? 'signedIn' : 'loading');
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [signInError, setSignInError] = useState(redirect && !redirect.ok ? describeSignInError(redirect.error) : '');
  const renewing = useRef(false);

  const remember = useCallback((u: User) => {
    setUser(u);
    saveUser(u);
    setStatus('signedIn');
    setNeedsReconnect(false);
  }, []);

  const signIn = useCallback(() => {
    setSignInError('');
    signInWithRedirect({ chooseAccount: true });
  }, []);

  const signOut = useCallback(() => {
    signOutLocally();
    saveUser(null);
    forgetCachedGroups();
    resetApi();
    queryClient.clear();
    setUser(null);
    setNeedsReconnect(false);
    setStatus('signedOut');
  }, [queryClient]);

  const reconnect = useCallback(async () => {
    await renewWithPopup();
    setNeedsReconnect(false);
    await queryClient.invalidateQueries();
  }, [queryClient]);

  // Start-up: use the token we have, or (for someone who signed in before) fetch a new one without a click.
  useEffect(() => {
    onNeedsSignIn(() => setNeedsReconnect(true));
    const failedJustNow = !!redirect && !redirect.ok;
    if (!hasToken()) {
      if (lastEmail() && !failedJustNow) signInWithRedirect();
      else setStatus('signedOut');
      return;
    }
    api('me', {})
      .then((r) => {
        // Another account signed in on this device: drop what was cached for the previous one.
        if (cachedUser && cachedUser.email !== r.user.email) {
          forgetCachedGroups();
          queryClient.clear();
        }
        remember(r.user);
      })
      .catch((e: ApiCallError) => {
        if (e.code === 'NEEDS_SIGNIN') {
          dropToken();
          if (lastEmail() && !failedJustNow) return signInWithRedirect();
        }
        if (!cachedUser) {
          setSignInError(e.message);
          setStatus('signedOut');
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Renew quietly on a tap shortly before access runs out (browsers allow Google's popup only after a tap),
  // and show the "Continue" banner if it ran out while the app was idle.
  useEffect(() => {
    if (status !== 'signedIn') return;
    const onTap = () => {
      const left = tokenExpiresAt() - Date.now();
      if (renewing.current || left > 5 * 60_000) return;
      renewing.current = true;
      renewWithPopup()
        .then(() => setNeedsReconnect(false))
        .catch(() => !hasToken(0) && setNeedsReconnect(true))
        .finally(() => (renewing.current = false));
    };
    const tick = setInterval(() => !hasToken(0) && setNeedsReconnect(true), 30_000);
    window.addEventListener('pointerdown', onTap, true);
    return () => {
      clearInterval(tick);
      window.removeEventListener('pointerdown', onTap, true);
    };
  }, [status]);

  const updateUser = useCallback((u: User) => {
    setUser(u);
    saveUser(u);
  }, []);

  const value = useMemo(
    () => ({ status, user, needsReconnect, signInError, signIn, reconnect, signOut, updateUser }),
    [status, user, needsReconnect, signInError, signIn, reconnect, signOut, updateUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** The signed-in user; only call inside authenticated routes. */
export function useMe(): User {
  const { user } = useAuth();
  if (!user) throw new Error('Not signed in');
  return user;
}
