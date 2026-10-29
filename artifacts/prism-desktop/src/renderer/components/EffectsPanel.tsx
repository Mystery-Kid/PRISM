import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Download,
  FileUp,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  effectDefaults,
  isNativeEffectType,
  nativeEffectCatalog,
  normalizeEffectParameters,
  normalizeEffectState,
  unavailablePluginFormats,
} from "@shared/effect-definitions";
import {
  createEffectPresetFile,
  maxPresetEffectCount,
} from "@shared/effect-presets";
import type {
  EffectChainPreset,
  EffectState,
  SongSession,
} from "@shared/types";

type EffectsPanelProps = {
  session: SongSession;
  selectedTrackId: string;
  onSelectTrack: (trackId: string) => void;
  onUpdateTrackEffects: (trackId: string, effects: EffectState[]) => void;
  onUpdateMasterEffects: (effects: EffectState[]) => void;
  onNotice: (message: string) => void;
};

type PresetScope = "global" | "project";
type ChainTarget = "track" | "master";

export function EffectsPanel({
  session,
  selectedTrackId,
  onSelectTrack,
  onUpdateTrackEffects,
  onUpdateMasterEffects,
  onNotice,
}: EffectsPanelProps) {
  const [target, setTarget] = useState<ChainTarget>("track");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<PresetScope>("project");
  const [presetName, setPresetName] = useState("");
  const [presets, setPresets] = useState<EffectChainPreset[]>([]);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const selectedTrack = session.tracks.find((track) => track.id === selectedTrackId) ?? null;
  const activeTarget = target === "track" && selectedTrack ? "track" : "master";
  const effects = activeTarget === "master" ? session.masterEffects : selectedTrack?.effects ?? [];

  useEffect(() => {
    let cancelled = false;
    setPresets([]);
    setLoadError("");
    void window.prism.listEffectPresets(session.releaseId).then((items) => {
      if (!cancelled) setPresets(items);
    }).catch((cause: unknown) => {
      if (!cancelled) setLoadError(cause instanceof Error ? cause.message : "Saved effect presets could not be loaded.");
    });
    return () => { cancelled = true; };
  }, [session.releaseId]);

  const filteredEffects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return nativeEffectCatalog.filter((effect) =>
      !query || [effect.label, effect.category, effect.description, ...effect.searchTerms]
        .join(" ").toLowerCase().includes(query),
    );
  }, [search]);
  const filteredUnavailable = useMemo(() => {
    const query = search.trim().toLowerCase();
    return unavailablePluginFormats.filter((format) =>
      !query || [format.name, format.description, ...format.searchTerms]
        .join(" ").toLowerCase().includes(query),
    );
  }, [search]);

  const updateChain = (next: EffectState[]) => {
    if (activeTarget === "master") onUpdateMasterEffects(next);
    else if (selectedTrack) onUpdateTrackEffects(selectedTrack.id, next);
  };

  const savePreset = async (input: {
    id: string;
    name: string;
    scope: PresetScope;
    projectId: string | null;
    effects: EffectChainPreset["effects"];
  }) => {
    const saved = await window.prism.saveEffectPreset({
      ...input,
      version: 1,
    });
    setPresets((current) => sortPresets([...current.filter((item) => item.id !== saved.id), saved]));
    return saved;
  };

  const saveCurrentChain = async () => {
    if (!presetName.trim()) {
      setLoadError("Enter a name before saving this effect chain.");
      return;
    }
    setBusy(true);
    setLoadError("");
    try {
      const effectsData = effects.map((effect) => ({
        id: effect.id,
        type: effect.type,
        enabled: effect.enabled,
        parameters: { ...effect.parameters },
        raw: {
          id: effect.id,
          type: effect.type,
          enabled: effect.enabled,
          parameters: { ...effect.parameters },
        },
      }));
      const saved = await savePreset({
        id: crypto.randomUUID(),
        name: presetName.trim(),
        scope,
        projectId: scope === "project" ? session.releaseId : null,
        effects: effectsData,
      });
      setPresetName("");
      onNotice(`Saved “${saved.name}” to ${scope === "global" ? "global presets" : "this release"}.`);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "The effect preset could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const applyPreset = (preset: EffectChainPreset, append: boolean) => {
    const available = preset.effects.flatMap((effect) => {
      if (!isNativeEffectType(effect.type)) return [];
      const state = normalizeEffectState({
        id: crypto.randomUUID(),
        type: effect.type,
        enabled: effect.enabled,
        parameters: effect.parameters,
      });
      return state ? [state] : [];
    });
    const missing = preset.effects.length - available.length;
    const next = append ? [...effects, ...available] : available;
    if (next.length > maxPresetEffectCount) {
      setLoadError(`The resulting chain cannot exceed ${maxPresetEffectCount} effects.`);
      return;
    }
    updateChain(next);
    setLoadError("");
    onNotice(missing
      ? `${available.length ? "Available effects loaded. " : ""}${missing} unavailable effect${missing === 1 ? " was" : "s were"} skipped; the saved preset is unchanged.`
      : `${append ? "Appended" : "Loaded"} “${preset.name}”.`);
  };

  const renamePreset = async (preset: EffectChainPreset) => {
    if (!renameValue.trim()) {
      setLoadError("Preset names cannot be blank.");
      return;
    }
    setBusy(true);
    setLoadError("");
    try {
      const saved = await savePreset({
        id: preset.id,
        name: renameValue.trim(),
        scope: preset.scope,
        projectId: preset.projectId,
        effects: preset.effects,
      });
      setRenamingId(null);
      onNotice(`Renamed preset to “${saved.name}”.`);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "The preset could not be renamed.");
    } finally {
      setBusy(false);
    }
  };

  const duplicatePreset = async (preset: EffectChainPreset) => {
    setBusy(true);
    setLoadError("");
    try {
      const saved = await savePreset({
        id: crypto.randomUUID(),
        name: `${preset.name} Copy`.slice(0, 80),
        scope: preset.scope,
        projectId: preset.projectId,
        effects: preset.effects,
      });
      onNotice(`Created “${saved.name}”.`);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "The preset could not be duplicated.");
    } finally {
      setBusy(false);
    }
  };

  const deletePreset = async (preset: EffectChainPreset) => {
    setBusy(true);
    setLoadError("");
    try {
      if (!window.confirm(`Delete “${preset.name}”? This cannot be undone.`)) return;
      await window.prism.deleteEffectPreset(preset.id, session.releaseId);
      setPresets((current) => current.filter((item) => item.id !== preset.id));
      onNotice(`Deleted “${preset.name}”.`);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "The preset could not be deleted.");
    } finally {
      setBusy(false);
    }
  };

  const importPreset = async () => {
    setBusy(true);
    setLoadError("");
    try {
      const file = await window.prism.importEffectPreset();
      if (!file) return;
      const saved = await savePreset({
        id: crypto.randomUUID(),
        name: file.name,
        scope,
        projectId: scope === "project" ? session.releaseId : null,
        effects: file.effects,
      });
      const missing = saved.effects.filter((effect) => !isNativeEffectType(effect.type)).length;
      onNotice(`Imported “${saved.name}”${missing ? `; ${missing} unavailable effect${missing === 1 ? " was" : "s were"} preserved.` : "."}`);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "The preset file could not be imported.");
    } finally {
      setBusy(false);
    }
  };

  const exportPreset = async (preset: EffectChainPreset) => {
    setBusy(true);
    setLoadError("");
    try {
      const file = createEffectPresetFile(preset.name, preset.effects);
      const exported = await window.prism.exportEffectPreset(file);
      if (exported) onNotice(`Exported “${preset.name}”.`);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "The preset file could not be exported.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="effects-workspace">
    <section className="effect-browser" aria-label="Native effects browser">
      <div className="effects-section-title"><strong>Effects browser</strong><span>Native</span></div>
      <label className="effect-search"><Search size={13} /><input data-testid="input-effects-search" aria-label="Search effects" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search effects" /></label>
      <div className="effect-browser-list">
        {filteredEffects.map((effect) => <article className="effect-browser-card" key={effect.type}>
          <div><strong>{effect.label}</strong><small>{effect.category}</small><p>{effect.description}</p></div>
          <button className="button button-subtle" data-testid={`button-browse-add-${effect.type}`} aria-label={`Add ${effect.label}`} disabled={effects.length >= maxPresetEffectCount} onClick={() => {
            const defaults = effectDefaults(effect.type);
            const item: EffectState = { id: crypto.randomUUID(), type: effect.type, enabled: true, parameters: defaults };
            updateChain([...effects, item]);
          }}><Plus size={12} />Add</button>
        </article>)}
        {filteredEffects.length === 0 && filteredUnavailable.length === 0 && <p className="effect-browser-empty">No effects match that search.</p>}
        {filteredUnavailable.map((format) => <article className="effect-browser-card unavailable" key={format.name}>
          <div><strong>{format.name}</strong><small>Unavailable</small><p>{format.description}</p></div>
        </article>)}
      </div>
    </section>

    <section className="effect-chain-workspace" aria-label="Effect chain editor">
      <div className="effects-section-title"><strong>Ordered chain</strong>
        <label className="effect-target">
          <span>Target</span>
          <select data-testid="select-effect-chain-target" value={activeTarget} onChange={(event) => setTarget(event.target.value as ChainTarget)}>
            <option value="track" disabled={!selectedTrack}>Track</option>
            <option value="master">Master</option>
          </select>
        </label>
      </div>
      {activeTarget === "track" && <label className="effect-track-target">
        <span>Track</span>
        <select data-testid="select-effect-track" value={selectedTrack?.id ?? ""} onChange={(event) => onSelectTrack(event.target.value)}>
          {session.tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}
        </select>
      </label>}
      {effects.length > 0
        ? <EffectChainEditor effects={effects} onChange={updateChain} />
        : <p className="effect-chain-empty">This chain is empty. Search for an effect and add it.</p>}
    </section>

    <section className="effect-presets" aria-label="Effect preset library">
      <div className="effects-section-title"><strong>Reusable presets</strong><button className="icon-button compact" data-testid="button-import-effect-preset" title="Import a versioned JSON preset" disabled={busy} onClick={() => void importPreset()}><FileUp size={13} /></button></div>
      <div className="preset-save-controls">
        <label className="preset-scope-select">
          <span>Save to</span>
          <select data-testid="select-effect-preset-scope" value={scope} onChange={(event) => setScope(event.target.value as PresetScope)}>
            <option value="project">This release</option>
            <option value="global">All projects</option>
          </select>
        </label>
        <label className="preset-name-input"><span className="sr-only">Preset name</span><input data-testid="input-effect-preset-name" value={presetName} maxLength={80} onChange={(event) => setPresetName(event.target.value)} placeholder="Name this chain" /></label>
        <button className="button button-subtle" data-testid="button-save-effect-preset" disabled={busy} onClick={() => void saveCurrentChain()}><Save size={12} />Save</button>
      </div>
      {loadError && <p className="effect-preset-error" role="alert" data-testid="status-effect-preset-error">{loadError}</p>}
      <div className="effect-preset-list">
        {presets.map((preset) => {
          const unavailableCount = preset.effects.filter((effect) => !isNativeEffectType(effect.type)).length;
          return <article className="effect-preset-card" data-testid={`effect-preset-${preset.id}`} key={preset.id}>
            <div className="effect-preset-summary">
              {renamingId === preset.id
                ? <input aria-label={`Rename ${preset.name}`} autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => {
                  if (event.key === "Enter") void renamePreset(preset);
                  if (event.key === "Escape") setRenamingId(null);
                }} />
                : <><strong title={preset.name}>{preset.name}</strong><small>{preset.scope === "global" ? "Global" : "This release"} · {preset.effects.length} effect{preset.effects.length === 1 ? "" : "s"}{unavailableCount ? ` · ${unavailableCount} unavailable` : ""}</small></>}
            </div>
            {renamingId === preset.id
              ? <div className="effect-preset-actions"><button className="icon-button compact" title="Save name" disabled={busy} onClick={() => void renamePreset(preset)}><Check size={12} /></button><button className="icon-button compact" title="Cancel rename" onClick={() => setRenamingId(null)}><X size={12} /></button></div>
              : <>
                <div className="effect-preset-actions">
                  <button className="button button-subtle" data-testid={`button-effect-preset-load-${preset.id}`} aria-label={`Replace chain with ${preset.name}`} title="Replace this chain with the preset's available effects" disabled={busy} onClick={() => applyPreset(preset, false)}>Load</button>
                  <button className="button button-subtle" data-testid={`button-effect-preset-append-${preset.id}`} aria-label={`Append ${preset.name}`} title="Append the available effects to this chain" disabled={busy} onClick={() => applyPreset(preset, true)}>Append</button>
                  <button className="icon-button compact" title="Rename preset" disabled={busy} onClick={() => { setRenamingId(preset.id); setRenameValue(preset.name); }}><Pencil size={12} /></button>
                  <button className="icon-button compact" title="Duplicate preset" disabled={busy} onClick={() => void duplicatePreset(preset)}><Copy size={12} /></button>
                  <button className="icon-button compact" title="Export preset JSON" disabled={busy} onClick={() => void exportPreset(preset)}><Download size={12} /></button>
                  <button className="icon-button compact danger-hover" title="Delete preset" disabled={busy} onClick={() => void deletePreset(preset)}><Trash2 size={12} /></button>
                </div>
                {unavailableCount > 0 && <p className="effect-unavailable-note">Unavailable effects stay in this preset and are not loaded into the audio graph.</p>}
              </>}
          </article>;
        })}
        {!loadError && presets.length === 0 && <p className="effect-preset-empty">No saved presets are available for this release yet.</p>}
      </div>
    </section>
  </div>;
}

function EffectChainEditor({ effects, onChange }: {
  effects: EffectState[];
  onChange: (effects: EffectState[]) => void;
}) {
  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= effects.length) return;
    const next = [...effects];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };
  const update = (effectId: string, apply: (effect: EffectState) => EffectState) =>
    onChange(effects.map((effect) => effect.id === effectId ? apply(effect) : effect));

  return <div className="effect-chain-list">
    {effects.map((effect, index) => {
      const definition = nativeEffectCatalog.find((item) => item.type === effect.type)!;
      return <article className={`effect-unit ${effect.enabled ? "enabled" : ""}`} data-testid={`effect-unit-${effect.id}`} key={effect.id}>
        <div className="effect-unit-head">
          <label><input data-testid={`track-effect-toggle-${effect.id}`} type="checkbox" checked={effect.enabled} onChange={(event) => update(effect.id, (item) => ({ ...item, enabled: event.target.checked }))} />{definition.label}</label>
          <div className="effect-unit-actions">
            <button className="icon-button compact" title="Move effect up" aria-label={`Move ${definition.label} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={12} /></button>
            <button className="icon-button compact" title="Move effect down" aria-label={`Move ${definition.label} down`} disabled={index === effects.length - 1} onClick={() => move(index, 1)}><ArrowDown size={12} /></button>
            <button className="icon-button compact" title="Duplicate effect" aria-label={`Duplicate ${definition.label}`} disabled={effects.length >= maxPresetEffectCount} onClick={() => {
              const copy = { ...effect, id: crypto.randomUUID(), parameters: { ...effect.parameters } };
              const next = [...effects];
              next.splice(index + 1, 0, copy);
              onChange(next);
            }}><Copy size={11} /></button>
            <button className="icon-button compact" title="Reset parameters" aria-label={`Reset ${definition.label}`} onClick={() => update(effect.id, (item) => ({ ...item, parameters: effectDefaults(item.type) }))}><RotateCcw size={11} /></button>
            <button className="icon-button compact danger-hover" title="Remove effect" aria-label={`Remove ${definition.label}`} onClick={() => onChange(effects.filter((item) => item.id !== effect.id))}><X size={12} /></button>
          </div>
        </div>
        {definition.parameters.map((parameter) => {
          const value = normalizeEffectParameters(effect.type, effect.parameters)[parameter.key] ?? parameter.defaultValue;
          return <label className="effect-param" key={parameter.key}>
            <span>{parameter.label}</span>
            <input
              data-testid={`track-effect-${effect.id}-${parameter.key}`}
              aria-label={`${definition.label} ${parameter.label}`}
              type="range"
              min={parameter.min}
              max={parameter.max}
              step={parameter.step}
              value={value}
              onChange={(event) => update(effect.id, (item) => ({
                ...item,
                parameters: normalizeEffectParameters(item.type, {
                  ...item.parameters,
                  [parameter.key]: Number(event.target.value),
                }),
              }))}
            />
            <small>{formatParameter(value, parameter.unit)}</small>
          </label>;
        })}
      </article>;
    })}
  </div>;
}

function formatParameter(value: number, unit?: string): string {
  const digits = Math.abs(value) < 1 ? 2 : value % 1 === 0 ? 0 : 1;
  return `${value.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
}

function sortPresets(presets: EffectChainPreset[]): EffectChainPreset[] {
  return [...presets].sort((left, right) =>
    Number(left.scope === "project") - Number(right.scope === "project") ||
    left.name.localeCompare(right.name),
  );
}
