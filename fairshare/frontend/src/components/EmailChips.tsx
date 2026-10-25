import { useState, type KeyboardEvent } from 'react';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Type emails separated by Enter, comma or space; each becomes a removable chip. */
export default function EmailChips({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const commit = (text: string) => {
    const parts = text.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return;
    const bad = parts.find((p) => !EMAIL_RE.test(p));
    if (bad) {
      setError(`"${bad}" is not a valid email`);
      return;
    }
    onChange([...new Set([...value, ...parts])]);
    setDraft('');
    setError('');
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', ',', ' ', 'Tab'].includes(e.key) && draft.trim()) {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div>
      <div className="input flex min-h-[44px] flex-wrap items-center gap-1.5 py-2">
        {value.map((email) => (
          <span key={email} className="flex items-center gap-1 rounded-full bg-brand-100 py-0.5 pl-2.5 pr-1 text-xs font-medium text-brand-800 dark:bg-brand-900/50 dark:text-brand-200">
            {email}
            <button type="button" onClick={() => onChange(value.filter((v) => v !== email))} className="rounded-full px-1 hover:bg-brand-200 dark:hover:bg-brand-800" aria-label={`Remove ${email}`}>
              ×
            </button>
          </span>
        ))}
        <input
          type="email"
          className="min-w-[10rem] flex-1 bg-transparent text-sm outline-none"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => draft && commit(draft)}
          onPaste={(e) => {
            e.preventDefault();
            commit(e.clipboardData.getData('text'));
          }}
          placeholder={value.length ? '' : 'friend@gmail.com'}
        />
      </div>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
