import { useRef, useState } from "react";
import { Check, LoaderCircle, RotateCw } from "lucide-react";
import { ORIGINAL_ID, STARRY_ID } from "@shared/themes";
import { useThemes } from "../themes/ThemeProvider";
import starryPreview from "../assets/starry-preview.svg";
import originalPreview from "../assets/original-preview.svg";

export function AppearanceSettings() {
  const { state, loading, error, reload, apply, repair } = useThemes();
  const [pending, setPending] = useState("");
  const pendingRef = useRef(false);
  const [message, setMessage] = useState("");
  const choose = async (id: string, repairMissing = false) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(id); setMessage("");
    try {
      await (repairMissing ? repair(id) : apply(id));
      setMessage(repairMissing ? "Theme package restored." : "Appearance updated.");
    } catch { /* The provider retains the operation error. */ }
    finally { pendingRef.current = false; setPending(""); }
  };

  if (loading && !state) return <div className="appearance-loading"><span /><span /><span /></div>;
  if (!state) return <div className="theme-load-error" role="alert"><p>{error || "Appearance settings are unavailable."}</p><button className="button button-quiet" onClick={() => void reload()}><RotateCw size={14} /> Retry</button></div>;
  const themes = [
    { id: ORIGINAL_ID, name: "Original", description: "PRISM's familiar neutral studio palette.", preview: originalPreview, claimed: true },
    ...(state.claimedThemeIds.includes(STARRY_ID) ? [{ id: STARRY_ID, name: "Starry", description: "Midnight navy, soft blue accents, and a quiet starfield.", preview: starryPreview, claimed: true }] : []),
  ];
  return <div className="appearance-section">
    <div className="appearance-intro"><span className="eyebrow">STUDIO SURFACE</span><h3>Appearance</h3><p>Choose the room you want to work in. Changes are saved on this device.</p></div>
    {state.warning && <div className="theme-warning" role="status">{state.warning}</div>}
    {error && <div className="inline-error" role="alert">{error}</div>}
    {message && <div className="theme-success" role="status"><Check size={14} />{message}</div>}
    <div className="appearance-list">
      {themes.map((theme) => {
        const current = state.effectiveThemeId === theme.id;
        const missing = theme.id !== ORIGINAL_ID && !state.availableThemeIds.includes(theme.id);
        return <article className={`appearance-theme ${current ? "selected" : ""}`} key={theme.id}>
          <img src={theme.preview} alt={`${theme.name} theme preview`} />
          <div className="appearance-theme-info"><div className="appearance-name">{theme.name}{current && <span className="current-tag">CURRENT</span>}</div><p>{theme.description}</p><span className="appearance-claimed">{missing ? "Claimed · package missing" : theme.claimed ? "Claimed" : "Available"}</span></div>
          {current ? <button className="button button-quiet appearance-action" disabled><Check size={14} />Currently Applied</button>
            : missing ? <button className="button button-quiet appearance-action" disabled={!!pending} onClick={() => void choose(theme.id, true)}>{pending === theme.id ? <LoaderCircle className="button-spin" size={14} /> : <RotateCw size={14} />}Repair</button>
              : <button className="button button-quiet appearance-action" disabled={!!pending} onClick={() => void choose(theme.id)}>{pending === theme.id ? <LoaderCircle className="button-spin" size={14} /> : null}Apply Theme</button>}
        </article>;
      })}
    </div>
    {!state.claimedThemeIds.includes(STARRY_ID) && <p className="appearance-shop-hint">Starry is free in the <strong>Shop</strong>. Claim it to make it available here.</p>}
  </div>;
}
