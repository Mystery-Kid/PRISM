import { useEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import "./tempo-dialog.css";

type TempoChangeDialogProps = {
  fromTempo: number;
  toTempo: number;
  busy: boolean;
  progress: string;
  error: string;
  unsupported: string[];
  onTempoOnly: () => void;
  onAdapt: () => void;
  onCancel: () => void;
};

function formatTempo(tempo: number): string {
  return Number.isFinite(tempo) ? tempo.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—";
}

export function TempoChangeDialog({
  fromTempo,
  toTempo,
  busy,
  progress,
  error,
  unsupported,
  onTempoOnly,
  onAdapt,
  onCancel,
}: TempoChangeDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const initiatingElementRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const ratio = fromTempo > 0 ? toTempo / fromTempo : Number.NaN;
  const ratioSupported = Number.isFinite(ratio) && ratio >= 0.5 && ratio <= 2;

  useEffect(() => {
    cancelRef.current?.focus();
    return () => {
      const initiatingElement = initiatingElementRef.current;
      if (initiatingElement?.isConnected) initiatingElement.focus();
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;

    const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
    ) ?? [])].filter((element) => element.offsetParent !== null);
    if (!controls.length) {
      event.preventDefault();
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="tempo-dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="tempo-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tempo-dialog-title"
        aria-describedby="tempo-dialog-description"
        aria-busy={busy}
        data-testid="tempo-dialog"
        onKeyDown={handleKeyDown}
      >
        <header className="tempo-dialog-header">
          <span className="tempo-dialog-kicker">TEMPO CHANGE / {formatTempo(fromTempo)} → {formatTempo(toTempo)} BPM</span>
          <h2 id="tempo-dialog-title">Do you want to change all media to match the new tempo?</h2>
          <p id="tempo-dialog-description">Choose how PRISM should handle existing media in this project.</p>
        </header>

        <div className="tempo-dialog-options">
          <article className="tempo-dialog-option">
            <span className="tempo-dialog-option-index" aria-hidden="true">01</span>
            <div className="tempo-dialog-option-copy">
              <h3>Keep audio as recorded</h3>
              <p>Tempo-only leaves audio speed and duration unchanged. MIDI follows the new BPM.</p>
            </div>
          </article>
          <article className="tempo-dialog-option tempo-dialog-option-adapt">
            <span className="tempo-dialog-option-index" aria-hidden="true">02</span>
            <div className="tempo-dialog-option-copy">
              <h3>Adapt compatible audio</h3>
              <p>Creates pitch-preserving derivatives and scales audio timing. Source files are never overwritten; the change is undoable.</p>
            </div>
          </article>
        </div>

        <div className="tempo-dialog-method" id="tempo-dialog-method">
          <span className="tempo-dialog-method-label">ALGORITHM / ORIGINAL WSOLA</span>
          <p>WSOLA overlap-add works from 0.5× to 2× length. It can smear transients or reverberation and is not studio-perfect.</p>
          <p>Only bounded mono or stereo decoded audio is adapted. Sampler one-shot sample lengths remain unchanged, and unknown plugins are not stretched.</p>
        </div>

        <section className="tempo-dialog-unsupported" aria-labelledby="tempo-dialog-unsupported-title">
          <h3 id="tempo-dialog-unsupported-title">Not adapted</h3>
          {unsupported.length > 0 ? (
            <ul>{unsupported.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
          ) : (
            <p>No unsupported media were reported.</p>
          )}
        </section>

        {!ratioSupported && (
          <p className="tempo-dialog-range-note" role="note">
            Adapt is unavailable: this tempo change is outside the supported 0.5×–2× length range.
          </p>
        )}

        {busy && (
          <div className="tempo-dialog-progress" role="status" aria-live="polite" aria-atomic="true">
            <span className="tempo-dialog-progress-mark" aria-hidden="true" />
            <span>{progress || "Adapting compatible media…"}</span>
          </div>
        )}
        {error && <p className="tempo-dialog-error" role="alert">{error}</p>}

        <footer className="tempo-dialog-actions">
          <button
            ref={cancelRef}
            className="tempo-dialog-button tempo-dialog-button-cancel"
            type="button"
            data-testid="button-tempo-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="tempo-dialog-button tempo-dialog-button-quiet"
            type="button"
            data-testid="button-tempo-only"
            disabled={busy}
            onClick={onTempoOnly}
          >
            Change Tempo Only
          </button>
          <button
            className="tempo-dialog-button tempo-dialog-button-primary"
            type="button"
            data-testid="button-tempo-adapt"
            disabled={busy || !ratioSupported}
            aria-describedby={!ratioSupported ? "tempo-dialog-range-note" : undefined}
            onClick={onAdapt}
          >
            Change Tempo and Adapt Compatible Media
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export default TempoChangeDialog;
