import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney } from '@shared/money';
import type { GroupSummary } from '@shared/types';
import { useGroups } from '../api/hooks';
import { useAuth, useMe } from '../auth/AuthContext';
import CreateGroupModal from './CreateGroupModal';
import { AppBar, Avatar, AvatarStack, Balance, EmptyState, ErrorState, Icon, ListSkeleton, Page } from '../components/ui';
import { TOOLHUB_URL } from '../config';
import { relativeTime } from '../lib/date';

export default function DashboardPage() {
  const me = useMe();
  const { signOut } = useAuth();
  const groups = useGroups();
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const list = groups.data ?? [];
  const active = list.filter((g) => !g.archived);
  const archived = list.filter((g) => g.archived);

  return (
    <>
      <AppBar
        title="FairShare"
        right={
          <div className="relative">
            <button onClick={() => setMenu((m) => !m)} aria-label="Account menu">
              <Avatar name={me.name} email={me.email} pictureUrl={me.pictureUrl} size={34} />
            </button>
            {menu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                <div className="card absolute right-0 z-20 mt-2 w-60 p-2">
                  <div className="px-3 py-2">
                    <p className="truncate text-sm font-semibold">{me.name}</p>
                    <p className="truncate text-xs text-slate-500">{me.email}</p>
                  </div>
                  <a href={TOOLHUB_URL} className="btn-ghost w-full justify-start">
                    <Icon name="back" /> Back to Toolhub
                  </a>
                  <button onClick={signOut} className="btn-ghost w-full justify-start">
                    <Icon name="logout" /> Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        }
      />
      <Page>
        <Summary groups={active} />

        <div className="mb-3 mt-6 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Your groups</h2>
          <button className="btn-primary py-2" onClick={() => setCreating(true)}>
            <Icon name="plus" className="h-4 w-4" /> New group
          </button>
        </div>

        {groups.isLoading ? (
          <ListSkeleton />
        ) : groups.error ? (
          <ErrorState error={groups.error} onRetry={() => groups.refetch()} />
        ) : active.length === 0 ? (
          <EmptyState emoji="🧳" title="No groups yet">
            Create a group for your next trip, flat or event, and add friends by email.
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {active.map((g) => (
              <GroupCard key={g.id} g={g} />
            ))}
          </div>
        )}

        {archived.length > 0 && (
          <div className="mt-8">
            <button className="text-sm font-medium text-slate-500" onClick={() => setShowArchived((s) => !s)}>
              {showArchived ? 'Hide' : 'Show'} archived groups ({archived.length})
            </button>
            {showArchived && (
              <div className="mt-3 space-y-3 opacity-70">
                {archived.map((g) => (
                  <GroupCard key={g.id} g={g} />
                ))}
              </div>
            )}
          </div>
        )}
      </Page>
      <CreateGroupModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function Summary({ groups }: { groups: GroupSummary[] }) {
  // Totals per currency: groups may use different currencies.
  const byCur = new Map<string, { owed: number; owe: number }>();
  for (const g of groups) {
    const t = byCur.get(g.currency) ?? { owed: 0, owe: 0 };
    if (g.myNetMinor > 0) t.owed += g.myNetMinor;
    else t.owe -= g.myNetMinor;
    byCur.set(g.currency, t);
  }
  const rows = [...byCur.entries()].filter(([, t]) => t.owed || t.owe);
  return (
    <div className="card overflow-hidden bg-gradient-to-br from-brand-600 to-brand-800 p-5 text-white ring-0">
      <p className="text-sm font-medium text-brand-100">Overall</p>
      {rows.length === 0 ? (
        <p className="mt-1 text-2xl font-bold">You're all settled up 🎉</p>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-brand-200">You are owed</p>
            {rows.map(([cur, t]) => (
              <p key={cur} className="text-xl font-bold">
                {formatMoney(t.owed, cur)}
              </p>
            ))}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-brand-200">You owe</p>
            {rows.map(([cur, t]) => (
              <p key={cur} className="text-xl font-bold">
                {formatMoney(t.owe, cur)}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GroupCard({ g }: { g: GroupSummary }) {
  return (
    <Link to={`/g/${g.id}`} className="card flex items-center gap-4 p-4 transition hover:ring-brand-300 active:scale-[0.99]">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-lg font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
        {g.name.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{g.name}</p>
        <div className="mt-1 flex items-center gap-2">
          <AvatarStack people={g.memberPreview} max={4} />
          <span className="text-xs text-slate-500">· {relativeTime(g.lastActivityAt)}</span>
        </div>
      </div>
      <div className="text-right text-sm">
        {g.myNetMinor === 0 ? (
          <span className="text-slate-500">settled up</span>
        ) : (
          <>
            <p className={`text-xs ${g.myNetMinor > 0 ? 'text-owed' : 'text-owe'}`}>{g.myNetMinor > 0 ? 'you are owed' : 'you owe'}</p>
            <Balance minor={g.myNetMinor} currency={g.currency} />
          </>
        )}
      </div>
    </Link>
  );
}
