/* eslint-disable react-refresh/only-export-components -- provider + hook are intentionally colocated */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Single source of truth for the dashboard theme. The user's *preference*
 * (`dark | light | system`) is persisted to localStorage; the *applied* theme
 * (`dark | light`) is resolved from it (system follows the OS) and written to
 * `document.body.dataset.theme`, which drives the CSS-variable palette.
 *
 * Both the Topbar toggle and the Settings selector consume this hook, so they
 * can never drift out of sync.
 */
export type ThemePref = 'dark' | 'light' | 'system';
export type AppliedTheme = 'dark' | 'light';

const STORAGE_KEY = 'hola-theme';

interface ThemeContextValue {
  /** The user's stored preference. */
  theme: ThemePref;
  /** The resolved theme actually applied to the DOM. */
  applied: AppliedTheme;
  setTheme: (t: ThemePref) => void;
  /** Flip between dark and light (relative to what's currently applied). */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light' || v === 'system') return v;
  } catch {
    /* localStorage unavailable (SSR/tests) — fall through */
  }
  return 'dark';
}

function systemTheme(): AppliedTheme {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemePref>(readPref);
  const [system, setSystem] = useState<AppliedTheme>(systemTheme);

  // Keep the resolved value current when the OS scheme changes (only matters
  // while the preference is 'system', but the listener is cheap to keep live).
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!mq) return;
    const onChange = () => setSystem(mq.matches ? 'light' : 'dark');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const applied: AppliedTheme = theme === 'system' ? system : theme;

  useEffect(() => {
    document.body.dataset.theme = applied;
  }, [applied]);

  const setTheme = useCallback((t: ThemePref) => {
    setThemeState(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* ignore persistence failures */
    }
  }, []);

  const toggle = useCallback(
    () => setTheme(applied === 'dark' ? 'light' : 'dark'),
    [applied, setTheme],
  );

  return (
    <ThemeContext.Provider value={{ theme, applied, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
