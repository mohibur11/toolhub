import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CURRENCIES } from '@shared/money';
import { useCreateGroup } from '../api/hooks';
import EmailChips from '../components/EmailChips';
import { useToast } from '../components/Toast';
import { Modal, Spinner } from '../components/ui';

export default function CreateGroupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreateGroup();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState('BDT');
  const [emails, setEmails] = useState<string[]>([]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      { name, description, currency, memberEmails: emails },
      {
        onSuccess: (d) => {
          toast.success('Group created');
          onClose();
          setName('');
          setDescription('');
          setEmails([]);
          // Open the group with the invite dialog, so the link can be sent straight away.
          navigate(`/g/${d.group.id}`, { state: { invite: d.members.length > 1 } });
        },
      },
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="New group">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="g-name">
            Group name
          </label>
          <input id="g-name" className="input" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Sylhet trip 2026" />
        </div>
        <div>
          <label className="label" htmlFor="g-desc">
            Description
          </label>
          <textarea id="g-desc" className="input" rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        </div>
        <div>
          <label className="label" htmlFor="g-cur">
            Currency
          </label>
          <select id="g-cur" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.symbol} {c.code} — {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Add members (email)</label>
          <EmailChips value={emails} onChange={setEmails} />
          <p className="mt-1 text-xs text-slate-500">
            Use the email of their Google account. Next you'll get a link to send them. You can add more people later.
          </p>
        </div>
        <p className="text-xs text-slate-500">
          The group is saved as a Google Sheet in your Drive and shared only with these people. FairShare has no server, so
          nobody else can see it.
        </p>

        {create.error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{create.error.message}</p>}

        <button type="submit" className="btn-primary w-full" disabled={create.isPending}>
          {create.isPending ? (
            <>
              <Spinner className="h-4 w-4" /> Creating group…
            </>
          ) : (
            'Create group'
          )}
        </button>
      </form>
    </Modal>
  );
}
