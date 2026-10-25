import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { GroupDetail, Member } from '@shared/types';
import { useDeleteGroup, useGroup, useGroupWrite } from '../api/hooks';
import { useMe } from '../auth/AuthContext';
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

function Settings({ d }: { d: GroupDetail }) {
  const me = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const update = useGroupWrite(d.group.id, 'updateGroup');
  const addMember = useGroupWrite(d.group.id, 'addMember');
  const removeMember = useGroupWrite(d.group.id, 'removeMember');
  const archive = useGroupWrite(d.group.id, 'archiveGroup');
  const deleteGroup = useDeleteGroup(d.group.id);
  const [name, setName] = useState(d.group.name);
  const [description, setDescription] = useState(d.group.description);
  const [newEmail, setNewEmail] = useState('');
  const [renaming, setRenaming] = useState<Member | null>(null);
  const [editingOwnName, setEditingOwnName] = useState(false);
  const setNickname = useGroupWrite(d.group.id, 'setMemberNickname');
  const isOwner = d.members.find((m) => m.email === me.email)?.role === 'owner';
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
          toast.success('Member added, invite email sent');
          setNewEmail('');
        },
      },
    );
  };

  const remove = (email: string, self: boolean) => {
    const msg = self ? 'Leave this group?' : `Remove ${email} from the group?`;
    if (!confirm(msg)) return;
    removeMember.mutate(
      { email },
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
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Details</h2>
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
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Members ({active.length})</h2>
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
                    {m.role === 'owner' && <span className="ml-1 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-800 dark:bg-brand-900/50 dark:text-brand-200">OWNER</span>}
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
                    onClick={() => remove(m.email, self)}
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
        </div>
        <p className="mt-2 px-1 text-xs text-slate-500">
          {isOwner
            ? 'Tap ✎ to change how a member is named in this group. '
            : 'Tap ✎ on your row to change your name. '}
          Members need a settled balance (zero) before they can leave or be removed.
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
      </section>

      <section>
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Preferences</h2>
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
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Data</h2>
        <div className="card divide-y divide-slate-100 dark:divide-slate-800">
          <button
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm"
            onClick={() => downloadText(`${d.group.name.replace(/[^\w-]+/g, '_')}.csv`, groupToCsv(d))}
          >
            <Icon name="download" className="h-5 w-5 text-slate-400" /> Export as CSV
          </button>
        </div>
        <p className="mt-2 px-1 text-xs text-slate-500">Download a copy of every expense and payment, with each member's balance.</p>
      </section>

      {isOwner && (
        <section className="space-y-3">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Owner actions</h2>
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
                `This permanently deletes "${d.group.name}" for everyone: all expenses, payments and receipts.\n\nTip: export a CSV first.\n\nType the group name to confirm:`,
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
