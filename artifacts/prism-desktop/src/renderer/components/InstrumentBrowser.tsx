import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AudioLines, Check, ChevronDown, CircleHelp, Music2, Play, Save, Trash2, X } from "lucide-react";
import type { InstrumentPreset, InstrumentState, JsonValue, Track } from "@shared/types";
import {
  BUILT_IN_INSTRUMENTS,
  createInstrumentState,
  findInstrumentDefinition,
  getInstrumentId,
  instrumentParameterValue,
  LEGACY_INSTRUMENT_ID,
  unavailableInstrumentCategories,
  withInstrumentParameter,
} from "@shared/instrument-library";
import "./instruments.css";

type InstrumentBrowserProps = {
  track: Track | undefined;
  onChange: (trackId: string, update: Partial<Track>) => void;
  onPreview: (trackId: string, pitch: number) => void;
  onAssetsChanged: () => Promise<void>;
};

const categories = ["All", "Keys", "Synths", "Bass", "Drums"] as const;
type Category = (typeof categories)[number];

function trackPresetType(track: Track): InstrumentPreset["type"] | null {
  return track.type === "instrument" || track.type === "sampler" || track.type === "drum" ? track.type : null;
}

function recoveryForReplacement(track: Track): Track["instrumentRecovery"] {
  if (track.instrumentRecovery) return track.instrumentRecovery;
  const unknownInstrument = track.type === "instrument" && track.instrument &&
    !findInstrumentDefinition(getInstrumentId(track.instrument));
  const unknownDrum = track.type === "drum" && track.drumKit?.instrumentId &&
    !findInstrumentDefinition(track.drumKit.instrumentId);
  if (!unknownInstrument && !unknownDrum) return track.instrumentRecovery;
  const raw = track.type === "instrument" ? track.instrument : track.drumKit;
  return {
    originalType: track.type,
    rawState: JSON.parse(JSON.stringify(raw)) as JsonValue,
    message: "This saved sound uses an instrument ID that is not available in this PRISM build. Its original state is retained for recovery.",
  };
}

function presetIsUsable(preset: InstrumentPreset): boolean {
  if (preset.type === "instrument") {
    return Boolean(preset.instrument && findInstrumentDefinition(getInstrumentId(preset.instrument))?.kind === "synth");
  }
  if (preset.type === "sampler") return Boolean(preset.sampler);
  if (preset.type === "drum") return Boolean(preset.drumKit &&
    (!preset.drumKit.instrumentId || findInstrumentDefinition(preset.drumKit.instrumentId)?.kind === "drum"));
  return false;
}

export function InstrumentBrowser({ track, onChange, onPreview, onAssetsChanged }: InstrumentBrowserProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const trackIdRef = useRef(track?.id);
  trackIdRef.current = track?.id;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Category>("All");
  const [presets, setPresets] = useState<InstrumentPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [presetId, setPresetId] = useState("");
  const [presetName, setPresetName] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setOpen(false);
    setError("");
    setMessage("");
  }, [track?.id]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const firstControl = dialogRef.current?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)");
    firstControl?.focus();
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
      else triggerRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPresetsLoading(true);
    setError("");
    void window.prism.listInstrumentPresets().then((items) => {
      if (!cancelled) {
        setPresets(items);
        setPresetId((current) => items.some((item) => item.id === current) ? current : "");
      }
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Instrument presets could not be loaded.");
    }).finally(() => {
      if (!cancelled) setPresetsLoading(false);
    });
    return () => { cancelled = true; };
  }, [open]);

  const currentId = track?.type === "instrument" && track.instrument
    ? getInstrumentId(track.instrument)
    : track?.type === "drum" ? track.drumKit?.instrumentId ?? "" : "";
  const currentDefinition = currentId ? findInstrumentDefinition(currentId) : undefined;
  const filteredInstruments = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return BUILT_IN_INSTRUMENTS.filter((item) => (category === "All" || item.category === category) &&
      (!query || `${item.name} ${item.category} ${item.description}`.toLocaleLowerCase().includes(query)));
  }, [category, search]);
  const selectedPreset = presets.find((item) => item.id === presetId);
  const canSave = Boolean(track && (
    (track.type === "instrument" && track.instrument && findInstrumentDefinition(getInstrumentId(track.instrument))?.kind === "synth") ||
    (track.type === "sampler" && track.sampler) ||
    (track.type === "drum" && track.drumKit)
  ));

  const applyInstrument = async (id: string) => {
    if (!track) return;
    const trackId = track.id;
    const definition = findInstrumentDefinition(id);
    if (!definition) return;
    setError("");
    setMessage("");
    if (definition.kind === "drum") {
      setBusy(id);
      try {
        const drumKit = await window.prism.getFactoryDrumKit();
        // The operation is intentionally pinned to the track that initiated it.
        onChange(trackId, { type: "drum", instrument: null, sampler: null, drumKit: { ...drumKit, instrumentId: id }, instrumentRecovery: recoveryForReplacement(track) });
        try {
          await onAssetsChanged();
          if (trackIdRef.current === trackId) setMessage("Factory kit loaded. Your MIDI pattern and track routing are unchanged.");
        } catch (cause) {
          if (trackIdRef.current === trackId) setError(`Factory kit loaded, but its sample list could not refresh: ${cause instanceof Error ? cause.message : "Audio assets could not be listed."}`);
        }
      } catch (cause) {
        if (trackIdRef.current === trackId) setError(cause instanceof Error ? cause.message : "The factory drum kit could not be loaded.");
      } finally {
        if (trackIdRef.current === trackId) setBusy("");
      }
      return;
    }
    onChange(trackId, {
      type: "instrument",
      instrument: createInstrumentState(id),
      sampler: null,
      drumKit: null,
      instrumentRecovery: recoveryForReplacement(track),
    });
    setMessage(`${definition.name} is now active. Existing notes and routing are unchanged.`);
  };

  const updateInstrument = (instrument: InstrumentState) => {
    if (track) onChange(track.id, { instrument });
  };

  const savePreset = async () => {
    if (!track || !canSave) return;
    const name = presetName.trim();
    if (!name) { setError("Enter a name for this preset."); return; }
    const type = trackPresetType(track)!;
    const input: Omit<InstrumentPreset, "createdAt" | "updatedAt"> = {
      id: crypto.randomUUID(),
      name,
      version: 1,
      type,
      instrument: type === "instrument" && track.instrument ? { ...track.instrument, parameters: { ...track.instrument.parameters } } : null,
      sampler: type === "sampler" && track.sampler ? { ...track.sampler } : null,
      drumKit: type === "drum" && track.drumKit ? {
        ...track.drumKit,
        pads: track.drumKit.pads.map((pad) => ({ ...pad })),
      } : null,
    };
    setBusy("save");
    setError("");
    setMessage("");
    try {
      const saved = await window.prism.saveInstrumentPreset(input);
      setPresets((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setPresetId(saved.id);
      setPresetName("");
      setMessage(`Saved “${saved.name}” with the active sound state.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The preset could not be saved.");
    } finally {
      setBusy("");
    }
  };

  const loadPreset = async () => {
    if (!track || !selectedPreset) return;
    const trackId = track.id;
    if (!presetIsUsable(selectedPreset)) {
      setError("This preset references a missing or unsupported sound. Delete it or choose another preset.");
      return;
    }
    setBusy("load");
    setError("");
    setMessage("");
    try {
      if (selectedPreset.type === "instrument" && selectedPreset.instrument) {
        onChange(trackId, { type: "instrument", instrument: { ...selectedPreset.instrument, parameters: { ...selectedPreset.instrument.parameters } }, sampler: null, drumKit: null, instrumentRecovery: recoveryForReplacement(track) });
      } else if (selectedPreset.type === "sampler" && selectedPreset.sampler) {
        onChange(trackId, { type: "sampler", instrument: null, sampler: { ...selectedPreset.sampler }, drumKit: null, instrumentRecovery: recoveryForReplacement(track) });
      } else if (selectedPreset.type === "drum" && selectedPreset.drumKit) {
        onChange(trackId, { type: "drum", instrument: null, sampler: null, drumKit: { ...selectedPreset.drumKit, pads: selectedPreset.drumKit.pads.map((pad) => ({ ...pad })) }, instrumentRecovery: recoveryForReplacement(track) });
      }
      setMessage(`Restored “${selectedPreset.name}”.`);
    } finally {
      setBusy("");
    }
  };

  const deletePreset = async () => {
    if (!selectedPreset) return;
    const deleting = selectedPreset;
    setBusy("delete");
    setError("");
    setMessage("");
    try {
      await window.prism.deleteInstrumentPreset(deleting.id);
      setPresets((current) => current.filter((item) => item.id !== deleting.id));
      setPresetId("");
      setMessage(`Deleted “${deleting.name}”.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The preset could not be deleted.");
    } finally {
      setBusy("");
    }
  };

  const setEnvelopeValue = (key: "attack" | "decay" | "sustain" | "release", value: number) => {
    if (!track?.instrument) return;
    const limits = { attack: [0.001, 4], decay: [0.001, 4], sustain: [0, 1], release: [0.005, 4] }[key];
    updateInstrument({ ...track.instrument, [key]: Math.min(limits[1], Math.max(limits[0], value)) });
  };

  return <div className="instrument-browser-shell">
    <button ref={triggerRef} className="instrument-browser-trigger" type="button" data-testid="button-instrument-browser"
      aria-haspopup="dialog" aria-expanded={open} disabled={!track} onClick={() => setOpen(true)}>
      <span className="instrument-browser-trigger-icon"><AudioLines size={14} /></span>
      <span className="instrument-browser-trigger-copy">
        <small>ACTIVE SOUND</small>
        <strong>{currentDefinition?.name ?? (track?.type === "instrument" && track.instrument && !findInstrumentDefinition(getInstrumentId(track.instrument)) ? "Missing instrument" : track?.type === "sampler" ? track.sampler?.sampleAssetId ? "Project sampler" : "Sampler · no sample" : track?.type === "drum" ? "Drum kit" : track?.type === "unsupported" ? "Unsupported track" : "Custom Oscillator")}{track?.type === "instrument" && track.instrument?.presetName ? ` · ${track.instrument.presetName}` : ""}</strong>
      </span>
      <span className="instrument-browser-trigger-action">Browse <ChevronDown size={13} /></span>
    </button>
    {open && createPortal(<div className="instrument-browser-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setOpen(false);
    }}>
      <section ref={dialogRef} className="instrument-browser-dialog" role="dialog" aria-modal="true" aria-labelledby="instrument-browser-title" data-testid="instrument-browser"
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.stopPropagation(); setOpen(false); }
          if (event.key !== "Tab") return;
          const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)") ?? [])]
            .filter((element) => element.offsetParent !== null);
          if (!controls.length) return;
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}>
        <header className="ib-header">
          <div className="ib-brand"><span className="ib-mark"><AudioLines size={16} /></span><div><small>PRISM / SOUND LIBRARY</small><h2 id="instrument-browser-title">Instrument browser</h2></div></div>
          <button className="ib-icon-button" type="button" aria-label="Close instrument browser" onClick={() => setOpen(false)}><X size={16} /></button>
        </header>
        <div className="ib-current">
          <div><span className="ib-overline">TRACK / {track?.name ?? "No track selected"}</span>
            <strong>{currentDefinition?.name ?? (track?.type === "instrument" && track.instrument && !findInstrumentDefinition(getInstrumentId(track.instrument)) ? "Missing instrument" : track?.type === "unsupported" ? "Unsupported source" : track?.type === "sampler" ? "Project sampler" : track?.type === "drum" ? "Drum kit" : "Custom Oscillator")}</strong>
            <small>{track?.type === "unsupported" ? "Choose a sound to replace the active track type. Original recovery data stays attached." : currentDefinition?.description ?? "Classic waveform oscillator with editable envelope."}</small>
          </div>
          <button className="ib-button ib-preview" type="button" data-testid="button-instrument-preview"
            disabled={!track || track.type === "unsupported"} onClick={() => track && onPreview(track.id, track.type === "sampler" ? track.sampler?.rootNote ?? 60 : track.type === "drum" ? track.drumKit?.pads[0]?.note ?? 36 : 60)}>
            <Play size={13} fill="currentColor" /> Preview
          </button>
        </div>
        {(track?.instrumentRecovery ||
          (track?.type === "instrument" && track.instrument && !findInstrumentDefinition(getInstrumentId(track.instrument))) ||
          (track?.type === "drum" && track.drumKit?.instrumentId && !findInstrumentDefinition(track.drumKit.instrumentId))) &&
          <div className="ib-recovery" role="status"><CircleHelp size={15} /><span><strong>Recovery data retained</strong>{track.instrumentRecovery?.message ??
            `Instrument ID “${track.type === "instrument" ? getInstrumentId(track.instrument!) : track.drumKit?.instrumentId}” is not in this catalog.`} Replacing the sound activates the new choice without removing the original raw state.</span></div>}
        {track?.type === "instrument" && track.instrument && <div className="ib-controls">
          <div className="ib-section-heading"><span>SHAPE THE SOUND</span><span>LIVE CONTROLS</span></div>
          <div className="ib-control-grid">
            {getInstrumentId(track.instrument) === LEGACY_INSTRUMENT_ID && <label className="ib-field">Waveform
              <select data-testid="select-oscillator" value={track.instrument.waveform} onChange={(event) => updateInstrument({ ...track.instrument!, waveform: event.target.value as OscillatorType })}>
                {["sine", "triangle", "square", "sawtooth"].map((wave) => <option key={wave}>{wave}</option>)}
              </select>
            </label>}
            {(["attack", "decay", "sustain", "release"] as const).map((key) => {
              const bounds = { attack: [0.001, 4, 0.001], decay: [0.001, 4, 0.001], sustain: [0, 1, 0.01], release: [0.005, 4, 0.005] }[key];
              return <label className="ib-field" key={key}>{key[0].toUpperCase() + key.slice(1)}
                <input data-testid={`input-instrument-${key}`} type="number" min={bounds[0]} max={bounds[1]} step={bounds[2]} value={track.instrument![key]}
                  onChange={(event) => setEnvelopeValue(key, Number(event.target.value))} />
              </label>;
            })}
            {currentDefinition?.parameters.map((parameter) => <label className="ib-range-field" key={parameter.key}>
              <span><b>{parameter.label}</b><output>{instrumentParameterValue(track.instrument!, parameter.key).toLocaleString(undefined, { maximumFractionDigits: 2 })}{parameter.unit ? ` ${parameter.unit}` : ""}</output></span>
              <input type="range" data-testid={`instrument-param-${parameter.key}`} aria-label={parameter.label} min={parameter.min} max={parameter.max} step={parameter.step}
                value={instrumentParameterValue(track.instrument!, parameter.key)}
                onChange={(event) => updateInstrument(withInstrumentParameter(track.instrument!, parameter.key, Number(event.target.value)))} />
            </label>)}
          </div>
        </div>}
        <div className="ib-library">
          <div className="ib-library-heading"><div><span className="ib-overline">BUILT FOR PRISM</span><strong>Choose a sound</strong></div><span>{filteredInstruments.length} sounds</span></div>
          <div className="ib-filters">
            <label className="ib-search"><span className="sr-only">Search sounds</span><Music2 size={14} /><input data-testid="input-instrument-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or character" /></label>
            <label className="sr-only" htmlFor="instrument-category">Sound category</label>
            <select id="instrument-category" data-testid="select-instrument-category" value={category} onChange={(event) => setCategory(event.target.value as Category)}>
              {categories.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
          <div className="ib-catalog" role="group" aria-label="Available instruments">
            {filteredInstruments.map((item, index) => <button className={`ib-sound ${currentId === item.id ? "is-current" : ""}`} type="button"
              data-testid={`instrument-choice-${item.id}`} key={item.id} aria-pressed={currentId === item.id}
              disabled={busy === item.id} onClick={() => { void applyInstrument(item.id); }}>
              <span className={`ib-sound-number ib-tone-${item.category.toLowerCase()}`}>0{index + 1}</span>
              <span className="ib-sound-copy"><strong>{item.name}</strong><small>{item.description}</small></span>
              <span className="ib-sound-meta">{item.category}{currentId === item.id && <Check size={14} aria-label="Active" />}</span>
            </button>)}
            {!filteredInstruments.length && <div className="ib-empty">No sounds match that search. Try another name or category.</div>}
          </div>
          <p className="ib-unavailable">{unavailableInstrumentCategories}</p>
        </div>
        <section className="ib-presets" aria-label="Instrument presets">
          <div className="ib-presets-title"><div><span className="ib-overline">LOCAL LIBRARY</span><strong>Presets</strong></div><span>Concrete sound state</span></div>
          <div className="ib-preset-row">
            <label className="sr-only" htmlFor="instrument-preset-select">Saved instrument preset</label>
            <select id="instrument-preset-select" data-testid="select-instrument-preset" value={presetId} onChange={(event) => setPresetId(event.target.value)}>
              <option value="">{presetsLoading ? "Loading presets…" : "Select a saved preset"}</option>
              {presets.map((preset) => <option key={preset.id} value={preset.id} disabled={!presetIsUsable(preset)}>
                {preset.name} · {preset.type}{presetIsUsable(preset) ? "" : " · unavailable"}
              </option>)}
            </select>
            <button className="ib-button" type="button" data-testid="button-instrument-preset-load" disabled={!selectedPreset || !presetIsUsable(selectedPreset) || Boolean(busy)} onClick={() => { void loadPreset(); }}>Restore</button>
            <button className="ib-button ib-delete" type="button" aria-label="Delete selected preset" data-testid="button-instrument-preset-delete" disabled={!selectedPreset || Boolean(busy)} onClick={() => { void deletePreset(); }}><Trash2 size={14} /></button>
          </div>
          {selectedPreset && !presetIsUsable(selectedPreset) && <p className="ib-inline-note">This saved sound depends on an instrument no longer present. Select another or delete this entry.</p>}
          <div className="ib-save-row">
            <label className="sr-only" htmlFor="instrument-preset-name">Preset name</label>
            <input id="instrument-preset-name" data-testid="input-instrument-preset-name" value={presetName} maxLength={80} onChange={(event) => setPresetName(event.target.value)} placeholder="Name this sound…" />
            <button className="ib-button ib-save" type="button" data-testid="button-instrument-preset-save" disabled={!canSave || !presetName.trim() || Boolean(busy)} onClick={() => { void savePreset(); }}><Save size={13} /> Save state</button>
          </div>
          {!canSave && <p className="ib-inline-note">Choose a supported sound before saving a preset.</p>}
        </section>
        {(error || message) && <div className={`ib-feedback ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}>{error || message}</div>}
        <footer className="ib-footer"><span>PRISM · OFFLINE SOUND LIBRARY</span><button type="button" className="ib-done" onClick={() => setOpen(false)}>Done <X size={13} /></button></footer>
      </section>
    </div>, document.body)}
  </div>;
}

export default InstrumentBrowser;
