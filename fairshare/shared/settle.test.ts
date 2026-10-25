import { describe, expect, it } from 'vitest';
import { computeBalances, deriveGroupState, pairwiseDebts, simplifyDebts } from './settle';
import { computeShares } from './split';
import type { Transfer } from './types';

const exp = (payers: [string, number][], shares: [string, number][], deleted = false) => ({
  amountMinor: payers.reduce((a, [, v]) => a + v, 0),
  payers: payers.map(([email, amountMinor]) => ({ email, amountMinor })),
  shares: shares.map(([email, shareMinor]) => ({ email, shareMinor })),
  deleted,
});

function applyTransfers(net: Record<string, number>, transfers: Transfer[]) {
  const out = { ...net };
  for (const t of transfers) {
    out[t.from] += t.amountMinor;
    out[t.to] -= t.amountMinor;
  }
  return out;
}

describe('computeBalances', () => {
  it('nets payers, shares, and payments; sums to zero', () => {
    const net = computeBalances(
      [exp([['a', 300]], [['a', 100], ['b', 100], ['c', 100]]), exp([['b', 60]], [['a', 30], ['c', 30]], true)],
      [{ from: 'b', to: 'a', amountMinor: 50, deleted: false }],
      ['a', 'b', 'c', 'd'],
    );
    expect(net).toEqual({ a: 150, b: -50, c: -100, d: 0 });
  });
});

describe('simplifyDebts', () => {
  it('settles everyone with few transfers', () => {
    const net = { a: 150, b: -50, c: -100 };
    const t = simplifyDebts(net);
    expect(t).toEqual([
      { from: 'c', to: 'a', amountMinor: 100 },
      { from: 'b', to: 'a', amountMinor: 50 },
    ]);
  });

  it('prefers exact matches', () => {
    const t = simplifyDebts({ a: 500, b: 300, c: -300, d: -500 });
    expect(t).toHaveLength(2);
  });

  it('random groups: settles to zero with <= n-1 transfers', () => {
    for (let trial = 0; trial < 1000; trial++) {
      const n = 2 + Math.floor(Math.random() * 9);
      const people = Array.from({ length: n }, (_, i) => `p${i}`);
      const expenses = Array.from({ length: 1 + Math.floor(Math.random() * 15) }, () => {
        const amount = 1 + Math.floor(Math.random() * 100000);
        const payer = people[Math.floor(Math.random() * n)];
        const parts = people.filter(() => Math.random() < 0.7);
        const inputs = (parts.length ? parts : [payer]).map((email) => ({ email }));
        return {
          amountMinor: amount,
          payers: [{ email: payer, amountMinor: amount }],
          shares: computeShares(amount, 'EQUAL', inputs),
          deleted: false,
        };
      });
      const net = computeBalances(expenses, [], people);
      expect(Object.values(net).reduce((a, b) => a + b, 0)).toBe(0);
      const t = simplifyDebts(net);
      expect(t.length).toBeLessThanOrEqual(n - 1);
      expect(t.every((x) => x.amountMinor > 0)).toBe(true);
      expect(Object.values(applyTransfers(net, t)).every((v) => v === 0)).toBe(true);
      // pairwise mode must settle the same balances too
      expect(Object.values(applyTransfers(net, pairwiseDebts(expenses, []))).every((v) => v === 0)).toBe(true);
    }
  });
});

describe('pairwiseDebts', () => {
  it('splits debt across multiple payers proportionally', () => {
    const t = pairwiseDebts([exp([['a', 600], ['b', 400]], [['a', 500], ['b', 500]])], []);
    // a paid 100 more than share; b paid 100 less
    expect(t).toEqual([{ from: 'b', to: 'a', amountMinor: 100 }]);
  });
  it('payments reduce pairwise debt', () => {
    const t = pairwiseDebts(
      [exp([['a', 200]], [['a', 100], ['b', 100]])],
      [{ from: 'b', to: 'a', amountMinor: 100, deleted: false }],
    );
    expect(t).toEqual([]);
  });
});

describe('deriveGroupState', () => {
  it('switches plan by simplify flag', () => {
    const expenses = [exp([['a', 100]], [['b', 100]]), exp([['b', 100]], [['c', 100]])];
    expect(deriveGroupState(expenses, [], ['a', 'b', 'c'], true).settlePlan).toEqual([
      { from: 'c', to: 'a', amountMinor: 100 },
    ]);
    expect(deriveGroupState(expenses, [], ['a', 'b', 'c'], false).settlePlan).toHaveLength(2);
  });
});
