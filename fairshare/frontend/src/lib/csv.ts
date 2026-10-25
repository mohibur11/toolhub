import { categoryOf } from '@shared/categories';
import { minorToInput } from '@shared/money';
import type { GroupDetail } from '@shared/types';

const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Splitwise-style export: one row per expense/payment, one column per member with their net effect. */
export function groupToCsv(d: GroupDetail): string {
  const cur = d.group.currency;
  const people = d.members.map((m) => m.email);
  const name = (e: string) => d.members.find((m) => m.email === e)?.displayName ?? e;
  const rows: (string | number)[][] = [['Date', 'Description', 'Category', 'Cost', 'Currency', ...people.map(name)]];

  type Row = { date: string; created: string; cells: (string | number)[] };
  const items: Row[] = [];
  for (const e of d.expenses) {
    if (e.deleted) continue;
    const effect = (p: string) =>
      (e.payers.find((x) => x.email === p)?.amountMinor ?? 0) - (e.shares.find((x) => x.email === p)?.shareMinor ?? 0);
    items.push({
      date: e.date,
      created: e.createdAt,
      cells: [e.date, e.description, categoryOf(e.category).label, minorToInput(e.amountMinor, cur), cur, ...people.map((p) => minorToInput(effect(p), cur))],
    });
  }
  for (const p of d.payments) {
    if (p.deleted) continue;
    const effect = (x: string) => (x === p.from ? p.amountMinor : x === p.to ? -p.amountMinor : 0);
    items.push({
      date: p.date,
      created: p.createdAt,
      cells: [p.date, `${name(p.from)} paid ${name(p.to)}`, 'Payment', minorToInput(p.amountMinor, cur), cur, ...people.map((x) => minorToInput(effect(x), cur))],
    });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.created.localeCompare(b.created));
  rows.push(...items.map((i) => i.cells));
  rows.push([]);
  rows.push(['', 'Total balance', '', '', cur, ...people.map((p) => minorToInput(d.balances[p] ?? 0, cur))]);
  return rows.map((r) => r.map(cell).join(',')).join('\n');
}

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
