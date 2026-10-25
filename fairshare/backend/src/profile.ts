import type { ApiActions, User } from '../../shared/types';
import { withLock } from './config';
import { setCustomName, withProfileName } from './registry';
import { text } from './validate';

/** Set your own FairShare name (used in every group unless an owner gave you a nickname there). */
export function updateProfile(user: User, req: ApiActions['updateProfile']['req']) {
  const name = text(req.name ?? '', 'Name', 0, 40);
  return withLock(() => {
    setCustomName(user.email, name);
    return { user: withProfileName({ email: user.email, name: user.googleName ?? user.name, pictureUrl: user.pictureUrl }) };
  });
}
