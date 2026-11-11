// "My groups" and my FairShare name, kept in a hidden file in my own Drive (the app data folder), so they follow
// me across devices. Only FairShare (running in my browser) can read it; nobody else, including the app's author.
import type { GoogleApi } from './google';

export const INDEX_FILE = 'fairshare-index.json';

export interface IndexEntry {
  id: string;
  /** Last known name, shown if the group can't be loaded. */
  name: string;
  addedAt: string;
}

export interface PersonalIndex {
  version: 1;
  /** Name chosen in FairShare; '' means use the Google account name. */
  profileName: string;
  groups: IndexEntry[];
}

function normalize(data: unknown): PersonalIndex {
  const d = (data && typeof data === 'object' ? data : {}) as Partial<PersonalIndex>;
  return {
    version: 1,
    profileName: typeof d.profileName === 'string' ? d.profileName : '',
    groups: Array.isArray(d.groups)
      ? d.groups.filter((g): g is IndexEntry => !!g && typeof g.id === 'string' && g.id.length > 0)
      : [],
  };
}

export class IndexStore {
  private cache: PersonalIndex | null = null;

  constructor(private readonly google: GoogleApi) {}

  async get(fresh = false): Promise<PersonalIndex> {
    if (!this.cache || fresh) this.cache = normalize(await this.google.readAppData(INDEX_FILE));
    return this.cache;
  }

  /** Re-reads first, so a change made on another device isn't lost. `change` returns false when nothing changed. */
  async update(change: (index: PersonalIndex) => boolean | void): Promise<PersonalIndex> {
    const index = await this.get(true);
    if (change(index) === false) return index;
    await this.google.writeAppData(INDEX_FILE, index);
    this.cache = index;
    return index;
  }

  async add(id: string, name: string, now: string): Promise<void> {
    if ((await this.get()).groups.some((g) => g.id === id)) return;
    await this.update((ix) => {
      if (ix.groups.some((g) => g.id === id)) return false;
      ix.groups.push({ id, name, addedAt: now });
    });
  }

  async remove(ids: string[]): Promise<void> {
    await this.update((ix) => {
      const before = ix.groups.length;
      ix.groups = ix.groups.filter((g) => !ids.includes(g.id));
      return ix.groups.length !== before;
    });
  }
}
