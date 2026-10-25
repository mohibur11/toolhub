import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CATEGORIES } from '@shared/categories';
import { currencyInfo, formatMoney, minorToInput, toMinor } from '@shared/money';
import { computeShares, SplitError, validatePayers } from '@shared/split';
import type { Expense, ExpenseInput, GroupDetail, Member, Payer, Share, SplitInput, SplitMethod } from '@shared/types';
import { api } from '../api/client';
import { useGroup, useGroupWrite } from '../api/hooks';
import { useMe } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { AppBar, Avatar, ErrorState, Icon, ListSkeleton, Page, Spinner } from '../components/ui';
import { todayIso } from '../lib/date';
import { newId } from '../lib/id';
import { compressImage } from '../lib/image';

const METHODS: { id: SplitMethod; label: string; hint: string }[] = [
  { id: 'EQUAL', label: 'Equally', hint: 'Split evenly between selected people' },
  { id: 'EXACT', label: 'Amounts', hint: 'Enter exactly how much each person owes' },
  { id: 'PERCENT', label: 'Percent', hint: 'Enter a percentage for each person' },
  { id: 'SHARES', label: 'Shares', hint: 'e.g. a couple = 2 shares, a single = 1' },
];

export default function ExpenseFormPage() {
  const { groupId = '', expenseId } = useParams();
  const q = useGroup(groupId);
  const existing = expenseId ? q.data?.expenses.find((e) => e.id === expenseId) : undefined;
  const title = expenseId ? 'Edit expense' : 'Add expense';

  return (
    <>
      <AppBar back title={title} subtitle={q.data?.group.name} />
      <Page>
        {q.isLoading ? (
          <ListSkeleton />
        ) : q.error || !q.data ? (
          <ErrorState error={q.error ?? new Error('Group not found')} />
        ) : expenseId && !existing ? (
          <ErrorState error={new Error('Expense not found')} />
        ) : (
          <ExpenseForm d={q.data} existing={existing} />
        )}
      </Page>
    </>
  );
}

type Values = Record<string, string>;

function initialState(d: GroupDetail, me: string, e?: Expense) {
  const cur = d.group.currency;
  const active = d.members.filter((m) => m.active).map((m) => m.email);
  const values: Record<SplitMethod, Values> = { EQUAL: {}, EXACT: {}, PERCENT: {}, SHARES: {} };
  if (!e) {
    return {
      description: '',
      amount: '',
      date: todayIso(),
      category: 'general',
      notes: '',
      receiptFileId: '',
      multiPayer: false,
      payer: me,
      payerAmounts: {} as Values,
      method: 'EQUAL' as SplitMethod,
      included: new Set(active),
      values,
    };
  }
  const shareInput = (s: Share) => (e.splitMethod === 'EXACT' ? minorToInput(s.shareMinor, cur) : String(s.input ?? ''));
  e.shares.forEach((s) => (values[e.splitMethod][s.email] = shareInput(s)));
  return {
    description: e.description,
    amount: minorToInput(e.amountMinor, cur),
    date: e.date,
    category: e.category,
    notes: e.notes,
    receiptFileId: e.receiptFileId,
    multiPayer: e.payers.length > 1,
    payer: e.payers[0]?.email ?? me,
    payerAmounts: Object.fromEntries(e.payers.map((p) => [p.email, minorToInput(p.amountMinor, cur)])) as Values,
    method: e.splitMethod,
    included: new Set(e.splitMethod === 'EQUAL' ? e.shares.map((s) => s.email) : active),
    values,
  };
}

function ExpenseForm({ d, existing }: { d: GroupDetail; existing?: Expense }) {
  const me = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const add = useGroupWrite(d.group.id, 'addExpense');
  const update = useGroupWrite(d.group.id, 'updateExpense');
  const cur = d.group.currency;
  const symbol = currencyInfo(cur).symbol;
  const members = d.members.filter((m) => m.active);
  const init = useMemo(() => initialState(d, me.email, existing), []); // eslint-disable-line react-hooks/exhaustive-deps

  const [description, setDescription] = useState(init.description);
  const [amount, setAmount] = useState(init.amount);
  const [date, setDate] = useState(init.date);
  const [category, setCategory] = useState(init.category);
  const [notes, setNotes] = useState(init.notes);
  const [receiptFileId, setReceiptFileId] = useState(init.receiptFileId);
  const [receiptPreview, setReceiptPreview] = useState('');
  const [uploading, setUploading] = useState(false);
  const [multiPayer, setMultiPayer] = useState(init.multiPayer);
  const [payer, setPayer] = useState(init.payer);
  const [payerAmounts, setPayerAmounts] = useState<Values>(init.payerAmounts);
  const [method, setMethod] = useState<SplitMethod>(init.method);
  const [included, setIncluded] = useState<Set<string>>(init.included);
  const [values, setValues] = useState(init.values);
  const [showCategories, setShowCategories] = useState(false);
  const [showNotes, setShowNotes] = useState(!!init.notes);
  const fileRef = useRef<HTMLInputElement>(null);

  const amountMinor = toMinor(amount, cur);
  const amountOk = Number.isInteger(amountMinor) && amountMinor > 0;

  // Shares default to 1 per person the first time "Shares" is chosen.
  useEffect(() => {
    if (method === 'SHARES' && Object.keys(values.SHARES).length === 0)
      setValues((v) => ({ ...v, SHARES: Object.fromEntries(members.map((m) => [m.email, '1'])) }));
  }, [method]); // eslint-disable-line react-hooks/exhaustive-deps

  const payers: Payer[] = multiPayer
    ? members.map((m) => ({ email: m.email, amountMinor: payerAmounts[m.email] ? toMinor(payerAmounts[m.email], cur) : 0 }))
    : [{ email: payer, amountMinor: amountOk ? amountMinor : 0 }];

  const splitInputs: SplitInput[] =
    method === 'EQUAL'
      ? members.filter((m) => included.has(m.email)).map((m) => ({ email: m.email }))
      : members.map((m) => {
          const raw = values[method][m.email] ?? '';
          const value = raw === '' ? 0 : method === 'EXACT' ? toMinor(raw, cur) : Number(raw);
          return { email: m.email, value };
        });

  // Live validation using the exact same logic the server runs.
  const { shares, error } = useMemo(() => {
    if (!amountOk) return { shares: [] as Share[], error: amount ? 'Enter a valid amount' : '' };
    try {
      validatePayers(amountMinor, payers);
      return { shares: computeShares(amountMinor, method, splitInputs), error: '' };
    } catch (e) {
      return { shares: [] as Share[], error: e instanceof SplitError ? e.message : String(e) };
    }
  }, [amountMinor, amountOk, amount, JSON.stringify(payers), method, JSON.stringify(splitInputs)]); // eslint-disable-line react-hooks/exhaustive-deps

  const shareOf = (email: string) => shares.find((s) => s.email === email)?.shareMinor ?? 0;

  const remaining = (() => {
    if (!amountOk) return null;
    if (method === 'EXACT') {
      const left = amountMinor - splitInputs.reduce((a, s) => a + (Number.isFinite(s.value) ? (s.value ?? 0) : 0), 0);
      return left === 0 ? null : `${formatMoney(Math.abs(left), cur)} ${left > 0 ? 'left to assign' : 'over the total'}`;
    }
    if (method === 'PERCENT') {
      const left = Math.round((100 - splitInputs.reduce((a, s) => a + (s.value ?? 0), 0)) * 100) / 100;
      return left === 0 ? null : `${Math.abs(left)}% ${left > 0 ? 'left' : 'over'}`;
    }
    return null;
  })();

  const payerRemaining = multiPayer && amountOk ? amountMinor - payers.reduce((a, p) => a + (Number.isFinite(p.amountMinor) ? p.amountMinor : 0), 0) : 0;

  const onReceipt = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const { base64, dataUrl } = await compressImage(file);
      const { fileId } = await api('uploadReceipt', { groupId: d.group.id, base64, mimeType: 'image/jpeg', fileName: file.name });
      setReceiptFileId(fileId);
      setReceiptPreview(dataUrl);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const canSave = !!description.trim() && amountOk && !error && !uploading;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    const input: ExpenseInput = {
      description: description.trim(),
      category,
      amountMinor,
      date,
      splitMethod: method,
      payers: payers.filter((p) => p.amountMinor > 0),
      splitInputs,
      notes,
      receiptFileId,
    };
    if (existing) {
      update.mutate({ expenseId: existing.id, expense: input }, { onSuccess: () => toast.success('Expense updated') });
      navigate(`/g/${d.group.id}/expense/${existing.id}`, { replace: true });
    } else {
      add.mutate({ expense: input, clientId: newId() }, { onSuccess: () => toast.success('Expense saved') });
      navigate(`/g/${d.group.id}`, { replace: true });
    }
  };

  const cat = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0];

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Description + amount */}
      <div className="card space-y-4 p-4">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setShowCategories((s) => !s)}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-2xl dark:bg-slate-800"
            aria-label={`Category: ${cat.label}`}
            title={cat.label}
          >
            {cat.emoji}
          </button>
          <input
            className="input h-12 text-base"
            placeholder="What was it for?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={120}
            required
            autoFocus={!existing}
          />
        </div>
        {showCategories && (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {CATEGORIES.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => {
                  setCategory(c.id);
                  setShowCategories(false);
                }}
                className={`flex flex-col items-center gap-1 rounded-xl p-2 text-[11px] ${category === c.id ? 'bg-brand-100 text-brand-800 dark:bg-brand-900/50 dark:text-brand-200' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              >
                <span className="text-xl">{c.emoji}</span>
                <span className="line-clamp-1">{c.label.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-lg font-semibold text-slate-400">{symbol}</span>
            <input
              className="input h-14 pl-10 text-2xl font-bold"
              style={{ paddingLeft: `${1.25 + symbol.length * 0.7}rem` }}
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <input type="date" className="input h-14 w-40" value={date} onChange={(e) => setDate(e.target.value)} required aria-label="Date" />
        </div>
      </div>

      {/* Paid by */}
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="label mb-0">Paid by</span>
          <button type="button" className="text-xs font-semibold text-brand-700 dark:text-brand-400" onClick={() => setMultiPayer((m) => !m)}>
            {multiPayer ? 'Single payer' : 'Multiple people paid'}
          </button>
        </div>
        {!multiPayer ? (
          <div className="flex flex-wrap gap-2">
            {members.map((m) => (
              <PersonPill key={m.email} m={m} me={me.email} selected={payer === m.email} onClick={() => setPayer(m.email)} />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {members.map((m) => (
              <PersonRow key={m.email} m={m} me={me.email}>
                <AmountInput
                  prefix={symbol}
                  value={payerAmounts[m.email] ?? ''}
                  onChange={(v) => setPayerAmounts((p) => ({ ...p, [m.email]: v }))}
                />
              </PersonRow>
            ))}
            {amountOk && payerRemaining !== 0 && (
              <p className="text-right text-xs font-medium text-orange-600">
                {formatMoney(Math.abs(payerRemaining), cur)} {payerRemaining > 0 ? 'left to assign' : 'over the total'}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Split */}
      <div className="card p-4">
        <span className="label">Split</span>
        <div className="mb-2 grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {METHODS.map((m) => (
            <button
              type="button"
              key={m.id}
              onClick={() => setMethod(m.id)}
              className={`rounded-lg py-2 text-xs font-semibold transition ${method === m.id ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white' : 'text-slate-500'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mb-3 text-xs text-slate-500">{METHODS.find((m) => m.id === method)!.hint}</p>

        {method === 'EQUAL' && (
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              className="text-xs font-semibold text-brand-700 dark:text-brand-400"
              onClick={() => setIncluded(included.size === members.length ? new Set() : new Set(members.map((m) => m.email)))}
            >
              {included.size === members.length ? 'Select none' : 'Select all'}
            </button>
          </div>
        )}

        <div className="space-y-2">
          {members.map((m) => (
            <PersonRow key={m.email} m={m} me={me.email} sub={amountOk && shareOf(m.email) > 0 ? `owes ${formatMoney(shareOf(m.email), cur)}` : undefined}>
              {method === 'EQUAL' ? (
                <input
                  type="checkbox"
                  className="h-5 w-5 rounded accent-brand-600"
                  checked={included.has(m.email)}
                  onChange={(e) => {
                    const next = new Set(included);
                    if (e.target.checked) next.add(m.email);
                    else next.delete(m.email);
                    setIncluded(next);
                  }}
                  aria-label={`Include ${m.displayName}`}
                />
              ) : (
                <AmountInput
                  prefix={method === 'EXACT' ? symbol : undefined}
                  suffix={method === 'PERCENT' ? '%' : method === 'SHARES' ? 'sh' : undefined}
                  value={values[method][m.email] ?? ''}
                  onChange={(v) => setValues((all) => ({ ...all, [method]: { ...all[method], [m.email]: v } }))}
                />
              )}
            </PersonRow>
          ))}
        </div>
        {remaining && <p className="mt-2 text-right text-xs font-medium text-orange-600">{remaining}</p>}
        {method === 'EQUAL' && amountOk && included.size > 0 && (
          <p className="mt-2 text-right text-xs text-slate-500">
            {formatMoney(Math.floor(amountMinor / included.size), cur)} per person
          </p>
        )}
      </div>

      {/* Extras */}
      <div className="card space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Receipt</span>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onReceipt(e.target.files?.[0])} />
          {receiptFileId ? (
            <div className="flex items-center gap-2">
              {receiptPreview ? <img src={receiptPreview} alt="Receipt" className="h-10 w-10 rounded-lg object-cover" /> : <Icon name="receipt" className="h-5 w-5 text-brand-600" />}
              <span className="text-xs text-slate-500">Attached</span>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  setReceiptFileId('');
                  setReceiptPreview('');
                }}
              >
                Remove
              </button>
            </div>
          ) : (
            <button type="button" className="btn-secondary py-2 text-xs" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="receipt" className="h-4 w-4" />}
              {uploading ? 'Uploading…' : 'Add photo'}
            </button>
          )}
        </div>
        {showNotes ? (
          <textarea className="input" rows={2} maxLength={1000} placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        ) : (
          <button type="button" className="text-sm font-medium text-brand-700 dark:text-brand-400" onClick={() => setShowNotes(true)}>
            + Add notes
          </button>
        )}
      </div>

      {error && <p className="rounded-xl bg-orange-50 p-3 text-sm text-orange-800 dark:bg-orange-950/40 dark:text-orange-200">{error}</p>}

      <div className="sticky bottom-4 z-10">
        <button type="submit" className="btn-primary w-full py-3.5 text-base shadow-lg shadow-brand-600/25" disabled={!canSave}>
          {existing ? 'Save changes' : 'Save expense'}
        </button>
      </div>
    </form>
  );
}

function PersonPill({ m, me, selected, onClick }: { m: Member; me: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm transition ${
        selected ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200'
      }`}
    >
      <Avatar name={m.displayName} email={m.email} pictureUrl={m.pictureUrl} size={26} />
      {m.email === me ? 'You' : m.displayName.split(' ')[0]}
    </button>
  );
}

function PersonRow({ m, me, sub, children }: { m: Member; me: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar name={m.displayName} email={m.email} pictureUrl={m.pictureUrl} size={32} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{m.email === me ? 'You' : m.displayName}</p>
        {sub && <p className="text-xs text-slate-500">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

function AmountInput({ value, onChange, prefix, suffix }: { value: string; onChange: (v: string) => void; prefix?: string; suffix?: string }) {
  return (
    <div className="relative w-32">
      {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{prefix}</span>}
      <input
        className={`input py-2 text-right ${prefix ? 'pl-8' : ''} ${suffix ? 'pr-9' : ''}`}
        inputMode="decimal"
        placeholder="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{suffix}</span>}
    </div>
  );
}
