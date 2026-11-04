import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowDown, ArrowUp, Check, CircleHelp, FolderPlus, LoaderCircle,
  Minus, Play, Power, RefreshCw, Search, SlidersHorizontal, Square, X,
} from "lucide-react";
import type { AudioBus, SongSession, Track } from "@shared/types";
import type { NativeHostStatus, NativeParameterInfo, NativePluginInfo, NativePluginState } from "@shared/native-plugins";
import "./NativePluginManager.css";

type NativePluginManagerProps = {
  session: SongSession;
  selectedTrack?: Track;
  setSession: React.Dispatch<React.SetStateAction<SongSession>>;
  updateTrack: (trackId: string, update: Partial<Track>) => void;
  onStopPlayback: () => void;
  initialKind?: "instrument" | "effect";
  initialTarget?: Target;
};
type Target = "track" | `track:${string}` | `bus:${string}` | "master";
type ParameterMetadata = { parameters: NativeParameterInfo[]; error?: string };

function errorText(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

export function NativePluginManager({ session, selectedTrack, setSession, updateTrack, onStopPlayback, initialKind = "instrument", initialTarget = "track" }: NativePluginManagerProps) {
  const [status, setStatus] = useState<NativeHostStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"instrument" | "effect">(initialKind);
  const [target, setTarget] = useState<Target>(initialTarget);
  const [replaceAt, setReplaceAt] = useState<number | null>(null);
  const [replaceOwner, setReplaceOwner] = useState<Target | null>(null);
  const [metadata, setMetadata] = useState<Record<string, ParameterMetadata>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const refresh = async (operation = "Loading VST3 host…") => {
    setBusy(operation);
    setError("");
    try {
      const next = await window.prism.nativePluginStatus();
      setStatus(next);
      return next;
    } catch (cause) {
      setError(errorText(cause, "VST3 host status could not be loaded."));
      return null;
    } finally {
      setBusy("");
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);

  const availablePlugins = useMemo(() => (status?.plugins ?? [])
    .filter((plugin) => plugin.kind === kind)
    .filter((plugin) => `${plugin.name} ${plugin.vendor} ${plugin.categories}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name)), [status?.plugins, kind, query]);

  const assignedInstruments = session.tracks.flatMap((track) =>
    track.nativeInstrument ? [{ label: `Track · ${track.name}`, plugin: track.nativeInstrument }] : []);
  const assignedEffects = [
    ...session.tracks.flatMap((track) => (track.nativeEffects ?? []).map((plugin) => ({ label: `Track · ${track.name}`, plugin }))),
    ...session.buses.flatMap((bus) => (bus.nativeEffects ?? []).map((plugin) => ({ label: `Bus · ${bus.name}`, plugin }))),
    ...(session.nativeMasterEffects ?? []).map((plugin) => ({ label: "Master output", plugin })),
  ];

  const assign = (info: NativePluginInfo) => {
    if (info.kind === "instrument" && (!selectedTrack || selectedTrack.type !== "instrument")) {
      setError("Select an instrument track before assigning a native instrument. Built-in instruments and MIDI notes remain unchanged.");
      return;
    }
    if (info.kind === "effect" && target === "track" && !selectedTrack) {
      setError("Select a track, bus, or master output for this effect.");
      return;
    }
    const plugin: NativePluginState = {
      instanceId: crypto.randomUUID(), classId: info.classId, name: info.name, vendor: info.vendor,
      version: info.version, kind: info.kind, enabled: true, parameters: {},
    };
    if (info.kind === "instrument") {
      updateTrack(selectedTrack!.id, { nativeInstrument: plugin });
    } else {
      setSession((current) => {
        const destination = replaceOwner ?? target;
        if (destination === "master") {
          const chain = [...(current.nativeMasterEffects ?? [])];
          if (replaceAt !== null && chain[replaceAt]) chain[replaceAt] = plugin;
          else chain.push(plugin);
          return { ...current, nativeMasterEffects: chain };
        }
        if (destination.startsWith("bus:")) {
          const busId = destination.slice(4);
          return { ...current, buses: current.buses.map((bus) => {
            if (bus.id !== busId) return bus;
            const chain = [...(bus.nativeEffects ?? [])];
            if (replaceAt !== null && chain[replaceAt]) chain[replaceAt] = plugin;
            else chain.push(plugin);
            return { ...bus, nativeEffects: chain };
          }) };
        }
        const destinationTrackId = destination.startsWith("track:") ? destination.slice(6) : selectedTrack?.id;
        return { ...current, tracks: current.tracks.map((track) => {
          if (track.id !== destinationTrackId) return track;
          const chain = [...(track.nativeEffects ?? [])];
          if (replaceAt !== null && chain[replaceAt]) chain[replaceAt] = plugin;
          else chain.push(plugin);
          return { ...track, nativeEffects: chain };
        }) };
      });
    }
    setReplaceAt(null);
    setReplaceOwner(null);
    setSuccess(`${info.name} assigned. PRISM will prepare the native session before playback or export.`);
    setError("");
  };

  const getChain = (owner: Target): NativePluginState[] => {
    if (owner === "master") return session.nativeMasterEffects ?? [];
    if (owner.startsWith("bus:")) return session.buses.find((bus) => bus.id === owner.slice(4))?.nativeEffects ?? [];
    if (owner.startsWith("track:")) return session.tracks.find((track) => track.id === owner.slice(6))?.nativeEffects ?? [];
    return selectedTrack?.nativeEffects ?? [];
  };
  const writeChain = (owner: Target, chain: NativePluginState[]) => {
    if (owner === "master") setSession((current) => ({ ...current, nativeMasterEffects: chain }));
    else if (owner.startsWith("bus:")) {
      const id = owner.slice(4);
      setSession((current) => ({ ...current, buses: current.buses.map((bus) => bus.id === id ? { ...bus, nativeEffects: chain } : bus) }));
    } else if (owner.startsWith("track:")) {
      const id = owner.slice(6);
      setSession((current) => ({ ...current, tracks: current.tracks.map((track) => track.id === id ? { ...track, nativeEffects: chain } : track) }));
    } else if (selectedTrack) updateTrack(selectedTrack.id, { nativeEffects: chain });
  };
  const changeEffect = (owner: Target, index: number, update: Partial<NativePluginState> | "remove" | "up" | "down") => {
    const chain = [...getChain(owner)];
    if (update === "remove") chain.splice(index, 1);
    else if (update === "up" && index > 0) [chain[index - 1], chain[index]] = [chain[index], chain[index - 1]];
    else if (update === "down" && index < chain.length - 1) [chain[index + 1], chain[index]] = [chain[index], chain[index + 1]];
    else if (typeof update === "object") chain[index] = { ...chain[index], ...update };
    writeChain(owner, chain);
  };

  const inspect = async (plugin: NativePluginState) => {
    setError("");
    setBusy(`Inspecting ${plugin.name}…`);
    try {
      const result = await window.prism.inspectNativePlugin(plugin.classId);
      setMetadata((current) => ({ ...current, [plugin.classId]: { parameters: result.parameters } }));
      setExpanded(plugin.instanceId);
    } catch (cause) {
      const message = errorText(cause, `Could not inspect ${plugin.name}.`);
      setMetadata((current) => ({ ...current, [plugin.classId]: { parameters: [], error: message } }));
      setError(message);
    } finally { setBusy(""); }
  };
  const edit = async (plugin: NativePluginState) => {
    setError("");
    setBusy(`Opening ${plugin.name} editor…`);
    setEditing(plugin.instanceId);
    onStopPlayback();
    try {
      const updated = await window.prism.editNativePlugin(plugin);
      if (plugin.kind === "instrument" && selectedTrack?.nativeInstrument?.instanceId === plugin.instanceId) {
        updateTrack(selectedTrack.id, { nativeInstrument: updated });
      } else {
        const effectOwner = findEffectOwner(plugin.instanceId);
        if (effectOwner) {
          const chain = [...getChain(effectOwner)];
          const index = chain.findIndex((item) => item.instanceId === plugin.instanceId);
          if (index >= 0) { chain[index] = updated; writeChain(effectOwner, chain); }
        } else {
          setSession((current) => ({ ...current, tracks: current.tracks.map((track) =>
            track.nativeInstrument?.instanceId === plugin.instanceId ? { ...track, nativeInstrument: updated } : track) }));
        }
      }
      setSuccess(`${plugin.name} editor closed; returned plugin state was applied.`);
    } catch (cause) {
      setError(errorText(cause, `The ${plugin.name} editor could not be opened.`));
    } finally { setBusy(""); setEditing(null); }
  };
  const findEffectOwner = (instanceId: string): Target | null => {
    const track = session.tracks.find((item) => item.nativeEffects?.some((plugin) => plugin.instanceId === instanceId));
    if (track) return `track:${track.id}`;
    const bus = session.buses.find((item) => item.nativeEffects?.some((plugin) => plugin.instanceId === instanceId));
    if (bus) return `bus:${bus.id}`;
    return session.nativeMasterEffects?.some((plugin) => plugin.instanceId === instanceId) ? "master" : null;
  };
  const updateParameter = (plugin: NativePluginState, param: NativeParameterInfo, value: number) => {
    const parameters = { ...plugin.parameters, [String(param.id)]: value };
    if (plugin.kind === "instrument") {
      const owner = session.tracks.find((track) => track.nativeInstrument?.instanceId === plugin.instanceId);
      if (owner) updateTrack(owner.id, { nativeInstrument: { ...plugin, parameters } });
    } else {
      const owner = findEffectOwner(plugin.instanceId);
      if (!owner) return;
      const chain = [...getChain(owner)];
      const index = chain.findIndex((item) => item.instanceId === plugin.instanceId);
      if (index >= 0) { chain[index] = { ...plugin, parameters }; writeChain(owner, chain); }
    }
  };

  const effectOwners: { id: Target; label: string; chain: NativePluginState[] }[] = [
    ...(selectedTrack ? [{ id: `track:${selectedTrack.id}` as Target, label: `Track · ${selectedTrack.name}`, chain: selectedTrack.nativeEffects ?? [] }] : []),
    ...session.buses.map((bus: AudioBus) => ({ id: `bus:${bus.id}` as Target, label: `Bus · ${bus.name}`, chain: bus.nativeEffects ?? [] })),
    { id: "master", label: "Master output", chain: session.nativeMasterEffects ?? [] },
  ];
  const hasNative = assignedInstruments.length + assignedEffects.length > 0;

  const pluginCard = (plugin: NativePluginState, owner?: Target, index?: number) => {
    const installed = status?.plugins.some((item) => item.classId === plugin.classId && item.kind === plugin.kind);
    const info = status?.plugins.find((item) => item.classId === plugin.classId);
    const values = metadata[plugin.classId];
    const unavailable = !installed || !status?.available;
    return <article className={`native-plugin-card ${unavailable ? "is-unavailable" : ""}`} key={plugin.instanceId} data-testid={`native-plugin-${plugin.instanceId}`}>
      <div className="native-plugin-card-head">
        <span className={`native-plugin-mark ${plugin.kind}`}>{plugin.kind === "instrument" ? "INSTRUMENT" : "VST3 FX"}</span>
        <div className="native-plugin-identity">
          <strong>{plugin.name}</strong><span>{plugin.vendor || "Unknown vendor"}{plugin.version ? ` · ${plugin.version}` : ""}</span>
        </div>
        <button className={`native-power ${plugin.enabled ? "enabled" : ""}`} type="button" title={plugin.enabled ? "Bypass plugin" : "Enable plugin"} aria-label={plugin.enabled ? `Bypass ${plugin.name}` : `Enable ${plugin.name}`} onClick={() => {
          if (plugin.kind === "instrument") {
            const ownerTrack = session.tracks.find((track) => track.nativeInstrument?.instanceId === plugin.instanceId);
            if (ownerTrack) updateTrack(ownerTrack.id, { nativeInstrument: { ...plugin, enabled: !plugin.enabled } });
          } else if (owner) changeEffect(owner, index ?? 0, { enabled: !plugin.enabled });
        }}><Power size={14} /></button>
      </div>
      {unavailable && <div className="native-unavailable" role="status"><AlertTriangle size={14} /><span>Unavailable class reference. Its saved state is preserved. Scan or choose a replacement; removal is safe.</span></div>}
      <div className="native-plugin-actions">
        <button type="button" className="native-quiet-button" disabled={unavailable || Boolean(busy)} onClick={() => { if (expanded === plugin.instanceId) setExpanded(null); else if (values?.parameters.length) setExpanded(plugin.instanceId); else void inspect(plugin); }}>
          <SlidersHorizontal size={13} /> {expanded === plugin.instanceId ? "Hide parameters" : "Parameters"}
        </button>
        <button type="button" className="native-quiet-button" disabled={unavailable || Boolean(busy)} onClick={() => void edit(plugin)}><Play size={13} /> {editing === plugin.instanceId ? "Editor open…" : "Open editor"}</button>
        {owner && index !== undefined && <>
          <button type="button" className="native-icon-button" title="Move effect earlier" aria-label="Move effect earlier" disabled={index === 0} onClick={() => changeEffect(owner, index, "up")}><ArrowUp size={14} /></button>
          <button type="button" className="native-icon-button" title="Move effect later" aria-label="Move effect later" disabled={index === getChain(owner).length - 1} onClick={() => changeEffect(owner, index, "down")}><ArrowDown size={14} /></button>
          <button type="button" className="native-icon-button native-remove" title="Remove effect" aria-label={`Remove ${plugin.name}`} onClick={() => changeEffect(owner, index, "remove")}><X size={14} /></button>
        </>}
      </div>
      {expanded === plugin.instanceId && <div className="native-parameters">
        {values?.error && <div className="native-inline-error">{values.error}</div>}
        {values?.parameters.length ? values.parameters.map((parameter) => {
          const value = plugin.parameters[String(parameter.id)] ?? parameter.value;
          const step = parameter.steps > 1 ? 1 / (parameter.steps - 1) : 0.001;
          return <label className="native-parameter" key={parameter.id}>
            <span><b>{parameter.name || `Parameter ${parameter.id}`}</b><small>{parameter.unit || "Normalized"}</small></span>
            <input aria-label={`${plugin.name} ${parameter.name}`} type="range" min="0" max="1" step={step} value={value} disabled={parameter.readOnly || unavailable}
              onChange={(event) => updateParameter(plugin, parameter, Number(event.target.value))} />
            <output>{value.toFixed(3)}</output>
          </label>;
        }) : !values?.error ? <div className="native-parameter-empty">No parameter metadata reported by this plugin.</div> : null}
        <p className="native-state-note">Saved parameter values and opaque component/controller state are retained unless you change a control or close the native editor.</p>
      </div>}
    </article>;
  };

  return <div className="native-manager" data-testid="native-plugin-manager">
    <header className="native-manager-header">
      <div><span className="native-eyebrow">NATIVE INTEGRATION</span><h2>VST3 workstation</h2><p>Manage locally installed plugins without changing PRISM’s built-in instruments or effects.</p></div>
      <div className="native-header-actions">
        <button type="button" className="native-button" disabled={Boolean(busy)} onClick={() => void refresh("Refreshing plugin host…")}><RefreshCw size={14} /> Refresh</button>
        <button type="button" className="native-button native-button-primary" disabled={Boolean(busy)} onClick={async () => {
          setError(""); setSuccess(""); setBusy("Choose a VST3 folder…");
          try { const next = await window.prism.addNativePluginFolder(); setStatus(next); setSuccess("Plugin folder configuration updated."); }
          catch (cause) { setError(errorText(cause, "The plugin folder could not be added.")); }
          finally { setBusy(""); }
        }}><FolderPlus size={14} /> Add folder</button>
        <button type="button" className="native-button" disabled={Boolean(busy)} onClick={async () => {
          setError(""); setSuccess(""); setBusy("Scanning VST3 folders…");
          const poll = window.setInterval(() => {
            void window.prism.nativePluginStatus().then(setStatus).catch(() => undefined);
          }, 500);
          try { const next = await window.prism.scanNativePlugins(); setStatus(next); setSuccess(`Scan complete. ${next.plugins.length} plugin classes available.`); }
          catch (cause) { setError(errorText(cause, "VST3 scan failed.")); }
          finally { window.clearInterval(poll); setBusy(""); }
        }}><Search size={14} /> Scan folders</button>
      </div>
    </header>

    <div className="native-host-status">
      <span className={`native-status-dot ${status?.available ? "online" : "offline"}`} />
      <strong>{loading ? "Connecting to native host" : status?.available ? "Native host available" : "Native host unavailable"}</strong>
      <span>{status?.reason ?? (status?.available ? "VST3 processing runs locally." : "Refresh or inspect the host reason below.")}</span>
      <button type="button" className="native-cancel" onClick={() => {
        setError(""); setSuccess("");
        void window.prism.cancelNativeProcessing().then(() => setSuccess("Native processing cancellation requested.")).catch((cause: unknown) => setError(errorText(cause, "Could not cancel native processing.")));
      }}><Square size={12} /> Cancel preparation</button>
    </div>
    {status?.scanning && <div className="native-progress" role="status"><div className="native-progress-track"><span style={{ width: `${status.total ? Math.min(100, status.completed / status.total * 100) : 12}%` }} /></div><span>Scanning {status.completed} of {status.total || "…"} VST3 entries</span></div>}
    {busy && <div className="native-live-status" role="status"><LoaderCircle size={14} className="native-spin" />{busy}</div>}
    {error && <div className="native-message error" role="alert"><AlertTriangle size={15} />{error}<button type="button" aria-label="Dismiss error" onClick={() => setError("")}><X size={13} /></button></div>}
    {success && <div className="native-message success" role="status"><Check size={15} />{success}<button type="button" aria-label="Dismiss message" onClick={() => setSuccess("")}><X size={13} /></button></div>}

    <div className="native-buffering-warning" role="note"><AlertTriangle size={17} /><div><strong>Buffered native processing</strong><span>Native sessions prepare before playback and export. Changing audio settings requires re-preparation. This is not low-latency live MIDI or recording.</span></div></div>

    <div className="native-manager-grid">
      <section className="native-library">
        <div className="native-section-heading"><div><span className="native-eyebrow">LOCAL LIBRARY</span><h3>Available classes</h3></div><span className="native-count">{availablePlugins.length}</span></div>
        <div className="native-filters">
          <div className="native-kind-switch" role="tablist" aria-label="Plugin kind">
            {(["instrument", "effect"] as const).map((item) => <button type="button" role="tab" aria-selected={kind === item} key={item} onClick={() => { setKind(item); setReplaceAt(null); setReplaceOwner(null); }}>{item === "instrument" ? "Instruments" : "Effects"}</button>)}
          </div>
          <label className="native-search"><Search size={14} /><input aria-label="Search VST3 classes" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, vendor, category" /></label>
        </div>
        {status?.sources.length ? <div className="native-folder-list"><span>Configured scan folders</span>{status.sources.map((source) => <code key={source}>{source}</code>)}</div> : <div className="native-empty-folder"><FolderPlus size={17} /><span>No VST3 scan folders configured.</span><small>Add a folder with the system chooser. PRISM will request permission before scanning executable plugin code.</small></div>}
        {!status?.available && !loading && <div className="native-unavailable-reason"><CircleHelp size={15} />{status?.reason ?? "The native plugin host did not report availability."}</div>}
        {status?.errors.map((item, index) => <div className="native-scan-error" key={`${index}-${item}`}><AlertTriangle size={13} />{item}</div>)}
        <div className="native-class-list">
          {loading ? <div className="native-library-skeleton"><i /><i /><i /></div> : availablePlugins.length ? availablePlugins.map((plugin) => {
            const canAssign = plugin.kind === "instrument"
              ? selectedTrack?.type === "instrument"
              : target !== "track" || Boolean(selectedTrack);
            return <article key={plugin.classId} className="native-class-row">
              <div className={`native-plugin-mark ${plugin.kind}`}>{plugin.kind === "instrument" ? "INSTR" : "FX"}</div>
              <div className="native-class-info"><strong>{plugin.name}</strong><span>{plugin.vendor} · {plugin.categories || "Uncategorized"}</span></div>
              <button type="button" className="native-assign" disabled={!status?.available || !canAssign || Boolean(busy)} title={!canAssign ? plugin.kind === "instrument" ? "Select an instrument track" : "Select an effect destination" : "Assign plugin"} onClick={() => assign(plugin)}>Assign</button>
              {plugin.kind === "effect" && replaceAt !== null && <span className="native-replace-hint">Will replace slot {replaceAt + 1}</span>}
            </article>;
          }) : !loading && <div className="native-empty-library"><CircleHelp size={18} /><strong>{query ? "No matching classes" : "No scanned classes yet"}</strong><span>{query ? "Try another search or switch plugin kind." : "Add a VST3 folder, then scan. PRISM does not bundle a mock catalog."}</span></div>}
        </div>
      </section>

      <section className="native-assignments">
        <div className="native-section-heading"><div><span className="native-eyebrow">PROJECT STATE</span><h3>Assignments</h3></div><span className="native-count">{assignedInstruments.length + assignedEffects.length}</span></div>
        <div className="native-assignment-tools">
          <label>Effect destination<select aria-label="Native effect destination" value={target.startsWith("track:") ? "track" : target} onChange={(event) => { setTarget(event.target.value as Target); setReplaceAt(null); setReplaceOwner(null); }}>
            <option value="track" disabled={!selectedTrack}>Track · {selectedTrack?.name ?? "select a track"}</option>
            {session.buses.map((bus) => <option value={`bus:${bus.id}`} key={bus.id}>Bus · {bus.name}</option>)}
            <option value="master">Master output</option>
          </select></label>
          <span>Native effects run after built-in effects.</span>
        </div>
        {kind === "instrument" && <div className="native-assignment-group">
          <div className="native-subheading"><strong>Selected track instrument</strong><span>{selectedTrack?.name ?? "No track selected"}</span></div>
          {selectedTrack?.type !== "instrument" ? <div className="native-assignment-empty">Select an instrument track to add a VST3 instrument. Existing built-in sound is preserved.</div>
            : selectedTrack.nativeInstrument ? <>{pluginCard(selectedTrack.nativeInstrument)}<div className="native-assignment-controls">
              <button type="button" className="native-quiet-button" onClick={() => setReplaceAt(0)}><RefreshCw size={13} /> Replace from library</button>
              <button type="button" className="native-quiet-button native-remove-text" onClick={() => updateTrack(selectedTrack.id, { nativeInstrument: null })}><X size={13} /> Restore built-in instrument</button>
            </div></>
              : <div className="native-assignment-empty">No native instrument assigned. The built-in instrument and all notes remain active.</div>}
        </div>}
        {kind === "effect" && <div className="native-assignment-group native-effect-groups">
          {effectOwners.map((entry) => <div className="native-effect-owner" key={entry.id}>
            <div className="native-subheading"><strong>{entry.label}</strong><span>{entry.chain.length} {entry.chain.length === 1 ? "effect" : "effects"}</span></div>
            {entry.chain.length ? entry.chain.map((plugin, index) => <div className="native-effect-slot" key={plugin.instanceId}>
              <div className="native-slot-index">{String(index + 1).padStart(2, "0")}</div>
              {pluginCard(plugin, entry.id, index)}
              <button type="button" className="native-slot-replace" onClick={() => { setTarget(entry.id.startsWith("track:") ? "track" : entry.id); setReplaceOwner(entry.id); setReplaceAt(index); }}><RefreshCw size={12} /> Replace</button>
            </div>) : <div className="native-assignment-empty compact">No native effects at this stage.</div>}
          </div>)}
        </div>}
        <div className="native-state-footnote"><Minus size={13} />Unavailable plugin references remain in project state for recovery. You can replace or remove native effects, or restore a track’s built-in instrument.</div>
      </section>
    </div>

    {hasNative && <div className="native-recovery-summary"><strong>Saved assignments</strong><span>{assignedInstruments.length} native instrument{assignedInstruments.length === 1 ? "" : "s"} · {assignedEffects.length} native effect{assignedEffects.length === 1 ? "" : "s"} across this project</span><ul>{[...assignedInstruments, ...assignedEffects].filter(({ plugin }) => !status?.plugins.some((item) => item.classId === plugin.classId)).map(({ label, plugin }) => <li key={plugin.instanceId}><AlertTriangle size={12} />{plugin.name} — unavailable at {label}</li>)}</ul></div>}
  </div>;
}
