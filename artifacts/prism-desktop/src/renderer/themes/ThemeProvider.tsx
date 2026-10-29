import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  const requestVersion = useRef(0);
  const operationQueue = useRef<Promise<void>>(Promise.resolve());

  const reload = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError("");
    const request = operationQueue.current.then(() => window.prism.getThemeState());
    operationQueue.current = request.then(() => undefined, () => undefined);
    try {
      const next = await request;
      if (version === requestVersion.current) setState(next);
    } catch (cause) {
      if (version === requestVersion.current) setError(readableError(cause));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (state?.effectiveThemeId) document.documentElement.dataset.theme = state.effectiveThemeId;
  }, [state?.effectiveThemeId]);

  const commit = useCallback(async (operation: () => Promise<ThemeState>) => {
    const version = ++requestVersion.current;
    setError("");
    const request = operationQueue.current.then(operation);
    operationQueue.current = request.then(() => undefined, () => undefined);
    try {
      const next = await request;
      if (version === requestVersion.current) setState(next);
    } catch (cause) {
      if (version === requestVersion.current) setError(readableError(cause));
      // Availability may have changed since the Shop was opened (for example,
      // a local package was removed). Expose Repair without requiring a restart.
      try {
        const refreshed = await window.prism.getThemeState();
        if (version === requestVersion.current) setState(refreshed);
      } catch { /* Keep the original failure visible. */ }
      throw cause;
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);
  const claim = useCallback((id: string) => commit(() => window.prism.claimTheme(id)), [commit]);
  const apply = useCallback((id: string) => commit(() => window.prism.applyTheme(id)), [commit]);
  const repair = useCallback((id: string) => commit(() => window.prism.repairTheme(id)), [commit]);
  const value = useMemo(() => ({ state, loading, error, reload, claim, apply, repair }), [state, loading, error, reload, claim, apply, repair]);
  return <ThemeContext.Provider value={value}>
    <div className="theme-art-layer" data-testid="theme-art-layer" aria-hidden="true" />
    <div className="theme-app-content">{children}</div>
  </ThemeContext.Provider>;
}

export function useThemes() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useThemes must be used inside ThemeProvider.");
  return context;
}
