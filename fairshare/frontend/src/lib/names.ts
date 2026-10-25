import type { Member } from '@shared/types';

/** Returns a resolver: email -> "You" for the current user, display name for members, email prefix otherwise. */
export function nameResolver(members: Member[], meEmail: string) {
  const map = new Map(members.map((m) => [m.email, m.displayName]));
  return (email: string, opts: { you?: boolean } = { you: true }) => {
    if (opts.you !== false && email === meEmail) return 'You';
    return map.get(email) ?? email.split('@')[0];
  };
}

export function firstName(name: string): string {
  return name.split(/\s+/)[0];
}
