import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import {
  AudioLines, Circle, CircleStop, Download, Headphones, Music2, Pause, Play, Plus,
  Redo2, Save, SkipBack, SlidersHorizontal, Sparkles, Trash2, Undo2, Volume2, VolumeX, X,
} from "lucide-react";
import type {
  AudioClip,
  EffectState,
  EffectType,
  InstrumentState,
  MidiNote,
  SongSession,
  Track,
} from "@shared/types";
import { AudioEngine, type AudioDevice, type AudioEngineSnapshot } from "../audio/AudioEngine";
import { secondsPerBeat } from "../audio/time";
import { getPianoNoteDragUpdate, type PianoNoteDragState } from "./piano-roll";
import prismLogo from "../assets/prism-logo.png";

type WorkstationProps = {
  session: SongSession;
  releaseTitle: string;
  onBack: () => void;
  onHome: () => void;
};
type Meter = { peak: number; rms: number };
const colors = ["#d7a568", "#77a99e", "#a58ac4", "#c77979", "#829fc2"];
const effectDefaults: Record<EffectType, Record<string, number>> = {
  equalizer: { frequency: 1000, gain: 0, q: 1 },
  reverb: { decay: 1.6, mix: 0.2 },
  delay: { time: 0.25, feedback: 0.25, mix: 0.2 },
  compressor: { threshold: -18, ratio: 4, attack: 0.003, release: 0.25, knee: 12 },
};
const effectLabels: Record<EffectType, string> = {
  equalizer: "Equalizer", reverb: "Reverb", delay: "Delay", compressor: "Compressor",
};
const emptySnapshot: AudioEngineSnapshot = {
  status: "stopped",
  error: null,
  recording: false,
  position: 0,
  sampleRate: null,
  baseLatency: null,
  outputLatency: null,
  meters: {},
  inputMeter: { peak: 0, rms: 0 },
  inputChannels: null,
};
const historyLimit = 30;

export function Workstation({ session: initialSession, releaseTitle, onBack, onHome }: WorkstationProps) {
  const [session, setSession] = useState(initialSession);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [saveError, setSaveError] = useState("");
  const [engineError, setEngineError] = useState("");
  const [engine, setEngine] = useState<AudioEngine | null>(null);
  const [snapshot, setSnapshot] = useState<AudioEngineSnapshot>(emptySnapshot);
  const [selectedTrack, setSelectedTrack] = useState(initialSession.tracks[0]?.id ?? "");
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [snap, setSnap] = useState(true);
  const [inputDevices, setInputDevices] = useState<AudioDevice[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([]);
  const [inputDevice, setInputDevice] = useState(() => localStorage.getItem("prism.audioInput") ?? "");
  const [outputDevice, setOutputDevice] = useState(() => localStorage.getItem("prism.audioOutput") ?? "");
  const [monitoring, setMonitoring] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState("");
  const [panel, setPanel] = useState<"mixer" | "clip" | "piano" | "effects" | "devices">("mixer");
  const [notice, setNotice] = useState("");
  const [historyAvailability, setHistoryAvailability] = useState({ canUndo: false, canRedo: false });
  const timelineRef = useRef<HTMLDivElement>(null);
  const pianoGridRef = useRef<HTMLDivElement>(null);
  const history = useRef<{ states: SongSession[]; index: number }>({
    states: [structuredClone(initialSession)],
    index: 0,
  });
  const skipHistoryCapture = useRef(false);
  const beatSeconds = secondsPerBeat(session.tempo, session.timeSignature);
  const barSeconds = beatSeconds * beatsPerBar(session.timeSignature);
  const pixelsPerSecond = 54 * zoom;
  const clips = useMemo(() => session.tracks.flatMap((track) => track.clips.map((clip) => ({ track, clip }))), [session.tracks]);
  const duration = Math.max(16, ...clips.map(({ clip }) => clip.startSeconds + clip.durationSeconds), ...session.tracks.flatMap((track) => track.notes.map((note) => (note.startBeat + note.durationBeats) * beatSeconds)));
  const selected = clips.find(({ clip }) => clip.id === selectedClip);
  const selectedInstrument = session.tracks.find((track) => track.id === selectedTrack && track.type === "instrument");

  useEffect(() => {
    if (panel !== "piano" || !pianoGridRef.current) return;
    const pitch = selectedInstrument?.notes.find((note) => note.id === selectedNote)?.pitch ?? 60;
    pianoGridRef.current.scrollTop = Math.max(0, (127 - pitch) * 15 - 45);
  }, [panel, selectedTrack, selectedNote]);

  useEffect(() => {
    history.current = { states: [structuredClone(initialSession)], index: 0 };
    setHistoryAvailability({ canUndo: false, canRedo: false });
    if (session.id !== initialSession.id) {
      skipHistoryCapture.current = true;
      setSession(initialSession);
      setSelectedTrack(initialSession.tracks[0]?.id ?? "");
    }
    setSelectedClip(null);
    setSelectedNote(null);
    setSnapshot({ ...emptySnapshot });
  }, [initialSession.id]);

  useEffect(() => {
    if (skipHistoryCapture.current) {
      skipHistoryCapture.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      const stack = history.current;
      const previous = stack.states[stack.index];
      if (previous && JSON.stringify(previous) === JSON.stringify(session)) return;
      const states = stack.states.slice(0, stack.index + 1);
      states.push(structuredClone(session));
      if (states.length > historyLimit) states.shift();
      history.current = { states, index: states.length - 1 };
      setHistoryAvailability({ canUndo: states.length > 1, canRedo: false });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [session]);

  useEffect(() => {
    const audio = new AudioEngine((id) => window.prism.assetUrl(id));
    setEngine(audio);
    audio.updateSession(session);
    return () => { void audio.dispose(); };
    // Engine lifetime is scoped to the open song.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  useEffect(() => {
    if (!engine) return;
    let cancelled = false;
    const clips = session.tracks.flatMap((track) => track.clips);
    void Promise.all(clips.map(async (clip) => {
      if (clip.sourceDurationSeconds > 0 && clip.waveform.length > 0) return null;
      try {
        const buffer = await engine.loadAudio(clip.assetId);
        return {
          clipId: clip.id,
          durationSeconds: buffer.duration,
          waveform: clip.waveform.length > 0 ? clip.waveform : waveformPeaks(buffer),
        };
      } catch (cause) {
        if (!cancelled) {
          setEngineError(cause instanceof Error ? cause.message : `Could not load ${clip.name}.`);
        }
        return null;
      }
    })).then((loaded) => {
      if (cancelled) return;
      const metadata = new Map(loaded.filter((item): item is NonNullable<typeof item> => item !== null)
        .map((item) => [item.clipId, item]));
      if (metadata.size === 0) return;
      setSession((current) => ({
        ...current,
        tracks: current.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) => {
            const item = metadata.get(clip.id);
            if (!item) return clip;
            const sourceDurationSeconds = Math.min(
              clip.sourceDurationSeconds || item.durationSeconds,
              item.durationSeconds,
            );
            const availableDuration = Math.max(0, sourceDurationSeconds - clip.sourceStartSeconds);
            return {
              ...clip,
              durationSeconds: clip.durationSeconds
                ? Math.min(clip.durationSeconds, availableDuration)
                : availableDuration,
              sourceDurationSeconds,
              waveform: item.waveform,
            };
          }),
        })),
      }));
    });
    return () => { cancelled = true; };
  }, [engine, session.id]);

  useEffect(() => {
    if (!engine) return;
    engine.updateSession(session);
  }, [engine, session]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!engine) return;
      const next = engine.snapshot();
      setSnapshot(next);
      if (next.error) setEngineError(next.error);
      setRecording(next.recording);
    }, 80);
    return () => window.clearInterval(timer);
  }, [engine]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSaveStatus("saving");
      setSaveError("");
      void window.prism.saveSession(session).then(() => {
        if (!cancelled) setSaveStatus("saved");
      }).catch((cause: unknown) => {
        if (!cancelled) {
          setSaveStatus("error");
          setSaveError(cause instanceof Error ? cause.message : "Session could not be saved.");
        }
      });
    }, 320);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [session]);

  useEffect(() => window.prism.onCloseRequested(() => {
    void (async () => {
      let current = session;
      if (engine?.snapshot().recording) {
        const take = await engine.stopRecording();
        if (take) current = appendRecordedClip(current, take.clip, take.trackId);
        setSession(current);
      }
      await window.prism.saveSession(current);
      setSaveStatus("saved");
      await window.prism.finishClose();
    })().catch((cause: unknown) => {
      setSaveStatus("error");
      setSaveError(cause instanceof Error ? cause.message : "Could not save before closing PRISM.");
    });
  }), [engine, session]);

  useEffect(() => {
    if (!engine) return;
    let cancelled = false;
    void engine.listDevices().then(({ inputs, outputs }) => {
      if (cancelled) return;
      setInputDevices(inputs);
      setOutputDevices(outputs);
      if (!inputs.some((device) => device.id === inputDevice)) setInputDevice(inputs[0]?.id ?? "");
      const nextOutput = outputs.some((device) => device.id === outputDevice)
        ? outputDevice
        : outputs[0]?.id ?? "";
      if (nextOutput !== outputDevice) setOutputDevice(nextOutput);
    }).catch((cause: unknown) => {
      if (!cancelled) setEngineError(cause instanceof Error ? cause.message : "Audio devices could not be listed.");
    });
    return () => { cancelled = true; };
  }, [engine]);

  const updateTrack = (trackId: string, update: Partial<Track>) => setSession((current) => ({
    ...current, tracks: current.tracks.map((track) => track.id === trackId ? { ...track, ...update } : track),
  }));
  const updateClip = (trackId: string, clipId: string, update: Partial<AudioClip>) => setSession((current) => ({
    ...current, tracks: current.tracks.map((track) => track.id === trackId ? {
      ...track, clips: track.clips.map((clip) => clip.id === clipId ? { ...clip, ...update } : clip),
    } : track),
  }));
  const updateNote = (trackId: string, noteId: string, update: Partial<MidiNote>) => setSession((current) => ({
    ...current, tracks: current.tracks.map((track) => track.id === trackId ? {
      ...track, notes: track.notes.map((note) => note.id === noteId ? { ...note, ...update } : note),
    } : track),
  }));
  const updateInstrumentParameter = (
    parameter: Exclude<keyof InstrumentState, "waveform">,
    value: number,
  ) => {
    if (!selectedInstrument?.instrument) return;
    const bounds = {
      attack: [0.001, 4],
      decay: [0.001, 4],
      sustain: [0, 1],
      release: [0.005, 4],
    }[parameter];
    updateTrack(selectedInstrument.id, {
      instrument: {
        ...selectedInstrument.instrument,
        [parameter]: clamp(value, bounds[0], bounds[1]),
      },
    });
  };
  const safe = async (task: () => Promise<void>) => {
    setEngineError("");
    try { await task(); } catch (cause) {
      setEngineError(cause instanceof Error ? cause.message : "The audio operation failed.");
    }
  };
  const applyOutputDevice = async () => {
    if (engine && outputDevice && outputDevice !== "default") {
      await engine.setOutputDevice(outputDevice);
    }
  };
  const play = () => safe(async () => {
    if (!engine) return;
    if (snapshot.status === "playing") {
      const position = engine.pause();
      setSnapshot((old) => ({ ...old, status: "stopped", position }));
    } else {
      await applyOutputDevice();
      await engine.start(session, snapshot.position);
    }
  });
  const stop = () => safe(async () => {
    if (recording && engine) await engine.stopRecording();
    const position = engine?.stop(false) ?? 0;
    setRecording(false);
    setSnapshot((old) => ({ ...old, status: "stopped", position }));
  });
  const seek = (seconds: number) => {
    const position = Math.max(0, Math.min(duration, seconds));
    engine?.seek(position);
    setSnapshot((old) => ({ ...old, position }));
  };
  const addTrack = (type: "audio" | "instrument") => {
    const number = session.tracks.filter((track) => track.type === type).length + 1;
    const track: Track = {
      id: crypto.randomUUID(), name: type === "audio" ? `Audio ${number}` : `Instrument ${number}`,
      type, color: colors[session.tracks.length % colors.length], volume: 0.82, pan: 0,
      muted: false, solo: false, recordArmed: false, clips: [], notes: [],
      instrument: type === "instrument" ? { waveform: "triangle", attack: 0.015, decay: 0.12, sustain: 0.62, release: 0.18 } : null,
      effects: [],
    };
    setSession((current) => ({ ...current, tracks: [...current.tracks, track] }));
    setSelectedTrack(track.id);
    setPanel(type === "instrument" ? "piano" : "mixer");
  };
  const removeTrack = (trackId: string) => {
    if (recording) return;
    const track = session.tracks.find((item) => item.id === trackId);
    if (!track) return;
    const warning = track.clips.length > 0
      ? `Remove "${track.name}" and its clips from this song? Original media files will remain in the project library.`
      : `Remove "${track.name}" from this song?`;
    if (!window.confirm(warning)) return;
    setSession((current) => ({
      ...current,
      tracks: current.tracks.filter((item) => item.id !== trackId),
    }));
    setSelectedClip((clipId) =>
      track.clips.some((clip) => clip.id === clipId) ? null : clipId,
    );
    if (selectedTrack === trackId) {
      const next = session.tracks.find((item) => item.id !== trackId);
      setSelectedTrack(next?.id ?? "");
    }
  };
  const importAudio = () => safe(async () => {
    if (!engine) return;
    const target = session.tracks.find((track) => track.id === selectedTrack && track.type === "audio")
      ?? session.tracks.find((track) => track.type === "audio");
    if (!target) { setNotice("Add an audio track before importing a file."); return; }
    const imported = await window.prism.importAudio(session.id, target.id);
    if (!imported) return;
    const buffer = await engine.loadAudio(imported.clip.assetId);
    const waveform = waveformPeaks(buffer);
    const clip = {
      ...imported.clip,
      durationSeconds: buffer.duration,
      sourceDurationSeconds: buffer.duration,
      waveform,
    };
    setSession((current) => ({ ...current, tracks: current.tracks.map((track) => track.id === target.id ? {
      ...track, clips: [...track.clips.filter((item) => item.id !== clip.id), clip],
    } : track) }));
    setSelectedClip(clip.id);
    setPanel("clip");
  });
  const toggleRecord = () => safe(async () => {
    if (!engine) return;
    if (recording) { await engine.stopRecording(); setRecording(false); return; }
    const armed = session.tracks.find((track) => track.recordArmed && track.type === "audio");
    if (!armed) { setEngineError("Arm an audio track before recording."); return; }
    await window.prism.saveSession(session);
    await applyOutputDevice();
    await engine.startRecording(session, armed.id, inputDevice, monitoring, {
      onComplete: ({ clip, trackId }) => {
        setSession((current) => appendRecordedClip(current, clip, trackId));
        setSelectedClip(clip.id);
        setPanel("clip");
        setRecording(false);
      },
      onError: (error) => { setEngineError(error.message); setRecording(false); },
    });
    setRecording(true);
    const devices = await engine.listDevices();
    setInputDevices(devices.inputs);
    setOutputDevices(devices.outputs);
  });
  const saveNow = async () => {
    setSaveStatus("saving");
    try { await window.prism.saveSession(session); setSaveStatus("saved"); setSaveError(""); }
    catch (cause) { setSaveStatus("error"); setSaveError(cause instanceof Error ? cause.message : "Session could not be saved."); }
  };
  const undo = () => {
    if (recording) return;
    const stack = history.current;
    if (stack.index <= 0) return;
    const index = stack.index - 1;
    history.current = { ...stack, index };
    skipHistoryCapture.current = true;
    setSession(structuredClone(stack.states[index]));
    setHistoryAvailability({ canUndo: index > 0, canRedo: true });
  };
  const redo = () => {
    if (recording) return;
    const stack = history.current;
    if (stack.index >= stack.states.length - 1) return;
    const index = stack.index + 1;
    history.current = { ...stack, index };
    skipHistoryCapture.current = true;
    setSession(structuredClone(stack.states[index]));
    setHistoryAvailability({ canUndo: true, canRedo: index < stack.states.length - 1 });
  };
  const leave = async (navigate: () => void) => {
    setSaveStatus("saving");
    try {
      let current = session;
      if (engine?.snapshot().recording) {
        const take = await engine.stopRecording();
        if (take) current = appendRecordedClip(current, take.clip, take.trackId);
        setSession(current);
      }
      await window.prism.saveSession(current);
      setSaveStatus("saved");
      navigate();
    }
    catch (cause) { setSaveStatus("error"); setSaveError(cause instanceof Error ? cause.message : "Could not save before leaving."); }
  };
  const removeClip = (clipId: string) => {
    setSession((current) => ({ ...current, tracks: current.tracks.map((track) => ({ ...track, clips: track.clips.filter((clip) => clip.id !== clipId) })) }));
    setSelectedClip(null);
  };
  const duplicateClip = () => {
    if (!selected) return;
    const copy = { ...selected.clip, id: crypto.randomUUID(), startSeconds: selected.clip.startSeconds + selected.clip.durationSeconds };
    setSession((current) => ({ ...current, tracks: current.tracks.map((track) => track.id === selected.track.id ? { ...track, clips: [...track.clips, copy] } : track) }));
    setSelectedClip(copy.id);
  };
  const splitClip = () => {
    if (!selected) return;
    const { clip, track } = selected;
    const cut = snapshot.position - clip.startSeconds;
    if (cut <= 0.02 || cut >= clip.durationSeconds - 0.02) { setNotice("Place the playhead inside the selected clip to split it."); return; }
    const right = { ...clip, id: crypto.randomUUID(), startSeconds: snapshot.position, durationSeconds: clip.durationSeconds - cut, sourceStartSeconds: clip.sourceStartSeconds + cut, fadeInSeconds: 0 };
    updateClip(track.id, clip.id, { durationSeconds: cut, fadeOutSeconds: 0 });
    setSession((current) => ({ ...current, tracks: current.tracks.map((item) => item.id === track.id ? { ...item, clips: [...item.clips, right] } : item) }));
    setSelectedClip(right.id);
  };
  const addEffect = (trackId: string | null, type: EffectType) => {
    const effect: EffectState = { id: crypto.randomUUID(), type, enabled: true, parameters: { ...effectDefaults[type] } };
    setSession((current) => trackId
      ? { ...current, tracks: current.tracks.map((track) => track.id === trackId ? { ...track, effects: [...track.effects, effect] } : track) }
      : { ...current, masterEffects: [...current.masterEffects, effect] });
  };
  const updateEffect = (trackId: string | null, effectId: string, update: Partial<EffectState>) => {
    setSession((current) => trackId
      ? { ...current, tracks: current.tracks.map((track) => track.id === trackId ? { ...track, effects: track.effects.map((effect) => effect.id === effectId ? { ...effect, ...update } : effect) } : track) }
      : { ...current, masterEffects: current.masterEffects.map((effect) => effect.id === effectId ? { ...effect, ...update } : effect) });
  };
  const updateEffectParameter = (trackId: string | null, effect: EffectState, key: string, value: number) =>
    updateEffect(trackId, effect.id, { parameters: { ...effect.parameters, [key]: value } });
  const removeEffect = (trackId: string | null, effectId: string) => setSession((current) => trackId
    ? { ...current, tracks: current.tracks.map((track) => track.id === trackId ? { ...track, effects: track.effects.filter((effect) => effect.id !== effectId) } : track) }
    : { ...current, masterEffects: current.masterEffects.filter((effect) => effect.id !== effectId) });
  const exportWav = () => safe(async () => {
    if (!engine) return;
    setBusy("export");
    try {
      const ok = await engine.exportWav(session);
      setNotice(ok ? "WAV export is ready in your chosen location." : "WAV export was cancelled.");
    } finally { setBusy(""); }
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.matches("input, textarea, select, [contenteditable=true]")) return;
      if (event.code === "Space" && !event.repeat) { event.preventDefault(); void play(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void saveNow(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && event.shiftKey) { event.preventDefault(); redo(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); undo(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { event.preventDefault(); duplicateClip(); }
      else if ((event.key === "Delete" || event.key === "Backspace") && selectedClip) removeClip(selectedClip);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const labelTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}.${String(Math.floor((seconds % 1) * 10))}`;
  const timelineWidth = Math.max(1000, duration * pixelsPerSecond + 120);
  const toggleLoop = () => setSession((current) => ({
    ...current,
    loopRange: current.loopRange?.enabled
      ? { ...current.loopRange, enabled: false }
      : { enabled: true, startSeconds: current.loopRange?.startSeconds ?? 0, endSeconds: current.loopRange?.endSeconds ?? Math.max(barSeconds * 4, 8) },
  }));

  return <main className="workstation">
    <header className="workstation-header">
      <div className="workstation-brand">
        <button className="mini-brand" data-testid="button-prism-home" title="PRISM library" onClick={() => void leave(onHome)}><img className="workstation-logo" src={prismLogo} alt="PRISM" /><b>PRISM</b></button>
        <span className="crumb-divider">/</span>
        <button className="workstation-crumb" data-testid="button-release-back" onClick={() => void leave(onBack)}>{releaseTitle}</button>
        <span className="crumb-divider">/</span><strong className="current-song" data-testid="text-song-title">{session.title}</strong>
      </div>
      <div className={`save-indicator ${saveStatus}`} data-testid="status-session-save" aria-live="polite" title={saveError || "Stored on this device"}>
        <span className="save-dot" />{saveStatus === "saving" ? "Saving" : saveStatus === "error" ? "Save error" : "Saved locally"}
      </div>
      <button className="icon-button" data-testid="button-save-session" title="Save session" onClick={() => void saveNow()}><Save size={16} /></button>
      <button className="button button-subtle export-button" data-testid="button-export-wav" title="48 kHz, 16-bit stereo WAV; maximum 10 minutes" onClick={() => void exportWav()} disabled={busy === "export" || recording}><Download size={14} />{busy === "export" ? "Rendering…" : "Export WAV"}</button>
    </header>

    <section className="transport-bar">
      <div className="transport-actions">
        <button className="transport-button" data-testid="button-return-start" title="Return to start" onClick={() => { void safe(async () => { if (recording) await engine?.stopRecording(); engine?.stop(true); setRecording(false); setSnapshot((old) => ({ ...old, status: "stopped", position: 0 })); }); }}><SkipBack size={16} /></button>
        <button className="transport-play" data-testid="button-play-pause" aria-label={snapshot.status === "playing" ? "Pause" : "Play"} onClick={() => void play()}>{snapshot.status === "playing" ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
        <button className="transport-button" data-testid="button-stop" title="Stop" onClick={() => void stop()}><CircleStop size={17} /></button>
        <button className={`transport-record ${recording ? "recording" : ""}`} data-testid="button-record" aria-label={recording ? "Stop recording" : "Record"} onClick={() => void toggleRecord()}><Circle size={15} fill="currentColor" /></button>
        <span className="transport-position" data-testid="status-playhead">{labelTime(snapshot.position)}</span>
      </div>
      <div className="transport-settings">
        <label className="tempo-control"><span>Tempo</span><input data-testid="input-tempo" aria-label="Tempo in beats per minute" type="number" min={20} max={300} value={session.tempo} onChange={(event) => { const value = Number(event.target.value); if (value >= 20 && value <= 300) setSession((current) => ({ ...current, tempo: value })); }} /><small>BPM</small></label>
        <label className="meter-select"><span>Meter</span><select data-testid="select-time-signature" value={session.timeSignature} onChange={(event) => setSession((current) => ({ ...current, timeSignature: event.target.value }))}>{["4/4", "3/4", "6/8", "5/4", "7/8"].map((meter) => <option key={meter}>{meter}</option>)}</select></label>
        <button className={`icon-button compact ${session.metronomeEnabled ? "is-active" : ""}`} data-testid="button-metronome" title="Toggle metronome" aria-pressed={session.metronomeEnabled} onClick={() => setSession((current) => ({ ...current, metronomeEnabled: !current.metronomeEnabled }))}><AudioLines size={16} /></button>
        <button className={`button button-subtle loop-button ${session.loopRange?.enabled ? "active" : ""}`} data-testid="button-loop" aria-pressed={Boolean(session.loopRange?.enabled)} onClick={toggleLoop}>Loop</button>
        {session.loopRange?.enabled && <>
          <label className="loop-bound">In<input data-testid="input-loop-start" type="number" min="0" step=".1" value={session.loopRange.startSeconds} onChange={(event) => setSession((current) => current.loopRange ? ({ ...current, loopRange: { ...current.loopRange, startSeconds: Math.max(0, Math.min(Number(event.target.value), current.loopRange.endSeconds - .1)) } }) : current)} /></label>
          <label className="loop-bound">Out<input data-testid="input-loop-end" type="number" min=".1" step=".1" value={session.loopRange.endSeconds} onChange={(event) => setSession((current) => current.loopRange ? ({ ...current, loopRange: { ...current.loopRange, endSeconds: Math.max(current.loopRange.startSeconds + .1, Number(event.target.value)) } }) : current)} /></label>
        </>}
      </div>
    </section>

    {(engineError || saveError || notice) && <div className={`workstation-notice ${engineError || saveError ? "error-notice" : ""}`} role={engineError || saveError ? "alert" : "status"} data-testid="status-workstation-message">
      <span>{engineError || saveError || notice}</span><button data-testid="button-dismiss-message" aria-label="Dismiss message" onClick={() => { setEngineError(""); setSaveError(""); setNotice(""); }}><X size={14} /></button>
    </div>}

    <section className="arrangement">
      <div className="arrangement-toolbar">
        <div className="arrangement-tools"><span className="panel-label">ARRANGEMENT</span>
          <button className="icon-button compact" data-testid="button-undo" aria-label="Undo edit" title="Undo (Ctrl+Z)" disabled={!historyAvailability.canUndo || recording} onClick={undo}><Undo2 size={14} /></button>
          <button className="icon-button compact" data-testid="button-redo" aria-label="Redo edit" title="Redo (Ctrl+Shift+Z)" disabled={!historyAvailability.canRedo || recording} onClick={redo}><Redo2 size={14} /></button>
          <button className="button button-subtle" data-testid="button-import-audio" onClick={() => void importAudio()}><Plus size={14} /> Import audio</button>
          <button className="button button-subtle" data-testid="button-add-audio-track" onClick={() => addTrack("audio")}><Plus size={14} /> Audio track</button>
          <button className="button button-subtle" data-testid="button-add-instrument-track" onClick={() => addTrack("instrument")}><Music2 size={14} /> Instrument</button>
          <label className="snap-toggle"><input data-testid="input-snap" type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} /> Snap</label>
        </div>
        <div className="zoom-control"><span>Zoom</span><input data-testid="input-timeline-zoom" aria-label="Timeline zoom" type="range" min=".5" max="2.4" step=".05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></div>
      </div>
      <div className="timeline-scroll" ref={timelineRef}>
        <div className="timeline-content" style={{ width: `${timelineWidth}px` }}>
          <div className="timeline-ruler-row">
            <div className="track-column-heading">TRACKS</div>
            <div className="timeline-ruler" style={{ width: `${timelineWidth - 240}px` }} onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              seek(Math.max(0, (event.clientX - bounds.left) / pixelsPerSecond));
            }}>
          {Array.from({ length: Math.ceil(duration / barSeconds) + 2 }, (_, index) => <div className="ruler-mark" key={index} style={{ left: `${index * barSeconds * pixelsPerSecond}px` }}><span>{String(index + 1).padStart(2, "0")}</span></div>)}
              {session.loopRange?.enabled && <div className="loop-region" style={{ left: `${session.loopRange.startSeconds * pixelsPerSecond}px`, width: `${Math.max(12, (session.loopRange.endSeconds - session.loopRange.startSeconds) * pixelsPerSecond)}px` }} />}
            </div>
          </div>
          {session.tracks.map((track, index) => <div className={`timeline-track-row ${selectedTrack === track.id ? "track-selected" : ""}`} key={track.id}>
            <div className="track-controls">
              <span className="track-color" style={{ background: track.color || colors[index % colors.length] }} />
              <button className="track-name" data-testid={`button-rename-track-${track.id}`} title="Rename track" onClick={() => { const name = window.prompt("Track name", track.name); if (name?.trim()) updateTrack(track.id, { name: name.trim() }); setSelectedTrack(track.id); }}>{track.name}</button>
              <small className="track-kind">{track.type === "instrument" ? "INSTRUMENT" : "AUDIO"}</small>
              <div className="track-buttons">
                <button className={`track-toggle ${track.muted ? "active" : ""}`} data-testid={`button-mute-${track.id}`} aria-label={`${track.muted ? "Unmute" : "Mute"} ${track.name}`} aria-pressed={track.muted} onClick={() => updateTrack(track.id, { muted: !track.muted })}>{track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}</button>
                <button className={`track-toggle ${track.solo ? "solo-active" : ""}`} data-testid={`button-solo-${track.id}`} aria-label={`${track.solo ? "Unsolo" : "Solo"} ${track.name}`} aria-pressed={track.solo} onClick={() => updateTrack(track.id, { solo: !track.solo })}>S</button>
                {track.type === "audio" && <button className={`track-toggle arm-toggle ${track.recordArmed ? "armed" : ""}`} data-testid={`button-arm-${track.id}`} aria-label={`${track.recordArmed ? "Disarm" : "Arm"} ${track.name}`} aria-pressed={track.recordArmed} onClick={() => updateTrack(track.id, { recordArmed: !track.recordArmed })}>R</button>}
                <button className="track-toggle danger-hover" data-testid={`button-delete-track-${track.id}`} aria-label={`Delete ${track.name}`} title="Remove track" disabled={recording} onClick={() => removeTrack(track.id)}><Trash2 size={12} /></button>
              </div>
              <label className="track-level"><span>VOL</span><input data-testid={`input-track-volume-${track.id}`} aria-label={`${track.name} volume`} type="range" min="0" max="1.25" step=".01" value={track.volume} onChange={(event) => updateTrack(track.id, { volume: Number(event.target.value) })} /><small>{Math.round(track.volume * 100)}</small></label>
              <label className="track-pan"><span>PAN</span><input data-testid={`input-track-pan-${track.id}`} aria-label={`${track.name} pan`} type="range" min="-1" max="1" step=".01" value={track.pan} onChange={(event) => updateTrack(track.id, { pan: Number(event.target.value) })} /></label>
            </div>
            <div className="timeline-lane" onClick={(event) => {
              setSelectedTrack(track.id);
              if ((event.target as HTMLElement).closest(".audio-clip, .midi-note")) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              seek((event.clientX - bounds.left) / pixelsPerSecond);
            }}>
              {Array.from({ length: Math.ceil(duration / barSeconds) + 2 }, (_, index) => <div key={index} className="lane-gridline" style={{ left: `${index * barSeconds * pixelsPerSecond}px` }} />)}
              {track.clips.map((clip) => <ClipBlock key={clip.id} clip={clip} selected={selectedClip === clip.id} pps={pixelsPerSecond} snapStep={beatSeconds / 4} snap={snap} onSelect={() => { setSelectedTrack(track.id); setSelectedClip(clip.id); setPanel("clip"); }} onUpdate={(update) => updateClip(track.id, clip.id, update)} onDelete={() => removeClip(clip.id)} />)}
              {track.type === "instrument" && track.notes.map((note) => <div key={note.id} className={`midi-note ${selectedNote === note.id ? "selected" : ""}`} data-testid={`note-${note.id}`} style={{ left: `${note.startBeat * beatSeconds * pixelsPerSecond}px`, width: `${Math.max(12, note.durationBeats * beatSeconds * pixelsPerSecond)}px`, top: `${Math.max(3, (127 - note.pitch) * .62)}px` }} onClick={(event) => { event.stopPropagation(); setSelectedTrack(track.id); setSelectedNote(note.id); setPanel("piano"); }} title={`${pitchName(note.pitch)} · velocity ${note.velocity}`} />)}
              <div className="playhead" style={{ left: `${snapshot.position * pixelsPerSecond}px` }} />
            </div>
          </div>)}
          {session.tracks.length === 0 && <div className="timeline-empty"><Music2 size={22} /><strong>Start with a track</strong><span>Import audio or create an instrument lane.</span></div>}
        </div>
      </div>
      <div className="arrangement-footer"><span>{session.tracks.length} {session.tracks.length === 1 ? "track" : "tracks"}</span><span>Local project audio · {session.timeSignature} · {session.tempo} BPM</span></div>
    </section>

    <section className="workstation-bottom">
      <nav className="lower-panel-tabs" aria-label="Workstation panels">
        {(["mixer", "clip", "piano", "effects", "devices"] as const).map((tab) => <button key={tab} className={`lower-tab ${panel === tab ? "active" : ""}`} data-testid={`tab-${tab}`} onClick={() => setPanel(tab)}>{tab === "mixer" ? <SlidersHorizontal size={13} /> : tab === "clip" ? <AudioLines size={13} /> : tab === "piano" ? <Music2 size={13} /> : tab === "effects" ? <Sparkles size={13} /> : <Headphones size={13} />}{tab === "clip" ? "Clip" : tab === "devices" ? "I/O" : tab[0].toUpperCase() + tab.slice(1)}</button>)}
      </nav>
      {panel === "mixer" && <div className="mixer-channels">
        {session.tracks.map((track) => <div className="mixer-channel" key={track.id}>
          <div className="mixer-channel-name"><span className="track-color" style={{ background: track.color }} />{track.name}</div>
          <MeterBar meter={snapshot.meters[track.id]} id={track.id} />
          <input className="mixer-fader" data-testid={`input-mixer-volume-${track.id}`} aria-label={`${track.name} mixer volume`} type="range" min="0" max="1.25" step=".01" value={track.volume} onChange={(event) => updateTrack(track.id, { volume: Number(event.target.value) })} />
          <div className="mixer-fader-value">{Math.round(track.volume * 100)}%</div>
        </div>)}
        <div className="mixer-channel master-channel"><div className="mixer-channel-name">MASTER</div><MeterBar meter={snapshot.meters.master} id="master" /><input className="mixer-fader" data-testid="input-master-volume" aria-label="Master volume" type="range" min="0" max="1.5" step=".01" value={session.masterVolume} onChange={(event) => setSession((current) => ({ ...current, masterVolume: Number(event.target.value) }))} /><div className="mixer-fader-value">{Math.round(session.masterVolume * 100)}%</div></div>
      </div>}
      {panel === "clip" && <div className="clip-inspector">
        {selected ? <><div className="clip-inspector-title"><span className="eyebrow">Selected audio clip</span><strong>{selected.clip.name}</strong><small>{selected.track.name} · {formatSeconds(selected.clip.durationSeconds)}</small></div>
          <label>Fade in <input data-testid="input-clip-fade-in" type="number" min="0" max={selected.clip.durationSeconds} step=".05" value={selected.clip.fadeInSeconds} onChange={(event) => updateClip(selected.track.id, selected.clip.id, { fadeInSeconds: clamp(Number(event.target.value), 0, selected.clip.durationSeconds) })} /></label>
          <label>Fade out <input data-testid="input-clip-fade-out" type="number" min="0" max={selected.clip.durationSeconds} step=".05" value={selected.clip.fadeOutSeconds} onChange={(event) => updateClip(selected.track.id, selected.clip.id, { fadeOutSeconds: clamp(Number(event.target.value), 0, selected.clip.durationSeconds) })} /></label>
          <label>Gain <input data-testid="input-clip-gain" type="range" min="0" max="2" step=".01" value={selected.clip.gain} onChange={(event) => updateClip(selected.track.id, selected.clip.id, { gain: Number(event.target.value) })} /></label>
          <button className="button button-subtle" data-testid="button-split-clip" onClick={splitClip}>Split at playhead</button><button className="button button-subtle" data-testid="button-duplicate-clip" onClick={duplicateClip}>Duplicate</button><button className="button button-subtle danger-button" data-testid="button-delete-clip" onClick={() => removeClip(selected.clip.id)}><Trash2 size={13} /> Delete</button>
        </> : <div className="panel-empty">Select an audio clip to trim, fade, duplicate, or split it.</div>}
      </div>}
      {panel === "piano" && <div className="piano-panel">
        <div className="piano-tools">
          <label>Instrument<select data-testid="select-oscillator" value={selectedInstrument?.instrument?.waveform ?? "triangle"} onChange={(event) => selectedInstrument?.instrument && updateTrack(selectedInstrument.id, { instrument: { ...selectedInstrument.instrument, waveform: event.target.value as OscillatorType } })}>{["sine", "triangle", "square", "sawtooth"].map((wave) => <option key={wave}>{wave}</option>)}</select></label>
          <label>Attack<input data-testid="input-instrument-attack" type="number" min="0.001" max="4" step="0.001" value={selectedInstrument?.instrument?.attack ?? 0.01} onChange={(event) => updateInstrumentParameter("attack", Number(event.target.value))} /></label>
          <label>Decay<input data-testid="input-instrument-decay" type="number" min="0.001" max="4" step="0.001" value={selectedInstrument?.instrument?.decay ?? 0.12} onChange={(event) => updateInstrumentParameter("decay", Number(event.target.value))} /></label>
          <label>Sustain<input data-testid="input-instrument-sustain" type="number" min="0" max="1" step="0.01" value={selectedInstrument?.instrument?.sustain ?? 0.65} onChange={(event) => updateInstrumentParameter("sustain", Number(event.target.value))} /></label>
          <label>Release<input data-testid="input-instrument-release" type="number" min="0.005" max="4" step="0.005" value={selectedInstrument?.instrument?.release ?? 0.18} onChange={(event) => updateInstrumentParameter("release", Number(event.target.value))} /></label>
          <button className="button button-subtle" data-testid="button-add-midi-note" onClick={() => {
            if (!selectedInstrument) { setNotice("Select or add an instrument track to write MIDI."); return; }
            const note: MidiNote = { id: crypto.randomUUID(), pitch: 60, startBeat: Math.floor(snapshot.position / beatSeconds), durationBeats: 1, velocity: 92 };
            updateTrack(selectedInstrument.id, { notes: [...selectedInstrument.notes, note] });
            setSelectedNote(note.id);
          }}><Plus size={13} /> Add note</button>
          {selectedInstrument?.notes.some((note) => note.id === selectedNote) && <><label>Pitch<input data-testid="input-note-pitch" type="number" min="0" max="127" value={session.tracks.flatMap((track) => track.notes).find((note) => note.id === selectedNote)?.pitch ?? 60} onChange={(event) => { const note = session.tracks.flatMap((track) => track.notes).find((item) => item.id === selectedNote); if (note) { const owner = session.tracks.find((track) => track.notes.some((item) => item.id === note.id)); if (owner) updateNote(owner.id, note.id, { pitch: Math.round(clamp(Number(event.target.value), 0, 127)) }); } }} /></label>
            <label>Velocity<input data-testid="input-note-velocity" type="range" min="1" max="127" value={session.tracks.flatMap((track) => track.notes).find((note) => note.id === selectedNote)?.velocity ?? 92} onChange={(event) => { const note = session.tracks.flatMap((track) => track.notes).find((item) => item.id === selectedNote); const owner = session.tracks.find((track) => track.notes.some((item) => item.id === selectedNote)); if (note && owner) updateNote(owner.id, note.id, { velocity: Number(event.target.value) }); }} /></label>
            <button className="icon-button compact danger-hover" data-testid="button-delete-midi-note" title="Delete selected note" onClick={() => { setSession((current) => ({ ...current, tracks: current.tracks.map((track) => ({ ...track, notes: track.notes.filter((note) => note.id !== selectedNote) })) })); setSelectedNote(null); }}><Trash2 size={13} /></button></>}
        </div>
        <div className="piano-grid" ref={pianoGridRef} data-testid="piano-roll" onClick={(event) => {
          if ((event.target as HTMLElement).closest(".piano-key, .piano-note")) return;
          if (!selectedInstrument) { setNotice("Add an instrument track to create MIDI notes."); return; }
          const bounds = event.currentTarget.getBoundingClientRect();
          const beat = Math.max(0, (event.clientX - bounds.left + event.currentTarget.scrollLeft) / (beatSeconds * pixelsPerSecond));
          const pitch = clamp(127 - Math.floor((event.clientY - bounds.top + event.currentTarget.scrollTop) / 15), 0, 127);
          const note: MidiNote = { id: crypto.randomUUID(), pitch, startBeat: snap ? Math.round(beat * 4) / 4 : beat, durationBeats: 1, velocity: 90 };
          updateTrack(selectedInstrument.id, { notes: [...selectedInstrument.notes, note] });
          setSelectedNote(note.id);
        }}>
          {Array.from({ length: 128 }, (_, index) => <div key={index} className={`piano-row ${isBlackKey(127 - index) ? "black-key-row" : ""}`}><span className="piano-key">{pitchName(127 - index)}</span></div>)}
          {selectedInstrument?.notes.map((note) => <PianoNote key={note.id} note={note} selected={note.id === selectedNote} beatWidth={beatSeconds * pixelsPerSecond} snap={snap} onSelect={() => { setSelectedNote(note.id); setSelectedTrack(selectedInstrument.id); }} onChange={(update) => updateNote(selectedInstrument.id, note.id, update)} />)}
        </div>
        {!selectedInstrument && <div className="piano-hint">Choose an instrument track to edit notes. Click the grid to place a note.</div>}
      </div>}
      {panel === "effects" && <div className="effects-panel">
        <div className="effect-scope"><span>Track chain</span><select data-testid="select-effect-track" value={selectedTrack} onChange={(event) => setSelectedTrack(event.target.value)}>{session.tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}</select></div>
        <EffectChain effects={session.tracks.find((track) => track.id === selectedTrack)?.effects ?? []} testPrefix="track-effect" onAdd={(type) => addEffect(selectedTrack || null, type)} onChange={(id, update) => updateEffect(selectedTrack || null, id, update)} onParam={(effect, key, value) => updateEffectParameter(selectedTrack || null, effect, key, value)} onRemove={(id) => removeEffect(selectedTrack || null, id)} />
        <div className="effect-scope master-scope"><span>Master chain</span><EffectChain effects={session.masterEffects} testPrefix="master-effect" onAdd={(type) => addEffect(null, type)} onChange={(id, update) => updateEffect(null, id, update)} onParam={(effect, key, value) => updateEffectParameter(null, effect, key, value)} onRemove={(id) => removeEffect(null, id)} /></div>
      </div>}
      {panel === "devices" && <div className="devices-panel">
        <label>Audio input<select data-testid="select-audio-input" value={inputDevice} onChange={(event) => { setInputDevice(event.target.value); localStorage.setItem("prism.audioInput", event.target.value); }}>{inputDevices.map((device) => <option key={device.id} value={device.id}>{device.label}</option>)}</select></label>
          <label>Audio output<select data-testid="select-audio-output" value={outputDevice} onChange={(event) => {
          const selected = event.target.value;
          setOutputDevice(selected);
          void safe(async () => {
            if (selected && selected !== "default") await engine?.setOutputDevice(selected);
            else await engine?.setOutputDevice("default");
            localStorage.setItem("prism.audioOutput", selected);
          });
        }}>{outputDevices.map((device) => <option key={device.id} value={device.id}>{device.label}</option>)}</select></label>
        <label className="monitor-control"><input data-testid="input-monitoring" type="checkbox" checked={monitoring} onChange={(event) => { setMonitoring(event.target.checked); engine?.setMonitoring(event.target.checked); }} /> Input monitoring</label>
        <button className="button button-subtle" data-testid="button-refresh-devices" onClick={() => void engine?.listDevices().then(({ inputs, outputs }) => { setInputDevices(inputs); setOutputDevices(outputs); }).catch((cause: unknown) => setEngineError(cause instanceof Error ? cause.message : "Could not refresh devices."))}>Refresh devices</button>
        <div className="input-level" data-testid="status-input-level"><span>INPUT</span><MeterBar meter={snapshot.inputMeter} id="input" /></div>
        <div className="audio-device-state" data-testid="status-audio-engine">
          {snapshot.sampleRate ? `${Math.round(snapshot.sampleRate / 1000)} kHz` : "Audio engine starts on playback"}
          {snapshot.inputChannels ? ` · ${snapshot.inputChannels} input ch` : ""}
          {snapshot.baseLatency !== null ? ` · ${Math.round(snapshot.baseLatency * 1000)} ms base latency` : ""}
          {snapshot.outputLatency !== null ? ` · ${Math.round(snapshot.outputLatency * 1000)} ms output latency` : ""}
        </div>
        <div className="recording-hint" data-testid="status-recording-setup">Input monitoring can produce feedback or delay; headphones are recommended. {session.tracks.some((track) => track.recordArmed) ? "An audio track is armed. Press Record to capture input." : "Arm an audio track with R in the track header before recording."}</div>
      </div>}
    </section>
  </main>;
}

function ClipBlock({ clip, selected, pps, snap, snapStep, onSelect, onUpdate, onDelete }: {
  clip: AudioClip; selected: boolean; pps: number; snap: boolean; snapStep: number; onSelect: () => void;
  onUpdate: (update: Partial<AudioClip>) => void; onDelete: () => void;
}) {
  const drag = useRef<{ x: number; start: number; duration: number; edge: "move" | "left" | "right" } | null>(null);
  const [preview, setPreview] = useState<{ start: number; duration: number; source: number } | null>(null);
  const begin = (event: PointerEvent<HTMLElement>, edge: "move" | "left" | "right") => {
    event.preventDefault(); event.stopPropagation(); onSelect();
    drag.current = { x: event.clientX, start: clip.startSeconds, duration: clip.durationSeconds, edge };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current; if (!state) return;
    const delta = (event.clientX - state.x) / pps;
    const quantize = (value: number) => snap ? Math.max(0, Math.round(value / snapStep) * snapStep) : Math.max(0, value);
    if (state.edge === "move") setPreview({ start: quantize(state.start + delta), duration: state.duration, source: clip.sourceStartSeconds });
    else if (state.edge === "right") {
      const remainingSource = Math.max(.05, clip.sourceDurationSeconds - clip.sourceStartSeconds);
      setPreview({
        start: state.start,
        duration: Math.min(remainingSource, Math.max(.05, quantize(state.duration + delta))),
        source: clip.sourceStartSeconds,
      });
    }
    else {
      const shift = clamp(
        quantize(state.start + delta) - state.start,
        Math.max(-state.start, -clip.sourceStartSeconds),
        state.duration - .05,
      );
      setPreview({ start: state.start + shift, duration: state.duration - shift, source: clip.sourceStartSeconds + shift });
    }
  };
  const finish = () => {
    if (preview) onUpdate({ startSeconds: preview.start, durationSeconds: preview.duration, sourceStartSeconds: preview.source });
    setPreview(null); drag.current = null;
  };
  const start = preview?.start ?? clip.startSeconds;
  const width = preview?.duration ?? clip.durationSeconds;
  const sourceStart = preview?.source ?? clip.sourceStartSeconds;
  const sourceDuration = Math.max(clip.sourceDurationSeconds, sourceStart + width, .001);
  const waveformStart = Math.floor(sourceStart / sourceDuration * clip.waveform.length);
  const waveformEnd = Math.ceil((sourceStart + width) / sourceDuration * clip.waveform.length);
  const visibleWaveform = clip.waveform.slice(waveformStart, Math.max(waveformStart + 1, waveformEnd));
  return <div className={`audio-clip ${selected ? "selected" : ""}`} data-testid={`clip-${clip.id}`} style={{ left: `${start * pps}px`, width: `${Math.max(74, width * pps)}px` }} onClick={(event) => { event.stopPropagation(); onSelect(); }} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
    <button className="trim-edge trim-left" data-testid={`trim-left-${clip.id}`} aria-label="Trim clip start" onPointerDown={(event) => begin(event, "left")} />
    <div className="clip-body" onPointerDown={(event) => begin(event, "move")}><div className="clip-topline"><span className="clip-label">{clip.name}</span><button data-testid={`button-delete-clip-${clip.id}`} aria-label={`Delete ${clip.name}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onDelete(); }}><X size={12} /></button></div>
      <div className="waveform">{visibleWaveform.map((value, index) => <span key={index} style={{ height: `${Math.max(4, value * 82)}%` }} />)}</div>
      <span className="clip-duration">{formatSeconds(clip.durationSeconds)}</span><span className="clip-fades" style={{ "--fade-in": `${clip.fadeInSeconds / Math.max(clip.durationSeconds, .01) * 100}%`, "--fade-out": `${clip.fadeOutSeconds / Math.max(clip.durationSeconds, .01) * 100}%` } as CSSProperties} />
    </div>
    <button className="trim-edge trim-right" data-testid={`trim-right-${clip.id}`} aria-label="Trim clip end" onPointerDown={(event) => begin(event, "right")} />
  </div>;
}

function PianoNote({ note, selected, beatWidth, snap, onSelect, onChange }: {
  note: MidiNote; selected: boolean; beatWidth: number; snap: boolean; onSelect: () => void; onChange: (update: Partial<MidiNote>) => void;
}) {
  const drag = useRef<PianoNoteDragState | null>(null);
  const [offset, setOffset] = useState<{ startBeat: number; durationBeats: number; pitch: number } | null>(null);
  const start = offset?.startBeat ?? note.startBeat;
  const duration = offset?.durationBeats ?? note.durationBeats;
  const pitch = offset?.pitch ?? note.pitch;
  return <div className={`piano-note ${selected ? "selected" : ""}`} data-testid={`piano-note-${note.id}`} style={{ left: `${start * beatWidth}px`, width: `${Math.max(14, duration * beatWidth)}px`, top: `${(127 - pitch) * 15}px` }} onPointerDown={(event) => {
    event.stopPropagation(); event.preventDefault(); onSelect();
    drag.current = {
      pointerStartX: event.clientX,
      pointerStartY: event.clientY,
      startBeat: note.startBeat,
      durationBeats: note.durationBeats,
      pitch: note.pitch,
      resize: (event.target as HTMLElement).classList.contains("note-resize"),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }} onPointerMove={(event) => {
    if (!drag.current) return;
    setOffset(getPianoNoteDragUpdate(
      drag.current,
      event.clientX,
      event.clientY,
      beatWidth,
      snap,
    ));
  }} onPointerUp={() => {
    if (offset) onChange({
      startBeat: offset.startBeat,
      durationBeats: offset.durationBeats,
      pitch: offset.pitch,
    });
    setOffset(null); drag.current = null;
  }} onPointerCancel={() => {
    setOffset(null);
    drag.current = null;
  }}><span>{pitchName(pitch)}</span><i className="note-resize" /></div>;
}

function MeterBar({ meter, id }: { meter?: Meter; id: string }) {
  const peak = Math.max(0, Math.min(1, meter?.peak ?? 0));
  return <div className="mixer-meter" data-testid={`meter-${id}`} role="meter" aria-label={`${id} output level`} aria-valuemin={0} aria-valuemax={1} aria-valuenow={peak}><span style={{ transform: `scaleX(${peak})` }} /><i style={{ left: `${peak * 100}%` }} /></div>;
}

function EffectChain({ effects, testPrefix, onAdd, onChange, onParam, onRemove }: {
  effects: EffectState[]; testPrefix: string; onAdd: (type: EffectType) => void;
  onChange: (id: string, update: Partial<EffectState>) => void; onParam: (effect: EffectState, key: string, value: number) => void;
  onRemove: (id: string) => void;
}) {
  return <div className="effect-chain">
    <div className="effect-add">{(["equalizer", "reverb", "delay", "compressor"] as const).map((type) => <button key={type} className="button button-subtle" data-testid={`${testPrefix}-add-${type}`} onClick={() => onAdd(type)}><Plus size={12} />{effectLabels[type]}</button>)}</div>
    {effects.map((effect) => <div className={`effect-unit ${effect.enabled ? "enabled" : ""}`} key={effect.id}>
      <div className="effect-unit-head"><label><input data-testid={`${testPrefix}-toggle-${effect.id}`} type="checkbox" checked={effect.enabled} onChange={(event) => onChange(effect.id, { enabled: event.target.checked })} />{effectLabels[effect.type]}</label><button className="icon-button compact" data-testid={`${testPrefix}-remove-${effect.id}`} aria-label={`Remove ${effectLabels[effect.type]}`} onClick={() => onRemove(effect.id)}><X size={12} /></button></div>
      {Object.entries(effect.parameters).filter(([key]) => key !== "_remove").map(([key, value]) => {
        const limits = parameterLimits(effect.type, key);
        return <label className="effect-param" key={key}><span>{key}</span><input data-testid={`${testPrefix}-${effect.id}-${key}`} type="range" min={limits[0]} max={limits[1]} step={limits[2]} value={value} onChange={(event) => onParam(effect, key, Number(event.target.value))} /><small>{value.toFixed(value < 1 ? 2 : 0)}</small></label>;
      })}
    </div>)}
    {effects.length === 0 && <span className="effect-empty">Add an effect to shape this signal.</span>}
  </div>;
}

function parameterLimits(type: EffectType, key: string): [number, number, number] {
  if (type === "equalizer") return key === "frequency" ? [20, 20000, 10] : key === "gain" ? [-24, 24, .5] : [.1, 18, .1];
  if (type === "reverb") return key === "decay" ? [.15, 4, .05] : [0, 1, .01];
  if (type === "delay") return key === "time" ? [.01, 1.5, .01] : key === "feedback" ? [0, .85, .01] : [0, 1, .01];
  return key === "threshold" ? [-60, 0, 1] : key === "ratio" ? [1, 20, .5] : key === "attack" ? [.001, 1, .001] : key === "release" ? [.01, 2, .01] : [0, 40, 1];
}
function beatsPerBar(meter: string): number { const [top] = meter.split("/").map(Number); return top || 4; }
function clamp(value: number, low: number, high: number): number { return Math.max(low, Math.min(high, Number.isFinite(value) ? value : low)); }
function formatSeconds(seconds: number): string { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`; }
function pitchName(pitch: number): string { return `${["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][pitch % 12]}${Math.floor(pitch / 12) - 1}`; }
function isBlackKey(pitch: number): boolean { return [1, 3, 6, 8, 10].includes(pitch % 12); }
function waveformPeaks(buffer: AudioBuffer): number[] {
  const channel = buffer.getChannelData(0);
  return Array.from({ length: 112 }, (_, index) => {
    const from = Math.floor(index * channel.length / 112);
    const to = Math.max(from + 1, Math.floor((index + 1) * channel.length / 112));
    let peak = 0;
    for (let sample = from; sample < to; sample += 1) peak = Math.max(peak, Math.abs(channel[sample]));
    return peak;
  });
}
function appendRecordedClip(session: SongSession, clip: AudioClip, trackId?: string): SongSession {
  if (session.tracks.some((track) => track.clips.some((item) => item.id === clip.id))) return session;
  const track = session.tracks.find((item) => item.id === trackId) ??
    session.tracks.find((item) => item.recordArmed && item.type === "audio");
  if (!track) return session;
  return {
    ...session,
    tracks: session.tracks.map((item) => item.id === track.id
      ? { ...item, clips: [...item.clips, clip] }
      : item),
  };
}
