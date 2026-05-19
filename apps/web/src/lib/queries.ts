import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ArchiveNotebookDetail, ArchiveReadBook, ArchiveTimelineItem, HistoryYearRecord, ShelfAlbumItem, ShelfBookItem } from "../api/weread";
import { fetchJson } from "./api";

export type SessionPayload = {
  authenticated: boolean;
  public: boolean;
  passwordChanged: boolean;
  hasApiKey: boolean;
};

export type SyncRun = {
  id: number;
  status: string;
  phase: string;
  progressCurrent: number;
  progressTotal: number;
  requestedAt: number;
  startedAt: number;
  finishedAt?: number | null;
  errorMessage?: string | null;
  logs?: Array<{
    id: number;
    runId: number;
    level: string;
    phase: string;
    message: string;
    progressCurrent?: number | null;
    progressTotal?: number | null;
    metaJson?: string | null;
    createdAt: number;
  }>;
};

export type HistoryPayload = {
  overall: { totalReadTime?: number };
  years: number[];
  records: HistoryYearRecord[];
};

export type ArchivePayload = {
  shelfBooks: ShelfBookItem[];
  shelfAlbums: ShelfAlbumItem[];
  mp: Record<string, unknown> | null;
  notebookBooks: Array<{ bookId: string }>;
  notebookDetails: ArchiveNotebookDetail[];
  readBooks: ArchiveReadBook[];
  readBooksNotInShelf: ArchiveReadBook[];
  timeline: ArchiveTimelineItem[];
};

export const queryKeys = {
  session: ["session"] as const,
  history: ["query", "history"] as const,
  archive: ["query", "archive"] as const,
  syncRuns: ["sync", "runs"] as const,
  syncRun: (runId: number | null) => ["sync", "run", runId] as const,
};

export function useSessionQuery() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: () => fetchJson<SessionPayload>("/api/auth/session"),
    staleTime: 10_000,
  });
}

export function useLoginMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (password: string) =>
      fetchJson("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
    onSuccess: async () => {
      queryClient.setQueryData<SessionPayload>(queryKeys.session, (current) => ({
        authenticated: true,
        public: current?.public ?? false,
        passwordChanged: current?.passwordChanged ?? false,
        hasApiKey: current?.hasApiKey ?? false,
      }));
      await queryClient.invalidateQueries({ queryKey: queryKeys.session });
    },
  });
}

export function useLogoutMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => fetchJson("/api/auth/logout", { method: "POST", body: "{}" }),
    onSuccess: async () => {
      queryClient.setQueryData<SessionPayload>(queryKeys.session, (current) => ({
        authenticated: false,
        public: current?.public ?? false,
        passwordChanged: current?.passwordChanged ?? false,
        hasApiKey: current?.hasApiKey ?? false,
      }));
      queryClient.removeQueries({ queryKey: queryKeys.history });
      queryClient.removeQueries({ queryKey: queryKeys.archive });
      queryClient.removeQueries({ queryKey: queryKeys.syncRuns });
    },
  });
}

export function useSetPasswordMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (password: string) =>
      fetchJson<{ ok: boolean; passwordChanged: boolean }>("/api/settings/password", {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
    onSuccess: async () => {
      queryClient.setQueryData<SessionPayload>(queryKeys.session, (current) => ({
        authenticated: true,
        public: current?.public ?? false,
        passwordChanged: true,
        hasApiKey: current?.hasApiKey ?? false,
      }));
      await queryClient.invalidateQueries({ queryKey: queryKeys.session });
    },
  });
}

export function useSetWereadApiKeyMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (apiKey: string) =>
      fetchJson<{ ok: boolean; hasApiKey: boolean }>("/api/settings/weread-api-key", {
        method: "POST",
        body: JSON.stringify({ apiKey }),
      }),
    onSuccess: async () => {
      queryClient.setQueryData<SessionPayload>(queryKeys.session, (current) => ({
        authenticated: current?.authenticated ?? true,
        public: current?.public ?? false,
        passwordChanged: current?.passwordChanged ?? false,
        hasApiKey: true,
      }));
      await queryClient.invalidateQueries({ queryKey: queryKeys.session });
    },
  });
}

export function useHistoryQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.history,
    queryFn: () => fetchJson<HistoryPayload>("/api/query/history").then(res => ({
      ...res,
      records: res.records.reverse(),
    })),
    enabled,
  });
}

export function useArchiveQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.archive,
    queryFn: () => fetchJson<ArchivePayload>("/api/query/archive"),
    enabled,
  });
}

export function useSetPublicMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (isPublic: boolean) =>
      fetchJson<{ public: boolean }>("/api/settings/public", {
        method: "POST",
        body: JSON.stringify({ public: isPublic }),
      }),
    onSuccess: async (result) => {
      queryClient.setQueryData<SessionPayload>(queryKeys.session, (current) => ({
        authenticated: current?.authenticated ?? false,
        public: result.public,
        passwordChanged: current?.passwordChanged ?? false,
        hasApiKey: current?.hasApiKey ?? false,
      }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.session }),
        queryClient.invalidateQueries({ queryKey: queryKeys.history }),
        queryClient.invalidateQueries({ queryKey: queryKeys.archive }),
      ]);
    },
  });
}

export function useSyncRunsQuery(enabled = true, poll = false) {
  return useQuery({
    queryKey: queryKeys.syncRuns,
    queryFn: () => fetchJson<SyncRun[]>("/api/sync/runs"),
    enabled,
    refetchInterval: (query) => {
      if (!poll) return false;
      const runs = query.state.data as SyncRun[] | undefined;
      return runs?.some((run) => run.status === "queued" || run.status === "running") ? 1500 : false;
    },
    refetchIntervalInBackground: false,
    staleTime: 5_000,
  });
}

export function useSyncRunQuery(runId: number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.syncRun(runId),
    queryFn: () => fetchJson<SyncRun>(`/api/sync/runs/${runId}`),
    enabled: enabled && runId !== null,
    refetchInterval: (query) => {
      const run = query.state.data as SyncRun | undefined;
      return run?.status === "queued" || run?.status === "running" ? 1500 : false;
    },
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });
}

export function useStartSyncMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      fetchJson<{ runId: number }>("/api/sync/weread", {
        method: "POST",
        body: "{}",
      }),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.syncRuns }),
        queryClient.invalidateQueries({ queryKey: queryKeys.syncRun(result.runId) }),
      ]);
    },
  });
}

export function useInvalidateWereadSnapshots() {
  const queryClient = useQueryClient();

  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.history }),
        queryClient.invalidateQueries({ queryKey: queryKeys.archive }),
        queryClient.invalidateQueries({ queryKey: queryKeys.syncRuns }),
      ]),
    [queryClient],
  );
}
