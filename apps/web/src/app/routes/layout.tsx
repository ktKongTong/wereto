import { Outlet, useOutletContext } from "react-router";
import {useCallback, useEffect, useState} from "react";

import { AppShell } from "../../components/app-shell";
import {useSessionQuery} from "@/lib/queries.ts";

type ShellContext = {
  openSettings: (initialTab?: "sync" | "account" | "appearance" | "about") => void;
};

export default function ShellLayout() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"sync" | "account" | "appearance" | "about">("account");

  const openSettings = useCallback((initialTab: "sync" | "account" | "appearance" | "about" = "sync") => {
    setSettingsInitialTab(initialTab);
    setSettingsOpen(true);
  }, []);
  const session = useSessionQuery();
  const canView = Boolean(session.data?.authenticated || session.data?.public);
  useEffect(() => {
    if (!session.isPending && !canView) {
      openSettings("account");
    }
  }, [canView, openSettings, session.isPending]);

  return (
    <AppShell
      settingsOpen={settingsOpen}
      onSettingsOpenChange={setSettingsOpen}
      settingsInitialTab={settingsInitialTab}
    >
      <Outlet context={{ openSettings } satisfies ShellContext} />
    </AppShell>
  );
}

export function useShell() {
  return useOutletContext<ShellContext>();
}
