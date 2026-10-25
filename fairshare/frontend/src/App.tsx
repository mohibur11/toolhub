import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Spinner } from './components/ui';
import { API_URL, GOOGLE_CLIENT_ID } from './config';
import DashboardPage from './pages/DashboardPage';
import ExpenseDetailPage from './pages/ExpenseDetailPage';
import ExpenseFormPage from './pages/ExpenseFormPage';
import GroupPage from './pages/GroupPage';
import GroupSettingsPage from './pages/GroupSettingsPage';
import LoginPage from './pages/LoginPage';

export default function App() {
  const { status } = useAuth();

  if (!API_URL || !GOOGLE_CLIENT_ID) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <div className="card p-6">
          <h1 className="text-lg font-semibold">FairShare is not configured</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Fill in <code>js/fairshare-config.js</code> in the Toolhub repo (or <code>fairshare/frontend/.env.local</code> for local
            development). See <code>fairshare/README.md</code> for setup steps.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'loading')
    return (
      <div className="flex h-screen items-center justify-center text-brand-600">
        <Spinner className="h-8 w-8" />
      </div>
    );
  if (status === 'signedOut') return <LoginPage />;

  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/g/:groupId" element={<GroupPage />} />
      <Route path="/g/:groupId/settings" element={<GroupSettingsPage />} />
      <Route path="/g/:groupId/expense/new" element={<ExpenseFormPage />} />
      <Route path="/g/:groupId/expense/:expenseId" element={<ExpenseDetailPage />} />
      <Route path="/g/:groupId/expense/:expenseId/edit" element={<ExpenseFormPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
