import { Outlet, useOutletContext } from "react-router";
import { useCallback, useState } from "react";

import { AppShell } from "../../components/app-shell";

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
