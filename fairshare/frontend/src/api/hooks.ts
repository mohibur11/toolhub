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
  receipt: (groupId: string, fileId: string) => ['receipt', groupId, fileId] as const,
};

export function useGroups() {
  return useQuery({ queryKey: keys.groups, queryFn: () => api('listGroups', {}) });
}

export function useGroup(groupId: string) {
  return useQuery({ queryKey: keys.group(groupId), queryFn: () => api('getGroup', { groupId }) });
}

export function useActivity(groupId: string) {
  return useQuery({ queryKey: keys.activity(groupId), queryFn: () => api('getActivity', { groupId, limit: 300 }) });
}

export function useReceipt(groupId: string, fileId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.receipt(groupId, fileId),
    queryFn: () => api('getReceipt', { groupId, fileId }),
    enabled: enabled && !!fileId,
    staleTime: Infinity,
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
