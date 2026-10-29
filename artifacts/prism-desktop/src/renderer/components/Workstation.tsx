import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import {
  AudioLines, Circle, CircleStop, Download, Headphones, Music2, Pause, Play, Plus,
  Keyboard, Redo2, Save, Settings2, SkipBack, SlidersHorizontal, Sparkles, Trash2, Undo2, Volume2, VolumeX, X,
} from "lucide-react";
import type {
  AudioClip,
  DrumPadState,
  InstrumentState,
  MidiNote,
  ProjectAsset,
  SongSession,
  TrackType,
  Track,
} from "@shared/types";
import { createDefaultDrumKit, createDefaultSamplerState } from "@shared/instrument-tracks";
import { AudioEngine, type AudioDevice, type AudioEngineSnapshot } from "../audio/AudioEngine";
import { secondsPerBeat } from "../audio/time";
import { getPianoNoteDragUpdate, splitMidiNoteAt, type PianoNoteDragState } from "./piano-roll";
import { EffectsPanel } from "./EffectsPanel";
import { RoutingPanel } from "./RoutingPanel";
import { SamplerPanel } from "./SamplerPanel";
import { DrumPanel } from "./DrumPanel";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { getAllowedBusTargets } from "@shared/audio-routing";
import prismLogo from "../assets/prism-logo.png";
import {
  activeShortcutContext,
  commandIsActive,
  findShortcutConflicts,
  formatShortcut,
  getShortcutPlatform,
  isEditableTarget,
  loadShortcutBindings,
  matchesShortcut,
  serializeShortcutProfile,
  shortcutRegistry,
  shortcutStorageKey,
  type ShortcutBindings,
  type ShortcutCommandId,
} from "../shortcuts";
import {
  createSessionHistory,
  recordSessionSnapshot,
  redoSessionHistory,
  sessionHistoryAvailability,
  undoSessionHistory,
} from "../session-history";

type WorkstationProps = {
  session: SongSession;
  releaseTitle: string;
  onBack: () => void;
  onHome: () => void;
  onSettings: () => void;
};
type Meter = { peak: number; rms: number };
type ContextMenuTarget =
  | { kind: "clip"; clipId: string; trackId: string }
  | { kind: "note"; noteId: string; trackId: string };
type ContextMenuState = ContextMenuTarget & { x: number; y: number };
const colors = ["#d7a568", "#77a99e", "#a58ac4", "#c77979", "#829fc2"];
const emptySnapshot: AudioEngineSnapshot = {
  status: "stopped",
  error: null,
  recording: false,
  position: 0,
  sampleRate: null,
  baseLatency: null,
  outputLatency: null,
  meters: {},
  sampleErrors: [],
  inputMeter: { peak: 0, rms: 0 },
  inputChannels: null,
};
const historyLimit = 50;
type EditTool = "select" | "draw" | "erase" | "split";

export function Workstation({ session: initialSession, releaseTitle, onBack, onHome, onSettings }: WorkstationProps) {
  const [session, setSession] = useState(initialSession);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [saveError, setSaveError] = useState("");
  const [engineError, setEngineError] = useState("");
  const [engine, setEngine] = useState<AudioEngine | null>(null);
  const [snapshot, setSnapshot] = useState<AudioEngineSnapshot>(emptySnapshot);
  const [selectedTrack, setSelectedTrack] = useState(initialSession.tracks[0]?.id ?? "");
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [recoveryDismissedTrackId, setRecoveryDismissedTrackId] = useState("");
  const [dismissedSnapshotError, setDismissedSnapshotError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [snap, setSnap] = useState(true);
  const [inputDevices, setInputDevices] = useState<AudioDevice[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([]);
  const [audioAssets, setAudioAssets] = useState<ProjectAsset[]>([]);
  const [audioAssetsLoading, setAudioAssetsLoading] = useState(true);
  const [inputDevice, setInputDevice] = useState(() => localStorage.getItem("prism.audioInput") ?? "");
  const [outputDevice, setOutputDevice] = useState(() => localStorage.getItem("prism.audioOutput") ?? "");
  const [monitoring, setMonitoring] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState("");
  const [panel, setPanel] = useState<"mixer" | "clip" | "piano" | "sampler" | "drums" | "effects" | "routing" | "devices">("mixer");
  const [selectedEffectBusId, setSelectedEffectBusId] = useState("");
  const [notice, setNotice] = useState("");
  const [historyAvailability, setHistoryAvailability] = useState({ canUndo: false, canRedo: false });
  const [shortcutDialogOpen, setShortcutDialogOpen] = useState(false);
  const [shortcutSettings, setShortcutSettings] = useState(loadShortcutBindings);
  const [shortcutBindings, setShortcutBindings] = useState(shortcutSettings.bindings);
  const [editTool, setEditTool] = useState<EditTool>("select");
  const [openCommandMenu, setOpenCommandMenu] = useState<"edit" | "view" | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const pianoGridRef = useRef<HTMLDivElement>(null);
  const history = useRef(createSessionHistory(initialSession));
  const commandExecutor = useRef<(commandId: ShortcutCommandId) => void>(() => {});
  const shortcutStateRef = useRef({
    bindings: shortcutBindings, panel, dialogOpen: shortcutDialogOpen,
    menuOpen: openCommandMenu, contextMenu,
  });
  shortcutStateRef.current = {
    bindings: shortcutBindings, panel, dialogOpen: shortcutDialogOpen,
    menuOpen: openCommandMenu, contextMenu,
  };
  const platform = getShortcutPlatform(navigator.platform || navigator.userAgent);
  const beatSeconds = secondsPerBeat(session.tempo, session.timeSignature);
  const barSeconds = beatSeconds * beatsPerBar(session.timeSignature);
  const pixelsPerSecond = 54 * zoom;
  const clips = useMemo(() => session.tracks.flatMap((track) => track.clips.map((clip) => ({ track, clip }))), [session.tracks]);
  const duration = Math.max(16, ...clips.map(({ clip }) => clip.startSeconds + clip.durationSeconds), ...session.tracks.flatMap((track) => track.notes.map((note) => (note.startBeat + note.durationBeats) * beatSeconds)));
  const selected = clips.find(({ clip }) => clip.id === selectedClip);
  const selectedTrackData = session.tracks.find((track) => track.id === selectedTrack);
  const selectedInstrument = session.tracks.find((track) => track.id === selectedTrack && track.type === "instrument");
  const selectedSamplerTrack = session.tracks.find((track) => track.id === selectedTrack && track.type === "sampler");
  const selectedDrumTrack = session.tracks.find((track) => track.id === selectedTrack && track.type === "drum");
  const selectedPatternTrack = session.tracks.find((track) =>
    track.id === selectedTrack &&
    ["instrument", "sampler", "drum", "unsupported"].includes(track.type),
  );
  const selectedPatternNote = selectedPatternTrack?.notes.find((note) => note.id === selectedNote);
  const recoveryMessage = selectedTrackData?.id !== recoveryDismissedTrackId
    ? selectedTrackData?.instrumentRecovery?.message ?? ""
    : "";
  const visibleSnapshotError = snapshot.error && snapshot.error !== dismissedSnapshotError
    ? snapshot.error
    : "";

  useEffect(() => {
    if (panel !== "piano" || !pianoGridRef.current) return;
    const pitch = selectedInstrument?.notes.find((note) => note.id === selectedNote)?.pitch ?? 60;
    pianoGridRef.current.scrollTop = Math.max(0, (127 - pitch) * 15 - 45);
  }, [panel, selectedTrack, selectedNote]);

  useEffect(() => {
    history.current = createSessionHistory(initialSession);
    setHistoryAvailability({ canUndo: false, canRedo: false });
    if (session.id !== initialSession.id) {
      setSession(initialSession);
      setSelectedTrack(initialSession.tracks[0]?.id ?? "");
    }
    setSelectedClip(null);
    setSelectedNote(null);
    setSnapshot({ ...emptySnapshot });
  }, [initialSession.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      history.current = recordSessionSnapshot(history.current, session, historyLimit);
      setHistoryAvailability(sessionHistoryAvailability(history.current));
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
    let cancelled = false;
    setAudioAssetsLoading(true);
    void window.prism.listAudioAssets().then((assets) => {
      if (!cancelled) setAudioAssets(assets);
    }).catch((cause: unknown) => {
      if (!cancelled) setEngineError(cause instanceof Error ? cause.message : "Audio samples could not be listed.");
    }).finally(() => {
      if (!cancelled) setAudioAssetsLoading(false);
    });
    return () => { cancelled = true; };
  }, [initialSession.id]);

  useEffect(() => {
    if (!snapshot.error) setDismissedSnapshotError("");
  }, [snapshot.error]);

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
  const addMidiNote = (trackId: string, pitch: number, durationBeats = 1) => {
    const track = session.tracks.find((item) => item.id === trackId);
    if (!track || !["instrument", "sampler", "drum"].includes(track.type)) {
      setNotice("Choose a supported MIDI instrument track before adding a note.");
      return;
    }
    const beat = snapshot.position / beatSeconds;
    const startBeat = snap ? Math.round(beat * 4) / 4 : beat;
    const note: MidiNote = {
      id: crypto.randomUUID(),
      pitch: Math.round(clamp(pitch, 0, 127)),
      startBeat,
      durationBeats,
      velocity: 92,
    };
    updateTrack(track.id, { notes: [...track.notes, note] });
    setSelectedNote(note.id);
    setPanel("piano");
  };
  const previewSampleNote = (trackId: string, pitch: number) => safe(async () => {
    if (engine) await engine.previewInstrumentNote(session, trackId, pitch);
  });
  const recoverUnsupportedTrack = (trackId: string) => {
    updateTrack(trackId, {
      type: "instrument",
      instrument: { waveform: "triangle", attack: 0.015, decay: 0.12, sustain: 0.62, release: 0.18 },
      sampler: null,
      drumKit: null,
    });
    setRecoveryDismissedTrackId(trackId);
    setPanel("piano");
    setNotice("Recovered as a built-in synth. The original unsupported state and MIDI notes remain saved.");
  };
  const importSampleForTrack = (trackId: string, padId?: string) => safe(async () => {
    const asset = await window.prism.importSample();
    if (!asset) return;
    setAudioAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
    setSession((current) => ({
      ...current,
      tracks: current.tracks.map((track) => {
        if (track.id !== trackId) return track;
        if (track.type === "sampler") {
          return {
            ...track,
            sampler: { ...(track.sampler ?? createDefaultSamplerState()), sampleAssetId: asset.id },
          };
        }
        if (track.type === "drum" && padId) {
          const kit = track.drumKit ?? createDefaultDrumKit();
          return {
            ...track,
            drumKit: {
              ...kit,
              pads: kit.pads.map((pad) => pad.id === padId ? { ...pad, sampleAssetId: asset.id } : pad),
            },
          };
        }
        return track;
      }),
    }));
    setNotice(`Loaded ${asset.fileName}. Its source is stored in the project library.`);
  });
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
  const addTrack = (type: Extract<TrackType, "audio" | "instrument" | "sampler" | "drum">) => {
    const number = session.tracks.filter((track) => track.type === type).length + 1;
    const track: Track = {
      id: crypto.randomUUID(),
      name: type === "audio" ? `Audio ${number}`
        : type === "instrument" ? `Instrument ${number}`
          : type === "sampler" ? `Sampler ${number}` : `Drums ${number}`,
      type, color: colors[session.tracks.length % colors.length], volume: 0.82, pan: 0,
      muted: false, solo: false, recordArmed: false, clips: [], notes: [],
      instrument: type === "instrument" ? { waveform: "triangle", attack: 0.015, decay: 0.12, sustain: 0.62, release: 0.18 } : null,
      sampler: type === "sampler" ? createDefaultSamplerState() : null,
      drumKit: type === "drum" ? createDefaultDrumKit() : null,
      instrumentRecovery: null,
      effects: [], outputBusId: null, sends: [],
    };
    setSession((current) => ({ ...current, tracks: [...current.tracks, track] }));
    setSelectedTrack(track.id);
    setPanel(type === "instrument" ? "piano"
      : type === "sampler" ? "sampler"
        : type === "drum" ? "drums" : "mixer");
  };
  const selectTrack = (track: Track) => {
    setSelectedTrack(track.id);
    setPanel(track.type === "sampler" ? "sampler"
      : track.type === "drum" ? "drums"
        : track.type === "instrument" || track.type === "unsupported" ? "piano" : "mixer");
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
    history.current = recordSessionSnapshot(history.current, session, historyLimit);
    const result = undoSessionHistory(history.current);
    if (!result.value) return;
    history.current = result.history;
    setSession(result.value);
    setHistoryAvailability(sessionHistoryAvailability(history.current));
  };
  const redo = () => {
    if (recording) return;
    history.current = recordSessionSnapshot(history.current, session, historyLimit);
    const result = redoSessionHistory(history.current);
    if (!result.value) return;
    history.current = result.history;
    setSession(result.value);
    setHistoryAvailability(sessionHistoryAvailability(history.current));
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
  const removeNote = (noteId: string) => {
    setSession((current) => ({
      ...current,
      tracks: current.tracks.map((track) => ({ ...track, notes: track.notes.filter((note) => note.id !== noteId) })),
    }));
    if (selectedNote === noteId) setSelectedNote(null);
  };
  const duplicateNote = (noteId = selectedNote) => {
    if (!noteId) return;
    const source = session.tracks
      .map((track) => ({ track, note: track.notes.find((item) => item.id === noteId) }))
      .find((item) => item.note);
    if (!source?.note) return;
    const copy: MidiNote = {
      ...source.note,
      id: crypto.randomUUID(),
      startBeat: source.note.startBeat + Math.max(0.25, source.note.durationBeats),
    };
    setSession((current) => ({
      ...current,
      tracks: current.tracks.map((track) => track.id === source.track.id
        ? { ...track, notes: [...track.notes, copy] }
        : track),
    }));
    setSelectedTrack(source.track.id);
    setSelectedNote(copy.id);
    setPanel("piano");
  };
  const nudgeSelectedNote = (beatDelta: number, pitchDelta: number) => {
    if (!selectedNote) return;
    const track = session.tracks.find((item) => item.id === selectedTrack);
    const note = track?.notes.find((item) => item.id === selectedNote);
    if (!track || !note) return;
    updateNote(track.id, note.id, {
      startBeat: Math.max(0, snap ? Math.round((note.startBeat + beatDelta) * 4) / 4 : note.startBeat + beatDelta),
      pitch: clamp(note.pitch + pitchDelta, 0, 127),
    });
  };
  const splitMidiNote = (noteId = selectedNote) => {
    if (!noteId) return;
    const source = session.tracks
      .map((track) => ({ track, note: track.notes.find((item) => item.id === noteId) }))
      .find((item) => item.note);
    if (!source?.note) return;
    const playheadBeat = snapshot.position / beatSeconds;
    const cutBeat = snap ? Math.round(playheadBeat * 4) / 4 : playheadBeat;
    const parts = splitMidiNoteAt(source.note, cutBeat, crypto.randomUUID());
    if (!parts) {
      setNotice("Place the playhead at least a quarter beat inside the selected MIDI note to split it.");
      return;
    }
    setSession((current) => ({
      ...current,
      tracks: current.tracks.map((track) => track.id === source.track.id
        ? {
          ...track,
          notes: [...track.notes.map((note) => note.id === source.note!.id ? parts.left : note), parts.right],
        }
        : track),
    }));
    setSelectedTrack(source.track.id);
    setSelectedNote(parts.right.id);
    setNotice("");
  };
  const duplicateClipById = (clipId = selectedClip) => {
    if (!clipId) return;
    const source = session.tracks
      .map((track) => ({ track, clip: track.clips.find((item) => item.id === clipId) }))
      .find((item) => item.clip);
    if (!source?.clip) return;
    const copy = { ...source.clip, id: crypto.randomUUID(), startSeconds: source.clip.startSeconds + source.clip.durationSeconds };
    setSession((current) => ({ ...current, tracks: current.tracks.map((track) => track.id === source.track.id ? { ...track, clips: [...track.clips, copy] } : track) }));
    setSelectedClip(copy.id);
    setSelectedTrack(source.track.id);
  };
  const duplicateClip = () => {
    duplicateClipById();
  };
  const splitClipById = (clipId = selectedClip) => {
    if (!clipId) return;
    const source = session.tracks
      .map((track) => ({ track, clip: track.clips.find((item) => item.id === clipId) }))
      .find((item) => item.clip);
    if (!source?.clip) return;
    const { clip, track } = source;
    const cut = snapshot.position - clip.startSeconds;
    if (cut <= 0.02 || cut >= clip.durationSeconds - 0.02) { setNotice("Place the playhead inside the selected clip to split it."); return; }
    const right = { ...clip, id: crypto.randomUUID(), startSeconds: snapshot.position, durationSeconds: clip.durationSeconds - cut, sourceStartSeconds: clip.sourceStartSeconds + cut, fadeInSeconds: 0 };
    setSession((current) => ({
      ...current,
      tracks: current.tracks.map((item) => item.id === track.id ? {
        ...item,
        clips: [...item.clips.map((itemClip) => itemClip.id === clip.id
          ? { ...itemClip, durationSeconds: cut, fadeOutSeconds: 0 }
          : itemClip), right],
      } : item),
    }));
    setSelectedClip(right.id);
    setSelectedTrack(track.id);
  };
  const splitClip = () => {
    splitClipById();
  };
  const exportWav = () => safe(async () => {
    if (!engine) return;
    setBusy("export");
    try {
      const ok = await engine.exportWav(session);
      setNotice(ok ? "WAV export is ready in your chosen location." : "WAV export was cancelled.");
    } finally { setBusy(""); }
  });

  const createMidiNoteAt = (trackId: string, beat: number, pitch: number) => {
    const track = session.tracks.find((item) => item.id === trackId);
    if (!track || !["instrument", "sampler", "drum"].includes(track.type)) {
      setNotice("Choose a supported MIDI track before drawing a note.");
      return;
    }
    const startBeat = snap ? Math.round(beat * 4) / 4 : beat;
    const note: MidiNote = {
      id: crypto.randomUUID(),
      pitch: Math.round(clamp(pitch, 0, 127)),
      startBeat: Math.max(0, startBeat),
      durationBeats: 1,
      velocity: 90,
    };
    setSession((current) => ({
      ...current,
      tracks: current.tracks.map((item) => item.id === track.id
        ? { ...item, notes: [...item.notes, note] }
        : item),
    }));
    setSelectedTrack(track.id);
    setSelectedNote(note.id);
    setNotice("");
  };

  const moveTrackSelection = (direction: -1 | 1) => {
    const ids = session.tracks.map((track) => track.id);
    if (ids.length === 0) return;
    const currentIndex = ids.indexOf(selectedTrack);
    const origin = currentIndex < 0 ? (direction > 0 ? -1 : 0) : currentIndex;
    setSelectedTrack(ids[(origin + direction + ids.length) % ids.length]);
  };

  const executeCommand = (commandId: ShortcutCommandId) => {
    setOpenCommandMenu(null);
    switch (commandId) {
      case "transport.toggle": void play(); break;
      case "transport.stop": void stop(); break;
      case "transport.home":
        void safe(async () => {
          if (recording) await engine?.stopRecording();
          engine?.stop(true);
          setRecording(false);
          setSnapshot((old) => ({ ...old, status: "stopped", position: 0 }));
        });
        break;
      case "transport.stepBack": seek(snapshot.position - beatSeconds / 4); break;
      case "transport.stepForward": seek(snapshot.position + beatSeconds / 4); break;
      case "project.save": void saveNow(); break;
      case "project.library": void leave(onHome); break;
      case "edit.undo": undo(); break;
      case "edit.redo": redo(); break;
      case "edit.duplicate":
        if (activeShortcutContext(panel) === "piano") duplicateNote();
        else duplicateClip();
        break;
      case "edit.delete":
        if (activeShortcutContext(panel) === "piano") {
          if (selectedNote) removeNote(selectedNote);
        } else if (selectedClip) removeClip(selectedClip);
        break;
      case "edit.split":
        if (activeShortcutContext(panel) === "piano") splitMidiNote();
        else splitClip();
        break;
      case "edit.addNote":
        if (selectedPatternTrack) {
          const pitch = selectedPatternTrack.type === "sampler"
            ? selectedPatternTrack.sampler?.rootNote ?? 60
            : selectedPatternTrack.type === "drum"
              ? selectedPatternTrack.drumKit?.pads[0]?.note ?? 36
              : 60;
          addMidiNote(selectedPatternTrack.id, pitch);
        }
        break;
      case "edit.toggleSnap": setSnap((current) => !current); break;
      case "edit.nudgeLeft": nudgeSelectedNote(-0.25, 0); break;
      case "edit.nudgeRight": nudgeSelectedNote(0.25, 0); break;
      case "edit.nudgeUp": nudgeSelectedNote(0, 1); break;
      case "edit.nudgeDown": nudgeSelectedNote(0, -1); break;
      case "tool.select": setEditTool("select"); break;
      case "tool.draw": setEditTool("draw"); break;
      case "tool.erase": setEditTool("erase"); break;
      case "tool.split": setEditTool("split"); break;
      case "view.zoomIn": setZoom((current) => clamp(current + 0.1, 0.5, 2.4)); break;
      case "view.zoomOut": setZoom((current) => clamp(current - 0.1, 0.5, 2.4)); break;
      case "view.zoomReset": setZoom(1); break;
      case "panel.mixer": setPanel("mixer"); break;
      case "panel.piano": setPanel("piano"); break;
      case "panel.effects": setSelectedEffectBusId(""); setPanel("effects"); break;
      case "panel.routing": setPanel("routing"); break;
      case "mixer.previousTrack": moveTrackSelection(-1); break;
      case "mixer.nextTrack": moveTrackSelection(1); break;
      case "effects.previousTrack": setSelectedEffectBusId(""); moveTrackSelection(-1); break;
      case "effects.nextTrack": setSelectedEffectBusId(""); moveTrackSelection(1); break;
      case "help.shortcuts": setShortcutDialogOpen(true); break;
    }
  };
  commandExecutor.current = executeCommand;

  useEffect(() => {
    if (shortcutSettings.error) setNotice(shortcutSettings.error);
  }, []);

  const applyShortcutProfile = (next: ShortcutBindings) => {
    if (findShortcutConflicts(next).length > 0) {
      setNotice("Resolve shortcut conflicts before applying the profile.");
      return;
    }
    try {
      localStorage.setItem(shortcutStorageKey, serializeShortcutProfile(next));
      setShortcutBindings(next);
      setShortcutSettings({ bindings: next, error: "" });
      setShortcutDialogOpen(false);
      setNotice("Keyboard shortcuts saved on this computer.");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "The shortcut profile could not be saved.");
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[role="dialog"]'))) return;
      if (shortcutStateRef.current.dialogOpen) return;
      if (event.key === "Escape" && (shortcutStateRef.current.menuOpen || shortcutStateRef.current.contextMenu)) {
        event.preventDefault();
        setOpenCommandMenu(null);
        setContextMenu(null);
        return;
      }
      if (isEditableTarget(event.target)) return;
      const element = event.target as Element | null;
      if (event.key === " " && typeof element?.closest === "function" &&
          element.closest("button, a, [role='button']")) return;
      const context = activeShortcutContext(shortcutStateRef.current.panel);
      const command = shortcutRegistry.find((item) =>
        commandIsActive(item, context) &&
        matchesShortcut(event, shortcutStateRef.current.bindings[item.id], platform),
      );
      if (!command) return;
      const repeatable = [
        "transport.stepBack", "transport.stepForward",
        "edit.nudgeLeft", "edit.nudgeRight", "edit.nudgeUp", "edit.nudgeDown",
        "view.zoomIn", "view.zoomOut",
      ];
      if (event.repeat && !repeatable.includes(command.id)) return;
      event.preventDefault();
      commandExecutor.current(command.id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [platform]);

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
      <nav className="workstation-command-menus" aria-label="Workstation menus">
        <button className="command-menu-trigger workstation-settings-trigger" type="button" onClick={onSettings} aria-label="Open settings" title="Settings"><Settings2 size={14} /><span>Settings</span></button>
        <div className="command-menu-wrap">
          <button className="command-menu-trigger" type="button" data-testid="menu-edit" aria-haspopup="menu" aria-expanded={openCommandMenu === "edit"} onClick={() => setOpenCommandMenu((current) => current === "edit" ? null : "edit")}>Edit</button>
          {openCommandMenu === "edit" && <div className="workstation-command-menu" role="menu">
            <button role="menuitem" onClick={() => executeCommand("edit.undo")} disabled={!historyAvailability.canUndo || recording}>Undo <kbd>{formatShortcut(shortcutBindings["edit.undo"], platform)}</kbd></button>
            <button role="menuitem" onClick={() => executeCommand("edit.redo")} disabled={!historyAvailability.canRedo || recording}>Redo <kbd>{formatShortcut(shortcutBindings["edit.redo"], platform)}</kbd></button>
            <hr />
            <button role="menuitem" onClick={() => executeCommand("edit.duplicate")}>Duplicate</button>
            <button role="menuitem" onClick={() => executeCommand("edit.delete")}>Delete</button>
            <button role="menuitem" onClick={() => executeCommand("edit.split")}>Split selection at playhead</button>
            <button role="menuitem" onClick={() => executeCommand("edit.toggleSnap")}>{snap ? "Disable snap" : "Enable snap"}</button>
            <hr />
            <button role="menuitem" onClick={() => executeCommand("tool.select")}>Select tool</button>
            <button role="menuitem" onClick={() => executeCommand("tool.draw")}>Draw tool</button>
            <button role="menuitem" onClick={() => executeCommand("tool.erase")}>Erase tool</button>
            <button role="menuitem" onClick={() => executeCommand("tool.split")}>Split tool</button>
          </div>}
        </div>
        <div className="command-menu-wrap">
          <button className="command-menu-trigger" type="button" data-testid="menu-view" aria-haspopup="menu" aria-expanded={openCommandMenu === "view"} onClick={() => setOpenCommandMenu((current) => current === "view" ? null : "view")}>View</button>
          {openCommandMenu === "view" && <div className="workstation-command-menu" role="menu">
            <button role="menuitem" onClick={() => executeCommand("view.zoomIn")}>Zoom in</button>
            <button role="menuitem" onClick={() => executeCommand("view.zoomOut")}>Zoom out</button>
            <button role="menuitem" onClick={() => executeCommand("view.zoomReset")}>Reset zoom</button>
            <hr />
            <button role="menuitem" onClick={() => executeCommand("panel.mixer")}>Mixer</button>
            <button role="menuitem" onClick={() => executeCommand("panel.piano")}>Piano roll</button>
            <button role="menuitem" onClick={() => executeCommand("panel.effects")}>Effects</button>
            <button role="menuitem" onClick={() => executeCommand("panel.routing")}>Routing</button>
            <hr />
            <button role="menuitem" onClick={() => executeCommand("help.shortcuts")}><Keyboard size={13} /> Keyboard shortcuts</button>
          </div>}
        </div>
      </nav>
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

    {(engineError || saveError || recoveryMessage || visibleSnapshotError || notice) && <div className={`workstation-notice ${engineError || saveError || recoveryMessage || visibleSnapshotError ? "error-notice" : ""}`} role={engineError || saveError || recoveryMessage || visibleSnapshotError ? "alert" : "status"} data-testid="status-workstation-message">
      <span>{engineError || saveError || recoveryMessage || visibleSnapshotError || notice}</span>
      {recoveryMessage && selectedTrackData?.type === "unsupported" && <button className="button button-subtle recovery-action" data-testid="button-recover-unsupported-track" onClick={() => recoverUnsupportedTrack(selectedTrackData.id)}>Recover as synth</button>}
      <button data-testid="button-dismiss-message" aria-label="Dismiss message" onClick={() => { setEngineError(""); setSaveError(""); setNotice(""); setRecoveryDismissedTrackId(selectedTrack); setDismissedSnapshotError(snapshot.error ?? ""); }}><X size={14} /></button>
    </div>}

    <section className="arrangement">
      <div className="arrangement-toolbar">
        <div className="arrangement-tools"><span className="panel-label">ARRANGEMENT</span>
          <div className="edit-tool-group" role="group" aria-label="Editing tool">
            {(["select", "draw", "erase", "split"] as const).map((tool) => <button
              key={tool}
              className={`edit-tool-button ${editTool === tool ? "active" : ""}`}
              type="button"
              data-testid={`button-tool-${tool}`}
              aria-label={`${tool[0].toUpperCase()}${tool.slice(1)} tool`}
              aria-pressed={editTool === tool}
              onClick={() => setEditTool(tool)}
            >{tool[0].toUpperCase()}{tool.slice(1)}</button>)}
          </div>
          <button className="icon-button compact" data-testid="button-undo" aria-label="Undo edit" title={`Undo (${formatShortcut(shortcutBindings["edit.undo"], platform)})`} disabled={!historyAvailability.canUndo || recording} onClick={undo}><Undo2 size={14} /></button>
          <button className="icon-button compact" data-testid="button-redo" aria-label="Redo edit" title={`Redo (${formatShortcut(shortcutBindings["edit.redo"], platform)})`} disabled={!historyAvailability.canRedo || recording} onClick={redo}><Redo2 size={14} /></button>
          <button className="button button-subtle" data-testid="button-import-audio" onClick={() => void importAudio()}><Plus size={14} /> Import audio</button>
          <button className="button button-subtle" data-testid="button-add-audio-track" onClick={() => addTrack("audio")}><Plus size={14} /> Audio track</button>
          <button className="button button-subtle" data-testid="button-add-instrument-track" onClick={() => addTrack("instrument")}><Music2 size={14} /> Instrument</button>
          <button className="button button-subtle" data-testid="button-add-sampler-track" onClick={() => addTrack("sampler")}><AudioLines size={14} /> Sampler</button>
          <button className="button button-subtle" data-testid="button-add-drum-track" onClick={() => addTrack("drum")}><Music2 size={14} /> Drums</button>
          <label className="snap-toggle"><input data-testid="input-snap" type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} /> Snap</label>
          <button className="icon-button compact" type="button" data-testid="button-open-shortcuts" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={() => setShortcutDialogOpen(true)}><Keyboard size={14} /></button>
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
              <button className="track-name" data-testid={`button-rename-track-${track.id}`} title="Rename track" onClick={() => { const name = window.prompt("Track name", track.name); if (name?.trim()) updateTrack(track.id, { name: name.trim() }); selectTrack(track); }}>{track.name}</button>
              <small className="track-kind">{track.type === "instrument" ? "INSTRUMENT" : track.type === "sampler" ? "SAMPLER" : track.type === "drum" ? "DRUM KIT" : track.type === "unsupported" ? "UNSUPPORTED" : "AUDIO"}</small>
              <div className="track-buttons">
                <button className={`track-toggle ${track.muted ? "active" : ""}`} data-testid={`button-mute-${track.id}`} aria-label={`${track.muted ? "Unmute" : "Mute"} ${track.name}`} aria-pressed={track.muted} onClick={() => updateTrack(track.id, { muted: !track.muted })}>{track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}</button>
                <button className={`track-toggle ${track.solo ? "solo-active" : ""}`} data-testid={`button-solo-${track.id}`} aria-label={`${track.solo ? "Unsolo" : "Solo"} ${track.name}`} aria-pressed={track.solo} onClick={() => updateTrack(track.id, { solo: !track.solo })}>S</button>
                {track.type === "audio" && <button className={`track-toggle arm-toggle ${track.recordArmed ? "armed" : ""}`} data-testid={`button-arm-${track.id}`} aria-label={`${track.recordArmed ? "Disarm" : "Arm"} ${track.name}`} aria-pressed={track.recordArmed} onClick={() => updateTrack(track.id, { recordArmed: !track.recordArmed })}>R</button>}
                <button className="track-toggle danger-hover" data-testid={`button-delete-track-${track.id}`} aria-label={`Delete ${track.name}`} title="Remove track" disabled={recording} onClick={() => removeTrack(track.id)}><Trash2 size={12} /></button>
              </div>
              <label className="track-level"><span>VOL</span><input data-testid={`input-track-volume-${track.id}`} aria-label={`${track.name} volume`} type="range" min="0" max="1.25" step=".01" value={track.volume} onChange={(event) => updateTrack(track.id, { volume: Number(event.target.value) })} /><small>{Math.round(track.volume * 100)}</small></label>
              <label className="track-pan"><span>PAN</span><input data-testid={`input-track-pan-${track.id}`} aria-label={`${track.name} pan`} type="range" min="-1" max="1" step=".01" value={track.pan} onChange={(event) => updateTrack(track.id, { pan: Number(event.target.value) })} /></label>
            </div>
            <div className={`timeline-lane tool-${editTool}`} onClick={(event) => {
              if ((event.target as HTMLElement).closest(".audio-clip, .midi-note")) return;
              selectTrack(track);
              const bounds = event.currentTarget.getBoundingClientRect();
              const seconds = Math.max(0, (event.clientX - bounds.left) / pixelsPerSecond);
              if (editTool === "draw") {
                const pitch = 127 - Math.floor((event.clientY - bounds.top) / 0.62);
                createMidiNoteAt(track.id, seconds / beatSeconds, pitch);
                return;
              }
              if (editTool !== "erase") seek(seconds);
            }}>
              {Array.from({ length: Math.ceil(duration / barSeconds) + 2 }, (_, index) => <div key={index} className="lane-gridline" style={{ left: `${index * barSeconds * pixelsPerSecond}px` }} />)}
              {track.clips.map((clip) => <ClipBlock key={clip.id} clip={clip} selected={selectedClip === clip.id} pps={pixelsPerSecond} snapStep={beatSeconds / 4} snap={snap} tool={editTool} onSelect={() => { setSelectedTrack(track.id); setSelectedClip(clip.id); setPanel("clip"); }} onUpdate={(update) => updateClip(track.id, clip.id, update)} onDelete={() => removeClip(clip.id)} onSplit={() => splitClipById(clip.id)} onContextMenu={(x, y) => { setSelectedTrack(track.id); setSelectedClip(clip.id); setPanel("clip"); setContextMenu({ kind: "clip", clipId: clip.id, trackId: track.id, x, y }); }} />)}
              {["instrument", "sampler", "drum", "unsupported"].includes(track.type) && track.notes.map((note) => <div key={note.id} className={`midi-note ${selectedNote === note.id ? "selected" : ""} ${editTool === "erase" ? "eraser-target" : ""}`} data-testid={`note-${note.id}`} style={{ left: `${note.startBeat * beatSeconds * pixelsPerSecond}px`, width: `${Math.max(12, note.durationBeats * beatSeconds * pixelsPerSecond)}px`, top: `${Math.max(3, (127 - note.pitch) * .62)}px` }} onClick={(event) => { event.stopPropagation(); if (editTool === "erase") { removeNote(note.id); return; } if (editTool === "split") { splitMidiNote(note.id); return; } setSelectedTrack(track.id); setSelectedNote(note.id); setPanel("piano"); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setSelectedTrack(track.id); setSelectedNote(note.id); setPanel("piano"); setContextMenu({ kind: "note", noteId: note.id, trackId: track.id, x: event.clientX, y: event.clientY }); }} title={`${pitchName(note.pitch)} · velocity ${note.velocity}`} />)}
              <div className="playhead" style={{ left: `${snapshot.position * pixelsPerSecond}px` }} />
            </div>
          </div>)}
          {session.tracks.length === 0 && <div className="timeline-empty"><Music2 size={22} /><strong>Start with a track</strong><span>Import audio or create an instrument lane.</span></div>}
        </div>
      </div>
      <div className="arrangement-footer"><span>{session.tracks.length} {session.tracks.length === 1 ? "track" : "tracks"}</span><span>Local project audio · {session.timeSignature} · {session.tempo} BPM</span></div>
    </section>

    <section className={`workstation-bottom ${panel === "effects" ? "effects-open" : ""} ${panel === "routing" ? "routing-open" : ""} ${panel === "sampler" ? "sampler-open" : ""} ${panel === "drums" ? "drums-open" : ""}`}>
      <nav className="lower-panel-tabs" aria-label="Workstation panels">
        {(["mixer", "clip", "piano", "sampler", "drums", "effects", "routing", "devices"] as const).map((tab) => <button key={tab} className={`lower-tab ${panel === tab ? "active" : ""}`} data-testid={`tab-${tab}`} onClick={() => { if (tab === "effects") setSelectedEffectBusId(""); setPanel(tab); }}>{tab === "mixer" ? <SlidersHorizontal size={13} /> : tab === "clip" ? <AudioLines size={13} /> : tab === "piano" || tab === "drums" ? <Music2 size={13} /> : tab === "sampler" || tab === "routing" ? <AudioLines size={13} /> : tab === "effects" ? <Sparkles size={13} /> : <Headphones size={13} />}{tab === "clip" ? "Clip" : tab === "devices" ? "I/O" : tab[0].toUpperCase() + tab.slice(1)}</button>)}
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
      {panel === "sampler" && (selectedSamplerTrack ? <div className="instrument-panel-wrap">
        <SamplerPanel
          sampler={selectedSamplerTrack.sampler ?? createDefaultSamplerState()}
          assets={audioAssets}
          assetsLoading={audioAssetsLoading}
          missingSampleIds={snapshot.sampleErrors}
          recoveryMessage={selectedSamplerTrack.instrumentRecovery?.message ?? ""}
          onChange={(sampler) => updateTrack(selectedSamplerTrack.id, { sampler })}
          onImportSample={() => { void importSampleForTrack(selectedSamplerTrack.id); }}
          onPreview={() => { void previewSampleNote(selectedSamplerTrack.id, selectedSamplerTrack.sampler?.rootNote ?? 60); }}
          onAddNote={() => addMidiNote(selectedSamplerTrack.id, selectedSamplerTrack.sampler?.rootNote ?? 60)}
          onOpenPattern={() => setPanel("piano")}
        />
      </div> : <div className="panel-empty">Select a sampler track to load a sample and edit its MIDI pattern.</div>)}
      {panel === "drums" && (selectedDrumTrack ? <div className="instrument-panel-wrap">
        <DrumPanel
          drumKit={selectedDrumTrack.drumKit ?? createDefaultDrumKit()}
          notes={selectedDrumTrack.notes}
          assets={audioAssets}
          assetsLoading={audioAssetsLoading}
          missingSampleIds={snapshot.sampleErrors}
          recoveryMessage={selectedDrumTrack.instrumentRecovery?.message ?? ""}
          tempo={session.tempo}
          timeSignature={session.timeSignature}
          onChange={(drumKit) => updateTrack(selectedDrumTrack.id, { drumKit })}
          onNotesChange={(notes) => updateTrack(selectedDrumTrack.id, { notes })}
          onImportSample={(padId) => { void importSampleForTrack(selectedDrumTrack.id, padId); }}
          onPreviewPad={(pad: DrumPadState) => { void previewSampleNote(selectedDrumTrack.id, pad.note); }}
          onAddHit={(pad: DrumPadState) => addMidiNote(selectedDrumTrack.id, pad.note, 0.25)}
          onOpenPattern={() => setPanel("piano")}
        />
      </div> : <div className="panel-empty">Select a drum track to assign samples and build a pad pattern.</div>)}
      {panel === "piano" && <div className="piano-panel">
        <div className="piano-tools">
          {selectedInstrument && <>
            <label>Instrument<select data-testid="select-oscillator" value={selectedInstrument.instrument?.waveform ?? "triangle"} onChange={(event) => selectedInstrument.instrument && updateTrack(selectedInstrument.id, { instrument: { ...selectedInstrument.instrument, waveform: event.target.value as OscillatorType } })}>{["sine", "triangle", "square", "sawtooth"].map((wave) => <option key={wave}>{wave}</option>)}</select></label>
            <label>Attack<input data-testid="input-instrument-attack" type="number" min="0.001" max="4" step="0.001" value={selectedInstrument.instrument?.attack ?? 0.01} onChange={(event) => updateInstrumentParameter("attack", Number(event.target.value))} /></label>
            <label>Decay<input data-testid="input-instrument-decay" type="number" min="0.001" max="4" step="0.001" value={selectedInstrument.instrument?.decay ?? 0.12} onChange={(event) => updateInstrumentParameter("decay", Number(event.target.value))} /></label>
            <label>Sustain<input data-testid="input-instrument-sustain" type="number" min="0" max="1" step="0.01" value={selectedInstrument.instrument?.sustain ?? 0.65} onChange={(event) => updateInstrumentParameter("sustain", Number(event.target.value))} /></label>
            <label>Release<input data-testid="input-instrument-release" type="number" min="0.005" max="4" step="0.005" value={selectedInstrument.instrument?.release ?? 0.18} onChange={(event) => updateInstrumentParameter("release", Number(event.target.value))} /></label>
          </>}
          {!selectedInstrument && <span className="pattern-track-label" data-testid="text-pattern-track">
            {selectedPatternTrack ? `MIDI pattern · ${selectedPatternTrack.name}` : "Select a MIDI track"}
          </span>}
          {selectedPatternTrack && <button className="button button-subtle" data-testid="button-add-midi-note" disabled={selectedPatternTrack.type === "unsupported"} onClick={() => {
            const pitch = selectedPatternTrack.type === "sampler"
              ? selectedPatternTrack.sampler?.rootNote ?? 60
              : selectedPatternTrack.type === "drum"
                ? selectedPatternTrack.drumKit?.pads[0]?.note ?? 36
                : 60;
            addMidiNote(selectedPatternTrack.id, pitch);
          }}><Plus size={13} /> Add note</button>}
          {selectedPatternNote && <>
            <label>Pitch<input data-testid="input-note-pitch" type="number" min="0" max="127" value={selectedPatternNote.pitch} onChange={(event) => updateNote(selectedPatternTrack!.id, selectedPatternNote.id, { pitch: Math.round(clamp(Number(event.target.value), 0, 127)) })} /></label>
            <label>Velocity<input data-testid="input-note-velocity" type="range" min="1" max="127" value={selectedPatternNote.velocity} onChange={(event) => updateNote(selectedPatternTrack!.id, selectedPatternNote.id, { velocity: Number(event.target.value) })} /></label>
            <button className="icon-button compact danger-hover" data-testid="button-delete-midi-note" title="Delete selected note" onClick={() => { if (selectedNote) removeNote(selectedNote); }}><Trash2 size={13} /></button>
          </>}
        </div>
        <div className="piano-grid" ref={pianoGridRef} data-testid="piano-roll" onClick={(event) => {
          if ((event.target as HTMLElement).closest(".piano-key, .piano-note")) return;
          if (editTool === "erase" || editTool === "split") return;
          if (!selectedPatternTrack || selectedPatternTrack.type === "unsupported") {
            setNotice("Select a supported sampler, drum, or instrument track to create MIDI notes.");
            return;
          }
          const bounds = event.currentTarget.getBoundingClientRect();
          const beat = Math.max(0, (event.clientX - bounds.left + event.currentTarget.scrollLeft) / (beatSeconds * pixelsPerSecond));
          const pitch = clamp(127 - Math.floor((event.clientY - bounds.top + event.currentTarget.scrollTop) / 15), 0, 127);
          createMidiNoteAt(selectedPatternTrack.id, beat, pitch);
        }}>
          {Array.from({ length: 128 }, (_, index) => <div key={index} className={`piano-row ${isBlackKey(127 - index) ? "black-key-row" : ""}`}><span className="piano-key">{pitchName(127 - index)}</span></div>)}
          {selectedPatternTrack?.notes.map((note) => <PianoNote key={note.id} note={note} selected={note.id === selectedNote} beatWidth={beatSeconds * pixelsPerSecond} snap={snap} tool={editTool} onSelect={() => { setSelectedNote(note.id); setSelectedTrack(selectedPatternTrack.id); }} onChange={(update) => updateNote(selectedPatternTrack.id, note.id, update)} onDelete={() => removeNote(note.id)} onSplit={() => splitMidiNote(note.id)} onContextMenu={(x, y) => { setSelectedNote(note.id); setSelectedTrack(selectedPatternTrack.id); setContextMenu({ kind: "note", noteId: note.id, trackId: selectedPatternTrack.id, x, y }); }} />)}
        </div>
        {!selectedPatternTrack && <div className="piano-hint">Choose an instrument, sampler, or drum track to edit MIDI notes. Click the grid to place a note.</div>}
        {selectedPatternTrack?.type === "unsupported" && <div className="piano-hint">This track’s MIDI is preserved but cannot play until you recover it as a supported instrument.</div>}
      </div>}
      {panel === "routing" && <RoutingPanel
        session={session}
        selectedTrackId={selectedTrack}
        meters={snapshot.meters}
        allowedBusTargets={(busId) => getAllowedBusTargets(session.tracks, session.buses, busId)}
        onChange={setSession}
        onSelectTrack={setSelectedTrack}
        onEditBusEffects={(busId) => { setSelectedEffectBusId(busId); setPanel("effects"); }}
        onNotice={setNotice}
      />}
      {panel === "effects" && <EffectsPanel
        session={session}
        selectedTrackId={selectedTrack}
        selectedBusId={selectedEffectBusId}
        onSelectTrack={setSelectedTrack}
        onSelectBus={setSelectedEffectBusId}
        onUpdateTrackEffects={(trackId, effects) => updateTrack(trackId, { effects })}
        onUpdateBusEffects={(busId, effects) => setSession((current) => ({ ...current, buses: current.buses.map((bus) => bus.id === busId ? { ...bus, effects } : bus) }))}
        onUpdateMasterEffects={(effects) => setSession((current) => ({ ...current, masterEffects: effects }))}
        onNotice={setNotice}
      />}
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
    {contextMenu && <div className="workstation-context-backdrop" data-testid="workstation-context-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setContextMenu(null); }}>
      <div className="workstation-context-menu" role="menu" data-testid="workstation-context-menu" style={{ left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 190)), top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 160)) }} onContextMenu={(event) => event.preventDefault()}>
        <span className="context-menu-heading">{contextMenu.kind === "clip" ? "Audio clip" : "MIDI note"}</span>
        <button role="menuitem" data-testid="context-duplicate" onClick={() => {
          if (contextMenu.kind === "clip") duplicateClipById(contextMenu.clipId);
          else duplicateNote(contextMenu.noteId);
          setContextMenu(null);
        }}>Duplicate</button>
        <button role="menuitem" data-testid="context-split" onClick={() => { if (contextMenu.kind === "clip") splitClipById(contextMenu.clipId); else splitMidiNote(contextMenu.noteId); setContextMenu(null); }}>Split at playhead</button>
        <button role="menuitem" className="context-danger" data-testid="context-delete" onClick={() => {
          if (contextMenu.kind === "clip") removeClip(contextMenu.clipId);
          else removeNote(contextMenu.noteId);
          setContextMenu(null);
        }}>Delete</button>
      </div>
    </div>}
    {shortcutDialogOpen && <ShortcutsDialog bindings={shortcutBindings} platform={platform} onApply={applyShortcutProfile} onClose={() => setShortcutDialogOpen(false)} />}
  </main>;
}

function ClipBlock({ clip, selected, pps, snap, snapStep, tool, onSelect, onUpdate, onDelete, onSplit, onContextMenu }: {
  clip: AudioClip; selected: boolean; pps: number; snap: boolean; snapStep: number; onSelect: () => void;
  tool: EditTool; onUpdate: (update: Partial<AudioClip>) => void; onDelete: () => void;
  onSplit: () => void; onContextMenu: (x: number, y: number) => void;
}) {
  const drag = useRef<{ x: number; start: number; duration: number; edge: "move" | "left" | "right" } | null>(null);
  const [preview, setPreview] = useState<{ start: number; duration: number; source: number } | null>(null);
  const begin = (event: PointerEvent<HTMLElement>, edge: "move" | "left" | "right") => {
    if (event.button !== 0 || tool === "erase" || tool === "split") return;
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
  return <div className={`audio-clip ${selected ? "selected" : ""}`} data-testid={`clip-${clip.id}`} style={{ left: `${start * pps}px`, width: `${Math.max(74, width * pps)}px` }} onClick={(event) => { event.stopPropagation(); if (tool === "erase") onDelete(); else if (tool === "split") onSplit(); else onSelect(); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onContextMenu(event.clientX, event.clientY); }} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
    <button className="trim-edge trim-left" data-testid={`trim-left-${clip.id}`} aria-label="Trim clip start" onPointerDown={(event) => begin(event, "left")} />
    <div className="clip-body" onPointerDown={(event) => begin(event, "move")}><div className="clip-topline"><span className="clip-label">{clip.name}</span><button data-testid={`button-delete-clip-${clip.id}`} aria-label={`Delete ${clip.name}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onDelete(); }}><X size={12} /></button></div>
      <div className="waveform">{visibleWaveform.map((value, index) => <span key={index} style={{ height: `${Math.max(4, value * 82)}%` }} />)}</div>
      <span className="clip-duration">{formatSeconds(clip.durationSeconds)}</span><span className="clip-fades" style={{ "--fade-in": `${clip.fadeInSeconds / Math.max(clip.durationSeconds, .01) * 100}%`, "--fade-out": `${clip.fadeOutSeconds / Math.max(clip.durationSeconds, .01) * 100}%` } as CSSProperties} />
    </div>
    <button className="trim-edge trim-right" data-testid={`trim-right-${clip.id}`} aria-label="Trim clip end" onPointerDown={(event) => begin(event, "right")} />
  </div>;
}

function PianoNote({ note, selected, beatWidth, snap, tool, onSelect, onChange, onDelete, onSplit, onContextMenu }: {
  note: MidiNote; selected: boolean; beatWidth: number; snap: boolean; tool: EditTool;
  onSelect: () => void; onChange: (update: Partial<MidiNote>) => void; onDelete: () => void;
  onSplit: () => void; onContextMenu: (x: number, y: number) => void;
}) {
  const drag = useRef<PianoNoteDragState | null>(null);
  const [offset, setOffset] = useState<{ startBeat: number; durationBeats: number; pitch: number } | null>(null);
  const start = offset?.startBeat ?? note.startBeat;
  const duration = offset?.durationBeats ?? note.durationBeats;
  const pitch = offset?.pitch ?? note.pitch;
  return <div className={`piano-note ${selected ? "selected" : ""} ${tool === "erase" ? "eraser-target" : ""}`} data-testid={`piano-note-${note.id}`} style={{ left: `${start * beatWidth}px`, width: `${Math.max(14, duration * beatWidth)}px`, top: `${(127 - pitch) * 15}px` }} onPointerDown={(event) => {
    if (event.button !== 0) return;
    if (tool === "erase") { event.stopPropagation(); onDelete(); return; }
    if (tool === "split") return;
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
  }} onClick={(event) => { event.stopPropagation(); if (tool === "split") onSplit(); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onContextMenu(event.clientX, event.clientY); }} onPointerMove={(event) => {
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
