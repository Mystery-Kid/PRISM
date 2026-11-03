import { useRef, useState } from "react";
import { Check, LoaderCircle, RotateCw } from "lucide-react";
import { BUILT_IN_THEME_IDS, DAY_ID, ORIGINAL_ID, STARRY_ID } from "@shared/themes";
import { useThemes } from "../themes/ThemeProvider";
import starryPreview from "../assets/starry-moon.png";
import originalPreview from "../assets/original-preview.svg";
import dayPreview from "../assets/day-preview.svg";

export function AppearanceSettings() {
  const { state, loading, error, reload, apply, repair } = useThemes();
  const [pending, setPending] = useState<string[]>([]);
  const pendingRef = useRef(new Set<string>());
  const [message, setMessage] = useState("");
  const choose = async (id: string, repairMissing = false) => {
    if (pendingRef.current.has(id)) return;
    pendingRef.current.add(id);
    setPending([...pendingRef.current]); setMessage("");
    try {
      await (repairMissing ? repair(id) : apply(id));
      setMessage(repairMissing ? "Theme package restored." : "Appearance updated.");
    } catch { /* The provider retains the operation error. */ }
    finally {
      pendingRef.current.delete(id);
      setPending([...pendingRef.current]);
    }
  };

  if (loading && !state) return <div className="appearance-loading"><span /><span /><span /></div>;
  if (!state) return <div className="theme-load-error" role="alert"><p>{error || "Appearance settings are unavailable."}</p><button className="button button-quiet" onClick={() => void reload()}><RotateCw size={14} /> Retry</button></div>;
  const knownThemes = [
    { id: ORIGINAL_ID, name: "Original", description: "PRISM's familiar neutral studio palette.", preview: originalPreview },
    { id: DAY_ID, name: "Day", description: "A clear daylight studio with soft mineral grey and readable teal.", preview: dayPreview },
    { id: STARRY_ID, name: "Starry", description: "Midnight sky, moonlight, and the exact Starry teal accent.", preview: starryPreview },
  ];
  const knownIds = new Set(knownThemes.map((theme) => theme.id));
  const themes = [
    ...knownThemes.filter((theme) =>
      theme.id !== STARRY_ID || state.claimedThemeIds.includes(STARRY_ID)
    ),
    ...[...new Set(state.availableThemeIds)]
      .filter((id) => !knownIds.has(id) && !BUILT_IN_THEME_IDS.includes(id))
      .map((id) => ({
        id,
        name: id.replace(/^theme\./, "").replace(/[-_.]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
        description: "An installed PRISM appearance saved on this device.",
        preview: null as string | null,
      })),
  ];
  return <div data-testid="preference-appearance">
   <div className="appearance-section" data-testid="appearance-section">
    <div className="appearance-intro"><span className="eyebrow">STUDIO SURFACE</span><h3>Appearance</h3><p>Choose the room you want to work in. Changes are saved on this device.</p></div>
    {state.warning && <div className="theme-warning" role="status">{state.warning}</div>}
    {error && <div className="inline-error" role="alert">{error}</div>}
    {message && <div className="theme-success" role="status"><Check size={14} />{message}</div>}
    <div className="appearance-list">
      {themes.map((theme) => {
        const current = state.effectiveThemeId === theme.id;
        const builtIn = BUILT_IN_THEME_IDS.includes(theme.id);
        const missing = !builtIn && !state.availableThemeIds.includes(theme.id);
        const isPending = pending.includes(theme.id);
        return <article className={`appearance-theme ${current ? "selected" : ""}`} key={theme.id} data-testid={`appearance-theme-${theme.id}`} aria-current={current ? "true" : undefined}>
          {theme.preview
            ? <img src={theme.preview} alt={`${theme.name} theme preview`} />
            : <div className="appearance-preview-fallback" aria-label={`${theme.name} preview`} />}
          <div className="appearance-theme-info">
            <div className="appearance-name">{theme.name}{current && <span className="current-tag" data-testid={`theme-current-${theme.id}`}>CURRENT</span>}</div>
            <p>{theme.description}</p>
            <span className="appearance-claimed">{missing ? "Claimed · package missing" : builtIn ? "Built-in" : state.claimedThemeIds.includes(theme.id) ? "Claimed" : "Installed locally"}</span>
          </div>
          {current ? <button className="button button-quiet appearance-action" disabled data-testid={`theme-current-action-${theme.id}`}><Check size={14} />Currently Applied</button>
            : missing ? <button className="button button-quiet appearance-action" disabled={isPending} onClick={() => void choose(theme.id, true)} data-testid={`theme-repair-${theme.id}`}>{isPending ? <LoaderCircle className="button-spin" size={14} /> : <RotateCw size={14} />}Repair</button>
              : <button className="button button-quiet appearance-action" disabled={isPending} onClick={() => void choose(theme.id)} data-testid={`theme-apply-${theme.id}`}>{isPending ? <LoaderCircle className="button-spin" size={14} /> : null}Apply Theme</button>}
        </article>;
      })}
    </div>
    {!state.claimedThemeIds.includes(STARRY_ID) && <p className="appearance-shop-hint">Starry is in the <strong>Shop</strong>. Claim it to make it available here.</p>}
   </div>
  </div>;
}
