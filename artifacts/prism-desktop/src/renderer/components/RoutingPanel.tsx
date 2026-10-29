import { useMemo, useState } from "react";
import {
  AudioLines,
  Headphones,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { EffectState, SongSession, Track } from "@shared/types";
import { maxAudioBuses, maxSendsPerSource } from "@shared/audio-routing";
import "./RoutingPanel.css";

type BusSend = {
  id: string;
  busId: string;
  level: number;
  placement: "pre" | "post";
};

type AudioBus = {
  id: string;
  name: string;
  level: number;
  muted: boolean;
  solo: boolean;
  outputBusId: string | null;
  sends: BusSend[];
  effects: EffectState[];
};

type RoutedTrack = Track & {
  outputBusId: string | null;
  sends: BusSend[];
};

type RoutedSession = SongSession & {
  buses: AudioBus[];
  tracks: RoutedTrack[];
};

type RoutingPanelProps = {
  session: SongSession;
  selectedTrackId: string;
  meters: Record<string, { peak: number; rms: number }>;
  allowedBusTargets(sourceBusId: string): string[];
  onChange(session: SongSession): void;
  onSelectTrack(trackId: string): void;
  onEditBusEffects(busId: string): void;
  onNotice(message: string): void;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function RoutingPanel({
  session,
  selectedTrackId,
  meters,
  allowedBusTargets,
  onChange,
  onSelectTrack,
  onEditBusEffects,
  onNotice,
}: RoutingPanelProps) {
  const routed = session as RoutedSession;
  const buses = routed.buses ?? [];
  const tracks = routed.tracks ?? [];
  const [creatingBus, setCreatingBus] = useState(false);
  const [newBusName, setNewBusName] = useState("");
  const [formError, setFormError] = useState("");

  const busNames = useMemo(() => new Map(buses.map((bus) => [bus.id, bus.name])), [buses]);
  const busLimitReached = buses.length >= maxAudioBuses;
  const updateSession = (apply: (current: RoutedSession) => RoutedSession) => {
    onChange(apply({ ...routed, buses, tracks }));
  };

  const createBus = () => {
    const name = newBusName.trim();
    if (!name) {
      setFormError("Enter a name for this bus.");
      return;
    }
    if (busLimitReached) {
      setFormError(`A session can have at most ${maxAudioBuses} audio buses.`);
      return;
    }
    if (buses.some((bus) => bus.name.toLowerCase() === name.toLowerCase())) {
      setFormError("A bus with that name already exists.");
      return;
    }
    const bus: AudioBus = {
      id: crypto.randomUUID(),
      name,
      level: 1,
      muted: false,
      solo: false,
      outputBusId: null,
      sends: [],
      effects: [],
    };
    updateSession((current) => ({ ...current, buses: [...current.buses, bus] }));
    setNewBusName("");
    setFormError("");
    setCreatingBus(false);
    onNotice(`Created “${name}”.`);
  };

  const renameBus = (bus: AudioBus) => {
    const value = window.prompt("Rename bus", bus.name);
    if (value === null) return;
    const name = value.trim();
    if (!name) {
      onNotice("Bus names cannot be blank.");
      return;
    }
    if (buses.some((item) => item.id !== bus.id && item.name.toLowerCase() === name.toLowerCase())) {
      onNotice("A bus with that name already exists.");
      return;
    }
    updateSession((current) => ({
      ...current,
      buses: current.buses.map((item) => item.id === bus.id ? { ...item, name } : item),
    }));
  };

  const deleteBus = (bus: AudioBus) => {
    if (!window.confirm(`Delete “${bus.name}” and remove all routes and sends that point to it?`)) return;
    updateSession((current) => ({
      ...current,
      buses: current.buses
        .filter((item) => item.id !== bus.id)
        .map((item) => ({
          ...item,
          outputBusId: item.outputBusId === bus.id ? null : item.outputBusId,
          sends: item.sends.filter((send) => send.busId !== bus.id),
        })),
      tracks: current.tracks.map((track) => ({
        ...track,
        outputBusId: track.outputBusId === bus.id ? null : track.outputBusId,
        sends: track.sends.filter((send) => send.busId !== bus.id),
      })),
    }));
    onNotice(`Deleted “${bus.name}”. Routes to that bus now feed Master.`);
  };

  const updateBus = (busId: string, changes: Partial<AudioBus>) => updateSession((current) => ({
    ...current,
    buses: current.buses.map((bus) => bus.id === busId ? { ...bus, ...changes } : bus),
  }));

  const updateTrack = (trackId: string, changes: Partial<RoutedTrack>) => updateSession((current) => ({
    ...current,
    tracks: current.tracks.map((track) => track.id === trackId ? { ...track, ...changes } : track),
  }));

  const updateSend = (
    sourceId: string,
    sourceKind: "track" | "bus",
    sendId: string,
    changes: Partial<BusSend>,
  ) => {
    if (sourceKind === "track") {
      const track = tracks.find((item) => item.id === sourceId);
      if (!track) return;
      updateTrack(sourceId, {
        sends: track.sends.map((send) => send.id === sendId ? { ...send, ...changes } : send),
      });
    } else {
      const bus = buses.find((item) => item.id === sourceId);
      if (!bus) return;
      updateBus(sourceId, {
        sends: bus.sends.map((send) => send.id === sendId ? { ...send, ...changes } : send),
      });
    }
  };

  const removeSend = (sourceId: string, sourceKind: "track" | "bus", sendId: string) => {
    if (sourceKind === "track") {
      const track = tracks.find((item) => item.id === sourceId);
      if (track) updateTrack(sourceId, { sends: track.sends.filter((send) => send.id !== sendId) });
    } else {
      const bus = buses.find((item) => item.id === sourceId);
      if (bus) updateBus(sourceId, { sends: bus.sends.filter((send) => send.id !== sendId) });
    }
  };

  const addSend = (sourceId: string, sourceKind: "track" | "bus", sourceName: string, sends: BusSend[]) => {
    if (sends.length >= maxSendsPerSource) {
      onNotice(`${sourceName} already has the maximum of ${maxSendsPerSource} sends.`);
      return;
    }
    const targets = (sourceKind === "bus"
      ? buses.filter((bus) => allowedBusTargets(sourceId).includes(bus.id)).map((bus) => bus.id)
      : buses.map((bus) => bus.id));
    const nextTarget = targets.find((id) => !sends.some((send) => send.busId === id));
    if (!nextTarget) {
      onNotice(targets.length
        ? `${sourceName} already sends to every permitted bus.`
        : `No permitted send destinations are available for ${sourceName}.`);
      return;
    }
    const send: BusSend = { id: crypto.randomUUID(), busId: nextTarget, level: 0.7, placement: "post" };
    if (sourceKind === "track") updateTrack(sourceId, { sends: [...sends, send] });
    else updateBus(sourceId, { sends: [...sends, send] });
  };

  const routeOptions = (sourceId: string, sourceKind: "track" | "bus" = "bus") =>
    sourceKind === "bus"
      ? buses.filter((bus) => allowedBusTargets(sourceId).includes(bus.id))
      : buses;

  const renderSends = (sourceId: string, sourceKind: "track" | "bus", sourceName: string, sends: BusSend[]) => {
    const permitted = routeOptions(sourceId, sourceKind);
    return <div className="rp-sends">
      <div className="rp-sends-heading">
        <span>Aux sends <b>{sends.length}</b></span>
        <button className="rp-text-button" type="button" disabled={sends.length >= maxSendsPerSource} onClick={() => addSend(sourceId, sourceKind, sourceName, sends)}>
          <Plus size={13} /> Add send
        </button>
      </div>
      {sends.length === 0
        ? <p className="rp-no-sends">No sends configured</p>
        : sends.map((send) => {
          const targetExists = permitted.some((bus) => bus.id === send.busId);
          return <div className="rp-send-row" key={send.id}>
            <label className="rp-field rp-send-target">
              <span className="rp-sr-only">{sourceName} send destination</span>
              <select
                aria-label={`${sourceName} send destination`}
                value={targetExists ? send.busId : ""}
                onChange={(event) => updateSend(sourceId, sourceKind, send.id, { busId: event.target.value })}
              >
                <option value="" disabled>{targetExists ? "Choose bus" : "Destination unavailable"}</option>
                {permitted.map((bus) => <option key={bus.id} value={bus.id}>{bus.name}</option>)}
              </select>
            </label>
            <label className="rp-field rp-send-level">
              <span className="rp-sr-only">{sourceName} send level</span>
              <input type="range" min="0" max="1.5" step=".01" value={clamp(send.level, 0, 1.5)}
                aria-label={`${sourceName} send level to ${busNames.get(send.busId) ?? "unavailable bus"}`}
                onChange={(event) => updateSend(sourceId, sourceKind, send.id, { level: Number(event.target.value) })} />
              <output>{Math.round(send.level * 100)}%</output>
            </label>
            <fieldset className="rp-placement">
              <legend className="rp-sr-only">Send fader placement</legend>
              <label title="Send signal before the source fader">
                <input type="radio" name={`placement-${sourceId}-${send.id}`} value="pre" checked={send.placement === "pre"}
                  onChange={() => updateSend(sourceId, sourceKind, send.id, { placement: "pre" })} />
                <span>Pre</span>
              </label>
              <label title="Send signal after the source fader">
                <input type="radio" name={`placement-${sourceId}-${send.id}`} value="post" checked={send.placement === "post"}
                  onChange={() => updateSend(sourceId, sourceKind, send.id, { placement: "post" })} />
                <span>Post</span>
              </label>
            </fieldset>
            <button className="rp-icon-button rp-remove-send" type="button" aria-label={`Remove send from ${sourceName} to ${busNames.get(send.busId) ?? "unavailable bus"}`}
              onClick={() => removeSend(sourceId, sourceKind, send.id)}><X size={14} /></button>
            {!targetExists && <span className="rp-inline-warning" role="status">Destination no longer permitted</span>}
          </div>;
        })}
    </div>;
  };

  const renderMeter = (key: string, label: string) => {
    const value = meters[key] ?? { peak: 0, rms: 0 };
    const peak = clamp(Number.isFinite(value.peak) ? value.peak : 0, 0, 1);
    const rms = clamp(Number.isFinite(value.rms) ? value.rms : 0, 0, 1);
    return <div className="rp-meter" role="img" aria-label={`${label} meter: peak ${Math.round(peak * 100)} percent, RMS ${Math.round(rms * 100)} percent`}>
      <span className="rp-meter-track"><i className="rp-meter-rms" style={{ width: `${rms * 100}%` }} /><i className={`rp-meter-peak ${peak > .92 ? "hot" : ""}`} style={{ left: `${peak * 100}%` }} /></span>
      <small><span>PK</span> {Math.round(peak * 100)} <span>RMS</span> {Math.round(rms * 100)}</small>
    </div>;
  };

  const invalidOutputs = buses.filter((bus) => bus.outputBusId && !routeOptions(bus.id, "bus").some((target) => target.id === bus.outputBusId));
  const audioTracks = tracks;

  return <section className="routing-panel" aria-label="Audio bus routing">
    <header className="rp-header">
      <div className="rp-title-lockup">
        <span className="rp-title-mark"><AudioLines size={17} /></span>
        <div><p className="rp-kicker">SIGNAL FLOW / SESSION</p><h2>Routing matrix</h2></div>
      </div>
      <div className="rp-header-meta">
        <span className="rp-bus-count">{buses.length.toString().padStart(2, "0")} <small>BUSES</small></span>
        <button className="rp-add-bus" type="button" disabled={busLimitReached} title={busLimitReached ? `Maximum ${maxAudioBuses} buses` : "Create a bus"} onClick={() => { setCreatingBus(true); setFormError(""); }}>
          <Plus size={14} /> New bus
        </button>
      </div>
    </header>

    {invalidOutputs.length > 0 && <div className="rp-warning" role="status">
      <span>{invalidOutputs.length} bus {invalidOutputs.length === 1 ? "output is" : "outputs are"} no longer permitted. Select Master or an available destination to restore the route.</span>
    </div>}

    {creatingBus && <div className="rp-create-row" role="group" aria-label="Create audio bus">
      <div className="rp-create-copy"><span className="rp-create-index">NEW</span><strong>Make a place for a submix</strong></div>
      <form onSubmit={(event) => { event.preventDefault(); createBus(); }}>
        <label className="rp-sr-only" htmlFor="rp-new-bus-name">Bus name</label>
        <input id="rp-new-bus-name" autoFocus maxLength={80} value={newBusName} placeholder="e.g. Drum bus"
          onChange={(event) => { setNewBusName(event.target.value); setFormError(""); }} />
        <button type="submit" className="rp-create-confirm">Create</button>
        <button type="button" className="rp-icon-button" aria-label="Cancel bus creation" onClick={() => { setCreatingBus(false); setFormError(""); }}><X size={15} /></button>
      </form>
      {formError && <p role="alert" className="rp-form-error">{formError}</p>}
    </div>}

    <div className="rp-section-heading">
      <div><span className="rp-section-index">01</span><h3>Bus outputs</h3><p>Dedicated submix channels, separate from the arrangement.</p></div>
      <span className="rp-destination-caption">DESTINATION</span>
    </div>
    {buses.length === 0
      ? <div className="rp-empty-buses">
        <div className="rp-empty-glyph"><AudioLines size={20} /></div>
        <div><strong>No buses in this session</strong><p>Create a bus to group tracks, shape a submix, and route it to another permitted destination.</p></div>
        <button type="button" className="rp-empty-action" disabled={busLimitReached} onClick={() => setCreatingBus(true)}><Plus size={13} /> Create first bus</button>
      </div>
      : <div className="rp-bus-list">
        {buses.map((bus, index) => {
          const targets = routeOptions(bus.id, "bus");
          const outputAllowed = bus.outputBusId === null || targets.some((target) => target.id === bus.outputBusId);
          return <article className={`rp-bus ${bus.muted ? "is-muted" : ""}`} key={bus.id} data-testid={`routing-bus-${bus.id}`}>
            <div className="rp-bus-identity">
              <span className="rp-channel-number">{String(index + 1).padStart(2, "0")}</span>
              <span className="rp-bus-icon"><AudioLines size={15} /></span>
              <div className="rp-bus-name-wrap">
                <strong title={bus.name}>{bus.name}</strong>
                <span>BUS CHANNEL</span>
              </div>
              <button className="rp-icon-button" type="button" title={`Rename ${bus.name}`} aria-label={`Rename ${bus.name}`} onClick={() => renameBus(bus)}><Pencil size={13} /></button>
            </div>
            <div className="rp-bus-meter">{renderMeter(`bus:${bus.id}`, `${bus.name} bus`)}</div>
            <label className="rp-level-control">
              <span>LEVEL</span><input type="range" min="0" max="1.5" step=".01" value={clamp(bus.level, 0, 1.5)}
                aria-label={`${bus.name} level`} onChange={(event) => updateBus(bus.id, { level: Number(event.target.value) })} />
              <output>{Math.round(bus.level * 100)}%</output>
            </label>
            <div className="rp-bus-actions">
              <button className={`rp-state-button ${bus.muted ? "active mute" : ""}`} type="button" aria-pressed={bus.muted}
                aria-label={`${bus.muted ? "Unmute" : "Mute"} ${bus.name}`} onClick={() => updateBus(bus.id, { muted: !bus.muted })}>
                {bus.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}<span>M</span>
              </button>
              <button className={`rp-state-button ${bus.solo ? "active solo" : ""}`} type="button" aria-pressed={bus.solo}
                aria-label={`${bus.solo ? "Unsolo" : "Solo"} ${bus.name}`} onClick={() => updateBus(bus.id, { solo: !bus.solo })}>
                <Headphones size={13} /><span>S</span>
              </button>
              <button className="rp-icon-button rp-effects-button" type="button" onClick={() => onEditBusEffects(bus.id)} aria-label={`Edit effects for ${bus.name}`} title="Edit bus effects">
                <SlidersHorizontal size={13} /><span>FX <b>{bus.effects?.length ?? 0}</b></span>
              </button>
              <button className="rp-icon-button rp-delete-bus" type="button" title={`Delete ${bus.name}`} aria-label={`Delete ${bus.name}`} onClick={() => deleteBus(bus)}><Trash2 size={13} /></button>
            </div>
            <label className="rp-output-control">
              <span>OUTPUT</span>
              <select aria-label={`${bus.name} output destination`} value={bus.outputBusId ?? "master"}
                onChange={(event) => updateBus(bus.id, { outputBusId: event.target.value === "master" ? null : event.target.value })}>
                <option value="master">Master</option>
                {targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
                {bus.outputBusId && !outputAllowed && <option value={bus.outputBusId} disabled>{busNames.get(bus.outputBusId) ?? "Unavailable bus"} · unavailable</option>}
              </select>
              {!outputAllowed && <small className="rp-invalid-destination">Current destination is not permitted</small>}
            </label>
            <div className="rp-bus-sends">{renderSends(bus.id, "bus", bus.name, bus.sends ?? [])}</div>
          </article>;
        })}
      </div>}

    <div className="rp-section-heading rp-track-heading">
      <div><span className="rp-section-index">02</span><h3>Track inputs</h3><p>Audio and instrument channels feeding the bus structure.</p></div>
      <span className="rp-destination-caption">{audioTracks.length.toString().padStart(2, "0")} SOURCES</span>
    </div>
    {audioTracks.length === 0
      ? <div className="rp-empty-tracks"><span>—</span><p>No audio or instrument tracks to route yet.</p></div>
      : <div className="rp-track-list">
        {audioTracks.map((track, index) => {
          const targets = routeOptions(track.id, "track");
          const selected = selectedTrackId === track.id;
          const outputAllowed = track.outputBusId === null || targets.some((target) => target.id === track.outputBusId);
          return <article className={`rp-track ${selected ? "selected" : ""}`} key={track.id} data-testid={`routing-track-${track.id}`}>
            <div className="rp-track-main">
              <button className="rp-track-select" type="button" onClick={() => onSelectTrack(track.id)} aria-pressed={selected} aria-label={`Select track ${track.name}`}>
                <span className={`rp-track-type ${track.type}`}><AudioLines size={13} /></span>
                <span className="rp-track-name"><strong>{track.name}</strong><small>{track.type === "instrument" ? "INSTRUMENT" : track.type === "sampler" ? "SAMPLER" : track.type === "drum" ? "DRUM KIT" : track.type === "unsupported" ? "UNSUPPORTED" : "AUDIO"} · {String(index + 1).padStart(2, "0")}</small></span>
              </button>
              <div className="rp-track-meter">{renderMeter(track.id, `${track.name} track`)}</div>
              <label className="rp-track-output">
                <span>OUTPUT</span>
                <select value={track.outputBusId ?? "master"} aria-label={`${track.name} output destination`}
                  onChange={(event) => updateTrack(track.id, { outputBusId: event.target.value === "master" ? null : event.target.value })}>
                  <option value="master">Master</option>
                  {targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
                  {track.outputBusId && !outputAllowed && <option value={track.outputBusId} disabled>{busNames.get(track.outputBusId) ?? "Unavailable bus"} · unavailable</option>}
                </select>
                {!outputAllowed && <small className="rp-invalid-destination">Current destination is not permitted</small>}
              </label>
            </div>
            {renderSends(track.id, "track", track.name, track.sends ?? [])}
          </article>;
        })}
      </div>}

    <footer className="rp-footer">
      <span className="rp-footer-dot" /> Session routing is held locally with this song.
      <span className="rp-footer-legend"><i /> RMS <b /> Peak</span>
    </footer>
  </section>;
}
