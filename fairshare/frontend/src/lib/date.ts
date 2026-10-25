/** Today's date in the user's local timezone as YYYY-MM-DD. */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const parse = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

export function formatDate(iso: string): string {
  if (!iso) return '';
  return parse(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function monthLabel(iso: string): string {
  return parse(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function dayParts(iso: string): { month: string; day: string } {
  const d = parse(iso);
  return { month: d.toLocaleDateString(undefined, { month: 'short' }), day: String(d.getDate()) };
}

export function relativeTime(isoTs: string): string {
  const diff = (Date.now() - new Date(isoTs).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(isoTs).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
