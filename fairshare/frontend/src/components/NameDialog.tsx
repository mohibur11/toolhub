import { useEffect, useState, type FormEvent } from 'react';
import { Modal, Spinner } from './ui';

/** Edit a display name. Saving an empty field (or "Use default") restores `defaultName`. */
export default function NameDialog({
  open,
  title,
  hint,
  current,
  defaultName,
  saving,
  onSave,
  onClose,
}: {
  open: boolean;
  title: string;
  hint: string;
  current: string;
  defaultName: string;
  saving: boolean;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(current);
  useEffect(() => {
    if (open) setValue(current);
  }, [open, current]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(value.trim());
  };

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">{hint}</p>
        <input className="input" value={value} onChange={(e) => setValue(e.target.value)} maxLength={40} placeholder={defaultName} autoFocus />
        <p className="text-xs text-slate-500">
          Leave empty to use the default: <b>{defaultName}</b>
        </p>
        <div className="flex gap-3">
          {current && (
            <button type="button" className="btn-secondary flex-1" disabled={saving} onClick={() => onSave('')}>
              Use default
            </button>
          )}
          <button type="submit" className="btn-primary flex-1" disabled={saving || value.trim() === current}>
            {saving ? <Spinner className="h-4 w-4" /> : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
