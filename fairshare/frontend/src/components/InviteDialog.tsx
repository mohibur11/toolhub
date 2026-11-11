import { APP_URL } from '../config';
import { useToast } from './Toast';
import { Icon, Modal, useCopy } from './ui';

export const inviteLink = (groupId: string) => `${APP_URL}#/g/${groupId}`;

/** Share the group's link (Google's own "shared with you" email often doesn't arrive). */
export default function InviteDialog({
  open,
  onClose,
  groupId,
  groupName,
}: {
  open: boolean;
  onClose: () => void;
  groupId: string;
  groupName: string;
}) {
  const copy = useCopy();
  const toast = useToast();
  const link = inviteLink(groupId);
  const message = `Join "${groupName}" on FairShare so we can split our expenses:`;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <Modal open={open} onClose={onClose} title="Invite people">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Send this link to the people you added. They open it, sign in with the Google account of the email you added, and tap{' '}
        <b>Open the group</b>.
      </p>
      <div className="mt-3 select-all break-all rounded-xl bg-slate-100 p-3 font-mono text-xs dark:bg-slate-800">{link}</div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {canShare && (
          <button className="btn-primary" onClick={() => navigator.share({ title: 'FairShare', text: message, url: link }).catch(() => undefined)}>
            <Icon name="share" className="h-4 w-4" /> Share…
          </button>
        )}
        <a className="btn-secondary" href={`https://wa.me/?text=${encodeURIComponent(`${message} ${link}`)}`} target="_blank" rel="noreferrer">
          WhatsApp
        </a>
        <button
          className="btn-secondary"
          onClick={async () => ((await copy(link)) ? toast.success('Link copied') : toast.error("Couldn't copy. Select the link above."))}
        >
          <Icon name="copy" className="h-4 w-4" /> Copy link
        </button>
      </div>
      <p className="mt-3 text-xs text-slate-500">The link alone gives no access: only people added to the group can open it.</p>
    </Modal>
  );
}
