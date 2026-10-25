import { useEffect, useState, type FormEvent } from 'react';
import { currencyInfo, minorToInput, toMinor } from '@shared/money';
import type { GroupDetail, Transfer } from '@shared/types';
import { useGroupWrite } from '../api/hooks';
import { todayIso } from '../lib/date';
import { newId } from '../lib/id';
import { useToast } from './Toast';
import { Modal } from './ui';

/** Record a cash/bank/bKash payment between two members (optionally prefilled from the settle plan). */
export default function PaymentModal({
  d,
  me,
  open,
  prefill,
  onClose,
}: {
  d: GroupDetail;
  me: string;
  open: boolean;
  prefill: Transfer | null;
  onClose: () => void;
}) {
  const add = useGroupWrite(d.group.id, 'addPayment');
  const toast = useToast();
  const cur = d.group.currency;
  const active = d.members.filter((m) => m.active);
  const [from, setFrom] = useState(me);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setFrom(prefill?.from ?? me);
    setTo(prefill?.to ?? active.find((m) => m.email !== me)?.email ?? '');
    setAmount(prefill ? minorToInput(prefill.amountMinor, cur) : '');
    setDate(todayIso());
    setNote('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill]);

  const amountMinor = toMinor(amount, cur);
  const valid = from && to && from !== to && Number.isInteger(amountMinor) && amountMinor > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    add.mutate({ payment: { from, to, amountMinor, date, note }, clientId: newId() }, { onSuccess: () => toast.success('Payment recorded') });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Record a payment">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="p-from">
              Who paid
            </label>
            <select id="p-from" className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
              {active.map((m) => (
                <option key={m.email} value={m.email}>
                  {m.email === me ? 'You' : m.displayName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="p-to">
              Paid to
            </label>
            <select id="p-to" className="input" value={to} onChange={(e) => setTo(e.target.value)}>
              {active.map((m) => (
                <option key={m.email} value={m.email}>
                  {m.email === me ? 'You' : m.displayName}
                </option>
              ))}
            </select>
          </div>
        </div>
        {from === to && <p className="text-xs text-rose-600">Pick two different people.</p>}
        <div>
          <label className="label" htmlFor="p-amt">
            Amount ({currencyInfo(cur).symbol})
          </label>
          <input id="p-amt" className="input text-lg font-semibold" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="p-date">
              Date
            </label>
            <input id="p-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="p-note">
              Note
            </label>
            <input id="p-note" className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Cash, bKash…" />
          </div>
        </div>
        <button className="btn-primary w-full" disabled={!valid}>
          Save payment
        </button>
      </form>
    </Modal>
  );
}
