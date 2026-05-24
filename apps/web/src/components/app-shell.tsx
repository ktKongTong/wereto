import { Link, useLocation } from "react-router";
import { useState } from "react";

import { SettingsDialog } from "./settings-dialog";
import {ChartNoAxesColumn, Menu, Book, GithubIcon} from "lucide-react";
import {Button} from "@/components/ui/button.tsx";

const navItems = [
  { to: "/", label: "History", glyph: <Book className={'size-4'}/> },
  { to: "/archive", label: "Archive", glyph: <ChartNoAxesColumn className={'size-4'}/> },
];

export function AppShell({
  children,
  settingsOpen,
  onSettingsOpenChange,
  settingsInitialTab = "sync",
}: {
  children: React.ReactNode;
  settingsOpen?: boolean;
  onSettingsOpenChange?: (open: boolean) => void;
  settingsInitialTab?: "sync" | "account" | "appearance" | "about";
}) {
  const location = useLocation();
  const [internalSettingsOpen, setInternalSettingsOpen] = useState(false);
  const actualSettingsOpen = settingsOpen ?? internalSettingsOpen;
  const setActualSettingsOpen = onSettingsOpenChange ?? setInternalSettingsOpen;

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground">
      <header className="fixed inset-x-0 top-0 z-20 border-b bg-sidebar/95 backdrop-blur md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <nav className="flex items-center gap-3">
            {navItems.map((item) => {
              const active = location.pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  title={item.label}
                  className={[
                    "flex size-10 items-center justify-center rounded-full border text-sm transition",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background/40 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  ].join(" ")}
                >
                  {item.glyph}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-3">
            <Button
              variant={'link'}
              size={'icon'}
              title="Github"
              className="rounded-full border border-border bg-background/40 text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
            >
              <Link to={'https://github.com/ktkongtong/wereto'} target={'_blank'}>
                <GithubIcon className={'size-4'}/>
              </Link>
            </Button>
            <button
              type="button"
              onClick={() => setActualSettingsOpen(true)}
              title="Settings"
              className="flex size-10 items-center justify-center rounded-full border border-border bg-background/40 text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
            >
              <Menu className={'size-4'}/>
            </button>
          </div>
        </div>
      </header>

      <div className="grid h-full md:grid-cols-[72px_1fr]">
        <aside className="hidden h-screen border-r bg-sidebar md:flex md:flex-col md:items-center md:justify-between md:py-6">
          <nav className="flex flex-col items-center gap-4">
            {navItems.map((item) => {
              const active = location.pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  title={item.label}
                  className={[
                    "flex size-9 items-center justify-center rounded-full border text-sm transition",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background/40 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  ].join(" ")}
                >
                  {item.glyph}
                </Link>
              );
            })}
          </nav>

          <div className="flex flex-col items-center gap-3">
            <Button
              variant={'link'}
              size={'icon'}
              title="Github"
              className="rounded-full border border-border bg-background/40 text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
            >
              <Link to={'https://github.com/ktkongtong/wereto'} target={'_blank'}>
                <GithubIcon className={'size-4'}/>
              </Link>
            </Button>
            <button
              onClick={() => setActualSettingsOpen(true)}
              title="Settings"
              className="flex size-9 items-center justify-center rounded-full border border-border bg-background/40 text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
            >
              <Menu className={'size-4'}/>
            </button>
          </div>
        </aside>

        <main className="h-screen overflow-y-auto px-5 pb-8 pt-24 md:px-10 md:pt-8 lg:px-12">
          {children}
        </main>
      </div>

      <SettingsDialog open={actualSettingsOpen} onOpenChange={setActualSettingsOpen} initialTab={settingsInitialTab} />
    </div>
  );
}
