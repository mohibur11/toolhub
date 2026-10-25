import { describe, expect, it } from 'vitest';
import { computeShares, largestRemainder, SplitError, validatePayers } from './split';
import { formatMoney, minorToInput, toMinor } from './money';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('largestRemainder', () => {
  it('sums exactly to total', () => {
    expect(largestRemainder(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(largestRemainder(10, [1, 0, 1])).toEqual([5, 0, 5]);
    expect(sum(largestRemainder(9999, [3, 7, 11, 13]))).toBe(9999);
  });
  it('never gives remainder to zero weights', () => {
    expect(largestRemainder(1, [0, 0, 1])).toEqual([0, 0, 1]);
  });
});

describe('computeShares', () => {
  it('EQUAL splits remainder deterministically by email', () => {
    const shares = computeShares(10000, 'EQUAL', [{ email: 'c@x' }, { email: 'a@x' }, { email: 'b@x' }]);
    expect(shares).toEqual([
      { email: 'a@x', shareMinor: 3334 },
      { email: 'b@x', shareMinor: 3333 },
      { email: 'c@x', shareMinor: 3333 },
    ]);
  });

  it('EXACT requires sum to match', () => {
    expect(() =>
      computeShares(1000, 'EXACT', [
        { email: 'a', value: 500 },
        { email: 'b', value: 400 },
      ]),
    ).toThrow(SplitError);
    const ok = computeShares(1000, 'EXACT', [
      { email: 'a', value: 1000 },
      { email: 'b', value: 0 },
    ]);
    expect(ok).toEqual([{ email: 'a', shareMinor: 1000, input: 1000 }]);
  });

  it('PERCENT requires 100 and rounds exactly', () => {
    expect(() =>
      computeShares(1000, 'PERCENT', [
        { email: 'a', value: 50 },
        { email: 'b', value: 49 },
      ]),
    ).toThrow(/100%/);
    const shares = computeShares(1000, 'PERCENT', [
      { email: 'a', value: 33.33 },
      { email: 'b', value: 33.33 },
      { email: 'c', value: 33.34 },
    ]);
    expect(sum(shares.map((s) => s.shareMinor))).toBe(1000);
  });

  it('SHARES is weight-proportional', () => {
    const shares = computeShares(9000, 'SHARES', [
      { email: 'couple', value: 2 },
      { email: 'single', value: 1 },
    ]);
    expect(shares.map((s) => s.shareMinor)).toEqual([6000, 3000]);
  });

  it('rejects empty, duplicate, and non-positive amounts', () => {
    expect(() => computeShares(100, 'EQUAL', [])).toThrow(SplitError);
    expect(() => computeShares(100, 'EQUAL', [{ email: 'a' }, { email: 'a' }])).toThrow(SplitError);
    expect(() => computeShares(0, 'EQUAL', [{ email: 'a' }])).toThrow(SplitError);
    expect(() => computeShares(1.5, 'EQUAL', [{ email: 'a' }])).toThrow(SplitError);
  });

  it('random splits always sum to amount', () => {
    for (let t = 0; t < 1000; t++) {
      const amount = 1 + Math.floor(Math.random() * 1_000_000);
      const n = 1 + Math.floor(Math.random() * 10);
      const inputs = Array.from({ length: n }, (_, i) => ({ email: `p${i}`, value: 1 + Math.floor(Math.random() * 5) }));
      const shares = computeShares(amount, 'SHARES', inputs);
      expect(sum(shares.map((s) => s.shareMinor))).toBe(amount);
    }
  });
});

describe('validatePayers', () => {
  it('accepts multiple payers summing to total', () => {
    expect(
      validatePayers(1000, [
        { email: 'a', amountMinor: 600 },
        { email: 'b', amountMinor: 400 },
      ]),
    ).toHaveLength(2);
  });
  it('rejects mismatched totals and no payer', () => {
    expect(() => validatePayers(1000, [{ email: 'a', amountMinor: 900 }])).toThrow(SplitError);
    expect(() => validatePayers(1000, [])).toThrow(SplitError);
  });
});

describe('money', () => {
  it('parses user input to minor units without float drift', () => {
    expect(toMinor('1.005', 'USD')).toBe(101);
    expect(toMinor('1,250.5', 'BDT')).toBe(125050);
    expect(toMinor('0.1', 'USD') + toMinor('0.2', 'USD')).toBe(30);
    expect(toMinor('100', 'JPY')).toBe(100);
    expect(toMinor('abc', 'USD')).toBeNaN();
    expect(toMinor('', 'USD')).toBeNaN();
  });
  it('formats', () => {
    expect(formatMoney(125050, 'BDT')).toBe('৳1,250.50');
    expect(formatMoney(-500, 'USD')).toBe('-$5.00');
    expect(formatMoney(-500, 'USD', { abs: true })).toBe('$5.00');
    expect(minorToInput(125050, 'BDT')).toBe('1250.50');
  });
});
