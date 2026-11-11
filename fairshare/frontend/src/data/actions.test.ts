// End-to-end scenarios of the browser data layer against the in-memory Google fake, with several accounts.
import { describe, expect, it } from 'vitest';
import type { ExpenseInput } from '@shared/types';
import { createDataApi } from './actions';
import { FakeGoogle } from './fakeGoogle';

const APP = 'https://example.test/fairshare/';
const world = new FakeGoogle();
let clock = Date.parse('2026-11-11T10:00:00Z');
const now = () => new Date((clock += 1000)).toISOString();

const account = (email: string, googleName: string) =>
  createDataApi({ google: world.client(email), account: async () => ({ email, googleName }), appUrl: APP, now });

const A = account('alice@gmail.com', 'Alice');
const B = account('bob@gmail.com', 'Bob');
const C = account('carol@gmail.com', 'Carol');
const D = account('dave@gmail.com', 'Dave');
const E = account('erin@gmail.com', 'Erin');
const X = account('mallory@gmail.com', 'Mallory');

const alice = 'alice@gmail.com';
const bob = 'bob@gmail.com';
const carol = 'carol@gmail.com';
const ALL = [alice, bob, carol];

async function fails(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code });
}
const sum = (b: Record<string, number>) => Object.values(b).reduce((a, x) => a + x, 0);
function equal(amountMinor: number, payer: string, among: string[], more: Partial<ExpenseInput> = {}): ExpenseInput {
  return {
    description: 'Dinner',
    category: 'food',
    amountMinor,
    date: '2026-11-10',
    splitMethod: 'EQUAL',
    payers: [{ email: payer, amountMinor }],
    splitInputs: among.map((email) => ({ email })),
    notes: '',
    receiptFileId: '',
    ...more,
  };
}

let g = ''; // the main group's sheet ID

describe('FairShare data layer (no server)', () => {
  it('creates a group sheet in the creator’s Drive and shares it with the members', async () => {
    await fails(A.createGroup({ name: '', description: '', currency: 'BDT', memberEmails: [] }), 'INVALID');
    await fails(A.createGroup({ name: 'Trip', description: '', currency: 'XYZ', memberEmails: [] }), 'INVALID');
    const d = await A.createGroup({
      name: "Cox's Bazar trip",
      description: 'Dec 2026',
      currency: 'BDT',
      memberEmails: ['BOB@gmail.com', carol, alice],
    });
    g = d.group.id;
    expect(d.group).toMatchObject({ name: "Cox's Bazar trip", currency: 'BDT', ownerEmail: alice, pendingOwner: '', simplifyDebts: true });
    expect(d.members.map((m) => [m.email, m.role, m.joinedAt !== ''])).toEqual([
      [alice, 'owner', true],
      [bob, 'member', false],
      [carol, 'member', false],
    ]);
    const file = world.files.get(g)!;
    expect(file.owner).toBe(alice);
    expect(file.title).toBe("FairShare – Cox's Bazar trip");
    expect([...file.tabs.keys()].sort()).toEqual(['Activity', 'Expenses', 'Members', 'Meta', 'Payments']);
    expect([...file.permissions.keys()].sort()).toEqual([alice, bob, carol]);
    expect(world.shares.map((s) => s.to)).toEqual([bob, carol]);
    expect(world.shares[0].message).toContain(`${APP}#/g/${g}`);
    expect(world.shares[0].message).toContain('Alice added you to "Cox\'s Bazar trip"');
    expect((await A.listGroups({})).map((x) => x.id)).toEqual([g]);
  });

  it('a member opens the group only after selecting it in the picker', async () => {
    await fails(B.getGroup({ groupId: g }), 'NO_ACCESS');
    expect(await B.listGroups({})).toEqual([]);
    expect(world.pick(bob, g)).toBe(true);
    const d = await B.joinGroup({ groupId: g });
    const me = d.members.find((m) => m.email === bob)!;
    expect(me.displayName).toBe('Bob');
    expect(me.joinedAt).not.toBe('');
    const list = await B.listGroups({});
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: g, memberCount: 3, role: 'member', myNetMinor: 0 });
    world.pick(carol, g);
    await C.joinGroup({ groupId: g });
  });

  it('keeps outsiders out', async () => {
    expect(world.pick('mallory@gmail.com', g)).toBe(false);
    await fails(X.getGroup({ groupId: g }), 'NO_ACCESS');
    await fails(X.addExpense({ groupId: g, expense: equal(100, 'mallory@gmail.com', ['mallory@gmail.com']) }), 'NO_ACCESS');
  });

  it('records expenses with every split method and multiple payers', async () => {
    let d = await A.addExpense({ groupId: g, expense: equal(30000, alice, ALL), clientId: 'exp-equal-1' });
    expect(d.balances).toEqual({ [alice]: 20000, [bob]: -10000, [carol]: -10000 });
    await B.addExpense({
      groupId: g,
      expense: equal(10000, bob, [], {
        description: 'Boat',
        splitMethod: 'EXACT',
        splitInputs: [
          { email: alice, value: 6000 },
          { email: carol, value: 4000 },
        ],
      }),
    });
    await C.addExpense({
      groupId: g,
      expense: equal(20000, carol, [], {
        description: 'Hotel',
        splitMethod: 'PERCENT',
        splitInputs: [
          { email: alice, value: 50 },
          { email: bob, value: 25 },
          { email: carol, value: 25 },
        ],
      }),
    });
    d = await A.addExpense({
      groupId: g,
      expense: equal(9000, alice, [], {
        description: 'Fuel',
        payers: [
          { email: alice, amountMinor: 5000 },
          { email: bob, amountMinor: 4000 },
        ],
        splitMethod: 'SHARES',
        splitInputs: [
          { email: bob, value: 1 },
          { email: carol, value: 2 },
        ],
      }),
    });
    expect(d.balances).toEqual({ [alice]: 9000, [bob]: -4000, [carol]: -5000 });
    expect(sum(d.balances)).toBe(0);
    expect(d.settlePlan).toHaveLength(2);
    expect(d.settlePlan.every((t) => t.to === alice)).toBe(true);
    const rows = world.sheet(g, 'Expenses');
    expect(rows).toHaveLength(5); // header + 4
    const fuel = rows.find((r) => r[2] === 'Fuel')!;
    expect(String(fuel[6])).toMatch(/Alice .*, Bob /); // readable "paid by" column
    expect(String(fuel[8])).not.toBe(''); // readable split summary
  });

  it('validates expenses', async () => {
    await fails(A.addExpense({ groupId: g, expense: equal(1000, alice, [alice], { description: '' }) }), 'INVALID');
    await fails(A.addExpense({ groupId: g, expense: equal(1000, alice, ['mallory@gmail.com']) }), 'INVALID');
    await fails(A.addExpense({ groupId: g, expense: equal(1000, alice, [alice], { payers: [{ email: alice, amountMinor: 999 }] }) }), 'INVALID');
    await fails(A.addExpense({ groupId: g, expense: equal(1000, alice, [alice], { date: '11/10/2026' }) }), 'INVALID');
  });

  it('edits, deletes and restores expenses; retries are safe', async () => {
    const before = await A.getGroup({ groupId: g });
    const again = await A.addExpense({ groupId: g, expense: equal(30000, alice, ALL), clientId: 'exp-equal-1' });
    expect(again.expenses).toHaveLength(before.expenses.length);

    let d = await B.updateExpense({ groupId: g, expenseId: 'exp-equal-1', expense: equal(60000, alice, ALL) });
    const edited = d.expenses.find((e) => e.id === 'exp-equal-1')!;
    expect(edited).toMatchObject({ amountMinor: 60000, updatedBy: bob, createdBy: alice });
    expect(world.sheet(g, 'Expenses')).toHaveLength(5); // edited in place
    d = await C.deleteExpense({ groupId: g, expenseId: 'exp-equal-1' });
    expect(d.expenses.find((e) => e.id === 'exp-equal-1')!.deleted).toBe(true);
    await fails(A.updateExpense({ groupId: g, expenseId: 'exp-equal-1', expense: equal(100, alice, ALL) }), 'CONFLICT');
    d = await A.restoreExpense({ groupId: g, expenseId: 'exp-equal-1' });
    expect(d.expenses.find((e) => e.id === 'exp-equal-1')!.deleted).toBe(false);
    d = await A.updateExpense({ groupId: g, expenseId: 'exp-equal-1', expense: equal(30000, alice, ALL) });
    expect(d.balances).toEqual({ [alice]: 9000, [bob]: -4000, [carol]: -5000 });
    await fails(A.deleteExpense({ groupId: g, expenseId: 'nope' }), 'NOT_FOUND');
  });

  it('stores text that looks like a formula safely', async () => {
    const evil = '=IMPORTXML("http://evil.example","//a")';
    const d = await A.addExpense({ groupId: g, expense: equal(100, alice, [alice], { description: evil }), clientId: 'exp-formula' });
    expect(d.expenses.find((e) => e.id === 'exp-formula')!.description).toBe(evil);
    expect(world.sheet(g, 'Expenses').find((r) => r[0] === 'exp-formula')![2]).toBe(`'${evil}`);
    await A.deleteExpense({ groupId: g, expenseId: 'exp-formula' });
  });

  it('keeps both writes when two members save at the same time', async () => {
    await Promise.all([
      A.addExpense({ groupId: g, expense: equal(1000, alice, [bob], { description: 'Tea' }), clientId: 'exp-tea-1' }),
      B.addExpense({ groupId: g, expense: equal(1000, bob, [alice], { description: 'Coffee' }), clientId: 'exp-coffee' }),
    ]);
    const d = await C.getGroup({ groupId: g });
    expect(d.expenses.map((e) => e.id)).toEqual(expect.arrayContaining(['exp-tea-1', 'exp-coffee']));
    expect(d.balances).toEqual({ [alice]: 9000, [bob]: -4000, [carol]: -5000 });
  });

  it('settles up with payments', async () => {
    let d = await B.getGroup({ groupId: g });
    for (const t of d.settlePlan)
      d = await A.addPayment({ groupId: g, payment: { from: t.from, to: t.to, amountMinor: t.amountMinor, date: '2026-11-11', note: '' } });
    expect(Object.values(d.balances).every((v) => v === 0)).toBe(true);
    expect(d.settlePlan).toEqual([]);
    const first = d.payments[0];
    d = await C.deletePayment({ groupId: g, paymentId: first.id });
    expect(d.balances[first.from]).toBe(-first.amountMinor);
    d = await C.addPayment({ groupId: g, payment: { from: first.from, to: first.to, amountMinor: first.amountMinor, date: '2026-11-11', note: 'again' } });
    expect(d.settlePlan).toEqual([]);
    await fails(A.addPayment({ groupId: g, payment: { from: alice, to: alice, amountMinor: 5, date: '2026-11-11', note: '' } }), 'INVALID');
  });

  it('switches between simplified and direct debts', async () => {
    await B.addExpense({ groupId: g, expense: equal(3000, bob, [alice], { description: 'Taxi' }) });
    let d = await C.addExpense({ groupId: g, expense: equal(3000, carol, [bob], { description: 'Snacks' }) });
    expect(d.settlePlan).toEqual([{ from: alice, to: carol, amountMinor: 3000 }]);
    d = await B.updateGroup({ groupId: g, simplifyDebts: false });
    expect(d.group.simplifyDebts).toBe(false);
    // Direct debts per pair: at least Alice→Bob (taxi) and Bob→Carol (snacks), plus older pair debts.
    expect(d.settlePlan).toEqual(
      expect.arrayContaining([
        { from: alice, to: bob, amountMinor: expect.any(Number) },
        { from: bob, to: carol, amountMinor: expect.any(Number) },
      ]),
    );
    d = await B.updateGroup({ groupId: g, simplifyDebts: true });
    expect(d.settlePlan).toHaveLength(1);
  });

  it('adds and removes members, who gain and lose Google access', async () => {
    let d = await B.addMember({ groupId: g, email: 'Dave@Gmail.com' });
    expect(d.members.find((m) => m.email === 'dave@gmail.com')).toMatchObject({ active: true, joinedAt: '' });
    const perms = world.files.get(g)!.permissions;
    expect(perms.has('dave@gmail.com')).toBe(true);
    await fails(B.addMember({ groupId: g, email: 'dave@gmail.com' }), 'CONFLICT');
    await fails(B.addMember({ groupId: g, email: 'not-an-email' }), 'INVALID');
    await fails(B.removeMember({ groupId: g, email: 'dave@gmail.com' }), 'FORBIDDEN');
    await fails(A.removeMember({ groupId: g, email: alice }), 'FORBIDDEN');
    await fails(A.removeMember({ groupId: g, email: carol }), 'CONFLICT'); // unsettled balance
    d = (await A.removeMember({ groupId: g, email: 'dave@gmail.com' }))!;
    expect(d.members.find((m) => m.email === 'dave@gmail.com')!.active).toBe(false);
    expect(perms.has('dave@gmail.com')).toBe(false);

    await A.addMember({ groupId: g, email: 'dave@gmail.com' });
    world.pick('dave@gmail.com', g);
    await D.joinGroup({ groupId: g });
    expect((await D.listGroups({})).map((x) => x.id)).toEqual([g]);
    expect(await D.removeMember({ groupId: g, email: 'dave@gmail.com' })).toBeNull();
    expect(await D.listGroups({})).toEqual([]);
    expect(perms.has('dave@gmail.com')).toBe(false);
    await fails(D.getGroup({ groupId: g }), 'NO_ACCESS');
  });

  it('shows who has access, and lets people shared from Google Sheets join', async () => {
    world.shareOutsideApp(g, 'erin@gmail.com');
    let access = await A.getAccess({ groupId: g });
    expect(access.find((a) => a.email === 'erin@gmail.com')).toMatchObject({ member: 'none', role: 'writer' });
    expect(access.find((a) => a.email === alice)).toMatchObject({ member: 'active', role: 'owner' });
    await fails(B.removeAccess({ groupId: g, email: 'erin@gmail.com' }), 'FORBIDDEN');
    await fails(A.removeAccess({ groupId: g, email: carol }), 'CONFLICT');
    access = await A.removeAccess({ groupId: g, email: 'erin@gmail.com' });
    expect(access.some((a) => a.email === 'erin@gmail.com')).toBe(false);

    world.shareOutsideApp(g, 'erin@gmail.com');
    world.pick('erin@gmail.com', g);
    const d = await E.joinGroup({ groupId: g });
    expect(d.members.find((m) => m.email === 'erin@gmail.com')).toMatchObject({ active: true, displayName: 'Erin', role: 'member' });
  });

  it('keeps an activity log, newest first', async () => {
    const recent = await B.getActivity({ groupId: g, limit: 3 });
    expect(recent).toHaveLength(3);
    expect(recent[0].summary).toBe('Erin joined the group');
    const all = await B.getActivity({ groupId: g });
    expect(all[all.length - 1].summary).toBe('Alice created the group "Cox\'s Bazar trip"');
    expect(all.some((x) => x.summary === 'Dave left the group')).toBe(true);
  });

  it('uses each member’s FairShare name, and the owner’s nicknames inside the group', async () => {
    await B.updateProfile({ name: 'Bobby' });
    expect((await B.me({})).user).toMatchObject({ name: 'Bobby', googleName: 'Bob' });
    let d = await A.getGroup({ groupId: g });
    expect(d.members.find((m) => m.email === bob)).toMatchObject({ displayName: 'Bobby', profileName: 'Bobby' });
    await fails(B.setMemberNickname({ groupId: g, email: carol, nickname: 'Caz' }), 'FORBIDDEN');
    d = await A.setMemberNickname({ groupId: g, email: carol, nickname: 'Caz' });
    expect(d.members.find((m) => m.email === carol)).toMatchObject({ displayName: 'Caz', profileName: 'Carol', nickname: 'Caz' });
    await B.updateProfile({ name: '' });
    d = await C.getGroup({ groupId: g });
    expect(d.members.find((m) => m.email === bob)!.displayName).toBe('Bob');
    expect((await A.getActivity({ groupId: g, limit: 3 })).map((x) => x.summary)).toContain('Alice renamed Carol to "Caz"');
  });

  it('hands the group over to another member, and the old owner can then leave', async () => {
    await A.addPayment({ groupId: g, payment: { from: alice, to: carol, amountMinor: 3000, date: '2026-11-12', note: '' } });
    await fails(B.offerOwnership({ groupId: g, email: carol }), 'FORBIDDEN');
    await fails(B.acceptOwnership({ groupId: g }), 'CONFLICT');

    let d = await A.offerOwnership({ groupId: g, email: bob });
    expect(d.group.pendingOwner).toBe(bob);
    await fails(C.acceptOwnership({ groupId: g }), 'CONFLICT');
    d = await B.acceptOwnership({ groupId: g });
    expect(d.group).toMatchObject({ ownerEmail: bob, pendingOwner: '' });
    expect(d.members.find((m) => m.email === bob)!.role).toBe('owner');
    expect(d.members.find((m) => m.email === alice)!.role).toBe('member');
    const file = world.files.get(g)!;
    expect(file.owner).toBe(bob);
    expect(file.inDriveOf).toBe(bob); // moved, so Alice no longer inherits access from her Drive

    expect(await A.removeMember({ groupId: g, email: alice })).toBeNull();
    expect(file.permissions.has(alice)).toBe(false);
    await fails(A.getGroup({ groupId: g }), 'NO_ACCESS');
    await fails(C.removeMember({ groupId: g, email: 'erin@gmail.com' }), 'FORBIDDEN');

    d = await B.offerOwnership({ groupId: g, email: carol });
    expect(d.group.pendingOwner).toBe(carol);
    d = await B.cancelOwnershipOffer({ groupId: g });
    expect(d.group.pendingOwner).toBe('');
    expect([...file.permissions.values()].some((p) => p.pendingOwner)).toBe(false);
    await fails(C.acceptOwnership({ groupId: g }), 'CONFLICT');
  });

  it('renames, archives and deletes (owner only); members lose the deleted group', async () => {
    let d = await C.updateGroup({ groupId: g, name: 'Sylhet trip' });
    expect(d.group.name).toBe('Sylhet trip');
    expect(world.files.get(g)!.title).toBe('FairShare – Sylhet trip');
    await fails(C.archiveGroup({ groupId: g, archived: true }), 'FORBIDDEN');
    d = await B.archiveGroup({ groupId: g, archived: true });
    expect(d.group.archived).toBe(true);
    expect((await C.listGroups({}))[0].archived).toBe(true);
    await fails(C.deleteGroup({ groupId: g, confirmName: 'Sylhet trip' }), 'FORBIDDEN');
    await fails(B.deleteGroup({ groupId: g, confirmName: 'wrong' }), 'INVALID');
    expect(await B.deleteGroup({ groupId: g, confirmName: 'Sylhet trip' })).toBeNull();
    expect(world.files.get(g)!.trashed).toBe(true);
    expect(await B.listGroups({})).toEqual([]);
    expect(await C.listGroups({})).toEqual([]);
    await fails(C.getGroup({ groupId: g }), 'NO_ACCESS');
  });

  it('adds columns that newer versions need to an older sheet', async () => {
    const d = await C.createGroup({ name: 'Flat', description: '', currency: 'USD', memberEmails: [] });
    const members = world.sheet(d.group.id, 'Members');
    const col = members[0].indexOf('joinedAt');
    members.forEach((row) => row.splice(col, 1)); // as if made before "joinedAt" existed
    const after = await C.addMember({ groupId: d.group.id, email: 'dave@gmail.com' });
    expect(members[0][members[0].length - 1]).toBe('joinedAt');
    expect(after.members.find((m) => m.email === 'dave@gmail.com')).toMatchObject({ active: true, joinedAt: '' });
    expect(after.members.find((m) => m.email === carol)!.active).toBe(true);
  });

  it('refuses sheets that are not FairShare groups', async () => {
    const id = await world.client(alice).createSpreadsheet('Budget', { Meta: ['key', 'value'], Members: ['email'], Expenses: ['expenseId'], Payments: ['paymentId'] });
    world.shareOutsideApp(id, carol);
    world.pick(carol, id);
    await fails(C.joinGroup({ groupId: id }), 'INVALID');
  });

  it('asks for a tap when Google sign-in expires, and lists groups that failed to load', async () => {
    const flat = (await C.listGroups({})).find((x) => x.name === 'Flat')!;
    world.expired.add(carol);
    await fails(C.listGroups({}), 'NEEDS_SIGNIN');
    await fails(C.getGroup({ groupId: flat.id }), 'NEEDS_SIGNIN');
    world.expired.delete(carol);
    world.flaky.add(flat.id);
    const failing = (await C.listGroups({})).find((x) => x.id === flat.id)!;
    expect(failing.error).toMatch(/Google error \(503\)/);
    expect((await C.listGroups({})).find((x) => x.id === flat.id)!.error).toBeUndefined();
  });
});
