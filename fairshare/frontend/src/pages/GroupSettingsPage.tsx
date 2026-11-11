import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { GroupDetail, Member } from '@shared/types';
import { useAccess, useDeleteGroup, useGroup, useGroupWrite, useRemoveAccess } from '../api/hooks';
import { useMe } from '../auth/AuthContext';
import InviteDialog from '../components/InviteDialog';
import NameDialog from '../components/NameDialog';
import ProfileNameDialog from '../components/ProfileNameDialog';
import { useToast } from '../components/Toast';
import { AppBar, Avatar, Balance, ErrorState, Icon, ListSkeleton, Page, Spinner, Toggle } from '../components/ui';
import { downloadText, groupToCsv } from '../lib/csv';

export default function GroupSettingsPage() {
  const { groupId = '' } = useParams();
  const q = useGroup(groupId);
  return (
    <>
      <AppBar back={`/g/${groupId}`} title="Group settings" subtitle={q.data?.group.name} />
      <Page>
        {q.isLoading ? <ListSkeleton /> : q.error || !q.data ? <ErrorState error={q.error ?? new Error('Group not found')} /> : <Settings d={q.data} />}
      </Page>
    </>
  );
}

const Heading = ({ children }: { children: string }) => (
  <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</h2>
);

function Settings({ d }: { d: GroupDetail }) {
  const me = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const update = useGroupWrite(d.group.id, 'updateGroup');
  const addMember = useGroupWrite(d.group.id, 'addMember');
  const removeMember = useGroupWrite(d.group.id, 'removeMember');
  const archive = useGroupWrite(d.group.id, 'archiveGroup');
  const setNickname = useGroupWrite(d.group.id, 'setMemberNickname');
  const deleteGroup = useDeleteGroup(d.group.id);
  const [name, setName] = useState(d.group.name);
  const [description, setDescription] = useState(d.group.description);
  const [newEmail, setNewEmail] = useState('');
  const [renaming, setRenaming] = useState<Member | null>(null);
  const [editingOwnName, setEditingOwnName] = useState(false);
  const [inviting, setInviting] = useState(false);
  const isOwner = d.group.ownerEmail === me.email;
  const dirty = name !== d.group.name || description !== d.group.description;

  useEffect(() => {
    setName(d.group.name);
    setDescription(d.group.description);
  }, [d.group.name, d.group.description]);

  const save = (e: FormEvent) => {
    e.preventDefault();
    update.mutate({ name, description }, { onSuccess: () => toast.success('Saved') });
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    addMember.mutate(
      { email: newEmail.trim() },
      {
        onSuccess: () => {
          toast.success('Added. Now send them the invite link.');
          setNewEmail('');
          setInviting(true);
        },
      },
    );
  };

  const remove = (m: Member, self: boolean) => {
    const msg = self ? 'Leave this group? You will lose access to it.' : `Remove ${m.displayName} (${m.email}) from the group? They will lose access to it.`;
    if (!confirm(msg)) return;
    removeMember.mutate(
      { email: m.email },
      {
        onSuccess: () => {
          if (self) navigate('/');
          else toast.success('Member removed');
        },
      },
    );
  };

  const active = d.members.filter((m) => m.active);

  return (
    <div className="space-y-6">
      <section>
        <Heading>Details</Heading>
        <form onSubmit={save} className="card space-y-3 p-4">
          <div>
            <label className="label" htmlFor="s-name">
              Name
            </label>
            <input id="s-name" className="input" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="s-desc">
              Description
            </label>
            <textarea id="s-desc" className="input" rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <p className="text-xs text-slate-500">Currency: {d.group.currency}</p>
          {dirty && (
            <button className="btn-primary w-full" disabled={update.isPending}>
              Save
            </button>
          )}
        </form>
      </section>

      <section>
        <Heading>{`Members (${active.length})`}</Heading>
        <div className="card divide-y divide-slate-100 dark:divide-slate-800">
          {active.map((m) => {
            const net = d.balances[m.email] ?? 0;
            const self = m.email === me.email;
            const canRemove = m.role !== 'owner' && (self || isOwner);
            return (
              <div key={m.email} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={m.displayName} email={m.email} pictureUrl={m.pictureUrl} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {m.displayName} {self && <span className="text-slate-400">(you)</span>}
                    {m.role === 'owner' && <Badge>OWNER</Badge>}
                    {!m.joinedAt && <Badge tone="muted">INVITED</Badge>}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {m.nickname && m.nickname !== m.profileName ? `${m.profileName} · ` : ''}
                    {m.email}
                  </p>
                </div>
                <Balance minor={net} currency={d.group.currency} className="text-xs" />
                {(isOwner || self) && (
                  <button
                    className="btn-ghost"
                    onClick={() => (isOwner ? setRenaming(m) : setEditingOwnName(true))}
                    aria-label={`Change ${self ? 'your' : `${m.displayName}'s`} name`}
                    title={isOwner ? 'Change name in this group' : 'Change your name'}
                  >
                    <Icon name="edit" className="h-4 w-4" />
                  </button>
                )}
                {canRemove && (
                  <button
                    className="btn-ghost text-xs text-rose-600"
                    onClick={() => remove(m, self)}
                    disabled={net !== 0 || removeMember.isPending}
                    title={net !== 0 ? 'Settle up before removing' : undefined}
                  >
                    {self ? 'Leave' : 'Remove'}
                  </button>
                )}
              </div>
            );
          })}
          <form onSubmit={add} className="flex gap-2 p-3">
            <input type="email" className="input" placeholder="friend@gmail.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
            <button className="btn-primary shrink-0" disabled={addMember.isPending}>
              {addMember.isPending ? <Spinner className="h-4 w-4" /> : 'Add'}
            </button>
          </form>
          <button className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm" onClick={() => setInviting(true)}>
            <Icon name="share" className="h-5 w-5 text-slate-400" /> Send the invite link
          </button>
        </div>
        <p className="mt-2 px-1 text-xs text-slate-500">
          Adding someone gives their Google account edit access to the group's sheet; then send them the invite link.{' '}
          {isOwner ? 'Tap ✎ to change how a member is named in this group. ' : 'Tap ✎ on your row to change your name. '}
          Members need a settled balance (zero) before they can leave or be removed.
          {isOwner && ' To leave, first make another member the owner.'}
        </p>
        <NameDialog
          open={renaming !== null}
          title={renaming?.email === me.email ? 'Your name in this group' : `Rename ${renaming?.displayName ?? ''}`}
          hint={`Only changes the name shown in "${d.group.name}". ${renaming?.email === me.email ? 'Your' : 'Their'} name in other groups stays the same.`}
          current={renaming?.nickname ?? ''}
          defaultName={renaming?.profileName ?? ''}
          saving={setNickname.isPending}
          onSave={(nickname) => {
            if (!renaming) return;
            setNickname.mutate({ email: renaming.email, nickname }, { onSuccess: () => toast.success('Name updated') });
            setRenaming(null);
          }}
          onClose={() => setRenaming(null)}
        />
        <ProfileNameDialog open={editingOwnName} onClose={() => setEditingOwnName(false)} />
        <InviteDialog open={inviting} onClose={() => setInviting(false)} groupId={d.group.id} groupName={d.group.name} />
      </section>

      <section>
        <Heading>Preferences</Heading>
        <div className="card p-4">
          <Toggle
            checked={d.group.simplifyDebts}
            onChange={(v) => update.mutate({ simplifyDebts: v })}
            label="Simplify group debts"
            description="Combine debts across people so the group settles with the fewest payments. E.g. if Asha owes Bilal and Bilal owes Chen, Asha pays Chen directly."
          />
        </div>
      </section>

      <section>
        <Heading>Data</Heading>
        <div className="card divide-y divide-slate-100 dark:divide-slate-800">
          <button
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm"
            onClick={() => downloadText(`${d.group.name.replace(/[^\w-]+/g, '_')}.csv`, groupToCsv(d))}
          >
            <Icon name="download" className="h-5 w-5 text-slate-400" /> Export as CSV
          </button>
          <a
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm"
            href={`https://docs.google.com/spreadsheets/d/${d.group.id}/edit`}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="sheet" className="h-5 w-5 text-slate-400" /> Open the group's Google Sheet
          </a>
        </div>
        <p className="mt-2 px-1 text-xs text-slate-500">
          The group lives in a Google Sheet owned by {isOwner ? 'you' : d.members.find((m) => m.email === d.group.ownerEmail)?.displayName ?? 'the owner'}.
          Please make changes in the app; editing the sheet by hand can break balances.
        </p>
      </section>

      <Access d={d} isOwner={isOwner} />

      {isOwner && <Handover d={d} />}

      {isOwner && (
        <section className="space-y-3">
          <Heading>Owner actions</Heading>
          <button
            className="btn-secondary w-full"
            disabled={archive.isPending}
            onClick={() => archive.mutate({ archived: !d.group.archived }, { onSuccess: () => toast.success(d.group.archived ? 'Group restored' : 'Group archived') })}
          >
            {d.group.archived ? 'Unarchive group' : 'Archive group'}
          </button>
          <button
            className="btn-danger w-full"
            disabled={deleteGroup.isPending}
            onClick={() => {
              const typed = prompt(
                `This deletes "${d.group.name}" for everyone: its Google Sheet goes to your Drive's trash and members lose access.\n\nTip: export a CSV first.\n\nType the group name to confirm:`,
              );
              if (typed === null) return;
              deleteGroup.mutate(typed, { onSuccess: () => navigate('/', { replace: true }) });
            }}
          >
            {deleteGroup.isPending ? <Spinner className="h-4 w-4" /> : <Icon name="trash" className="h-4 w-4" />} Delete group
          </button>
        </section>
      )}
    </div>
  );
}

function Badge({ children, tone = 'brand' }: { children: string; tone?: 'brand' | 'muted' }) {
  const cls =
    tone === 'brand'
      ? 'bg-brand-100 text-brand-800 dark:bg-brand-900/50 dark:text-brand-200'
      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  return <span className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{children}</span>;
}

/** People with Google access to the sheet who aren't members (e.g. shared from Google Sheets, or left over). */
function Access({ d, isOwner }: { d: GroupDetail; isOwner: boolean }) {
  const access = useAccess(d.group.id, isOwner);
  const removeAccess = useRemoveAccess(d.group.id);
  if (!isOwner) return null;
  const extra = (access.data ?? []).filter((a) => a.member !== 'active' && a.role !== 'owner');
  return (
    <section>
      <Heading>Google access</Heading>
      <div className="card p-4 text-sm">
        {access.isLoading ? (
          <Spinner className="h-4 w-4" />
        ) : access.error ? (
          <p className="text-rose-600">{access.error.message}</p>
        ) : extra.length === 0 ? (
          <p className="text-slate-600 dark:text-slate-300">Only the members above can open this group's sheet.</p>
        ) : (
          <>
            <p className="mb-2 text-slate-600 dark:text-slate-300">These people can open the sheet but aren't members:</p>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {extra.map((a) => (
                <li key={a.email} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate">
                    {a.email} <span className="text-xs text-slate-500">({a.member === 'removed' ? 'left or removed' : 'not a member'})</span>
                  </span>
                  <button
                    className="btn-ghost text-xs text-rose-600"
                    disabled={removeAccess.isPending}
                    onClick={() => confirm(`Remove ${a.email}'s access to the group's sheet?`) && removeAccess.mutate(a.email)}
                  >
                    Remove access
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

/** Make another member the owner. They accept from the group page; the sheet then moves to their Drive. */
function Handover({ d }: { d: GroupDetail }) {
  const toast = useToast();
  const offer = useGroupWrite(d.group.id, 'offerOwnership');
  const cancel = useGroupWrite(d.group.id, 'cancelOwnershipOffer');
  const candidates = d.members.filter((m) => m.active && m.role !== 'owner');
  const [target, setTarget] = useState('');
  const pending = d.members.find((m) => m.email === d.group.pendingOwner);

  return (
    <section>
      <Heading>Hand over the group</Heading>
      <div className="card space-y-3 p-4 text-sm">
        {pending ? (
          <>
            <p>
              Waiting for <b>{pending.displayName}</b> to accept. They'll see a button when they open the group.
            </p>
            <button className="btn-secondary w-full" disabled={cancel.isPending} onClick={() => cancel.mutate({}, { onSuccess: () => toast.success('Handover cancelled') })}>
              Cancel handover
            </button>
          </>
        ) : candidates.length === 0 ? (
          <p className="text-slate-600 dark:text-slate-300">Add another member to be able to hand the group over.</p>
        ) : (
          <>
            <p className="text-slate-600 dark:text-slate-300">
              The new owner manages members, and the group's Google Sheet moves to their Drive. You stay a member and can then leave.
            </p>
            <div className="flex gap-2">
              <select className="input" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="New owner">
                <option value="">Choose a member…</option>
                {candidates.map((m) => (
                  <option key={m.email} value={m.email}>
                    {m.displayName} ({m.email})
                  </option>
                ))}
              </select>
              <button
                className="btn-primary shrink-0"
                disabled={!target || offer.isPending}
                onClick={() => offer.mutate({ email: target }, { onSuccess: () => toast.success('Asked them to become the owner') })}
              >
                {offer.isPending ? <Spinner className="h-4 w-4" /> : 'Ask'}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
