import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { categoryOf } from '@shared/categories';
import { formatMoney } from '@shared/money';
import type { Expense, GroupDetail } from '@shared/types';
import { useActivity, useGroup, useGroupWrite, useReceipt } from '../api/hooks';
import { useMe } from '../auth/AuthContext';
import { AppBar, Avatar, ErrorState, Icon, ListSkeleton, Modal, Page, Spinner } from '../components/ui';
import { formatDate, relativeTime } from '../lib/date';
import { nameResolver } from '../lib/names';

const METHOD_LABEL = { EQUAL: 'split equally', EXACT: 'split by exact amounts', PERCENT: 'split by percentage', SHARES: 'split by shares' };

export default function ExpenseDetailPage() {
  const { groupId = '', expenseId = '' } = useParams();
  const q = useGroup(groupId);
  const e = q.data?.expenses.find((x) => x.id === expenseId);
  return (
    <>
      <AppBar
        back={`/g/${groupId}`}
        title="Expense"
        subtitle={q.data?.group.name}
        right={
          e &&
          !e.deleted && (
            <Link to={`/g/${groupId}/expense/${expenseId}/edit`} className="btn-ghost" aria-label="Edit">
              <Icon name="edit" />
            </Link>
          )
        }
      />
      <Page>
        {q.isLoading ? (
          <ListSkeleton />
        ) : q.error || !q.data ? (
          <ErrorState error={q.error ?? new Error('Group not found')} />
        ) : !e ? (
          <ErrorState error={new Error('Expense not found')} />
        ) : (
          <Detail d={q.data} e={e} />
        )}
      </Page>
    </>
  );
}

function Detail({ d, e }: { d: GroupDetail; e: Expense }) {
  const me = useMe();
  const navigate = useNavigate();
  const del = useGroupWrite(d.group.id, 'deleteExpense');
  const restore = useGroupWrite(d.group.id, 'restoreExpense');
  const activity = useActivity(d.group.id);
  const [showReceipt, setShowReceipt] = useState(false);
  const name = nameResolver(d.members, me.email);
  const member = (email: string) => d.members.find((m) => m.email === email);
  const cur = d.group.currency;
  const cat = categoryOf(e.category);
  const history = (activity.data ?? []).filter((a) => a.entityType === 'expense' && a.entityId === e.id);

  const people = [...new Set([...e.payers.map((p) => p.email), ...e.shares.map((s) => s.email)])];

  return (
    <div className="space-y-4">
      {e.deleted && (
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-rose-50 p-4 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          <span>This expense was deleted.</span>
          <button className="btn-secondary py-1.5 text-xs" onClick={() => restore.mutate({ expenseId: e.id })} disabled={restore.isPending}>
            Restore
          </button>
        </div>
      )}

      <div className="card p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-3xl dark:bg-slate-800">{cat.emoji}</div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">{e.description}</h2>
            <p className="text-3xl font-bold">{formatMoney(e.amountMinor, cur)}</p>
            <p className="mt-1 text-xs text-slate-500">
              {formatDate(e.date)} · {cat.label} · {METHOD_LABEL[e.splitMethod]}
            </p>
          </div>
        </div>
        <p className="mt-4 text-xs text-slate-500">
          Added by {name(e.createdBy)} {e.createdAt && `on ${formatDate(e.createdAt)}`}
          {e.updatedAt && e.updatedAt !== e.createdAt && ` · last edited by ${name(e.updatedBy)} ${relativeTime(e.updatedAt)}`}
          {e.pending && ' · saving…'}
        </p>
      </div>

      <div className="card divide-y divide-slate-100 dark:divide-slate-800">
        {people.map((email) => {
          const paid = e.payers.find((p) => p.email === email)?.amountMinor ?? 0;
          const share = e.shares.find((s) => s.email === email);
          const m = member(email);
          return (
            <div key={email} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={m?.displayName ?? email} email={email} pictureUrl={m?.pictureUrl} />
              <div className="min-w-0 flex-1 text-sm">
                {paid > 0 && (
                  <p>
                    <b>{name(email)}</b> paid <b>{formatMoney(paid, cur)}</b>
                  </p>
                )}
                {share && (
                  <p className={paid > 0 ? 'text-xs text-slate-500' : ''}>
                    {paid > 0 ? 'and owes' : <><b>{name(email)}</b> {email === me.email ? 'owe' : 'owes'}</>} {formatMoney(share.shareMinor, cur)}
                    {e.splitMethod === 'PERCENT' && ` (${share.input}%)`}
                    {e.splitMethod === 'SHARES' && ` (${share.input} share${share.input === 1 ? '' : 's'})`}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {(e.notes || e.receiptFileId) && (
        <div className="card space-y-3 p-4">
          {e.notes && <p className="whitespace-pre-wrap text-sm">{e.notes}</p>}
          {e.receiptFileId && (
            <button className="btn-secondary w-full" onClick={() => setShowReceipt(true)}>
              <Icon name="receipt" className="h-4 w-4" /> View receipt
            </button>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div>
          <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">History</h3>
          <div className="card divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {history.map((a, i) => (
              <div key={i} className="px-4 py-2.5">
                <p>{a.summary}</p>
                <p className="text-xs text-slate-500">{relativeTime(a.ts)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!e.deleted && (
        <button
          className="btn-danger w-full"
          disabled={e.pending}
          onClick={() => {
            if (!confirm(`Delete "${e.description}"? You can restore it later from Activity.`)) return;
            del.mutate({ expenseId: e.id });
            navigate(`/g/${d.group.id}`);
          }}
        >
          <Icon name="trash" className="h-4 w-4" /> Delete expense
        </button>
      )}

      <ReceiptModal groupId={d.group.id} fileId={e.receiptFileId} open={showReceipt} onClose={() => setShowReceipt(false)} />
    </div>
  );
}

function ReceiptModal({ groupId, fileId, open, onClose }: { groupId: string; fileId: string; open: boolean; onClose: () => void }) {
  const r = useReceipt(groupId, fileId, open);
  return (
    <Modal open={open} onClose={onClose} title="Receipt">
      {r.isLoading ? (
        <div className="flex justify-center py-16 text-brand-600">
          <Spinner className="h-8 w-8" />
        </div>
      ) : r.error ? (
        <p className="text-sm text-rose-600">{r.error.message}</p>
      ) : r.data ? (
        <img src={`data:${r.data.mimeType};base64,${r.data.base64}`} alt="Receipt" className="w-full rounded-xl" />
      ) : null}
    </Modal>
  );
}
