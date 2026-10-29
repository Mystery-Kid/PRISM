import type { ChangeEvent } from "react";
import { AudioLines, AudioWaveform, FileAudio2, FolderOpen, Music2, Play, Trash2 } from "lucide-react";
import type { ProjectAsset, SamplerState } from "@shared/types";
import "./SamplerPanel.css";

type SamplerPanelProps = {
  sampler: SamplerState;
  assets: ProjectAsset[];
  assetsLoading: boolean;
  missingSampleIds: string[];
  recoveryMessage: string;
  onChange: (next: SamplerState) => void;
  onImportSample: () => void;
  onPreview: () => void;
  onAddNote: () => void;
  onOpenPattern: () => void;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function SamplerPanel({
  sampler, assets, assetsLoading, missingSampleIds, recoveryMessage, onChange, onImportSample, onPreview, onAddNote, onOpenPattern,
}: SamplerPanelProps) {
  const asset = assets.find((item) => item.id === sampler.sampleAssetId);
  const isMissing = Boolean(sampler.sampleAssetId)
    && (missingSampleIds.includes(sampler.sampleAssetId as string) || (!assetsLoading && !asset));
  const usable = Boolean(sampler.sampleAssetId) && Boolean(asset) && !isMissing;

  const changeNumber = (event: ChangeEvent<HTMLInputElement>, key: "rootNote" | "gain", min: number, max: number) => {
    const value = Number(event.currentTarget.value);
    if (event.currentTarget.value === "" || !Number.isFinite(value)) return;
    onChange({ ...sampler, [key]: clamp(value, min, max) });
  };

  return (
    <section className="prism-instrument-panel sampler-panel" aria-labelledby="sampler-panel-title" data-testid="panel-sampler">
      <header className="instrument-panel-heading">
        <div className="instrument-heading-mark sampler-mark"><AudioWaveform size={15} aria-hidden="true" /></div>
        <div className="instrument-heading-copy">
          <span className="instrument-kicker">INSTRUMENT / 01</span>
          <h2 id="sampler-panel-title">Sampler</h2>
        </div>
        <span className={`instrument-status ${usable ? "status-ready" : isMissing ? "status-missing" : "status-empty"}`} data-testid="status-sampler-assignment" aria-live="polite">
          <i aria-hidden="true" />{usable ? "READY" : isMissing ? "MISSING SOURCE" : "NO SAMPLE"}
        </span>
      </header>

      <div className="sampler-workspace">
        <div className={`sample-assignment ${isMissing ? "assignment-missing" : ""} ${!sampler.sampleAssetId ? "assignment-empty" : ""}`}>
          <div className="sample-icon" aria-hidden="true"><FileAudio2 size={17} /></div>
          <div className="sample-file">
            <span className="control-caption">SOURCE FILE</span>
            {sampler.sampleAssetId ? (
              <>
                <strong data-testid="text-sampler-sample-name">{isMissing ? "Sample unavailable" : assetsLoading && !asset ? "Checking sample library…" : asset?.fileName}</strong>
                <small data-testid="text-sampler-sample-status">
                  {isMissing ? `Missing or unreadable · ${sampler.sampleAssetId}` : assetsLoading && !asset ? "Checking saved assignment" : `${asset?.mimeType || "Audio"} · assigned`}
                </small>
              </>
            ) : (
              <>
                <strong data-testid="text-sampler-empty-state">No sample assigned</strong>
                <small>Load an audio file to start shaping a sound.</small>
              </>
            )}
          </div>
          <button className="instrument-button instrument-button-quiet sampler-load" type="button" data-testid="button-sampler-import" onClick={onImportSample} aria-label={sampler.sampleAssetId ? "Replace sampler audio sample" : "Load audio sample"}>
            <FolderOpen size={14} aria-hidden="true" />{sampler.sampleAssetId ? "Replace" : "Load sample"}
          </button>
          {sampler.sampleAssetId && (
            <button className="instrument-icon-button" type="button" data-testid="button-sampler-clear" aria-label="Clear sample assignment" title="Clear assignment" onClick={() => onChange({ ...sampler, sampleAssetId: null })}>
              <Trash2 size={14} aria-hidden="true" />
            </button>
          )}
        </div>

        {recoveryMessage && <div className="instrument-warning" role="alert" data-testid="status-sampler-recovery"><AudioLines size={14} aria-hidden="true" /><span>{recoveryMessage}</span></div>}
        {isMissing && (
          <div className="instrument-warning" role="status" data-testid="status-sampler-missing">
            <AudioLines size={14} aria-hidden="true" />
            <span>This source is missing or unreadable. Its assignment is kept; load another file to replace it.</span>
          </div>
        )}

        <div className="sampler-controls">
          <label className="instrument-field sample-picker-field">
            <span className="control-caption">SAMPLE LIBRARY</span>
            <select
              data-testid="select-sampler-sample"
              aria-label="Sampler audio sample"
              value={sampler.sampleAssetId ?? ""}
              onChange={(event) => onChange({ ...sampler, sampleAssetId: event.target.value || null })}
            >
              <option value="">Unassigned</option>
              {sampler.sampleAssetId && !asset && (
                <option value={sampler.sampleAssetId}>{assetsLoading ? "Checking saved sample…" : `Unavailable sample · ${sampler.sampleAssetId}`}</option>
              )}
              {assets.map((item) => (
                <option key={item.id} value={item.id}>
                  {missingSampleIds.includes(item.id) ? `Unavailable · ${item.fileName}` : item.fileName}
                </option>
              ))}
            </select>
          </label>

          <label className="instrument-field note-field">
            <span className="control-caption">ROOT MIDI NOTE</span>
            <span className="number-control">
              <input data-testid="input-sampler-root-note" aria-label="Root MIDI note" type="number" min="0" max="127" step="1" value={sampler.rootNote} onChange={(event) => changeNumber(event, "rootNote", 0, 127)} />
              <span>NOTE</span>
            </span>
          </label>

          <label className="instrument-field gain-field">
            <span className="control-caption">SAMPLE GAIN <output data-testid="text-sampler-gain">{sampler.gain.toFixed(2)}×</output></span>
            <input className="instrument-range" data-testid="input-sampler-gain" aria-label="Sample gain" type="range" min="0" max="1.5" step="0.01" value={sampler.gain} onChange={(event) => onChange({ ...sampler, gain: Number(event.target.value) })} />
            <span className="range-ends"><small>0</small><small>1.5</small></span>
          </label>
        </div>

        <footer className="instrument-panel-actions">
          <button className="instrument-button instrument-button-quiet" type="button" data-testid="button-sampler-preview" onClick={onPreview} disabled={!usable}>
            <Play size={13} fill="currentColor" aria-hidden="true" />Preview
          </button>
          <span className="action-divider" aria-hidden="true" />
          <button className="instrument-button instrument-button-primary" type="button" data-testid="button-sampler-add-note" onClick={onAddNote} disabled={!usable}>
            <Music2 size={14} aria-hidden="true" />Add note at playhead
          </button>
          <button className="instrument-button instrument-button-quiet pattern-action" type="button" data-testid="button-sampler-open-pattern" onClick={onOpenPattern}>
            Open pattern <span aria-hidden="true">↗</span>
          </button>
        </footer>
      </div>
    </section>
  );
}

export default SamplerPanel;
