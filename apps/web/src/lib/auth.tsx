import { useLoginMutation, useLogoutMutation, useSessionQuery } from "./queries";

export function useAuth() {
  const session = useSessionQuery();
  const loginMutation = useLoginMutation();
  const logoutMutation = useLogoutMutation();

  return {
    authenticated: Boolean(session.data?.authenticated),
    public: Boolean(session.data?.public),
    passwordChanged: Boolean(session.data?.passwordChanged),
    hasApiKey: Boolean(session.data?.hasApiKey),
    canViewPrivateData: Boolean(session.data?.authenticated || session.data?.public),
    loading: session.isPending,
    error: session.error,
    refresh: async () => {
      await session.refetch();
    },
    login: async (password: string) => {
      try {
        await loginMutation.mutateAsync(password);
        return true;
      } catch {
        return false;
      }
    },
    logout: async () => {
      await logoutMutation.mutateAsync();
    },
    loginPending: loginMutation.isPending,
    logoutPending: logoutMutation.isPending,
  };
}
