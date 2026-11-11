import { useState } from 'react';
import { useJoinGroups } from '../api/hooks';
import { useAuth, useMe } from '../auth/AuthContext';
import { pickGroupSheets } from '../google/picker';
import { Spinner } from './ui';

/**
 * Shown when an invite link is opened by an account FairShare can't open the sheet for yet. Selecting the sheet in
 * Google's picker gives FairShare access to that one file (Google's drive.file permission).
 */
export default function JoinGroup({ groupId }: { groupId: string }) {
  const me = useMe();
  const { signOut, signIn } = useAuth();
  const join = useJoinGroups();
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');

  const open = async () => {
    setBusy(true);
    setHint('');
    try {
      const picked = await pickGroupSheets({ fileId: groupId });
      if (!picked.some((p) => p.id === groupId)) {
        setHint(
          `Didn't see the group in the list? It hasn't been shared with ${me.email}. Ask a member to add this email, or use the Google account that was invited.`,
        );
        return;
      }
      await join.mutateAsync([groupId]);
    } catch (e) {
      setHint((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 text-4xl">👋</div>
      <h2 className="text-lg font-semibold">You've been invited to a group</h2>
      <p className="mt-2 max-w-sm text-sm text-slate-600 dark:text-slate-300">
        To open it, select it in Google's file picker (once). This lets FairShare open this group's sheet only; it can't see your
        other files.
      </p>
      <button className="btn-primary mt-5" onClick={open} disabled={busy}>
        {busy ? <Spinner className="h-4 w-4" /> : 'Open the group'}
      </button>
      {hint && <p className="mt-4 max-w-sm text-sm text-amber-700 dark:text-amber-300">{hint}</p>}
      <p className="mt-6 text-xs text-slate-500">
        Signed in as {me.email}.{' '}
        <button
          className="underline"
          onClick={() => {
            signOut();
            signIn();
          }}
        >
          Use another account
        </button>
      </p>
    </div>
  );
}
