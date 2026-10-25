import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from '@shared/types';
import { api, getSessionToken, onUnauthenticated, setSessionToken } from '../api/client';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: Status;
  user: User | null;
  ownerEmail: string;
  signInWithGoogleCredential: (idToken: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);
const OWNER_KEY = 'fairshare.ownerEmail';
const USER_KEY = 'fairshare.user';

function readJson<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // Optimistically trust a stored session so the app paints instantly; `me` confirms it in the background.
  const cachedUser = getSessionToken() ? readJson<User>(USER_KEY) : null;
  const [user, setUser] = useState<User | null>(cachedUser);
  const [status, setStatus] = useState<Status>(cachedUser ? 'signedIn' : getSessionToken() ? 'loading' : 'signedOut');
  const [ownerEmail, setOwnerEmail] = useState(() => readJson<string>(OWNER_KEY) ?? '');

  const remember = (u: User, owner: string) => {
    setUser(u);
    setOwnerEmail(owner);
    setStatus('signedIn');
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(u));
      localStorage.setItem(OWNER_KEY, JSON.stringify(owner));
    } catch {
      // ignore
    }
  };

  const signOut = useCallback(() => {
    setSessionToken(null);
    try {
      localStorage.removeItem(USER_KEY);
    } catch {
      // ignore
    }
    window.google?.accounts.id.disableAutoSelect();
    queryClient.clear();
    setUser(null);
    setStatus('signedOut');
  }, [queryClient]);

  useEffect(() => {
    onUnauthenticated(signOut);
    if (!getSessionToken()) return;
    api('me', {})
      .then((r) => remember(r.user, r.ownerEmail))
      .catch((e) => {
        if (e.code === 'UNAUTHENTICATED') signOut();
        else if (!cachedUser) setStatus('signedOut');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signInWithGoogleCredential = useCallback(async (idToken: string) => {
    const r = await api('login', { idToken });
    setSessionToken(r.sessionToken);
    remember(r.user, r.ownerEmail);
  }, []);

  const value = useMemo(
    () => ({ status, user, ownerEmail, signInWithGoogleCredential, signOut }),
    [status, user, ownerEmail, signInWithGoogleCredential, signOut],
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
