import { largestRemainder } from './split';
import type { Expense, Payment, Transfer } from './types';

type ExpenseLike = Pick<Expense, 'amountMinor' | 'payers' | 'shares' | 'deleted'>;
type PaymentLike = Pick<Payment, 'from' | 'to' | 'amountMinor' | 'deleted'>;

/**
 * Net balance per person. Positive = others owe them, negative = they owe others.
 * Always sums to zero.
 */
export function computeBalances(
  expenses: ExpenseLike[],
  payments: PaymentLike[],
  members: string[] = [],
): Record<string, number> {
  const net: Record<string, number> = {};
  const add = (email: string, v: number) => (net[email] = (net[email] ?? 0) + v);
  members.forEach((m) => add(m, 0));
  for (const e of expenses) {
    if (e.deleted) continue;
    e.payers.forEach((p) => add(p.email, p.amountMinor));
    e.shares.forEach((s) => add(s.email, -s.shareMinor));
  }
  for (const p of payments) {
    if (p.deleted) continue;
    add(p.from, p.amountMinor); // paying someone back reduces what you owe
    add(p.to, -p.amountMinor);
  }
  return net;
}

/**
 * Minimise the number of transfers needed to settle all balances.
 * 1) settle exact debtor/creditor matches in one step each,
 * 2) greedily match the largest debtor with the largest creditor.
 * Produces at most n-1 transfers. (Finding the true minimum is NP-hard.)
 */
export function simplifyDebts(net: Record<string, number>): Transfer[] {
  const debtors = Object.entries(net)
    .filter(([, v]) => v < 0)
    .map(([email, v]) => ({ email, amt: -v }));
  const creditors = Object.entries(net)
    .filter(([, v]) => v > 0)
    .map(([email, v]) => ({ email, amt: v }));
  const transfers: Transfer[] = [];

  for (const d of debtors) {
    const c = creditors.find((x) => x.amt > 0 && x.amt === d.amt);
    if (c) {
      transfers.push({ from: d.email, to: c.email, amountMinor: d.amt });
      c.amt = 0;
      d.amt = 0;
    }
  }

  const byAmount = (a: { amt: number; email: string }, b: { amt: number; email: string }) =>
    b.amt - a.amt || a.email.localeCompare(b.email);
  for (;;) {
    const ds = debtors.filter((x) => x.amt > 0).sort(byAmount);
    const cs = creditors.filter((x) => x.amt > 0).sort(byAmount);
    if (ds.length === 0 || cs.length === 0) break;
    const d = ds[0];
    const c = cs[0];
    const amt = Math.min(d.amt, c.amt);
    transfers.push({ from: d.email, to: c.email, amountMinor: amt });
    d.amt -= amt;
    c.amt -= amt;
  }
  return transfers;
}

/**
 * Who owes whom without cross-person simplification (Splitwise's "simplify debts" off).
 * Each person's share of an expense is owed to the payers in proportion to what they paid.
 */
export function pairwiseDebts(expenses: ExpenseLike[], payments: PaymentLike[]): Transfer[] {
  const owe = new Map<string, number>(); // key "from|to"
  const add = (from: string, to: string, v: number) => {
    if (from === to || v === 0) return;
    const k = `${from}|${to}`;
    owe.set(k, (owe.get(k) ?? 0) + v);
  };
  for (const e of expenses) {
    if (e.deleted) continue;
    const payerWeights = e.payers.map((p) => p.amountMinor);
    for (const s of e.shares) {
      const parts = largestRemainder(s.shareMinor, payerWeights);
      e.payers.forEach((p, i) => add(s.email, p.email, parts[i]));
    }
  }
  for (const p of payments) {
    if (p.deleted) continue;
    add(p.to, p.from, p.amountMinor); // payment cancels debt from -> to
  }

  const people = new Set<string>();
  owe.forEach((_, k) => k.split('|').forEach((e) => people.add(e)));
  const sorted = [...people].sort();
  const transfers: Transfer[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const d = (owe.get(`${a}|${b}`) ?? 0) - (owe.get(`${b}|${a}`) ?? 0);
      if (d > 0) transfers.push({ from: a, to: b, amountMinor: d });
      else if (d < 0) transfers.push({ from: b, to: a, amountMinor: -d });
    }
  }
  return transfers.sort((x, y) => y.amountMinor - x.amountMinor);
}

/** Balances + settle plan for a group. Used by backend responses and frontend optimistic updates. */
export function deriveGroupState(
  expenses: ExpenseLike[],
  payments: PaymentLike[],
  members: string[],
  simplify: boolean,
): { balances: Record<string, number>; settlePlan: Transfer[] } {
  const balances = computeBalances(expenses, payments, members);
  const settlePlan = simplify ? simplifyDebts(balances) : pairwiseDebts(expenses, payments);
  return { balances, settlePlan };
}
