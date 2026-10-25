import { useUpdateProfile } from '../api/hooks';
import { useMe } from '../auth/AuthContext';
import NameDialog from './NameDialog';

/** Change the signed-in user's own FairShare name (applies in every group). */
export default function ProfileNameDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe();
  const update = useUpdateProfile();
  const googleName = me.googleName ?? me.name;
  const custom = me.name !== googleName ? me.name : '';
  return (
    <NameDialog
      open={open}
      title="Your name"
      hint="This is how you appear to others in FairShare. It doesn't change your Google account. A group owner can still give you a different name inside their group."
      current={custom}
      defaultName={googleName}
      saving={update.isPending}
      onSave={(name) => update.mutate(name, { onSuccess: onClose })}
      onClose={onClose}
    />
  );
}
