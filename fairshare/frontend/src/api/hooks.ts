import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deriveGroupState } from '@shared/settle';
import type { ApiActions, GroupDetail } from '@shared/types';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { api } from './client';
import { optimistic } from '../lib/optimistic';

export const keys = {
  groups: ['groups'] as const,
  group: (id: string) => ['group', id] as const,
  activity: (id: string) => ['activity', id] as const,
  access: (id: string) => ['access', id] as const,
};

// "No access" won't fix itself by retrying (the user must pick the sheet first), so don't retry it.
const retry = (count: number, err: Error) => count < 1 && !['NO_ACCESS', 'NEEDS_SIGNIN', 'FORBIDDEN'].includes((err as { code?: string }).code ?? '');

const LIST_CACHE = 'fairshare.groupsCache';
function cachedList(): ApiActions['listGroups']['res'] | undefined {
  try {
    const v = localStorage.getItem(LIST_CACHE);
    return v ? JSON.parse(v) : undefined;
  } catch {
    return undefined;
  }
}

/** My groups. The last list is kept on this device so the dashboard shows instantly while Google loads. */
export function useGroups() {
  return useQuery({
    queryKey: keys.groups,
    queryFn: async () => {
      const list = await api('listGroups', {});
      try {
        localStorage.setItem(LIST_CACHE, JSON.stringify(list.filter((g) => !g.error)));
      } catch {
        // ignore
      }
      return list;
    },
    placeholderData: cachedList,
    retry,
  });
}

export function forgetCachedGroups() {
  try {
    localStorage.removeItem(LIST_CACHE);
  } catch {
    // ignore
  }
}

export function useGroup(groupId: string) {
  return useQuery({ queryKey: keys.group(groupId), queryFn: () => api('getGroup', { groupId }), retry });
}

export function useActivity(groupId: string) {
  return useQuery({ queryKey: keys.activity(groupId), queryFn: () => api('getActivity', { groupId, limit: 300 }), retry });
}

/** Everyone with Google access to the group's sheet. */
export function useAccess(groupId: string, enabled: boolean) {
  return useQuery({ queryKey: keys.access(groupId), queryFn: () => api('getAccess', { groupId }), enabled, retry });
}

export function useRemoveAccess(groupId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (email: string) => api('removeAccess', { groupId, email }),
    onSuccess: (list) => {
      qc.setQueryData(keys.access(groupId), list);
      toast.success('Access removed');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

/** Open a group shared with me (after picking it), or several at once. */
export function useJoinGroups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (groupIds: string[]) => {
      const out = [];
      for (const groupId of groupIds) out.push(await api('joinGroup', { groupId }));
      return out;
    },
    onSuccess: (details) => {
      details.forEach((d) => qc.setQueryData(keys.group(d.group.id), d));
      qc.invalidateQueries({ queryKey: keys.groups });
    },
  });
}

/** Actions that take { groupId } and return the fresh GroupDetail. */
type GroupWrite = {
  [A in keyof ApiActions]: ApiActions[A]['req'] extends { groupId: string }
    ? ApiActions[A]['res'] extends GroupDetail | null
      ? A
      : never
    : never;
}[keyof ApiActions];

/**
 * Mutation for a group write. If an optimistic updater exists for the action, the cached group is
 * updated immediately (balances recomputed with the same shared logic as the server) and rolled
 * back on failure; the server's response then replaces it.
 */
export function useGroupWrite<A extends GroupWrite>(groupId: string, action: A) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = keys.group(groupId);
  return useMutation({
    mutationFn: (payload: Omit<ApiActions[A]['req'], 'groupId'>) =>
      api(action, { ...payload, groupId } as ApiActions[A]['req']),
    onMutate: async (payload) => {
      const update = (optimistic as Record<string, ((d: GroupDetail, p: unknown) => GroupDetail) | undefined>)[action];
      const prev = qc.getQueryData<GroupDetail>(key);
      if (!prev || !update) return { prev };
      await qc.cancelQueries({ queryKey: key });
      const next = update(prev, payload);
      const active = next.members.filter((m) => m.active).map((m) => m.email);
      qc.setQueryData<GroupDetail>(key, {
        ...next,
        ...deriveGroupState(next.expenses, next.payments, active, next.group.simplifyDebts),
      });
      return { prev };
    },
    onError: (err: Error, _payload, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(err.message);
    },
    onSuccess: (data) => {
      if (data) qc.setQueryData(key, data);
      else qc.removeQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: keys.groups });
      qc.invalidateQueries({ queryKey: keys.activity(groupId) });
      qc.invalidateQueries({ queryKey: keys.access(groupId) });
    },
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: ApiActions['createGroup']['req']) => api('createGroup', req),
    onSuccess: (d) => {
      qc.setQueryData(keys.group(d.group.id), d);
      qc.invalidateQueries({ queryKey: keys.groups });
    },
  });
}

export function useDeleteGroup(groupId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (confirmName: string) => api('deleteGroup', { groupId, confirmName }),
    onSuccess: () => {
      qc.setQueryData<ApiActions['listGroups']['res']>(keys.groups, (list) => list?.filter((g) => g.id !== groupId));
      qc.removeQueries({ queryKey: keys.group(groupId) });
      qc.removeQueries({ queryKey: keys.activity(groupId) });
      toast.success('Group deleted');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

/** Change your own FairShare name. Names appear in every group, so all group data is refetched. */
export function useUpdateProfile() {
  const qc = useQueryClient();
  const toast = useToast();
  const { updateUser } = useAuth();
  return useMutation({
    mutationFn: (name: string) => api('updateProfile', { name }),
    onSuccess: ({ user }) => {
      updateUser(user);
      qc.invalidateQueries({ queryKey: ['group'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
      qc.invalidateQueries({ queryKey: keys.groups });
      toast.success('Name updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
