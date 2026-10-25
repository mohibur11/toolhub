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

test('setup builds the Drive layout and is idempotent', () => {
  const folderName = (prop) => gas.files.get(gas.props.get(prop)).name;
  assert.equal(folderName('APP_FOLDER_ID'), 'FairShare');
  for (const [prop, name] of [['GROUPS_FOLDER_ID', 'Groups'], ['RECEIPTS_FOLDER_ID', 'Receipts'], ['BACKUP_FOLDER_ID', 'Backups']]) {
    assert.equal(folderName(prop), name);
    assert.equal(gas.files.get(gas.props.get(prop)).parent, gas.props.get('APP_FOLDER_ID'));
  }
  assert.equal(gas.files.get(gas.props.get('REGISTRY_SHEET_ID')).parent, gas.props.get('APP_FOLDER_ID'));
  assert.deepEqual(gas.triggers.map((t) => t.fn), ['weeklyBackup']);
  gas.setup();
  assert.equal(gas.triggers.length, 1, 'setup must not add a second trigger');
});

test('create group makes an app-owned spreadsheet', () => {
  err(gas.call('createGroup', { name: '', currency: 'BDT', memberEmails: [] }, A), 'INVALID');
  err(gas.call('createGroup', { name: 'Trip', currency: 'XYZ', memberEmails: [] }, A), 'INVALID');
  const d = ok(
    gas.call(
      'createGroup',
      {
        name: "Cox's Bazar trip",
        description: 'Dec 2026',
        currency: 'BDT',
        memberEmails: ['BOB@gmail.com', 'carol@gmail.com', 'alice@gmail.com'],
      },
      A,
    ),
  );
  groupId = d.group.id;
  assert.equal(d.members.length, 3);
  assert.equal(d.members.find((m) => m.email === 'alice@gmail.com').role, 'owner');
  assert.equal('sheetUrl' in d.group, false, 'sheet location must not leak to clients');
  const groupSheets = [...gas.files.values()].filter((f) => f.isSheet && f.parent === gas.props.get('GROUPS_FOLDER_ID'));
  assert.equal(groupSheets.length, 1);
  const ss = gas.spreadsheets.get(groupSheets[0].id);
  assert.deepEqual(
    ss.getSheets().map((s) => s.getName()).sort(),
    ['Activity', 'Expenses', 'Members', 'Meta', 'Payments'],
  );
  assert.match(ss.getName(), /^FairShare – Cox's Bazar trip \(/);
  // initial members are emailed (not the creator), with replies going to the creator
  assert.deepEqual(gas.mails.map((m) => m.to).sort(), ['bob@gmail.com', 'carol@gmail.com']);
  assert.equal(gas.mails[0].replyTo, 'alice@gmail.com');
  assert.match(gas.mails[0].subject, /Alice added you to "Cox's Bazar trip"/);
  assert.match(gas.mails[0].htmlBody, /https:\/\/mohibur11\.github\.io\/toolhub\/tools\/fairshare\//);
  assert.match(gas.mails[0].htmlBody, /Cox&#39;s Bazar trip/, 'group name must be HTML-escaped');
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

test('adding a member emails them; opt-out and quota are respected', () => {
  const before = gas.mails.length;
  ok(gas.call('addMember', { groupId, email: 'Erin@Gmail.com' }, B));
  assert.equal(gas.mails.length, before + 1);
  const mail = gas.mails.at(-1);
  assert.equal(mail.to, 'erin@gmail.com');
  assert.equal(mail.replyTo, 'bob@gmail.com');
  assert.match(mail.body, /sign in with this Google account \(erin@gmail.com\)/);
  ok(gas.call('removeMember', { groupId, email: 'erin@gmail.com' }, A));

  // quota exhausted: member is still added, no email, no error
  gas.context.MailApp.quota = gas.mails.length;
  ok(gas.call('addMember', { groupId, email: 'erin@gmail.com' }, B));
  assert.equal(gas.mails.length, before + 1);
  ok(gas.call('removeMember', { groupId, email: 'erin@gmail.com' }, A));
  gas.context.MailApp.quota = 100;

  // SEND_EMAILS=false turns notifications off
  gas.props.set('SEND_EMAILS', 'false');
  ok(gas.call('addMember', { groupId, email: 'erin@gmail.com' }, B));
  assert.equal(gas.mails.length, before + 1);
  ok(gas.call('removeMember', { groupId, email: 'erin@gmail.com' }, A));
  gas.props.delete('SEND_EMAILS');
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

test('names: own FairShare name, owner nicknames, precedence', () => {
  const member = (d, email) => d.members.find((m) => m.email === email);
  ok(gas.call('getGroup', { groupId }, A)); // warm the cache so renames must invalidate it

  let r = ok(gas.call('updateProfile', { name: '  Bobby  ' }, B));
  assert.equal(r.user.name, 'Bobby');
  assert.equal(r.user.googleName, 'Bob');
  assert.equal(ok(gas.call('me', {}, B)).user.name, 'Bobby');
  let d = ok(gas.call('getGroup', { groupId }, A));
  assert.equal(member(d, 'bob@gmail.com').displayName, 'Bobby');
  assert.equal(ok(gas.call('listGroups', {}, A))[0].memberPreview.find((p) => p.email === 'bob@gmail.com').displayName, 'Bobby');
  err(gas.call('updateProfile', { name: 'x'.repeat(41) }, B), 'INVALID');

  // only the owner can set nicknames
  err(gas.call('setMemberNickname', { groupId, email: 'carol@gmail.com', nickname: 'CC' }, B), 'FORBIDDEN');
  err(gas.call('setMemberNickname', { groupId, email: 'nobody@gmail.com', nickname: 'N' }, A), 'NOT_FOUND');
  d = ok(gas.call('setMemberNickname', { groupId, email: 'bob@gmail.com', nickname: 'Bob (cousin)' }, A));
  assert.equal(member(d, 'bob@gmail.com').displayName, 'Bob (cousin)');
  assert.equal(member(d, 'bob@gmail.com').profileName, 'Bobby');
  assert.match(ok(gas.call('getActivity', { groupId, limit: 1 }, C))[0].summary, /Alice renamed Bobby to "Bob \(cousin\)"/);
  // group sheet mirror shows the nickname
  const sheet = [...gas.files.values()].find((f) => f.isSheet && f.parent === gas.props.get('GROUPS_FOLDER_ID'));
  const rows = gas.spreadsheets.get(sheet.id).getSheetByName('Members').rows;
  assert.ok(rows.some((row) => row[0] === 'bob@gmail.com' && row[1] === 'Bob (cousin)'));

  // the owner's nickname wins inside the group even after Bob renames himself
  ok(gas.call('updateProfile', { name: 'Robert' }, B));
  d = ok(gas.call('getGroup', { groupId }, C));
  assert.equal(member(d, 'bob@gmail.com').displayName, 'Bob (cousin)');
  assert.equal(member(d, 'bob@gmail.com').profileName, 'Robert');

  // the owner can rename themselves in the group too; clearing restores the default
  d = ok(gas.call('setMemberNickname', { groupId, email: 'alice@gmail.com', nickname: 'Ali' }, A));
  assert.equal(member(d, 'alice@gmail.com').displayName, 'Ali');
  d = ok(gas.call('setMemberNickname', { groupId, email: 'bob@gmail.com', nickname: '' }, A));
  assert.equal(member(d, 'bob@gmail.com').displayName, 'Robert');
  r = ok(gas.call('updateProfile', { name: '' }, B));
  assert.equal(r.user.name, 'Bob');
  d = ok(gas.call('getGroup', { groupId }, A));
  assert.equal(member(d, 'bob@gmail.com').displayName, 'Bob');
  ok(gas.call('setMemberNickname', { groupId, email: 'alice@gmail.com', nickname: '' }, A));
});

test('registry created before the naming feature is migrated automatically', () => {
  const reg = gas.spreadsheets.get(gas.props.get('REGISTRY_SHEET_ID'));
  // simulate an old registry: drop the new trailing columns
  reg.getSheetByName('Users').rows.forEach((row) => (row.length = 5));
  reg.getSheetByName('Memberships').rows.forEach((row) => (row.length = 7));
  gas.props.set('REGISTRY_SCHEMA', '1');
  const r = ok(gas.call('updateProfile', { name: 'Carol C' }, C));
  assert.equal(r.user.name, 'Carol C');
  assert.equal(reg.getSheetByName('Users').rows[0][5], 'customName');
  assert.equal(reg.getSheetByName('Memberships').rows[0][7], 'nickname');
  assert.equal(gas.props.get('REGISTRY_SCHEMA'), '2');
  ok(gas.call('updateProfile', { name: '' }, C));
});

test('weekly backup copies registry + groups and keeps the last 8', () => {
  const backupRoot = gas.props.get('BACKUP_FOLDER_ID');
  const msg = gas.weeklyBackup();
  assert.match(msg, /registry \+ 1 group/);
  const folders = () => [...gas.files.values()].filter((f) => f.isFolder && f.parent === backupRoot && !f.trashed);
  assert.equal(folders().length, 1);
  const copies = [...gas.files.values()].filter((f) => f.isSheet && f.parent === folders()[0].id);
  assert.deepEqual(copies.map((c) => c.name).sort(), ["Cox's Bazar trip (" + groupId.slice(0, 8) + ')', 'FairShare Registry'].sort());
  // backup copies hold real data
  const groupCopy = gas.spreadsheets.get(copies.find((c) => c.name !== 'FairShare Registry').id);
  assert.ok(groupCopy.getSheetByName('Expenses').getLastRow() > 1);
  for (let i = 0; i < 10; i++) gas.weeklyBackup();
  assert.equal(folders().length, 8);
});

test('delete group: owner only, name confirmation, data trashed', () => {
  const sheetId = [...gas.files.values()].find((f) => f.isSheet && f.parent === gas.props.get('GROUPS_FOLDER_ID')).id;
  const receiptsFolder = [...gas.files.values()].find((f) => f.isFolder && f.name === groupId);
  err(gas.call('deleteGroup', { groupId, confirmName: "Cox's Bazar trip" }, B), 'FORBIDDEN');
  err(gas.call('deleteGroup', { groupId, confirmName: 'wrong' }, A), 'INVALID');
  err(gas.call('deleteGroup', { groupId, confirmName: "Cox's Bazar trip" }, X), 'FORBIDDEN');
  assert.equal(ok(gas.call('deleteGroup', { groupId, confirmName: " Cox's Bazar trip " }, A)), null);
  assert.equal(gas.files.get(sheetId).trashed, true);
  assert.equal(receiptsFolder.trashed, true);
  err(gas.call('getGroup', { groupId }, A), 'NOT_FOUND');
  assert.equal(ok(gas.call('listGroups', {}, B)).length, 0);
  assert.equal(ok(gas.call('listGroups', {}, A)).length, 0);
});
