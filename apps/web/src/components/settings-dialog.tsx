import { useEffect, useMemo, useState } from "react";

import { CheckCircle2, CircleDashed, CircleX, ExternalLink, LoaderCircle } from "lucide-react";

import { useAuth } from "../lib/auth";
import { themeOptions, useTheme } from "../lib/theme";
import {
  type SyncRun,
  useSetPasswordMutation,
  useSetPublicMutation,
  useSetWereadApiKeyMutation,
  useStartSyncMutation,
  useSyncRunQuery,
  useSyncRunsQuery,
} from "../lib/queries";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { ScrollArea } from "./ui/scroll-area";
import { Switch } from "./ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { cn } from "../lib/utils";

type SettingsTab = "sync" | "account" | "appearance" | "about";

export function SettingsDialog({
  open,
  onOpenChange,
  initialTab = "account",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: SettingsTab;
}) {
  const auth = useAuth();
  const { theme, setTheme } = useTheme();
  const desktopTabs = useMediaQuery("(min-width: 768px)");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loginError, setLoginError] = useState("");
  const [settingsMessage, setSettingsMessage] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const runsQuery = useSyncRunsQuery(open && auth.authenticated);
  const startSyncMutation = useStartSyncMutation();
  const setPublicMutation = useSetPublicMutation();
  const setPasswordMutation = useSetPasswordMutation();
  const setApiKeyMutation = useSetWereadApiKeyMutation();
  const runs = useMemo(() => runsQuery.data ?? [], [runsQuery.data]);
  const currentRun: SyncRun | null = runs.find((item) => item.status === "queued" || item.status === "running") ?? runs[0] ?? null;
  const effectiveRunId = selectedRunId ?? currentRun?.id ?? null;
  const selectedRun = runs.find((item) => item.id === effectiveRunId) ?? null;
  const runQuery = useSyncRunQuery(effectiveRunId, open && auth.authenticated && effectiveRunId !== null);
  const run: SyncRun | null = runQuery.data ?? selectedRun ?? currentRun;
  const syncBusy = runs.some((item) => item.status === "queued" || item.status === "running");


  useEffect(() => {
    if (open && selectedRunId === null && currentRun) {
      setSelectedRunId(currentRun.id);
    }
  }, [currentRun, open, selectedRunId]);

  async function handleLogin() {
    const ok = await auth.login(password);
    if (!ok) {
      setLoginError("密码错误");
      return;
    }
    setLoginError("");
    setPassword("");
  }

  async function savePassword() {
    setSettingsMessage("");
    await setPasswordMutation.mutateAsync(newPassword);
    setNewPassword("");
    setSettingsMessage("密码已更新。");
  }

  async function saveApiKey() {
    setSettingsMessage("");
    await setApiKeyMutation.mutateAsync(apiKey);
    setApiKey("");
    setSettingsMessage("Weread API key 已保存。");
  }

  async function startSync() {
    const result = await startSyncMutation.mutateAsync();
    setSelectedRunId(result.runId);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className=" gap-0 overflow-hidden p-0 w-160 max-w-full sm:max-w-full"
        aria-describedby="settings-description"
        showCloseButton={false}
      >
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as SettingsTab)}
          orientation={desktopTabs ? "vertical" : "horizontal"}
          className="min-h-0 min-w-0 gap-0 bg-background md:grid md:grid-cols-[140px_minmax(0,1fr)]"
        >
          <TabsList
            variant="line"
            className="w-full min-w-0 justify-start overflow-x-auto md:p-3 "
          >
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="sync">Sync</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>

          <div className="h-[72vh] min-h-0 min-w-0 w-full overflow-hidden bg-background p-5 max-md:h-[72vh]">


            <TabsContent value="account" className="m-0 h-full min-w-0 outline-none">
              <ScrollArea className="h-full">
                <AccountSettings
                  authenticated={auth.authenticated}
                  loginPending={auth.loginPending}
                  logoutPending={auth.logoutPending}
                  public={auth.public}
                  passwordChanged={auth.passwordChanged}
                  hasApiKey={auth.hasApiKey}
                  password={password}
                  newPassword={newPassword}
                  apiKey={apiKey}
                  loginError={loginError}
                  settingsMessage={settingsMessage}
                  passwordPending={setPasswordMutation.isPending}
                  apiKeyPending={setApiKeyMutation.isPending}
                  publicPending={setPublicMutation.isPending}
                  passwordError={setPasswordMutation.error}
                  apiKeyError={setApiKeyMutation.error}
                  onPasswordChange={setPassword}
                  onNewPasswordChange={setNewPassword}
                  onApiKeyChange={setApiKey}
                  onLogin={() => void handleLogin()}
                  onSavePassword={() => void savePassword()}
                  onSaveApiKey={() => void saveApiKey()}
                  onTogglePublic={() => void setPublicMutation.mutateAsync(!auth.public)}
                  onLogout={() => void auth.logout()}
                />
              </ScrollArea>
            </TabsContent>
            <TabsContent value="sync" className="m-0 h-full min-w-0 outline-none">
              <SyncSettings
                authenticated={auth.authenticated}
                hasApiKey={auth.hasApiKey}
                passwordChanged={auth.passwordChanged}
                run={run}
                runs={runs}
                runsPending={runsQuery.isPending}
                effectiveRunId={effectiveRunId}
                runFetching={runQuery.isFetching}
                syncBusy={syncBusy}
                startPending={startSyncMutation.isPending}
                onStartSync={() => void startSync()}
                onSelectRun={setSelectedRunId}
                onLoginRequest={() => setActiveTab("account")}
              />
            </TabsContent>
            <TabsContent value="appearance" className="m-0 h-full min-w-0 outline-none">
              <ScrollArea className="h-full">
                <AppearanceSettings activeTheme={theme} onThemeChange={setTheme} />
              </ScrollArea>
            </TabsContent>

            <TabsContent value="about" className="m-0 h-full min-w-0 outline-none">
              <ScrollArea className="h-full">
                <div className="pr-3">
                  <AboutSettings />
                </div>
              </ScrollArea>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function AppearanceSettings({
  activeTheme,
  onThemeChange,
}: {
  activeTheme: string;
  onThemeChange: (theme: typeof themeOptions[number]["value"]) => void;
}) {
  return (
    <div className="flex max-md:max-w-4xl flex-col gap-5">
      <div>
        <div className="text-base font-semibold">主题色</div>
      </div>
      <div className="flex flex-col gap-3">
        {themeOptions.map((option) => {
          const active = option.value === activeTheme;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onThemeChange(option.value)}
              className={cn(
                "flex items-center justify-between gap-5 rounded-lg border px-4 py-3 text-left transition",
                active ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background hover:border-primary/40"
              )}
            >
              <span>
                <span className="block text-base font-semibold">{option.label}</span>
              </span>
              <span className="flex shrink-0 gap-2">
                {option.swatches.map((swatch) => (
                  <span key={swatch} className="size-6 rounded-full border border-border" style={{ backgroundColor: swatch }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SyncSettings({
  authenticated,
  hasApiKey,
  passwordChanged,
  run,
  runs,
  runsPending,
  effectiveRunId,
  runFetching,
  syncBusy,
  startPending,
  onStartSync,
  onSelectRun,
  onLoginRequest,
}: {
  authenticated: boolean;
  hasApiKey: boolean;
  passwordChanged: boolean;
  run: SyncRun | null;
  runs: SyncRun[];
  runsPending: boolean;
  effectiveRunId: number | null;
  runFetching: boolean;
  syncBusy: boolean;
  startPending: boolean;
  onStartSync: () => void;
  onSelectRun: (runId: number) => void;
  onLoginRequest: () => void;
}) {

  const blockedReason = !passwordChanged ? "请先在 Account 中修改默认密码。" : !hasApiKey ? "请先在 Account 中配置 Weread API key。" : "";

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col shrink-0">
      <div className="shrink-0 border-b pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-2xl font-semibold">同步任务</div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button onClick={onStartSync} disabled={!passwordChanged || !hasApiKey || startPending || syncBusy}>
              {startPending || syncBusy ? "同步中..." : "开始同步"}
            </Button>
          </div>
        </div>
        {blockedReason ? <Notice tone="warning">{blockedReason}</Notice> : null}
      </div>

      <div className="grid min-h-0 min-w-0 md:grid-cols-[120px_minmax(0,1fr)]">
        <div className="min-h-0 min-w-0 py-3">
          <div className="min-w-0 overflow-x-auto pb-1 md:h-full md:overflow-x-hidden md:overflow-y-auto md:pb-0">
            <div className="flex w-max min-w-full gap-2 md:w-auto md:min-w-0 md:flex-col">
              {!runsPending && runs.length === 0 ? <div className="text-sm text-muted-foreground">尚无同步记录。</div> : null}
              {runs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectRun(item.id)}
                  className={cn(
                    "flex min-w-32 items-center gap-3 rounded-md px-3 py-2 text-left transition hover:bg-muted/50 md:min-w-0",
                    item.id === effectiveRunId ? "bg-muted text-foreground" : "text-muted-foreground"
                  )}
                >
                  <RunStatusIcon status={item.status} />
                  <span className="text-base font-semibold">run #{item.id}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 shrink flex-col md:pl-5">

          <div className="flex min-h-0 min-w-0 flex-1 flex-col py-4 md:py-5">
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex min-w-0 flex-col gap-3 pr-3">
                {run?.logs && run.logs.length > 0 ? (
                  run.logs.map((log) => (
                    <div key={log.id} className="min-w-0 border-l px-3 py-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <LogLevelBadge level={log.level} />
                        <span>{formatLogTime(log.createdAt)}</span>
                        <span>{log.phase}</span>
                        {log.progressCurrent !== null && log.progressCurrent !== undefined ? (
                          <span>
                            {log.progressCurrent}/{log.progressTotal || 0}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 break-words text-sm leading-5">{log.message}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">暂无同步日志。</div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountSettings({
  authenticated,
  loginPending,
  logoutPending,
  public: isPublic,
  passwordChanged,
  hasApiKey,
  password,
  newPassword,
  apiKey,
  loginError,
  settingsMessage,
  passwordPending,
  apiKeyPending,
  publicPending,
  passwordError,
  apiKeyError,
  onPasswordChange,
  onNewPasswordChange,
  onApiKeyChange,
  onLogin,
  onSavePassword,
  onSaveApiKey,
  onTogglePublic,
  onLogout,
}: {
  authenticated: boolean;
  loginPending: boolean;
  logoutPending: boolean;
  public: boolean;
  passwordChanged: boolean;
  hasApiKey: boolean;
  password: string;
  newPassword: string;
  apiKey: string;
  loginError: string;
  settingsMessage: string;
  passwordPending: boolean;
  apiKeyPending: boolean;
  publicPending: boolean;
  passwordError: unknown;
  apiKeyError: unknown;
  onPasswordChange: (value: string) => void;
  onNewPasswordChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onLogin: () => void;
  onSavePassword: () => void;
  onSaveApiKey: () => void;
  onTogglePublic: () => void;
  onLogout: () => void;
}) {
  if (!authenticated) {
    return (
      <div className="max-w-2xl">
        <div className="mb-8">
          <div className="text-2xl font-semibold">登录</div>
        </div>
        <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="flex flex-col gap-2">
            <Label htmlFor="settings-password">密码</Label>
            <DarkInput id="settings-password" type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} placeholder="输入密码" />
          </div>
          <Button onClick={onLogin} disabled={loginPending}>
            {loginPending ? "登录中..." : "登录"}
          </Button>
        </div>
        {loginError ? <div className="mt-4"><Notice tone="error">{loginError}</Notice></div> : null}
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {settingsMessage ? <Notice tone="success">{settingsMessage}</Notice> : null}

      <section className="flex flex-col gap-2">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:gap-5">
          <div className="shrink-0 md:w-36">
            <div className="text-base font-semibold">修改密码</div>
            {!passwordChanged ? <div className="mt-1 text-xs text-primary">首次登录，请修改默认密码</div> : null}
          </div>
          <div className="flex flex-col px-2  md:flex-row  justify-between gap-2">
            <div className="min-w-0 flex-1">
              <DarkInput id="settings-new-password" type="password" value={newPassword} onChange={(event) => onNewPasswordChange(event.target.value)} placeholder="password" />
            </div>
            <Button className="shrink-0 md:min-w-20" type="button" disabled={passwordPending || newPassword.trim().length < 4} onClick={onSavePassword}>
              保存
            </Button>
          </div>

        </div>
        {passwordError ? <div className="md:pl-[10.25rem]"><Notice tone="error">{passwordError instanceof Error ? passwordError.message : "保存失败"}</Notice></div> : null}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:gap-5">
          <div className="shrink-0 md:w-36">
            <div className="flex items-center gap-2 text-base font-semibold">
              修改 Weread API key
              <a
                href="https://weread.qq.com/r/weread-skills"
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground transition hover:text-primary"
                aria-label="打开微信读书获取 API key"
              >
            <ExternalLink className="size-4" />
              </a>
            </div>
          </div>
          <div className="flex flex-col px-2  md:flex-row  justify-between gap-2">
          <div className="min-w-0 flex-1">
            <DarkInput id="settings-api-key" type="password" value={apiKey} onChange={(event) => onApiKeyChange(event.target.value)} placeholder="wrk-..." />
          </div>
          <Button className="shrink-0 md:min-w-20" type="button" disabled={apiKeyPending || apiKey.trim().length === 0} onClick={onSaveApiKey}>
            保存
            </Button>
          </div>
        </div>
        {apiKeyError ? <div className="md:pl-[10.25rem]"><Notice tone="error">{apiKeyError instanceof Error ? apiKeyError.message : "保存失败"}</Notice></div> : null}
      </section>

      <section className="flex items-center justify-between px-2">
        <div className="shrink-0 text-base font-semibold md:w-36">公开阅读数据</div>
        <Switch checked={isPublic} disabled={publicPending} onCheckedChange={onTogglePublic} aria-label="公开阅读数据" />
      </section>

      <section className="flex items-center justify-between px-2">
        <div className="shrink-0 text-base font-semibold md:w-36">退出登录</div>
        <Button className="min-w-20" variant="outline" onClick={onLogout} disabled={logoutPending}>
          {logoutPending ? "退出中..." : "退出"}
        </Button>
      </section>
    </div>
  );
}

function AboutSettings() {
  return (
    <>About</>
  );
}

function DarkInput(props: React.ComponentProps<typeof Input>) {
  return <Input className="bg-background" {...props} />;
}

function RunStatusIcon({ status }: { status: string }) {
  if (status === "success") return <CheckCircle2 className="size-4 text-primary" aria-label="success" />;
  if (status === "failed") return <CircleX className="size-4 text-destructive" aria-label="failed" />;
  if (status === "running") return <LoaderCircle className="size-4 animate-spin text-primary" aria-label="running" />;
  return <CircleDashed className="size-4 text-muted-foreground" aria-label={status} />;
}

function LogLevelBadge({ level }: { level: string }) {
  if (level === "error") return <Badge variant="destructive">ERROR</Badge>;
  if (level === "warn") return <Badge variant="outline" className="border-amber-400/30 text-amber-200">WARN</Badge>;
  return <Badge variant="secondary">INFO</Badge>;
}

function Notice({ tone, children }: { tone: "warning" | "error" | "success"; children: React.ReactNode }) {
  const className =
    tone === "error"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : tone === "warning"
        ? "border-primary/30 bg-primary/10 text-foreground"
        : "border-primary/30 bg-primary/10 text-foreground";

  return <div className={`rounded-lg border px-3 py-2 text-sm leading-6 ${className}`}>{children}</div>;
}

function formatLogTime(timestamp: number) {
  if (!timestamp) return "";
  return new Date(timestamp * 1000).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);
    const listener = (event: MediaQueryListEvent) => setMatches(event.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [query]);

  return matches;
}
