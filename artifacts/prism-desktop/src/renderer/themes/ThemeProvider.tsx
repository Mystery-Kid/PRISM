import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ThemeState } from "@shared/themes";

type ThemeContextValue = {
  state: ThemeState | null;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  claim: (id: string) => Promise<void>;
  apply: (id: string) => Promise<void>;
  repair: (id: string) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const readableError = (cause: unknown) => cause instanceof Error ? cause.message : "Theme settings could not be saved.";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ThemeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setState(await window.prism.getThemeState());
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (state?.effectiveThemeId) document.documentElement.dataset.theme = state.effectiveThemeId;
    else delete document.documentElement.dataset.theme;
    return () => { delete document.documentElement.dataset.theme; };
  }, [state?.effectiveThemeId]);

  const commit = useCallback(async (operation: () => Promise<ThemeState>) => {
    setError("");
    try {
      const next = await operation();
      setState(next);
    } catch (cause) {
      setError(readableError(cause));
      // Availability may have changed since the Shop was opened (for example,
      // a local package was removed). Expose Repair without requiring a restart.
      try { setState(await window.prism.getThemeState()); } catch { /* Keep the original failure visible. */ }
      throw cause;
    }
  }, []);
  const claim = useCallback((id: string) => commit(() => window.prism.claimTheme(id)), [commit]);
  const apply = useCallback((id: string) => commit(() => window.prism.applyTheme(id)), [commit]);
  const repair = useCallback((id: string) => commit(() => window.prism.repairTheme(id)), [commit]);
  const value = useMemo(() => ({ state, loading, error, reload, claim, apply, repair }), [state, loading, error, reload, claim, apply, repair]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemes() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useThemes must be used inside ThemeProvider.");
  return context;
}
