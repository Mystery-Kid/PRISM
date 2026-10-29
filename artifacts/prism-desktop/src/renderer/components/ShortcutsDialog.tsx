import { useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Download, Search, Upload, X } from "lucide-react";
import {
  findShortcutConflicts,
  formatShortcut,
  getDefaultShortcutBindings,
  parseShortcutProfile,
  serializeShortcutProfile,
  shortcutFromEvent,
  shortcutRegistry,
  type ShortcutBindings,
  type ShortcutCommandId,
  type ShortcutPlatform,
} from "../shortcuts";
import "./ShortcutsDialog.css";

type ShortcutsDialogProps = {
  bindings: ShortcutBindings;
  platform: ShortcutPlatform;
  onApply: (bindings: ShortcutBindings) => void;
  onClose: () => void;
};

export function ShortcutsDialog({ bindings, platform, onApply, onClose }: ShortcutsDialogProps) {
  const [draft, setDraft] = useState<ShortcutBindings>({ ...bindings });
  const [search, setSearch] = useState("");
  const [capturing, setCapturing] = useState<ShortcutCommandId | null>(null);
  const [message, setMessage] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const conflicts = findShortcutConflicts(draft);
  const visibleCommands = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return shortcutRegistry.filter((command) =>
      !query ||
      command.label.toLocaleLowerCase().includes(query) ||
      command.description.toLocaleLowerCase().includes(query) ||
      command.category.toLocaleLowerCase().includes(query) ||
      formatShortcut(draft[command.id], platform).toLocaleLowerCase().includes(query),
    );
  }, [draft, platform, search]);

  const captureKey = (event: KeyboardEvent<HTMLElement>) => {
    if (!capturing) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setCapturing(null);
      setMessage("Shortcut capture cancelled.");
      return;
    }
    const binding = shortcutFromEvent(event.nativeEvent, platform);
    if (!binding) {
      setMessage("Use a letter, number, or supported navigation key. Modifier keys alone cannot be assigned.");
      return;
    }
    setDraft((current) => ({ ...current, [capturing]: binding }));
    setCapturing(null);
    setMessage("");
  };

  const exportProfile = () => {
    const blob = new Blob([serializeShortcutProfile(draft)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "prism-shortcuts.json";
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Shortcut profile exported.");
  };

  const importProfile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > 100_000) {
      setMessage("Shortcut profiles must be smaller than 100 KB.");
      return;
    }
    try {
      const profile = parseShortcutProfile(JSON.parse(await file.text()));
      setDraft(profile);
      setMessage("Profile loaded. Review any conflicts, then apply it.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The shortcut profile could not be read.");
    }
  };

  const conflictNames = conflicts.map((conflict) => {
    const names = conflict.commandIds.map((id) => shortcutRegistry.find((item) => item.id === id)?.label ?? id);
    return `${formatShortcut(conflict.binding, platform)}: ${names.join(" / ")}`;
  });

  return (
    <div className="shortcuts-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !capturing) onClose();
    }}>
      <section
        className="shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        data-testid="dialog-shortcuts"
        onKeyDown={captureKey}
      >
        <header className="shortcuts-heading">
          <div>
            <span className="eyebrow">Workstation controls</span>
            <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close keyboard shortcuts" onClick={onClose}><X size={18} /></button>
        </header>
        <p className="shortcuts-intro">Choose a command, select Change, then press the key combination you want. Shortcuts are saved on this computer.</p>
        <label className="shortcuts-search">
          <Search size={15} aria-hidden="true" />
          <input
            ref={searchRef}
            data-testid="input-shortcut-search"
            aria-label="Search shortcuts"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search commands or keys"
          />
        </label>
        <div className="shortcuts-list" data-testid="list-shortcuts">
          {visibleCommands.map((command) => (
            <div className="shortcut-row" key={command.id} data-testid={`shortcut-row-${command.id}`}>
              <div className="shortcut-command">
                <strong>{command.label}<span className="shortcut-context">{command.category}</span></strong>
                <span>{command.description}</span>
              </div>
              <div className="shortcut-assignment">
                <kbd>{capturing === command.id ? "Press keys…" : formatShortcut(draft[command.id], platform)}</kbd>
                <button
                  className={`button button-quiet shortcut-change ${capturing === command.id ? "capturing" : ""}`}
                  type="button"
                  data-testid={`button-shortcut-bind-${command.id}`}
                  onClick={(event) => {
                    setCapturing(command.id);
                    setMessage("Press the new shortcut, or Escape to cancel.");
                    event.currentTarget.focus();
                  }}
                >{capturing === command.id ? "Listening" : "Change"}</button>
              </div>
            </div>
          ))}
          {visibleCommands.length === 0 && <p className="shortcuts-empty">No commands match that search.</p>}
        </div>
        {conflictNames.length > 0 && <div className="shortcuts-conflicts" role="alert" data-testid="status-shortcut-conflicts">
          <strong>Resolve shortcut conflicts before applying:</strong>
          {conflictNames.map((name) => <span key={name}>{name}</span>)}
        </div>}
        {message && <p className="shortcuts-message" role="status" data-testid="status-shortcut-message">{message}</p>}
        <input ref={fileInputRef} className="shortcuts-file-input" type="file" accept=".json,application/json" data-testid="input-shortcut-profile" onChange={(event) => void importProfile(event)} />
        <footer className="shortcuts-actions">
          <div className="shortcuts-profile-actions">
            <button className="button button-quiet" type="button" data-testid="button-shortcut-import" onClick={() => fileInputRef.current?.click()}><Upload size={14} /> Import</button>
            <button className="button button-quiet" type="button" data-testid="button-shortcut-export" onClick={exportProfile}><Download size={14} /> Export</button>
            <button className="text-button" type="button" data-testid="button-shortcut-reset" onClick={() => { setDraft(getDefaultShortcutBindings()); setMessage("Defaults restored. Apply to save them."); }}>Reset defaults</button>
          </div>
          <div className="shortcuts-submit-actions">
            <button className="button button-quiet" type="button" onClick={onClose}>Cancel</button>
            <button className="button button-primary" type="button" data-testid="button-shortcut-apply" disabled={conflicts.length > 0} onClick={() => onApply(draft)}>Apply shortcuts</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
