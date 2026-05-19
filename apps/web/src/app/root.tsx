import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import type { Route } from "./+types/root";
import { AppQueryProvider } from "../lib/query-client";
import { defaultTheme, themeStorageKey, ThemeProvider } from "../lib/theme";
import "../styles/globals.css";

const themeInitScript = `(() => {
  try {
    const key = ${JSON.stringify(themeStorageKey)};
    const fallback = ${JSON.stringify(defaultTheme)};
    const theme = localStorage.getItem(key) || fallback;
    if (["paper", "sepia", "sage", "ink"].includes(theme)) {
      document.documentElement.dataset.theme = theme;
    } else {
      document.documentElement.dataset.theme = fallback;
    }
  } catch {
    document.documentElement.dataset.theme = ${JSON.stringify(defaultTheme)};
  }
})();`;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-theme={defaultTheme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <AppQueryProvider>
      <ThemeProvider>
        <Outlet />
      </ThemeProvider>
    </AppQueryProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return (
    <main className="mx-auto max-w-5xl px-6 py-20">
      <h1 className="text-4xl font-bold">页面加载失败</h1>
      <p className="mt-4 text-[color:var(--muted)]">{message}</p>
    </main>
  );
}
