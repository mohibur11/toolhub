import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CURRENCIES } from '@shared/money';
import { useCreateGroup } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import EmailChips from '../components/EmailChips';
import { useToast } from '../components/Toast';
import { Icon, Modal, Spinner, useCopy } from '../components/ui';

export default function CreateGroupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ownerEmail } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const copy = useCopy();
  const create = useCreateGroup();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState('BDT');
  const [sheetUrl, setSheetUrl] = useState('');
  const [emails, setEmails] = useState<string[]>([]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      { name, description, currency, sheetUrl, memberEmails: emails },
      {
        onSuccess: (d) => {
          toast.success('Group created');
          onClose();
          setName('');
          setDescription('');
          setSheetUrl('');
          setEmails([]);
          navigate(`/g/${d.group.id}`);
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

        <div className="rounded-2xl bg-brand-50 p-4 text-sm dark:bg-brand-900/20">
          <p className="font-semibold text-brand-900 dark:text-brand-200">Where the data is stored</p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-slate-700 dark:text-slate-300">
            <li>
              <a href="https://sheets.new" target="_blank" rel="noreferrer" className="font-medium text-brand-700 underline dark:text-brand-300">
                Create a blank Google Sheet
              </a>
            </li>
            <li>
              Click <b>Share</b> and add this email as <b>Editor</b>:
              <button
                type="button"
                onClick={async () => (await copy(ownerEmail)) && toast.success('Email copied')}
                className="mt-1 flex w-full items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 font-mono text-xs dark:bg-slate-800"
              >
                <span className="truncate">{ownerEmail || 'FairShare account'}</span>
                <Icon name="copy" className="h-4 w-4 shrink-0" />
              </button>
            </li>
            <li>Paste the sheet link below.</li>
          </ol>
        </div>
        <div>
          <label className="label" htmlFor="g-sheet">
            Google Sheet link
          </label>
          <input
            id="g-sheet"
            className="input"
            required
            value={sheetUrl}
            onChange={(e) => setSheetUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…"
          />
        </div>
        <div>
          <label className="label">Add members (email)</label>
          <EmailChips value={emails} onChange={setEmails} />
          <p className="mt-1 text-xs text-slate-500">You can add more people later.</p>
        </div>

        {create.error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{create.error.message}</p>}

        <button type="submit" className="btn-primary w-full" disabled={create.isPending}>
          {create.isPending ? (
            <>
              <Spinner className="h-4 w-4" /> Setting up your sheet…
            </>
          ) : (
            'Create group'
          )}
        </button>
      </form>
    </Modal>
  );
}
