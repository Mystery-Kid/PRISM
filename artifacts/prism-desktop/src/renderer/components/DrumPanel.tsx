import type { ChangeEvent } from "react";
import { useState } from "react";
import { AudioWaveform, Drum, FileAudio2, FolderOpen, Plus, Play, Trash2 } from "lucide-react";
import type { DrumKitState, DrumPadState, MidiNote, ProjectAsset } from "@shared/types";
import { parseTimeSignature } from "../audio/time";
import "./DrumPanel.css";

type DrumPanelProps = {
  drumKit: DrumKitState;
  notes: MidiNote[];
  assets: ProjectAsset[];
  assetsLoading: boolean;
  missingSampleIds: string[];
  recoveryMessage: string;
  tempo: number;
  timeSignature: string;
  onChange: (next: DrumKitState) => void;
  onNotesChange: (next: MidiNote[]) => void;
  onImportSample: (padId: string) => void;
  onPreviewPad: (pad: DrumPadState) => void;
  onAddHit: (pad: DrumPadState) => void;
  onOpenPattern: () => void;
};

const MAX_PADS = 16;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function DrumPanel({
  drumKit, notes, assets, assetsLoading, missingSampleIds, recoveryMessage, tempo, timeSignature,
  onChange, onNotesChange, onImportSample, onPreviewPad, onAddHit, onOpenPattern,
}: DrumPanelProps) {
  const [noteError, setNoteError] = useState("");
  const [patternError, setPatternError] = useState("");
  const patternLengthBars = drumKit.patternLengthBars ?? 1;
  const patternStartBeat = drumKit.patternStartBeat ?? 0;
  const { numerator, denominator } = parseTimeSignature(timeSignature);
  // Session MIDI beats follow the meter denominator, not quarter-note units.
  const beatsPerBar = numerator;
  const stepsPerBar = Math.max(1, Math.round(numerator * 16 / denominator));
  const stepBeats = beatsPerBar / stepsPerBar;
  const totalSteps = stepsPerBar * patternLengthBars;
  const patternEndBeat = patternStartBeat + beatsPerBar * patternLengthBars;
  const patternNotes = notes.filter((note) =>
    note.startBeat >= patternStartBeat - 0.0001 && note.startBeat < patternEndBeat - 0.0001,
  );
  const updatePad = (padId: string, update: Partial<DrumPadState>) => onChange({
    ...drumKit,
    pads: drumKit.pads.map((pad) => pad.id === padId ? { ...pad, ...update } : pad),
  });
  const stepNote = (pad: DrumPadState, step: number) => {
    const startBeat = patternStartBeat + step * stepBeats;
    return notes.find((note) => note.pitch === pad.note && Math.abs(note.startBeat - startBeat) < 0.0001);
  };
  const toggleStep = (pad: DrumPadState, step: number) => {
    const existing = stepNote(pad, step);
    if (existing) {
      onNotesChange(notes.filter((note) => note.id !== existing.id));
      return;
    }
    if (notes.length >= 100_000) {
      setPatternError("This project has reached the MIDI note limit.");
      return;
    }
    onNotesChange([...notes, {
      id: crypto.randomUUID(),
      pitch: pad.note,
      startBeat: patternStartBeat + step * stepBeats,
      durationBeats: stepBeats * 0.9,
      velocity: 96,
    }]);
  };
  const duplicatePattern = () => {
    if (patternNotes.length === 0) return;
    const lengthBeats = beatsPerBar * patternLengthBars;
    if (notes.length + patternNotes.length > 100_000 || patternStartBeat + lengthBeats > 100_000) {
      setPatternError("This project has reached the MIDI note limit.");
      return;
    }
    const duplicates = patternNotes.map((note) => ({
      ...note,
      id: crypto.randomUUID(),
      startBeat: note.startBeat + lengthBeats,
    }));
    onNotesChange([...notes, ...duplicates]);
    onChange({ ...drumKit, patternStartBeat: patternStartBeat + lengthBeats });
    setPatternError("");
  };
  const clearPattern = () => {
    onNotesChange(notes.filter((note) =>
      note.startBeat < patternStartBeat - 0.0001 || note.startBeat >= patternEndBeat - 0.0001,
    ));
    setPatternError("");
  };
  const setPatternStartBar = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.currentTarget.value);
    if (event.currentTarget.value === "" || !Number.isFinite(value)) return;
    const maxBar = Math.floor(100_000 / beatsPerBar) + 1;
    const bar = clamp(Math.round(value), 1, maxBar);
    onChange({ ...drumKit, patternStartBeat: (bar - 1) * beatsPerBar });
  };
  const setPatternLength = (value: string) => {
    const bars = Number(value);
    if (![1, 2, 4, 8].includes(bars)) return;
    onChange({ ...drumKit, patternLengthBars: bars });
    setPatternError("");
  };

  const addPad = () => {
    if (drumKit.pads.length >= MAX_PADS) return;
    const candidates = [
      ...Array.from({ length: 68 }, (_, index) => index + 60),
      ...Array.from({ length: 60 }, (_, index) => index),
    ];
    const note = candidates
      .find((candidate) => !drumKit.pads.some((pad) => pad.note === candidate));
    if (note === undefined) return;
    const pad: DrumPadState = {
      id: crypto.randomUUID(),
      name: `Pad ${String(drumKit.pads.length + 1).padStart(2, "0")}`,
      note,
      sampleAssetId: null,
      gain: 1,
    };
    onChange({ ...drumKit, pads: [...drumKit.pads, pad] });
  };

  const removePad = (padId: string) => {
    const pad = drumKit.pads.find((item) => item.id === padId);
    if (!pad) return;
    const keptHits = notes.filter((note) => note.pitch === pad.note).length;
    onChange({ ...drumKit, pads: drumKit.pads.filter((item) => item.id !== padId) });
    if (keptHits > 0) {
      setNoteError(`${keptHits} MIDI hit${keptHits === 1 ? "" : "s"} for ${pad.name} were kept. Assign those notes to another pad to hear them.`);
    }
  };
  const updateNumber = (event: ChangeEvent<HTMLInputElement>, pad: DrumPadState, key: "note" | "gain", min: number, max: number) => {
    const value = Number(event.currentTarget.value);
    if (event.currentTarget.value === "" || !Number.isFinite(value)) return;
    const bounded = clamp(value, min, max);
    if (key === "note" && drumKit.pads.some((item) => item.id !== pad.id && item.note === bounded)) {
      setNoteError(`MIDI note ${bounded} is already assigned to another pad.`);
      return;
    }
    setNoteError("");
    updatePad(pad.id, { [key]: bounded });
  };

  return (
    <section className="prism-instrument-panel drum-panel" aria-labelledby="drum-panel-title" data-testid="panel-drums">
      <header className="instrument-panel-heading">
        <div className="instrument-heading-mark drum-mark"><Drum size={16} aria-hidden="true" /></div>
        <div className="instrument-heading-copy">
          <span className="instrument-kicker">INSTRUMENT / 02</span>
          <h2 id="drum-panel-title">Drum kit <span className="drum-count" data-testid="text-drum-pad-count">{drumKit.pads.length} / {MAX_PADS}</span></h2>
        </div>
        <button className="instrument-button instrument-button-quiet drum-add-button" type="button" data-testid="button-drum-add-pad" onClick={addPad} disabled={drumKit.pads.length >= MAX_PADS}>
          <Plus size={13} aria-hidden="true" />Add pad
        </button>
        <button className="instrument-button instrument-button-quiet drum-pattern-button" type="button" data-testid="button-drum-open-pattern" onClick={onOpenPattern}>Open pattern <span aria-hidden="true">↗</span></button>
      </header>

      {recoveryMessage && <div className="instrument-warning drum-recovery-warning" role="alert" data-testid="status-drum-recovery"><AudioWaveform size={14} aria-hidden="true" /><span>{recoveryMessage}</span></div>}
      {noteError && <div className="drum-note-warning" role="status" data-testid="status-drum-duplicate-note">{noteError}</div>}
      {patternError && <div className="drum-note-warning" role="status" data-testid="status-drum-pattern-error">{patternError}</div>}
      <section className="drum-pattern-editor" aria-label="Drum step sequencer" data-testid="panel-drum-sequencer">
        <div className="drum-pattern-toolbar">
          <div className="drum-pattern-heading">
            <span className="control-caption">STEP SEQUENCER</span>
            <small data-testid="text-drum-tempo">{tempo} BPM · {stepsPerBar} steps / bar</small>
          </div>
          <label>
            <span className="control-caption">LENGTH</span>
            <select data-testid="select-drum-pattern-length" aria-label="Drum pattern length" value={patternLengthBars} onChange={(event) => setPatternLength(event.target.value)}>
              {[1, 2, 4, 8].map((bars) => <option key={bars} value={bars}>{bars} {bars === 1 ? "bar" : "bars"}</option>)}
            </select>
          </label>
          <label>
            <span className="control-caption">START BAR</span>
            <input data-testid="input-drum-pattern-start-bar" aria-label="Pattern start bar" type="number" min="1" max={Math.floor(100_000 / beatsPerBar) + 1} value={Math.round(patternStartBeat / beatsPerBar) + 1} onChange={setPatternStartBar} />
          </label>
          <button className="instrument-button instrument-button-quiet" type="button" data-testid="button-drum-pattern-duplicate" onClick={duplicatePattern} disabled={patternNotes.length === 0}>Duplicate → next</button>
          <button className="instrument-button instrument-button-quiet" type="button" data-testid="button-drum-pattern-clear" onClick={clearPattern} disabled={patternNotes.length === 0}>Clear</button>
        </div>
        <div className="drum-pattern-summary" data-testid="text-drum-pattern-summary">
          Bar {Math.round(patternStartBeat / beatsPerBar) + 1}–{Math.round(patternStartBeat / beatsPerBar) + patternLengthBars} · {patternNotes.length} hits · synced to transport
        </div>
        <div className="drum-pad-list drum-sequencer-list" data-testid="list-drum-sequencer">
          {drumKit.pads.map((pad) => (
            <div className="drum-step-row" key={`steps-${pad.id}`} data-testid={`row-drum-steps-${pad.id}`}>
              <span className="drum-step-row-name" title={pad.name}>{pad.name}</span>
              <div className="drum-step-scroll">
                <div className="drum-step-grid" style={{ gridTemplateColumns: `repeat(${totalSteps}, 22px)` }}>
                  {Array.from({ length: totalSteps }, (_, step) => {
                    const note = stepNote(pad, step);
                    const barStart = step % stepsPerBar === 0;
                    return <button
                      key={step}
                      type="button"
                      className={`drum-step-cell ${note ? "active" : ""} ${barStart ? "bar-start" : ""}`}
                      data-testid={`button-drum-step-${pad.id}-${step + 1}`}
                      aria-label={`${pad.name} ${note ? "active" : "inactive"} at step ${step + 1}`}
                      aria-pressed={Boolean(note)}
                      title={`${pad.name} · step ${step + 1}${note ? ` · velocity ${note.velocity}` : ""}`}
                      style={note ? { opacity: 0.5 + note.velocity / 254 } : undefined}
                      onClick={() => toggleStep(pad, step)}
                    >{barStart ? Math.floor(step / stepsPerBar) + 1 : ""}</button>;
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
      {drumKit.pads.length === 0 ? (
        <div className="drum-empty-state" data-testid="text-drum-empty-state">
          <div className="drum-empty-mark"><AudioWaveform size={19} aria-hidden="true" /></div>
          <strong>No pads in this kit</strong>
          <span>Add a pad, then assign a sample and MIDI note.</span>
          <button className="instrument-button instrument-button-primary" type="button" data-testid="button-drum-add-first-pad" onClick={addPad}><Plus size={13} aria-hidden="true" />Create first pad</button>
        </div>
      ) : (
        <div className="drum-pad-list" data-testid="list-drum-pads">
          {drumKit.pads.map((pad, index) => {
            const asset = assets.find((item) => item.id === pad.sampleAssetId);
            const isMissing = Boolean(pad.sampleAssetId)
              && (missingSampleIds.includes(pad.sampleAssetId as string) || (!assetsLoading && !asset));
            const playable = Boolean(pad.sampleAssetId) && Boolean(asset) && !isMissing;
            return (
              <article className={`drum-pad-row ${isMissing ? "drum-pad-missing" : ""} ${!pad.sampleAssetId ? "drum-pad-unassigned" : ""}`} key={pad.id} data-testid={`row-drum-pad-${pad.id}`}>
                <div className="drum-pad-identity">
                  <span className="drum-pad-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  <label className="drum-pad-name-field">
                    <span className="control-caption">PAD NAME</span>
                    <input data-testid={`input-drum-pad-name-${pad.id}`} aria-label={`Pad ${index + 1} name`} type="text" maxLength={40} value={pad.name} onChange={(event) => updatePad(pad.id, { name: event.target.value })} />
                  </label>
                  <label className="drum-pad-note-field">
                    <span className="control-caption">MIDI</span>
                    <input data-testid={`input-drum-pad-note-${pad.id}`} aria-label={`${pad.name || `Pad ${index + 1}`} MIDI note`} type="number" min="0" max="127" step="1" value={pad.note} onChange={(event) => updateNumber(event, pad, "note", 0, 127)} />
                  </label>
                </div>

                <div className="drum-pad-source">
                  <div className="drum-source-heading">
                    <span className="control-caption">SAMPLE ASSIGNMENT</span>
                    {isMissing ? (
                      <span className="drum-source-status missing" data-testid={`status-drum-pad-${pad.id}`}>MISSING / UNREADABLE</span>
                    ) : pad.sampleAssetId ? (
                      <span className="drum-source-status assigned" data-testid={`status-drum-pad-${pad.id}`}>ASSIGNED</span>
                    ) : (
                      <span className="drum-source-status unassigned" data-testid={`status-drum-pad-${pad.id}`}>UNASSIGNED</span>
                    )}
                  </div>
                  <div className="drum-source-controls">
                    <div className="drum-sample-label" title={isMissing ? `Missing sample: ${pad.sampleAssetId}` : asset?.fileName}>
                      <FileAudio2 size={13} aria-hidden="true" />
                      <span data-testid={`text-drum-pad-sample-${pad.id}`}>
                        {isMissing ? `Unavailable · ${asset?.fileName ?? pad.sampleAssetId}` : assetsLoading && pad.sampleAssetId && !asset ? "Checking sample library…" : asset?.fileName ?? "Choose a sample for this pad"}
                      </span>
                    </div>
                    <label className="drum-asset-select-wrap">
                      <span className="sr-only">Sample for {pad.name || `pad ${index + 1}`}</span>
                      <select data-testid={`select-drum-pad-sample-${pad.id}`} aria-label={`Sample assignment for ${pad.name || `pad ${index + 1}`}`} value={pad.sampleAssetId ?? ""} onChange={(event) => updatePad(pad.id, { sampleAssetId: event.target.value || null })}>
                        <option value="">Unassigned</option>
                        {pad.sampleAssetId && !asset && <option value={pad.sampleAssetId}>{assetsLoading ? "Checking saved sample…" : `Unavailable sample · ${pad.sampleAssetId}`}</option>}
                        {assets.map((item) => <option key={item.id} value={item.id}>{missingSampleIds.includes(item.id) ? `Unavailable · ${item.fileName}` : item.fileName}</option>)}
                      </select>
                    </label>
                    <button className="drum-assign-button" type="button" data-testid={`button-drum-pad-import-${pad.id}`} onClick={() => onImportSample(pad.id)} aria-label={pad.sampleAssetId ? `Replace sample for ${pad.name || `pad ${index + 1}`}` : `Assign sample to ${pad.name || `pad ${index + 1}`}`} title={pad.sampleAssetId ? "Replace or recover sample" : "Assign sample"}>
                      <FolderOpen size={13} aria-hidden="true" /><span>{pad.sampleAssetId ? "Replace" : "Assign"}</span>
                    </button>
                    {pad.sampleAssetId && (
                      <button className="drum-clear-button" type="button" data-testid={`button-drum-pad-clear-${pad.id}`} aria-label={`Clear sample assignment for ${pad.name || `pad ${index + 1}`}`} title="Clear sample assignment" onClick={() => updatePad(pad.id, { sampleAssetId: null })}>
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  {!pad.sampleAssetId && <span className="drum-unassigned-note" data-testid={`text-drum-pad-empty-${pad.id}`}>Assign an audio sample before triggering this pad.</span>}
                  {isMissing && <span className="drum-missing-note" data-testid={`text-drum-pad-missing-${pad.id}`}>Assignment retained. Select a replacement or load a new sample.</span>}
                </div>

                <label className="drum-gain-field">
                  <span className="control-caption">GAIN <output data-testid={`text-drum-pad-gain-${pad.id}`}>{pad.gain.toFixed(2)}×</output></span>
                  <input data-testid={`input-drum-pad-gain-${pad.id}`} aria-label={`${pad.name || `Pad ${index + 1}`} gain`} type="range" min="0" max="1.5" step="0.01" value={pad.gain} onChange={(event) => updatePad(pad.id, { gain: Number(event.target.value) })} />
                  <span className="range-ends"><small>0</small><small>1.5</small></span>
                </label>

                <div className="drum-pad-actions">
                  <button className="drum-trigger-button" type="button" data-testid={`button-drum-pad-preview-${pad.id}`} aria-label={`Preview ${pad.name || `pad ${index + 1}`}`} title="Preview pad" onClick={() => onPreviewPad(pad)} disabled={!playable}><Play size={12} fill="currentColor" aria-hidden="true" /></button>
                  <button className="instrument-button instrument-button-quiet drum-hit-button" type="button" data-testid={`button-drum-pad-add-hit-${pad.id}`} onClick={() => onAddHit(pad)} disabled={!playable}>Add hit</button>
                  <button className="drum-clear-button drum-remove-button" type="button" data-testid={`button-drum-pad-remove-${pad.id}`} aria-label={`Remove ${pad.name || `pad ${index + 1}`}`} title="Remove pad" onClick={() => removePad(pad.id)}><Trash2 size={14} aria-hidden="true" /></button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default DrumPanel;
