import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/ui';
import { GOOGLE_CLIENT_ID, TOOLHUB_URL } from '../config';

export default function LoginPage() {
  const { signInWithGoogleCredential } = useAuth();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    // The GIS script loads async; poll briefly until it is ready.
    const init = () => {
      if (cancelled) return;
      const gis = window.google?.accounts.id;
      if (!gis || !buttonRef.current) return void setTimeout(init, 100);
      gis.initialize({
        client_id: GOOGLE_CLIENT_ID!,
        auto_select: true,
        callback: async ({ credential }) => {
          setBusy(true);
          setError('');
          try {
            await signInWithGoogleCredential(credential);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        },
      });
      gis.renderButton(buttonRef.current, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: 280 });
      gis.prompt();
    };
    init();
    return () => {
      cancelled = true;
    };
  }, [signInWithGoogleCredential]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-brand-50 to-white px-6 dark:from-slate-900 dark:to-slate-950">
      <img src="./icon.svg" alt="" className="mb-6 h-20 w-20 rounded-3xl shadow-lg shadow-brand-600/20" />
      <h1 className="text-3xl font-bold tracking-tight">FairShare</h1>
      <p className="mt-2 max-w-xs text-center text-slate-600 dark:text-slate-300">
        Track shared expenses on trips and events, then settle up with the fewest payments.
      </p>
      <ul className="mt-8 space-y-2 text-sm text-slate-600 dark:text-slate-300">
        <li>✓ Split equally, by amount, percent or shares</li>
        <li>✓ Simplified “who pays whom” settle-up</li>
        <li>✓ No setup, just sign in with Google</li>
      </ul>
      <div className="mt-10 flex min-h-[44px] items-center justify-center">
        {busy && (
          <span className="flex items-center gap-2 text-sm text-slate-600">
            <Spinner /> Signing you in…
          </span>
        )}
        {/* Keep mounted so the Google-rendered button survives a failed attempt. */}
        <div ref={buttonRef} className={busy ? 'hidden' : ''} />
      </div>
      {error && <p className="mt-4 max-w-xs text-center text-sm text-rose-600">{error}</p>}
      <p className="mt-8 max-w-xs text-center text-xs text-slate-500">
        Sign-in shares only your name, email and profile photo. Group data is stored in the FairShare owner's Google account and
        is visible to that account; in the app, only your group's members see it.
      </p>
      <p className="mt-4 text-xs text-slate-400">
        Free forever · no ads ·{' '}
        <a href="./privacy.html" className="underline hover:text-slate-600">
          Privacy
        </a>{' '}
        ·{' '}
        <a href={TOOLHUB_URL} className="underline hover:text-slate-600">
          more tools on Toolhub
        </a>
      </p>
    </div>
  );
}
