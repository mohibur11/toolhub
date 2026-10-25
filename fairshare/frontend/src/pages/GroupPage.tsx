import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { categoryOf } from '@shared/categories';
import { formatMoney } from '@shared/money';
import type { Expense, GroupDetail, Payment, Transfer } from '@shared/types';
import { useActivity, useGroup, useGroupWrite } from '../api/hooks';
import { useMe } from '../auth/AuthContext';
import PaymentModal from '../components/PaymentModal';
import { AppBar, Avatar, Balance, EmptyState, ErrorState, Fab, Icon, ListSkeleton, Page, Skeleton, Spinner, Tabs } from '../components/ui';
import { dayParts, monthLabel, relativeTime } from '../lib/date';
import { nameResolver } from '../lib/names';

type Tab = 'expenses' | 'balances' | 'settle' | 'activity';

export default function GroupPage() {
  const { groupId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'expenses';
  const me = useMe();
  const q = useGroup(groupId);
  const d = q.data;

  return (
    <>
      <AppBar
        back="/"
        title={d?.group.name ?? 'Loading…'}
        subtitle={d ? `${d.members.filter((m) => m.active).length} members · ${d.group.currency}` : undefined}
        right={
          <Link to={`/g/${groupId}/settings`} className="btn-ghost" aria-label="Group settings">
            <Icon name="settings" />
          </Link>
        }
      />
      <Page>
        {q.isLoading ? (
          <>
            <Skeleton className="mb-4 h-24" />
            <ListSkeleton />
          </>
        ) : q.error || !d ? (
          <ErrorState error={q.error ?? new Error('Group not found')} onRetry={() => q.refetch()} />
        ) : (
          <>
            <MyBalanceCard d={d} me={me.email} />
            <div className="my-4">
              <Tabs
                value={tab}
                onChange={(t) => setParams(t === 'expenses' ? {} : { tab: t }, { replace: true })}
                tabs={[
                  { id: 'expenses', label: 'Expenses' },
                  { id: 'balances', label: 'Balances' },
                  { id: 'settle', label: 'Settle up' },
                  { id: 'activity', label: 'Activity' },
                ]}
              />
            </div>
            {tab === 'expenses' && <ExpensesTab d={d} me={me.email} />}
            {tab === 'balances' && <BalancesTab d={d} me={me.email} />}
            {tab === 'settle' && <SettleTab d={d} me={me.email} />}
            {tab === 'activity' && <ActivityTab d={d} me={me.email} />}
          </>
        )}
      </Page>
      {d && !d.group.archived && <Fab to={`/g/${groupId}/expense/new`} label="Add expense" />}
    </>
  );
}

function MyBalanceCard({ d, me }: { d: GroupDetail; me: string }) {
  const net = d.balances[me] ?? 0;
  const name = nameResolver(d.members, me);
  const mine = d.settlePlan.filter((t) => t.from === me || t.to === me);
  return (
    <div className="card p-5">
      {d.group.description && <p className="mb-3 text-sm text-slate-500">{d.group.description}</p>}
      {net === 0 ? (
        <p className="text-lg font-semibold">You are all settled up ✨</p>
      ) : (
        <p className="text-lg font-semibold">
          {net > 0 ? 'You are owed ' : 'You owe '}
          <Balance minor={net} currency={d.group.currency} className="text-lg" />
          {' overall'}
        </p>
      )}
      {mine.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-sm text-slate-600 dark:text-slate-300">
          {mine.slice(0, 4).map((t) => (
            <li key={t.from + t.to}>
              {t.from === me ? (
                <>
                  You owe {name(t.to)} <span className="text-owe font-medium">{formatMoney(t.amountMinor, d.group.currency)}</span>
                </>
              ) : (
                <>
                  {name(t.from)} owes you <span className="text-owed font-medium">{formatMoney(t.amountMinor, d.group.currency)}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------- Expenses ----------------

type FeedItem = { kind: 'expense'; date: string; created: string; e: Expense } | { kind: 'payment'; date: string; created: string; p: Payment };

function ExpensesTab({ d, me }: { d: GroupDetail; me: string }) {
  const [search, setSearch] = useState('');
  const [openPayment, setOpenPayment] = useState<Payment | null>(null);
  const name = nameResolver(d.members, me);
  const cur = d.group.currency;

  const groups = useMemo(() => {
    const s = search.trim().toLowerCase();
    const items: FeedItem[] = [
      ...d.expenses
        .filter((e) => !e.deleted && (!s || e.description.toLowerCase().includes(s) || categoryOf(e.category).label.toLowerCase().includes(s)))
        .map((e) => ({ kind: 'expense' as const, date: e.date, created: e.createdAt, e })),
      ...d.payments
        .filter((p) => !p.deleted && (!s || 'payment'.includes(s) || name(p.from).toLowerCase().includes(s) || name(p.to).toLowerCase().includes(s)))
        .map((p) => ({ kind: 'payment' as const, date: p.date, created: p.createdAt, p })),
    ].sort((a, b) => b.date.localeCompare(a.date) || b.created.localeCompare(a.created));
    const byMonth = new Map<string, FeedItem[]>();
    items.forEach((i) => {
      const k = i.date.slice(0, 7);
      byMonth.set(k, [...(byMonth.get(k) ?? []), i]);
    });
    return [...byMonth.entries()];
  }, [d, search, name]);

  const totalSpent = d.expenses.filter((e) => !e.deleted).reduce((a, e) => a + e.amountMinor, 0);
  const myShare = d.expenses.filter((e) => !e.deleted).reduce((a, e) => a + (e.shares.find((s) => s.email === me)?.shareMinor ?? 0), 0);

  if (d.expenses.length === 0 && d.payments.length === 0)
    return (
      <EmptyState emoji="🧾" title="No expenses yet">
        Tap “Add expense” to record the first one.
      </EmptyState>
    );

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Stat label="Group spending" value={formatMoney(totalSpent, cur)} />
        <Stat label="Your share" value={formatMoney(myShare, cur)} />
      </div>
      <div className="relative mb-4">
        <Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input className="input pl-9" placeholder="Search expenses" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {groups.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No matches</p>}
      {groups.map(([month, items]) => (
        <section key={month} className="mb-5">
          <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{monthLabel(month + '-01')}</h3>
          <div className="card divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((i) =>
              i.kind === 'expense' ? (
                <ExpenseRow key={i.e.id} e={i.e} d={d} me={me} />
              ) : (
                <button key={i.p.id} onClick={() => setOpenPayment(i.p)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                  <DateBadge iso={i.p.date} />
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300">
                    <Icon name="cash" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-medium ${i.p.pending ? 'opacity-60' : ''}`}>
                      {name(i.p.from)} paid {name(i.p.to)}
                    </p>
                    {i.p.note && <p className="truncate text-xs text-slate-500">{i.p.note}</p>}
                  </div>
                  <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{formatMoney(i.p.amountMinor, cur)}</span>
                </button>
              ),
            )}
          </div>
        </section>
      ))}
      <PaymentDetailModal d={d} me={me} payment={openPayment} onClose={() => setOpenPayment(null)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 font-semibold">{value}</p>
    </div>
  );
}

function DateBadge({ iso }: { iso: string }) {
  const { month, day } = dayParts(iso);
  return (
    <div className="w-9 shrink-0 text-center leading-tight text-slate-500">
      <div className="text-[10px] uppercase">{month}</div>
      <div className="text-base font-semibold">{day}</div>
    </div>
  );
}

function ExpenseRow({ e, d, me }: { e: Expense; d: GroupDetail; me: string }) {
  const name = nameResolver(d.members, me);
  const cur = d.group.currency;
  const cat = categoryOf(e.category);
  const paid = e.payers.find((p) => p.email === me)?.amountMinor ?? 0;
  const share = e.shares.find((s) => s.email === me)?.shareMinor ?? 0;
  const lent = paid - share;
  const payerText = e.payers.length === 1 ? `${name(e.payers[0].email)} paid` : `${e.payers.length} people paid`;
  return (
    <Link to={`/g/${d.group.id}/expense/${e.id}`} className={`flex items-center gap-3 px-4 py-3 ${e.pending ? 'opacity-60' : ''}`}>
      <DateBadge iso={e.date} />
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xl dark:bg-slate-800">{cat.emoji}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {e.description} {e.receiptFileId && <Icon name="receipt" className="inline h-3.5 w-3.5 text-slate-400" />}
        </p>
        <p className="truncate text-xs text-slate-500">
          {payerText} {formatMoney(e.amountMinor, cur)}
          {e.pending && ' · saving…'}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {lent === 0 ? (
          <span className="text-xs text-slate-400">{share === 0 ? 'not involved' : 'no balance'}</span>
        ) : (
          <>
            <p className={`text-[11px] ${lent > 0 ? 'text-owed' : 'text-owe'}`}>{lent > 0 ? 'you lent' : 'you borrowed'}</p>
            <p className={`text-sm font-semibold ${lent > 0 ? 'text-owed' : 'text-owe'}`}>{formatMoney(Math.abs(lent), cur)}</p>
          </>
        )}
      </div>
    </Link>
  );
}

function PaymentDetailModal({ d, me, payment, onClose }: { d: GroupDetail; me: string; payment: Payment | null; onClose: () => void }) {
  const del = useGroupWrite(d.group.id, 'deletePayment');
  const name = nameResolver(d.members, me);
  if (!payment) return null;
  return (
    <PaymentShell onClose={onClose}>
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30">
          <Icon name="cash" className="h-7 w-7" />
        </div>
        <p className="text-2xl font-bold">{formatMoney(payment.amountMinor, d.group.currency)}</p>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {name(payment.from)} paid {name(payment.to)}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {payment.date}
          {payment.createdBy && ` · recorded by ${name(payment.createdBy)}`}
        </p>
        {payment.note && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800">{payment.note}</p>}
      </div>
      <button
        className="btn-danger mt-6 w-full"
        disabled={payment.pending}
        onClick={() => {
          if (!confirm('Delete this payment? Balances will be recalculated.')) return;
          del.mutate({ paymentId: payment.id });
          onClose();
        }}
      >
        <Icon name="trash" className="h-4 w-4" /> Delete payment
      </button>
    </PaymentShell>
  );
}

function PaymentShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full rounded-t-3xl bg-white p-6 shadow-xl dark:bg-slate-900 sm:max-w-sm sm:rounded-3xl">{children}</div>
    </div>
  );
}

// ---------------- Balances ----------------

function BalancesTab({ d, me }: { d: GroupDetail; me: string }) {
  const cur = d.group.currency;
  const rows = d.members
    .filter((m) => m.active || (d.balances[m.email] ?? 0) !== 0)
    .map((m) => ({ m, net: d.balances[m.email] ?? 0 }))
    .sort((a, b) => b.net - a.net);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.net)));
  const paidBy = (email: string) =>
    d.expenses.filter((e) => !e.deleted).reduce((a, e) => a + (e.payers.find((p) => p.email === email)?.amountMinor ?? 0), 0);
  return (
    <div className="card divide-y divide-slate-100 dark:divide-slate-800">
      {rows.map(({ m, net }) => (
        <div key={m.email} className="px-4 py-3">
          <div className="flex items-center gap-3">
            <Avatar name={m.displayName} email={m.email} pictureUrl={m.pictureUrl} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {m.displayName}
                {m.email === me && <span className="text-slate-400"> (you)</span>}
              </p>
              <p className="text-xs text-slate-500">paid {formatMoney(paidBy(m.email), cur)} in total</p>
            </div>
            <div className="text-right">
              {net !== 0 && <p className={`text-[11px] ${net > 0 ? 'text-owed' : 'text-owe'}`}>{net > 0 ? 'gets back' : 'owes'}</p>}
              <Balance minor={net} currency={cur} className="text-sm" />
            </div>
          </div>
          <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="flex w-1/2 justify-end">{net < 0 && <div className="h-full rounded-l-full bg-orange-400" style={{ width: `${(-net / max) * 100}%` }} />}</div>
            <div className="flex w-1/2">{net > 0 && <div className="h-full rounded-r-full bg-emerald-500" style={{ width: `${(net / max) * 100}%` }} />}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------- Settle up ----------------

function SettleTab({ d, me }: { d: GroupDetail; me: string }) {
  const [prefill, setPrefill] = useState<Transfer | null | 'blank'>(null);
  const name = nameResolver(d.members, me);
  const member = (email: string) => d.members.find((m) => m.email === email);
  const cur = d.group.currency;
  const plan = [...d.settlePlan].sort((a, b) => Number(b.from === me || b.to === me) - Number(a.from === me || a.to === me));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between px-1">
        <p className="text-sm text-slate-500">
          {d.group.simplifyDebts ? 'Simplified: fewest payments to settle everyone.' : 'Showing direct debts (simplify is off).'}
        </p>
      </div>
      {plan.length === 0 ? (
        <EmptyState emoji="🎉" title="Everyone is settled up">
          No payments needed.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {plan.map((t) => {
            const mine = t.from === me || t.to === me;
            const from = member(t.from);
            const to = member(t.to);
            return (
              <div key={t.from + t.to} className={`card p-4 ${mine ? 'ring-2 ring-brand-400 dark:ring-brand-600' : ''}`}>
                <div className="flex items-center gap-3">
                  <Avatar name={from?.displayName ?? t.from} email={t.from} pictureUrl={from?.pictureUrl} />
                  <Icon name="arrow" className="h-4 w-4 text-slate-400" />
                  <Avatar name={to?.displayName ?? t.to} email={t.to} pictureUrl={to?.pictureUrl} />
                  <div className="min-w-0 flex-1 pl-1">
                    <p className="truncate text-sm">
                      <b>{name(t.from)}</b> {t.from === me ? 'pay' : 'pays'} <b>{name(t.to)}</b>
                    </p>
                    <p className="text-lg font-bold">{formatMoney(t.amountMinor, cur)}</p>
                  </div>
                </div>
                <button className={`${mine ? 'btn-primary' : 'btn-secondary'} mt-3 w-full`} onClick={() => setPrefill(t)}>
                  <Icon name="check" className="h-4 w-4" /> Mark as paid
                </button>
              </div>
            );
          })}
        </div>
      )}
      <button className="btn-secondary mt-4 w-full" onClick={() => setPrefill('blank')}>
        <Icon name="cash" className="h-4 w-4" /> Record a different payment
      </button>
      <PaymentModal
        d={d}
        me={me}
        open={prefill !== null}
        prefill={prefill === 'blank' ? null : prefill}
        onClose={() => setPrefill(null)}
      />
    </div>
  );
}

// ---------------- Activity ----------------

function ActivityTab({ d, me }: { d: GroupDetail; me: string }) {
  const q = useActivity(d.group.id);
  const restore = useGroupWrite(d.group.id, 'restoreExpense');
  const name = nameResolver(d.members, me);
  if (q.isLoading) return <ListSkeleton rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const deletedIds = new Set(d.expenses.filter((e) => e.deleted).map((e) => e.id));
  const icon: Record<string, string> = { add: '➕', update: '✏️', delete: '🗑️', restore: '♻️', create: '✨', remove: '👋', leave: '👋', archive: '📦', unarchive: '📤' };
  return (
    <div className="card divide-y divide-slate-100 dark:divide-slate-800">
      {(q.data ?? []).map((a, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3">
          <div className="mt-0.5 text-lg">{icon[a.action] ?? '•'}</div>
          <div className="min-w-0 flex-1">
            <p className="text-sm">{a.summary}</p>
            <p className="text-xs text-slate-500">
              {name(a.actor)} · {relativeTime(a.ts)}
            </p>
          </div>
          {a.entityType === 'expense' && a.action === 'delete' && deletedIds.has(a.entityId) && (
            <button className="btn-secondary px-3 py-1.5 text-xs" disabled={restore.isPending} onClick={() => restore.mutate({ expenseId: a.entityId })}>
              {restore.isPending ? <Spinner className="h-3 w-3" /> : 'Restore'}
            </button>
          )}
        </div>
      ))}
      {q.data?.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No activity yet</p>}
    </div>
  );
}
