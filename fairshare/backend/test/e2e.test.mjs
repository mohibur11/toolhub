// End-to-end test of the bundled backend (dist/Code.js) against in-memory Apps Script fakes.
// Run: npm -w backend test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeGas } from './fakeGas.mjs';

const gas = createFakeGas();
gas.setup();

function login(email, name) {
  const r = gas.call('login', { idToken: `valid:${email}:${name}` });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.data.sessionToken;
}
function ok(r) {
  assert.equal(r.ok, true, JSON.stringify(r.error));
  return r.data;
}
function err(r, code) {
  assert.equal(r.ok, false, 'expected an error');
  assert.equal(r.error.code, code, r.error.message);
  return r.error;
}
const sumBalances = (b) => Object.values(b).reduce((a, x) => a + x, 0);

const A = login('alice@gmail.com', 'Alice');
const B = login('bob@gmail.com', 'Bob');
const C = login('carol@gmail.com', 'Carol');
const X = login('mallory@gmail.com', 'Mallory');
let groupId;

test('auth', () => {
  err(gas.call('login', { idToken: 'garbage' }), 'UNAUTHENTICATED');
  err(gas.call('listGroups', {}, 'not.a.token'), 'UNAUTHENTICATED');
  err(gas.call('listGroups', {}, A.slice(0, -2) + 'xx'), 'UNAUTHENTICATED');
  assert.equal(ok(gas.call('me', {}, A)).user.email, 'alice@gmail.com');
});

test('create group validates sheet access', () => {
  const unshared = gas.newSpreadsheet('Untitled spreadsheet', { shared: false });
  const e = err(
    gas.call('createGroup', { name: 'Trip', description: '', currency: 'BDT', sheetUrl: unshared.getUrl(), memberEmails: [] }, A),
    'SHEET_ACCESS',
  );
  assert.match(e.message, /owner@gmail.com/);
  err(gas.call('createGroup', { name: 'Trip', currency: 'BDT', sheetUrl: 'not a link', memberEmails: [] }, A), 'INVALID');
});

test('create group initialises sheet and memberships', () => {
  const ss = gas.newSpreadsheet('Untitled spreadsheet');
  const d = ok(
    gas.call(
      'createGroup',
      {
        name: "Cox's Bazar trip",
        description: 'Dec 2026',
        currency: 'BDT',
        sheetUrl: ss.getUrl(),
        memberEmails: ['BOB@gmail.com', 'carol@gmail.com', 'alice@gmail.com'],
      },
      A,
    ),
  );
  groupId = d.group.id;
  assert.equal(d.members.length, 3);
  assert.equal(d.members.find((m) => m.email === 'alice@gmail.com').role, 'owner');
  assert.deepEqual(
    ss.getSheets().map((s) => s.getName()).sort(),
    ['Activity', 'Expenses', 'Members', 'Meta', 'Payments'],
  );
  assert.equal(ss.getName(), "FairShare – Cox's Bazar trip");
  // same sheet cannot be reused
  err(gas.call('createGroup', { name: 'Again', currency: 'BDT', sheetUrl: ss.getUrl(), memberEmails: [] }, B), 'CONFLICT');
  // bob sees it on his dashboard
  const list = ok(gas.call('listGroups', {}, B));
  assert.equal(list.length, 1);
  assert.equal(list[0].memberCount, 3);
});

test('non-members are rejected', () => {
  err(gas.call('getGroup', { groupId }, X), 'FORBIDDEN');
  err(gas.call('addExpense', { groupId, expense: {} }, X), 'FORBIDDEN');
});

test('expenses with every split method', () => {
  const base = { category: 'food', date: '2026-12-01', notes: '', receiptFileId: '' };
  // Alice pays 300.00 split equally between all three
  ok(
    gas.call('addExpense', {
      groupId,
      clientId: 'exp-0000-0001',
      expense: {
        ...base,
        description: 'Dinner',
        amountMinor: 30000,
        splitMethod: 'EQUAL',
        payers: [{ email: 'alice@gmail.com', amountMinor: 30000 }],
        splitInputs: [{ email: 'alice@gmail.com' }, { email: 'bob@gmail.com' }, { email: 'carol@gmail.com' }],
      },
    }, A),
  );
  // retry with same clientId is idempotent
  let d = ok(
    gas.call('addExpense', {
      groupId,
      clientId: 'exp-0000-0001',
      expense: {
        ...base,
        description: 'Dinner',
        amountMinor: 30000,
        splitMethod: 'EQUAL',
        payers: [{ email: 'alice@gmail.com', amountMinor: 30000 }],
        splitInputs: [{ email: 'alice@gmail.com' }],
      },
    }, A),
  );
  assert.equal(d.expenses.length, 1);

  // Bob + Carol pay hotel 1000 (600/400), split by percent
  ok(
    gas.call('addExpense', {
      groupId,
      expense: {
        ...base,
        description: 'Hotel',
        category: 'hotel',
        amountMinor: 100000,
        splitMethod: 'PERCENT',
        payers: [
          { email: 'bob@gmail.com', amountMinor: 60000 },
          { email: 'carol@gmail.com', amountMinor: 40000 },
        ],
        splitInputs: [
          { email: 'alice@gmail.com', value: 50 },
          { email: 'bob@gmail.com', value: 25 },
          { email: 'carol@gmail.com', value: 25 },
        ],
      },
    }, B),
  );
  // Carol pays 90, split by shares 2:1 (Alice x2)
  ok(
    gas.call('addExpense', {
      groupId,
      expense: {
        ...base,
        description: '=HYPERLINK("http://evil")',
        amountMinor: 9000,
        splitMethod: 'SHARES',
        payers: [{ email: 'carol@gmail.com', amountMinor: 9000 }],
        splitInputs: [
          { email: 'alice@gmail.com', value: 2 },
          { email: 'bob@gmail.com', value: 1 },
        ],
      },
    }, C),
  );
  // Exact split
  d = ok(
    gas.call('addExpense', {
      groupId,
      expense: {
        ...base,
        description: 'Taxi',
        amountMinor: 5000,
        splitMethod: 'EXACT',
        payers: [{ email: 'alice@gmail.com', amountMinor: 5000 }],
        splitInputs: [
          { email: 'bob@gmail.com', value: 2000 },
          { email: 'carol@gmail.com', value: 3000 },
        ],
      },
    }, A),
  );
  assert.equal(d.expenses.length, 4);
  // formula text round-trips as plain text
  assert.equal(d.expenses[2].description, '=HYPERLINK("http://evil")');
  // Alice: paid 300+50, owes 100 + 500 + 60 = 660  -> -310
  // Bob:   paid 600, owes 100 + 250 + 30 + 20 = 400 -> +200
  // Carol: paid 400+90, owes 100 + 250 + 30 = 380   -> +110
  assert.deepEqual(d.balances, { 'alice@gmail.com': -31000, 'bob@gmail.com': 20000, 'carol@gmail.com': 11000 });
  assert.equal(sumBalances(d.balances), 0);
  assert.deepEqual(d.settlePlan, [
    { from: 'alice@gmail.com', to: 'bob@gmail.com', amountMinor: 20000 },
    { from: 'alice@gmail.com', to: 'carol@gmail.com', amountMinor: 11000 },
  ]);
});

test('expense validation', () => {
  const bad = {
    description: 'x',
    category: 'food',
    date: '2026-12-01',
    amountMinor: 1000,
    splitMethod: 'EXACT',
    notes: '',
    receiptFileId: '',
    payers: [{ email: 'alice@gmail.com', amountMinor: 1000 }],
    splitInputs: [{ email: 'bob@gmail.com', value: 999 }],
  };
  assert.match(err(gas.call('addExpense', { groupId, expense: bad }, A), 'INVALID').message, /add up/);
  const outsider = { ...bad, splitMethod: 'EQUAL', splitInputs: [{ email: 'mallory@gmail.com' }] };
  assert.match(err(gas.call('addExpense', { groupId, expense: outsider }, A), 'INVALID').message, /not a member/);
});

test('edit, delete, restore expense', () => {
  let d = ok(gas.call('getGroup', { groupId }, B));
  const taxi = d.expenses.find((e) => e.description === 'Taxi');
  d = ok(
    gas.call('updateExpense', {
      groupId,
      expenseId: taxi.id,
      expense: {
        description: 'Taxi (fixed)',
        category: 'transport',
        date: '2026-12-02',
        amountMinor: 6000,
        splitMethod: 'EQUAL',
        notes: 'airport',
        receiptFileId: '',
        payers: [{ email: 'alice@gmail.com', amountMinor: 6000 }],
        splitInputs: [{ email: 'bob@gmail.com' }, { email: 'carol@gmail.com' }],
      },
    }, B),
  );
  assert.equal(d.expenses.find((e) => e.id === taxi.id).amountMinor, 6000);
  assert.equal(sumBalances(d.balances), 0);
  d = ok(gas.call('deleteExpense', { groupId, expenseId: taxi.id }, C));
  assert.equal(d.expenses.find((e) => e.id === taxi.id).deleted, true);
  d = ok(gas.call('restoreExpense', { groupId, expenseId: taxi.id }, C));
  assert.equal(d.expenses.find((e) => e.id === taxi.id).deleted, false);
});

test('settle up via payments zeroes balances', () => {
  let d = ok(gas.call('getGroup', { groupId }, A));
  for (const t of d.settlePlan) {
    d = ok(gas.call('addPayment', { groupId, payment: { ...t, date: '2026-12-05', note: 'bkash' } }, A));
  }
  assert.ok(Object.values(d.balances).every((v) => v === 0), JSON.stringify(d.balances));
  assert.deepEqual(d.settlePlan, []);
  const list = ok(gas.call('listGroups', {}, A));
  assert.equal(list[0].myNetMinor, 0);
  // delete a payment -> balance returns
  d = ok(gas.call('deletePayment', { groupId, paymentId: d.payments[0].id }, A));
  assert.notEqual(d.settlePlan.length, 0);
  err(gas.call('addPayment', { groupId, payment: { from: 'bob@gmail.com', to: 'bob@gmail.com', amountMinor: 5, date: '2026-12-05' } }, A), 'INVALID');
});

test('simplify toggle switches to pairwise debts', () => {
  const d = ok(gas.call('updateGroup', { groupId, simplifyDebts: false }, B));
  assert.equal(d.group.simplifyDebts, false);
  assert.equal(sumBalances(d.balances), 0);
  ok(gas.call('updateGroup', { groupId, simplifyDebts: true }, B));
});

test('members: add, remove rules, leave', () => {
  let d = ok(gas.call('addMember', { groupId, email: 'dave@gmail.com' }, B));
  assert.equal(d.members.filter((m) => m.active).length, 4);
  err(gas.call('addMember', { groupId, email: 'dave@gmail.com' }, B), 'CONFLICT');
  err(gas.call('removeMember', { groupId, email: 'dave@gmail.com' }, B), 'FORBIDDEN'); // only owner
  err(gas.call('removeMember', { groupId, email: 'alice@gmail.com' }, A), 'FORBIDDEN'); // owner can't leave
  d = ok(gas.call('getGroup', { groupId }, A));
  const debtor = Object.entries(d.balances).find(([, v]) => v !== 0)[0];
  if (debtor !== 'alice@gmail.com') err(gas.call('removeMember', { groupId, email: debtor }, A), 'CONFLICT');
  d = ok(gas.call('removeMember', { groupId, email: 'dave@gmail.com' }, A));
  assert.equal(d.members.find((m) => m.email === 'dave@gmail.com').active, false);
  const dave = login('dave@gmail.com', 'Dave');
  assert.equal(ok(gas.call('listGroups', {}, dave)).length, 0);
});

test('activity log', () => {
  const log = ok(gas.call('getActivity', { groupId, limit: 5 }, C));
  assert.equal(log.length, 5);
  assert.equal(log[0].entityType, 'member'); // newest first
});

test('receipts are private to the group', () => {
  const png = Buffer.from('fake image bytes').toString('base64');
  const { fileId } = ok(gas.call('uploadReceipt', { groupId, base64: png, mimeType: 'image/png', fileName: 'r.png' }, B));
  const r = ok(gas.call('getReceipt', { groupId, fileId }, C));
  assert.equal(r.base64, png);
  err(gas.call('getReceipt', { groupId, fileId }, X), 'FORBIDDEN');
  err(gas.call('uploadReceipt', { groupId, base64: png, mimeType: 'application/pdf', fileName: 'x' }, B), 'INVALID');
});

test('cache returns consistent data', () => {
  const d1 = ok(gas.call('getGroup', { groupId }, A));
  const d2 = ok(gas.call('getGroup', { groupId }, B));
  assert.deepEqual(d1, d2);
});
