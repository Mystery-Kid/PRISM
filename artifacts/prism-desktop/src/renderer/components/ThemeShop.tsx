import { useRef, useState } from "react";
import { Check, Download, LoaderCircle, RotateCw, Sparkles } from "lucide-react";
import { STARRY_ID, themeProducts } from "@shared/themes";
import { useThemes } from "../themes/ThemeProvider";
import starryPreview from "../assets/starry-preview.svg";

export function ThemeShop() {
  const { state, loading, error, reload, claim, apply, repair } = useThemes();
  const [pending, setPending] = useState("");
  const pendingRef = useRef(false);
  const [notice, setNotice] = useState<{ action: string; text: string } | null>(null);
  const product = themeProducts[0];
  const claimed = !!state?.claimedThemeIds.includes(product.id);
  const available = !!state?.availableThemeIds.includes(product.id);
  const applied = state?.effectiveThemeId === product.themeId;
  const run = async (action: string, fn: () => Promise<void>, success: string) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(action);
    setNotice(null);
    try { await fn(); setNotice({ action, text: success }); }
    catch { /* Provider exposes the persisted operation error. */ }
    finally { pendingRef.current = false; setPending(""); }
  };

  let actionLabel = "Claim Free Theme";
  if (pending) actionLabel = "Saving…";
  else if (applied) actionLabel = "Currently Applied";
  else if (claimed) actionLabel = "Apply Theme";

  return <section className="shop-page shop-catalog">
    <div className="shop-titlebar">
      <div><span className="eyebrow">PRISM / LOCAL COLLECTION</span><h1>Shop</h1><p>Useful additions for the room you make music in.</p></div>
      <span className="shop-offline"><span /> On-device · no account required</span>
    </div>
    {loading && !state ? <div className="theme-loading" aria-label="Loading themes"><span /><span /><span /></div> : null}
    {!loading && !state && <div className="theme-load-error" role="alert"><p>{error || "Your theme library could not be loaded."}</p><button className="button button-quiet" onClick={() => void reload()}><RotateCw size={14} /> Try again</button></div>}
    {state && <div className="shop-product">
      <div className="shop-artwork">
        <img src={starryPreview} alt="Starry theme preview: midnight blue interface with a soft starfield" />
        <span className="preview-caption"><Sparkles size={13} /> THEME PREVIEW / 01</span>
      </div>
      <div className="shop-product-copy">
        <div className="shop-product-meta"><span>THEMES</span><span className="free-label">FREE</span></div>
        <h2>{product.name}<span className="product-index">01</span></h2>
        <p className="shop-description">{product.description}</p>
        <div className="product-status" aria-live="polite">
          <span className={`status-mark ${available ? "is-ready" : "is-missing"}`} />
          {applied ? "Currently Applied" : claimed ? (available ? "Claimed" : "Claimed · package missing") : available ? "Available locally" : "Package unavailable"}
        </div>
        {state.warning && <div className="theme-warning" role="status">{state.warning}</div>}
        {error && <div className="inline-error" role="alert">{error}</div>}
        {notice && (notice.action !== "apply" || applied) && (notice.action !== "repair" || available) &&
          <div className="theme-success" role="status"><Check size={14} />{notice.text}</div>}
        <div className="shop-product-actions">
          {!available
            ? <button className="button button-quiet" disabled={!!pending} onClick={() => void run("repair", () => repair(product.themeId), "Starry is ready to use.")}>
                {pending ? <LoaderCircle className="button-spin" size={15} /> : <RotateCw size={15} />}{pending ? "Repairing…" : "Repair Theme"}
              </button>
            : !claimed
            ? <button className="button button-primary" disabled={!available || !!pending} onClick={() => void run("claim", () => claim(product.id), "Starry added to your themes.")}>
                {pending ? <LoaderCircle className="button-spin" size={15} /> : <Download size={15} />}{actionLabel}
              </button>
            : applied
              ? <button className="button button-primary applied-button" disabled><Check size={15} />Currently Applied</button>
              : available
                ? <button className="button button-primary" disabled={!!pending} onClick={() => void run("apply", () => apply(product.themeId), "Starry is now applied.")}>
                    {pending ? <LoaderCircle className="button-spin" size={15} /> : <Sparkles size={15} />}{actionLabel}
                  </button>
              : null}
          {claimed && !available && <span className="repair-note">Your claim is saved; restore the local theme package to apply it.</span>}
        </div>
      </div>
      <footer className="shop-product-foot"><span>Works offline</span><span>Saved to this device</span><span>Compatible with PRISM</span></footer>
    </div>}
    <div className="shop-bottom-note"><span className="shop-rule" /><span>More local themes may arrive over time. For now, one carefully made room.</span><span className="shop-rule" /></div>
  </section>;
}
