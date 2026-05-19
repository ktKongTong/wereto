import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type ThemeName = "paper" | "sepia" | "sage" | "ink";

export const themeOptions: Array<{
  value: ThemeName;
  label: string;
  description: string;
  swatches: string[];
}> = [
  {
    value: "paper",
    label: "Paper",
    description: "低对比暖纸色，适合长时间阅读。",
    swatches: ["oklch(0.96 0.018 82)", "oklch(0.23 0.018 78)", "oklch(0.62 0.12 64)"],
  },
  {
    value: "sepia",
    label: "Sepia",
    description: "更重的书页感，减少纯白刺激。",
    swatches: ["oklch(0.91 0.035 78)", "oklch(0.25 0.03 68)", "oklch(0.55 0.13 52)"],
  },
  {
    value: "sage",
    label: "Sage",
    description: "偏冷的灰绿色，适合数据视图。",
    swatches: ["oklch(0.92 0.025 145)", "oklch(0.22 0.025 155)", "oklch(0.55 0.12 155)"],
  },
  {
    value: "ink",
    label: "Ink",
    description: "保留深色，但不再使用硬编码黑色。",
    swatches: ["oklch(0.10 0.01 80)", "oklch(0.94 0.018 82)", "oklch(0.68 0.13 72)"],
  },
];

export const defaultTheme: ThemeName = "sage";
export const themeStorageKey = "weread-theme";

type ThemeContextValue = {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readInitialTheme(): ThemeName {
  if (typeof window === "undefined") return defaultTheme;
  const stored = window.localStorage.getItem(themeStorageKey);
  return isThemeName(stored) ? stored : defaultTheme;
}

function isThemeName(value: string | null): value is ThemeName {
  return themeOptions.some((theme) => theme.value === value);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(readInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme: setThemeState,
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return context;
}
