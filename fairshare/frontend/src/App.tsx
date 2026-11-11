import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Spinner } from './components/ui';
import { GOOGLE_API_KEY, GOOGLE_CLIENT_ID } from './config';
import { signInWithRedirect } from './google/auth';
import DashboardPage from './pages/DashboardPage';
import ExpenseDetailPage from './pages/ExpenseDetailPage';
import ExpenseFormPage from './pages/ExpenseFormPage';
import GroupPage from './pages/GroupPage';
import GroupSettingsPage from './pages/GroupSettingsPage';
import LoginPage from './pages/LoginPage';

export default function App() {
  const { status, needsReconnect } = useAuth();

  if (!GOOGLE_CLIENT_ID || !GOOGLE_API_KEY) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <div className="card p-6">
          <h1 className="text-lg font-semibold">FairShare is not configured</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Fill in <code>googleClientId</code> and <code>googleApiKey</code> in <code>js/fairshare-config.js</code> in the Toolhub repo (or{' '}
            <code>fairshare/frontend/.env.local</code> for local development). See <code>fairshare/README.md</code> for setup steps.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'loading')
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-brand-600">
        <Spinner className="h-8 w-8" />
        <p className="text-sm text-slate-500">Signing you in with Google…</p>
      </div>
    );
  if (status === 'signedOut') return <LoginPage />;

  return (
    <>
      {needsReconnect && <ReconnectBanner />}
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/g/:groupId" element={<GroupPage />} />
        <Route path="/g/:groupId/settings" element={<GroupSettingsPage />} />
        <Route path="/g/:groupId/expense/new" element={<ExpenseFormPage />} />
        <Route path="/g/:groupId/expense/:expenseId" element={<ExpenseDetailPage />} />
        <Route path="/g/:groupId/expense/:expenseId/edit" element={<ExpenseFormPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

/** Google access lasts about an hour. Renewing it needs a tap, because browsers only allow Google's popup then. */
function ReconnectBanner() {
  const { reconnect } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="sticky top-0 z-50 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-2">
        <span className="flex-1">{error || 'Your Google sign-in timed out. Tap Continue to keep going.'}</span>
        {error ? (
          <button className="btn-secondary py-1.5" onClick={() => signInWithRedirect()}>
            Reload and sign in
          </button>
        ) : (
          <button
            className="btn-primary py-1.5"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              reconnect()
                .catch((e: Error) => setError(`${e.message} Unsaved changes on this screen will be lost if you reload.`))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? <Spinner className="h-4 w-4" /> : 'Continue'}
          </button>
        )}
      </div>
    </div>
  );
}
