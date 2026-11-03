import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import {
  AudioLines, Circle, CircleStop, Headphones, Music2, Pause, Play, Plus,
  Keyboard, Redo2, Save, SkipBack, SlidersHorizontal, Sparkles, Trash2, Undo2, Volume2, VolumeX, X,
  PanelBottom,
} from "lucide-react";
import type {
  AudioClip,
  DrumPadState,
  InstrumentState,
  MidiClip,
  MidiNote,
  ProjectAsset,
  SongSession,
  SongKey,
  TrackType,
  Track,
} from "@shared/types";
import { createDefaultDrumKit, createDefaultSamplerState } from "@shared/instrument-tracks";
import { AudioEngine, type AudioDevice, type AudioEngineSnapshot } from "../audio/AudioEngine";
import { secondsPerBeat } from "../audio/time";
import {
  constrainCreatedPitch,
  constrainMovedPitch,
  pasteMidiNotes,
  PIANO_ROW_HEIGHT,
  splitMidiNoteAt,
} from "./piano-roll";
import { allowedPitchClasses } from "@shared/scales";
import { computeWaveformPeaks, getWaveformWindow } from "@shared/waveform";
import {
  ARRANGEMENT_RULER_HEIGHT,
  DEFAULT_TRACK_HEADER_WIDTH,
  DEFAULT_TRACK_HEIGHT,
  MAX_TRACK_HEADER_WIDTH,
  MAX_TRACK_HEIGHT,
  MIN_TRACK_HEADER_WIDTH,
  MIN_TRACK_HEIGHT,
  clampLayoutSize,
  clientYToArrangementPitch,
  clientXToTimelineSeconds,
} from "./arrangement-layout";
import { EffectsPanel } from "./EffectsPanel";
import { RoutingPanel } from "./RoutingPanel";
import { SamplerPanel } from "./SamplerPanel";
import { DrumPanel } from "./DrumPanel";
import { PianoRollSurface } from "./PianoRollSurface";
import { SongKeyControls, SONG_KEY_ROOT_NAMES as rootNames } from "./SongKeyControls";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { getAllowedBusTargets, maxAudioBuses } from "@shared/audio-routing";
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
  type ShortcutContext,
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
  onNewProject: () => Promise<void>;
  onOpenProject: (release: import("@shared/types").Release, session: SongSession) => Promise<void>;
};
type Meter = { peak: number; rms: number };
type ContextMenuTarget =
  | { kind: "clip"; clipId: string; trackId: string }
  | { kind: "midiClip"; midiClipId: string; trackId: string }
  | { kind: "note"; noteId: string; trackId: string };
type ContextMenuState = ContextMenuTarget & { x: number; y: number };
type ClipboardEntry =
  | { kind: "audio"; trackId: string; value: AudioClip }
  | { kind: "midi"; trackId: string; value: { clip: MidiClip; notes: MidiNote[] } }
  | { kind: "note"; trackId: string; value: MidiNote };
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

export function Workstation({ session: initialSession, releaseTitle, onBack, onHome, onSettings, onNewProject, onOpenProject }: WorkstationProps) {
  const [session, setSession] = useState(initialSession);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [saveError, setSaveError] = useState("");
  const [engineError, setEngineError] = useState("");
  const [engine, setEngine] = useState<AudioEngine | null>(null);
  const [snapshot, setSnapshot] = useState<AudioEngineSnapshot>(emptySnapshot);
  const [selectedTrack, setSelectedTrack] = useState(initialSession.tracks[0]?.id ?? "");
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [selectedMidiClip, setSelectedMidiClip] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [allItemsSelected, setAllItemsSelected] = useState(false);
  const [recoveryDismissedTrackId, setRecoveryDismissedTrackId] = useState("");
  const [dismissedSnapshotError, setDismissedSnapshotError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [snap, setSnap] = useState(true);
  const [headerWidth, setHeaderWidth] = useState(() => clampLayoutSize(
    Number(localStorage.getItem("prism.arrangementHeaderWidth")) || DEFAULT_TRACK_HEADER_WIDTH,
    MIN_TRACK_HEADER_WIDTH,
    MAX_TRACK_HEADER_WIDTH,
  ));
  const [trackHeights, setTrackHeights] = useState<Record<string, number>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("prism.arrangementTrackHeights") ?? "{}") as Record<string, number>;
      return Object.fromEntries(Object.entries(stored).map(([id, height]) => [
        id, clampLayoutSize(Number(height), MIN_TRACK_HEIGHT, MAX_TRACK_HEIGHT),
      ]));
    } catch { return {}; }
  });
  const smartView = session.midiView?.smartView ?? false;
  const scaleSnap = session.midiView?.scaleSnap ?? false;
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
  const [activeEditor, setActiveEditor] = useState<ShortcutContext>("arrangement");
  const [selectedEffectBusId, setSelectedEffectBusId] = useState("");
  const [notice, setNotice] = useState("");
  const [historyAvailability, setHistoryAvailability] = useState({ canUndo: false, canRedo: false });
  const [shortcutDialogOpen, setShortcutDialogOpen] = useState(false);
  const [shortcutSettings, setShortcutSettings] = useState(loadShortcutBindings);
  const [shortcutBindings, setShortcutBindings] = useState(shortcutSettings.bindings);
  const [editTool, setEditTool] = useState<EditTool>("select");
  const [openCommandMenu, setOpenCommandMenu] = useState<"edit" | "view" | null>(null);
  const [openTopMenu, setOpenTopMenu] = useState<"File" | "Edit" | "Insert" | "View" | "Transport" | "Help" | null>(null);
  const [dockHeight, setDockHeight] = useState(() => Number(localStorage.getItem("prism.dockHeight")) || 220);
  const [inspectorVisible, setInspectorVisible] = useState(() => localStorage.getItem("prism.inspectorVisible") !== "false");
  const [clipboard, setClipboard] = useState<ClipboardEntry[]>([]);
  const [version, setVersion] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const pianoGridRef = useRef<HTMLDivElement>(null);
  const pianoKeyboardRef = useRef<HTMLDivElement>(null);
  const pianoRulerRef = useRef<HTMLDivElement>(null);
  const waveformCache = useRef(new Map<string, { duration: number; peaks: number[] }>());
  const headerResizeRef = useRef<{ x: number; initialWidth: number; width: number } | null>(null);
  const trackResizeRef = useRef<{ id: string; y: number; initialHeight: number; height: number } | null>(null);
  const history = useRef(createSessionHistory(initialSession));
  const commandExecutor = useRef<(commandId: ShortcutCommandId) => void>(() => {});
  const shortcutStateRef = useRef({
    bindings: shortcutBindings, panel, activeEditor, dialogOpen: shortcutDialogOpen,
    menuOpen: openCommandMenu, topMenuOpen: openTopMenu, contextMenu,
  });
  shortcutStateRef.current = {
    bindings: shortcutBindings, panel, activeEditor, dialogOpen: shortcutDialogOpen,
    menuOpen: openCommandMenu, topMenuOpen: openTopMenu, contextMenu,
  };
  const platform = getShortcutPlatform(navigator.platform || navigator.userAgent);
  const beatSeconds = secondsPerBeat(session.tempo, session.timeSignature);
  const barSeconds = beatSeconds * beatsPerBar(session.timeSignature);
  const pixelsPerSecond = 54 * zoom;
  const clips = useMemo(() => session.tracks.flatMap((track) => track.clips.map((clip) => ({ track, clip }))), [session.tracks]);
  const duration = Math.max(
    16,
    ...clips.map(({ clip }) => clip.startSeconds + clip.durationSeconds),
    ...session.tracks.flatMap((track) => [
      ...track.notes.map((note) => (note.startBeat + note.durationBeats) * beatSeconds),
      ...(track.midiClips ?? []).map((clip) => (clip.startBeat + clip.durationBeats) * beatSeconds),
    ]),
  );
  const selected = clips.find(({ clip }) => clip.id === selectedClip);
  const selectedTrackData = session.tracks.find((track) => track.id === selectedTrack);
  const selectedInstrument = session.tracks.find((track) => track.id === selectedTrack && track.type === "instrument");
  const selectedSamplerTrack = session.tracks.find((track) => track.id === selectedTrack && track.type === "sampler");
  const selectedDrumTrack = session.tracks.find((track) => track.id === selectedTrack && track.type === "drum");
  const selectedPatternTrack = session.tracks.find((track) =>
    track.id === selectedTrack &&
    ["instrument", "sampler", "drum", "unsupported"].includes(track.type),
  );
  const selectedMidiClipData = selectedPatternTrack?.midiClips?.find((clip) => clip.id === selectedMidiClip);
  const pianoNotes = selectedPatternTrack?.notes.filter((note) =>
    selectedMidiClipData ? note.midiClipId === selectedMidiClipData.id : !note.midiClipId,
  ) ?? [];
  const selectedPatternNote = pianoNotes.find((note) => note.id === selectedNote);
  const recoveryMessage = selectedTrackData?.id !== recoveryDismissedTrackId
    ? selectedTrackData?.instrumentRecovery?.message ?? ""
    : "";
  const visibleSnapshotError = snapshot.error && snapshot.error !== dismissedSnapshotError
    ? snapshot.error
    : "";

  useEffect(() => {
    if (panel !== "piano" || !pianoGridRef.current) return;
    const clipNote = selectedPatternTrack?.notes.find((note) => note.midiClipId === selectedMidiClip);
    const pitch = clipNote?.pitch ?? 60;
    pianoGridRef.current.scrollTop = Math.max(0, (127 - pitch) * PIANO_ROW_HEIGHT - 45);
    if (pianoKeyboardRef.current) pianoKeyboardRef.current.scrollTop = pianoGridRef.current.scrollTop;
  }, [panel, selectedTrack, selectedMidiClip]);

  useEffect(() => {
    history.current = createSessionHistory(initialSession);
    setHistoryAvailability({ canUndo: false, canRedo: false });
    if (session.id !== initialSession.id) {
      setSession(initialSession);
      setSelectedTrack(initialSession.tracks[0]?.id ?? "");
    }
    setPanel("mixer");
    setActiveEditor("arrangement");
    setSelectedClip(null);
    setSelectedMidiClip(null);
    setSelectedNote(null);
    setClipboard([]);
    setSnapshot({ ...emptySnapshot });
  }, [initialSession.id]);

  useEffect(() => {
    let cancelled = false;
    const normalizedTracks = initialSession.tracks.map((track) => {
      if (track.notes.length === 0) return track;
      const existingClips = track.midiClips ?? [];
      const existingIds = new Set(existingClips.map((clip) => clip.id));
      const ungrouped = track.notes.filter((note) => !note.midiClipId || !existingIds.has(note.midiClipId));
      if (ungrouped.length === 0) return track;
      const ungroupedIds = new Set(ungrouped.map((note) => note.id));
      const startBeat = Math.min(...ungrouped.map((note) => note.startBeat));
      const endBeat = Math.max(...ungrouped.map((note) => note.startBeat + note.durationBeats));
      const clip: MidiClip = {
        id: crypto.randomUUID(),
        name: existingClips.length ? `MIDI Clip ${existingClips.length + 1}` : "MIDI Clip",
        startBeat,
        durationBeats: Math.max(1, endBeat - startBeat),
      };
      return {
        ...track,
        midiClips: [...existingClips, clip],
        notes: track.notes.map((note) => ungroupedIds.has(note.id) ? { ...note, midiClipId: clip.id } : note),
      };
    });
    const availableMidiClipIds = normalizedTracks.flatMap((track) => track.midiClips ?? []).map((clip) => clip.id);
    setSelectedMidiClip((current) => current && availableMidiClipIds.includes(current)
      ? current
      : availableMidiClipIds[0] ?? null);
    if (normalizedTracks.some((track, index) => track !== initialSession.tracks[index])) {
      setSession((current) => current.id === initialSession.id
        ? { ...current, tracks: normalizedTracks }
        : current);
    }
    void window.prism.getAppVersion()
      .then((value) => { if (!cancelled) setVersion(value); }).catch(() => undefined);
    return () => { cancelled = true; };
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

  const audioAssetSignature = session.tracks.flatMap((track) => track.clips.map((clip) => clip.assetId)).join("|");
  useEffect(() => {
    if (!engine) return;
    let cancelled = false;
    const assetIds = [...new Set(session.tracks.flatMap((track) => track.clips.map((clip) => clip.assetId)))];
    const missing = assetIds.filter((assetId) => !waveformCache.current.has(assetId));
    void Promise.all(missing.map(async (assetId) => {
      try {
        const buffer = await engine.loadAudio(assetId);
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
        const result = { duration: buffer.duration, peaks: computeWaveformPeaks(channels) };
        waveformCache.current.set(assetId, result);
        return { assetId, result };
      } catch (cause) {
        if (!cancelled) setEngineError(cause instanceof Error ? cause.message : `Audio source ${assetId} could not be decoded.`);
        return null;
      }
    })).then((loaded) => {
      if (cancelled) return;
      const metadata = new Map(loaded.filter((item): item is NonNullable<typeof item> => item !== null)
        .map((item) => [item.assetId, item.result]));
      for (const assetId of assetIds) {
        const cached = waveformCache.current.get(assetId);
        if (cached) metadata.set(assetId, cached);
      }
      if (!metadata.size) return;
      setSession((current) => ({
        ...current,
        tracks: current.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) => {
            const item = metadata.get(clip.assetId);
            if (!item) return clip;
            const sourceStartSeconds = clamp(clip.sourceStartSeconds, 0, item.duration);
            const sourceDurationSeconds = item.duration;
            const availableDuration = Math.max(0, sourceDurationSeconds - sourceStartSeconds);
            const durationSeconds = clip.durationSeconds > 0
              ? Math.min(clip.durationSeconds, availableDuration)
              : availableDuration;
            if (clip.sourceDurationSeconds === sourceDurationSeconds &&
              clip.waveform.length === item.peaks.length &&
              clip.waveform.every((peak, index) => peak === item.peaks[index]) &&
              clip.durationSeconds === durationSeconds &&
              clip.sourceStartSeconds === sourceStartSeconds) return clip;
            return { ...clip, durationSeconds, sourceDurationSeconds, sourceStartSeconds, waveform: item.peaks };
          }),
        })),
      }));
    });
    return () => { cancelled = true; };
  }, [engine, session.id, audioAssetSignature]);

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
  const setSongKey = (songKey: SongKey | null) => setSession((current) => ({ ...current, songKey }));
  const toggleSmartView = () => {
    setSession((current) => ({
      ...current,
      midiView: { smartView: !current.midiView?.smartView, scaleSnap: current.midiView?.scaleSnap ?? false },
    }));
  };
  const toggleScaleSnap = () => {
    setSession((current) => ({
      ...current,
      midiView: { smartView: current.midiView?.smartView ?? false, scaleSnap: !current.midiView?.scaleSnap },
    }));
  };
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
      pitch: constrainCreatedPitch(pitch, session.songKey, scaleSnap),
      startBeat,
      durationBeats,
      velocity: 92,
    };
    let midiClipId = selectedMidiClip;
    let midiClips = track.midiClips ?? [];
    if (!midiClipId || !midiClips.some((clip) => clip.id === midiClipId)) {
      const start = Math.floor(startBeat / 4) * 4;
      const clip: MidiClip = { id: crypto.randomUUID(), name: "MIDI Clip", startBeat: start, durationBeats: 4 };
      midiClipId = clip.id;
      midiClips = [...midiClips, clip];
      setSelectedMidiClip(clip.id);
    }
    const targetClip = midiClips.find((clip) => clip.id === midiClipId)!;
    note.startBeat = Math.max(targetClip.startBeat, Math.min(note.startBeat, targetClip.startBeat + targetClip.durationBeats - 0.125));
    note.durationBeats = Math.max(.125, Math.min(durationBeats, targetClip.startBeat + targetClip.durationBeats - note.startBeat));
    note.midiClipId = midiClipId;
    updateTrack(track.id, { midiClips, notes: [...track.notes, note] });
    setSelectedNote(note.id);
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
    setActiveEditor("piano");
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
    document.querySelector('[data-testid="button-add-track"]')?.closest("details")?.removeAttribute("open");
    const number = session.tracks.filter((track) => track.type === type).length + 1;
    const track: Track = {
      id: crypto.randomUUID(),
      name: type === "audio" ? `Audio ${number}`
        : type === "instrument" ? `Instrument ${number}`
          : type === "sampler" ? `Sampler ${number}` : `Drums ${number}`,
      type, color: colors[session.tracks.length % colors.length], volume: 0.82, pan: 0,
      muted: false, solo: false, recordArmed: false, clips: [], notes: [],
      midiClips: [],
      instrument: type === "instrument" ? { waveform: "triangle", attack: 0.015, decay: 0.12, sustain: 0.62, release: 0.18 } : null,
      sampler: type === "sampler" ? createDefaultSamplerState() : null,
      drumKit: type === "drum" ? createDefaultDrumKit() : null,
      instrumentRecovery: null,
      effects: [], outputBusId: null, sends: [],
    };
    setSession((current) => ({ ...current, tracks: [...current.tracks, track] }));
    setSelectedTrack(track.id);
    setPanel(type === "sampler" ? "sampler"
        : type === "drum" ? "drums" : "mixer");
    setActiveEditor(activeShortcutContext(type === "sampler" ? "sampler" : type === "drum" ? "drums" : "mixer"));
    return track;
  };
  const addBus = () => {
    document.querySelector('[data-testid="button-add-track"]')?.closest("details")?.removeAttribute("open");
    if (session.buses.length >= maxAudioBuses) {
      setNotice(`A project can have at most ${maxAudioBuses} buses.`);
      return;
    }
    let number = session.buses.length + 1;
    while (session.buses.some((bus) => bus.name.toLowerCase() === `bus ${number}`)) number++;
    setSession((current) => ({
      ...current,
      buses: [...current.buses, {
        id: crypto.randomUUID(), name: `Bus ${number}`, level: 1,
        muted: false, solo: false, outputBusId: null, sends: [], effects: [],
      }],
    }));
    setPanel("routing");
    setActiveEditor("routing");
    setNotice("Bus created. Choose it as a track output or send in Routing to feed it audio.");
  };
  const createMidiClip = (trackId = selectedTrack, newlyCreatedTrack?: Track) => {
    // Insert > MIDI Clip can create its instrument in this same React event;
    // that track is not in the render's session snapshot until the next render.
    const track = session.tracks.find((item) => item.id === trackId) ?? newlyCreatedTrack;
    if (!track || !["instrument", "sampler", "drum"].includes(track.type)) {
      setNotice("Add or select an instrument, sampler, or drum track first.");
      return;
    }
    const beat = snapshot.position / beatSeconds;
    const barLength = beatsPerBar(session.timeSignature);
    const startBeat = snap ? Math.max(0, Math.round(beat / barLength) * barLength) : Math.max(0, beat);
    const clip: MidiClip = { id: crypto.randomUUID(), name: "MIDI Clip", startBeat, durationBeats: barLength };
    setSession((current) => {
      const exists = current.tracks.some((item) => item.id === trackId);
      if (!exists && newlyCreatedTrack) {
        return {
          ...current,
          tracks: [...current.tracks, { ...newlyCreatedTrack, midiClips: [...(newlyCreatedTrack.midiClips ?? []), clip] }],
        };
      }
      return {
        ...current,
        tracks: current.tracks.map((item) => item.id === trackId
          ? { ...item, midiClips: [...(item.midiClips ?? []), clip] }
          : item),
      };
    });
    setSelectedTrack(trackId);
    setSelectedMidiClip(clip.id);
    setSelectedClip(null);
    setSelectedNote(null);
    setActiveEditor("arrangement");
    setNotice("MIDI clip added. Double-click it or use Open MIDI Editor to edit its notes.");
  };
  const updateMidiClip = (trackId: string, clipId: string, update: Partial<MidiClip>) => {
    const track = session.tracks.find((item) => item.id === trackId);
    const clip = track?.midiClips?.find((item) => item.id === clipId);
    if (!track || !clip) return;
    const nextStart = Math.max(0, update.startBeat ?? clip.startBeat);
    const delta = nextStart - clip.startBeat;
    const nextDuration = Math.max(.25, update.durationBeats ?? clip.durationBeats);
    const endBeat = nextStart + nextDuration;
    updateTrack(trackId, {
      midiClips: (track.midiClips ?? []).map((item) => item.id === clipId
        ? { ...item, ...update, startBeat: nextStart, durationBeats: nextDuration }
        : item),
      notes: track.notes.flatMap((note) => {
        if (note.midiClipId !== clipId) return [note];
        const moved = { ...note, startBeat: Math.max(0, note.startBeat + delta) };
        if (moved.startBeat >= endBeat) return [];
        return [{ ...moved, durationBeats: Math.max(.125, Math.min(moved.durationBeats, endBeat - moved.startBeat)) }];
      }),
    });
  };
  const openMidiEditor = (trackId = selectedTrack, clipId = selectedMidiClip) => {
    const track = session.tracks.find((item) => item.id === trackId);
    if (!track || !clipId || !track.midiClips?.some((clip) => clip.id === clipId)) {
      setNotice("Select a MIDI clip to open its editor.");
      return;
    }
    setSelectedTrack(trackId);
    setSelectedMidiClip(clipId);
    setSelectedClip(null);
    setPanel("piano");
    setActiveEditor("piano");
  };
  const selectArrangementTrack = (track: Track) => {
    setSelectedTrack(track.id);
    setSelectedMidiClip(track.midiClips?.[0]?.id ?? null);
    setSelectedClip(null);
    setSelectedNote(null);
    setActiveEditor("arrangement");
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
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
    const waveform = computeWaveformPeaks(channels);
    waveformCache.current.set(imported.clip.assetId, { duration: buffer.duration, peaks: waveform });
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
    setActiveEditor("arrangement");
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
        setActiveEditor("arrangement");
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
    try { await flushBeforeProjectAction(); setSaveStatus("saved"); setSaveError(""); setEngineError(""); }
    catch (cause) { setSaveStatus("error"); setSaveError(cause instanceof Error ? cause.message : "Session could not be saved."); }
  };
  const flushBeforeProjectAction = async () => {
    setSaveStatus("saving");
    setSaveError("");
    try {
      let current = session;
      if (engine?.snapshot().recording) {
        const take = await engine.stopRecording();
        if (take) current = appendRecordedClip(current, take.clip, take.trackId);
        setSession(current);
      }
      await window.prism.saveSession(current);
      setSaveStatus("saved");
      return current;
    } catch (cause) {
      setSaveStatus("error");
      setSaveError(cause instanceof Error ? cause.message : "Session could not be saved.");
      throw cause;
    }
  };
  const saveProjectAs = () => safe(async () => {
    const current = await flushBeforeProjectAction();
    const path = await window.prism.saveProjectAs(current);
    if (path) setNotice(`Portable project saved: ${path}`);
  });
  const openProject = () => safe(async () => {
    await flushBeforeProjectAction();
    const opened = await window.prism.openProject();
    if (opened) {
      await onOpenProject(opened.release, opened.session);
      setNotice(`Opened “${opened.session.title}” as a separate project copy. The original project was not changed.`);
    }
  });
  const createNewProject = () => safe(async () => {
    await flushBeforeProjectAction();
    await onNewProject();
  });
  const exitProject = () => safe(async () => {
    await flushBeforeProjectAction();
    await window.prism.requestExit();
  });
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
  const removeMidiClip = (trackId: string, clipId: string) => {
    setSession((current) => ({ ...current, tracks: current.tracks.map((track) => track.id === trackId
      ? {
        ...track,
        midiClips: (track.midiClips ?? []).filter((clip) => clip.id !== clipId),
        notes: track.notes.filter((note) => note.midiClipId !== clipId),
      }
      : track) }));
    if (selectedMidiClip === clipId) setSelectedMidiClip(null);
    setSelectedNote(null);
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
    setActiveEditor("piano");
  };
  const nudgeSelectedNote = (beatDelta: number, pitchDelta: number) => {
    if (!selectedNote) return;
    const track = session.tracks.find((item) => item.id === selectedTrack);
    const note = track?.notes.find((item) => item.id === selectedNote);
    if (!track || !note) return;
    updateNote(track.id, note.id, {
      startBeat: Math.max(0, snap ? Math.round((note.startBeat + beatDelta) * 4) / 4 : note.startBeat + beatDelta),
      pitch: constrainMovedPitch(note.pitch, pitchDelta, session.songKey, scaleSnap),
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
  const duplicateMidiClip = (clipId = selectedMidiClip) => {
    if (!clipId) return;
    const source = session.tracks.map((track) => ({ track, clip: track.midiClips?.find((item) => item.id === clipId) })).find((item) => item.clip);
    if (!source?.clip) return;
    const clip: MidiClip = { ...source.clip, id: crypto.randomUUID(), startBeat: source.clip.startBeat + source.clip.durationBeats };
    const offset = clip.startBeat - source.clip.startBeat;
    setSession((current) => ({ ...current, tracks: current.tracks.map((track) => track.id === source.track.id
      ? {
        ...track,
        midiClips: [...(track.midiClips ?? []), clip],
        notes: [...track.notes, ...track.notes.filter((note) => note.midiClipId === source.clip!.id).map((note) => ({ ...note, id: crypto.randomUUID(), midiClipId: clip.id, startBeat: note.startBeat + offset }))],
      }
      : track) }));
    setSelectedTrack(source.track.id);
    setSelectedMidiClip(clip.id);
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
  const splitMidiClipById = (clipId = selectedMidiClip) => {
    if (!clipId) return;
    const source = session.tracks.map((track) => ({ track, clip: track.midiClips?.find((item) => item.id === clipId) })).find((item) => item.clip);
    if (!source?.clip) return;
    const { clip, track } = source;
    const atBeat = snapshot.position / beatSeconds;
    const cutBeat = snap ? Math.round(atBeat / .25) * .25 : atBeat;
    if (cutBeat <= clip.startBeat + .125 || cutBeat >= clip.startBeat + clip.durationBeats - .125) {
      setNotice("Place the playhead inside the selected MIDI clip to split it.");
      return;
    }
    const rightClip: MidiClip = {
      ...clip, id: crypto.randomUUID(), name: `${clip.name} (2)`,
      startBeat: cutBeat, durationBeats: clip.startBeat + clip.durationBeats - cutBeat,
    };
    const leftDuration = cutBeat - clip.startBeat;
    const notes: MidiNote[] = [];
    for (const note of track.notes) {
      if (note.midiClipId !== clip.id) { notes.push(note); continue; }
      const noteEnd = note.startBeat + note.durationBeats;
      if (note.startBeat >= cutBeat) notes.push({ ...note, midiClipId: rightClip.id });
      else if (noteEnd > cutBeat) {
        notes.push({ ...note, durationBeats: cutBeat - note.startBeat });
        notes.push({ ...note, id: crypto.randomUUID(), midiClipId: rightClip.id, startBeat: cutBeat, durationBeats: noteEnd - cutBeat });
      } else notes.push(note);
    }
    updateTrack(track.id, {
      midiClips: [...(track.midiClips ?? []).map((item) => item.id === clip.id ? { ...item, durationBeats: leftDuration } : item), rightClip],
      notes,
    });
    setSelectedMidiClip(rightClip.id);
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

  const createMidiNoteAt = (trackId: string, beat: number, pitch: number, chromaticOverride = false) => {
    const track = session.tracks.find((item) => item.id === trackId);
    if (!track || !["instrument", "sampler", "drum"].includes(track.type)) {
      setNotice("Choose a supported MIDI track before drawing a note.");
      return;
    }
    const startBeat = snap ? Math.round(beat * 4) / 4 : beat;
    let midiClipId = selectedMidiClip;
    let midiClips = track.midiClips ?? [];
    if (!midiClipId || !midiClips.some((clip) => clip.id === midiClipId)) {
      const barLength = beatsPerBar(session.timeSignature);
      const startBeat = Math.floor(beat / barLength) * barLength;
      const clip: MidiClip = { id: crypto.randomUUID(), name: "MIDI Clip", startBeat, durationBeats: barLength };
      midiClipId = clip.id;
      midiClips = [...midiClips, clip];
      setSelectedMidiClip(clip.id);
    }
    const activeClip = midiClips.find((clip) => clip.id === midiClipId)!;
    const note: MidiNote = {
      id: crypto.randomUUID(),
      pitch: constrainCreatedPitch(pitch, session.songKey, scaleSnap, chromaticOverride),
      startBeat: Math.max(activeClip.startBeat, Math.min(startBeat, activeClip.startBeat + activeClip.durationBeats - 0.25)),
      durationBeats: Math.max(.125, Math.min(1, activeClip.startBeat + activeClip.durationBeats - Math.max(activeClip.startBeat, Math.min(startBeat, activeClip.startBeat + activeClip.durationBeats - 0.25)))),
      velocity: 90,
      midiClipId,
    };
    setSession((current) => ({
      ...current,
      tracks: current.tracks.map((item) => item.id === track.id
        ? { ...item, midiClips, notes: [...item.notes, note] }
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
    setOpenTopMenu(null);
    switch (commandId) {
      case "transport.toggle": void play(); break;
      case "transport.stop": void stop(); break;
      case "transport.record": void toggleRecord(); break;
      case "transport.loop": toggleLoop(); break;
      case "transport.metronome": setSession((current) => ({ ...current, metronomeEnabled: !current.metronomeEnabled })); break;
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
      case "project.saveAs": void saveProjectAs(); break;
      case "project.export": void exportWav(); break;
      case "project.library": void leave(onHome); break;
      case "project.new": void createNewProject(); break;
      case "project.open": void openProject(); break;
      case "project.exit": void exitProject(); break;
      case "edit.undo": undo(); break;
      case "edit.redo": redo(); break;
      case "edit.cut":
      case "edit.copy": {
        const pianoContext = activeEditor === "piano";
        let entries: ClipboardEntry[] = [];
        if (allItemsSelected && pianoContext && selectedPatternTrack) {
          entries = pianoNotes.map((note) => ({ kind: "note", trackId: selectedPatternTrack.id, value: { ...note } }));
        } else if (allItemsSelected) {
          entries = session.tracks.flatMap((track) => [
            ...track.clips.map((clip) => ({ kind: "audio" as const, trackId: track.id, value: { ...clip } })),
            ...(track.midiClips ?? []).map((clip) => ({
              kind: "midi" as const, trackId: track.id,
              value: { clip: { ...clip }, notes: track.notes.filter((note) => note.midiClipId === clip.id).map((note) => ({ ...note })) },
            })),
          ]);
        } else if (pianoContext && selectedPatternTrack) {
          const note = selectedPatternTrack.notes.find((item) => item.id === selectedNote);
          if (note) entries = [{ kind: "note", trackId: selectedPatternTrack.id, value: { ...note } }];
        } else {
          const audio = selectedClip ? clips.find(({ clip }) => clip.id === selectedClip) : undefined;
          const midi = selectedMidiClip
            ? session.tracks.flatMap((track) => (track.midiClips ?? []).map((clip) => ({ track, clip }))).find(({ clip }) => clip.id === selectedMidiClip)
            : undefined;
          if (audio) entries = [{ kind: "audio", trackId: audio.track.id, value: { ...audio.clip } }];
          else if (midi) entries = [{
            kind: "midi", trackId: midi.track.id,
            value: { clip: { ...midi.clip }, notes: midi.track.notes.filter((note) => note.midiClipId === midi.clip.id).map((note) => ({ ...note })) },
          }];
        }
        setClipboard(entries);
        if (commandId === "edit.cut" && entries.length > 0) {
          if (allItemsSelected && pianoContext && selectedPatternTrack) {
            const ids = new Set(entries.map((entry) => entry.kind === "note" ? entry.value.id : ""));
            updateTrack(selectedPatternTrack.id, { notes: selectedPatternTrack.notes.filter((note) => !ids.has(note.id)) });
          } else if (allItemsSelected) {
            setSession((current) => ({ ...current, tracks: current.tracks.map((track) => ({ ...track, clips: [], notes: [], midiClips: [] })) }));
          } else if (entries[0].kind === "note") removeNote(entries[0].value.id);
          else if (entries[0].kind === "audio") removeClip(entries[0].value.id);
          else removeMidiClip(entries[0].trackId, entries[0].value.clip.id);
          setAllItemsSelected(false);
        }
        break;
      }
      case "edit.paste": {
        if (!clipboard.length) break;
        const sourceStarts = clipboard.map((entry) => entry.kind === "audio"
          ? entry.value.startSeconds
          : entry.kind === "midi" ? entry.value.clip.startBeat * beatSeconds : entry.value.startBeat * beatSeconds);
        const origin = Math.min(...sourceStarts);
        let firstAudioId: string | null = null;
        let firstMidiId: string | null = null;
        let firstNoteId: string | null = null;
        // Allocate paste identities before scheduling state, so menu and key
        // commands select the same copies even when React defers the updater.
        const pastedTracks = session.tracks.map((track) => {
            const entries = clipboard.filter((entry) => entry.trackId === track.id);
            if (!entries.length) return track;
            let clips = [...track.clips];
            let midiClips = [...(track.midiClips ?? [])];
            let notes = [...track.notes];
            const noteEntries = entries.filter((entry): entry is Extract<ClipboardEntry, { kind: "note" }> => entry.kind === "note");
            if (noteEntries.length) {
              const pasted = pasteMidiNotes({
                notes: noteEntries.map((entry) => entry.value),
                clips: midiClips,
                selectedClipId: selectedMidiClip,
                playheadBeat: snapshot.position / beatSeconds,
                sourceOriginBeat: origin / beatSeconds,
                createId: () => crypto.randomUUID(),
              });
              midiClips = pasted.clips;
              notes.push(...pasted.notes);
              firstMidiId ??= pasted.clipId;
              firstNoteId ??= pasted.notes[0]?.id ?? null;
            }
            for (const entry of entries) {
              const offsetSeconds = sourceStarts[clipboard.indexOf(entry)] - origin;
              if (entry.kind === "audio") {
                const copy = { ...entry.value, id: crypto.randomUUID(), startSeconds: snapshot.position + offsetSeconds };
                clips.push(copy); firstAudioId ??= copy.id;
              } else if (entry.kind === "midi") {
                const clipId = crypto.randomUUID();
                const copy: MidiClip = {
                  ...entry.value.clip, id: clipId,
                  startBeat: snapshot.position / beatSeconds + offsetSeconds / beatSeconds,
                };
                midiClips.push(copy); firstMidiId ??= clipId;
                const noteShift = copy.startBeat - entry.value.clip.startBeat;
                notes.push(...entry.value.notes.map((note) => ({
                  ...note, id: crypto.randomUUID(), midiClipId: clipId,
                  startBeat: note.startBeat + noteShift,
                })));
              }
            }
            return { ...track, clips, midiClips, notes };
          });
        setSession((current) => ({ ...current, tracks: pastedTracks }));
        // Do not leave an unrelated old selection active after the paste:
        // the next Delete/Split must target the newly pasted selection.
        setSelectedClip(firstMidiId ? null : firstAudioId);
        setSelectedMidiClip(firstMidiId);
        setSelectedNote(firstNoteId);
        const pastedTrack = pastedTracks.find((track) => firstMidiId
          ? track.midiClips?.some((clip) => clip.id === firstMidiId)
          : track.clips.some((clip) => clip.id === firstAudioId));
        if (pastedTrack) setSelectedTrack(pastedTrack.id);
        setAllItemsSelected(false);
        break;
      }
      case "edit.selectAll":
        setAllItemsSelected(true);
        if (activeEditor === "piano") {
          setSelectedNote(pianoNotes[0]?.id ?? null);
        } else {
          setSelectedClip(clips[0]?.clip.id ?? null);
          setSelectedMidiClip(session.tracks.flatMap((track) => track.midiClips ?? [])[0]?.id ?? null);
        }
        break;
      case "edit.clearSelection":
        setAllItemsSelected(false); setSelectedClip(null); setSelectedMidiClip(null); setSelectedNote(null);
        break;
      case "edit.duplicate":
        if (allItemsSelected && activeEditor === "piano" && selectedPatternTrack) {
          const copies = pianoNotes.map((note) => ({
            ...note, id: crypto.randomUUID(),
            startBeat: note.startBeat + Math.max(.25, note.durationBeats),
          }));
          updateTrack(selectedPatternTrack.id, { notes: [...selectedPatternTrack.notes, ...copies] });
          setSelectedNote(copies[0]?.id ?? null); setAllItemsSelected(false);
        } else if (allItemsSelected) {
          session.tracks.forEach((track) => {
            track.clips.forEach((clip) => duplicateClipById(clip.id));
            (track.midiClips ?? []).forEach((clip) => duplicateMidiClip(clip.id));
          });
          setAllItemsSelected(false);
        } else if (activeEditor === "piano") duplicateNote();
        else if (selectedMidiClip) duplicateMidiClip();
        else duplicateClip();
        break;
      case "edit.delete":
        if (allItemsSelected && activeEditor === "piano" && selectedPatternTrack) {
          const selectedIds = new Set(pianoNotes.map((note) => note.id));
          updateTrack(selectedPatternTrack.id, { notes: selectedPatternTrack.notes.filter((note) => !selectedIds.has(note.id)) });
          setSelectedNote(null); setAllItemsSelected(false);
        } else if (allItemsSelected) {
          setSession((current) => ({ ...current, tracks: current.tracks.map((track) => ({ ...track, clips: [], notes: [], midiClips: [] })) }));
          setSelectedClip(null); setSelectedMidiClip(null); setSelectedNote(null); setAllItemsSelected(false);
        } else if (activeEditor === "piano") {
          if (selectedNote) removeNote(selectedNote);
        } else if (selectedMidiClip) {
          const owner = session.tracks.find((track) => track.midiClips?.some((item) => item.id === selectedMidiClip));
          if (owner) removeMidiClip(owner.id, selectedMidiClip);
        } else if (selectedClip) removeClip(selectedClip);
        break;
      case "edit.split":
        if (activeEditor === "piano") splitMidiNote();
        else if (selectedMidiClip) splitMidiClipById();
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
      case "view.fit": {
        const selectedAudio = activeEditor === "arrangement"
          ? clips.find(({ clip }) => clip.id === selectedClip)?.clip
          : undefined;
        const selectedMidi = session.tracks
          .flatMap((track) => (track.midiClips ?? []).map((clip) => ({ track, clip })))
          .find(({ clip }) => clip.id === selectedMidiClip)?.clip;
        const selectedNoteData = selectedPatternTrack?.notes.find((note) => note.id === selectedNote);
        const allStartSeconds = activeEditor === "piano" && allItemsSelected && pianoNotes.length
          ? Math.min(...pianoNotes.map((note) => note.startBeat * beatSeconds))
          : allItemsSelected && activeEditor === "arrangement"
          ? Math.min(...session.tracks.flatMap((track) => [
              ...track.clips.map((clip) => clip.startSeconds),
              ...(track.midiClips ?? []).map((clip) => clip.startBeat * beatSeconds),
            ]))
            : null;
        const startSeconds = allStartSeconds
          ?? (activeEditor === "piano" && selectedNoteData ? selectedNoteData.startBeat * beatSeconds : undefined)
          ?? selectedAudio?.startSeconds
          ?? (selectedMidi?.startBeat !== undefined ? selectedMidi.startBeat * beatSeconds : undefined)
          ?? 0;
        const endSeconds = activeEditor === "piano" && allItemsSelected && pianoNotes.length
          ? Math.max(...pianoNotes.map((note) => (note.startBeat + note.durationBeats) * beatSeconds))
          : allItemsSelected && activeEditor === "arrangement"
            ? Math.max(0, ...session.tracks.flatMap((track) => [
              ...track.clips.map((clip) => clip.startSeconds + clip.durationSeconds),
              ...(track.midiClips ?? []).map((clip) => (clip.startBeat + clip.durationBeats) * beatSeconds),
            ]))
            : activeEditor === "piano" && selectedNoteData
              ? (selectedNoteData.startBeat + selectedNoteData.durationBeats) * beatSeconds
              : selectedAudio
              ? selectedAudio.startSeconds + selectedAudio.durationSeconds
              : selectedMidi
                ? (selectedMidi.startBeat + selectedMidi.durationBeats) * beatSeconds
                : selectedNoteData
                  ? (selectedNoteData.startBeat + selectedNoteData.durationBeats) * beatSeconds
                  : duration;
        const targetDuration = Math.max(1, endSeconds - startSeconds);
        const viewWidth = activeEditor === "piano" ? pianoGridRef.current?.clientWidth : timelineRef.current?.clientWidth;
        const available = Math.max(12, (viewWidth ?? 900) - (activeEditor === "piano" ? 0 : headerWidth) - 20);
        const nextZoom = clamp(available / Math.max(1, targetDuration * 54), 0.5, 2.4);
        setZoom(nextZoom);
        window.requestAnimationFrame(() => {
          if (activeEditor === "piano") {
            const nextBeatWidth = beatSeconds * 54 * nextZoom;
            pianoGridRef.current?.scrollTo({ left: Math.max(0, startSeconds / beatSeconds * nextBeatWidth - 30), behavior: "smooth" });
          } else {
            timelineRef.current?.scrollTo({
              left: Math.max(0, headerWidth + startSeconds * 54 * nextZoom - 40),
              behavior: "smooth",
            });
          }
        });
        break;
      }
      case "panel.mixer": setPanel("mixer"); setActiveEditor("mixer"); break;
      case "panel.piano": setPanel("piano"); setActiveEditor("piano"); break;
      case "panel.effects": setSelectedEffectBusId(""); setPanel("effects"); setActiveEditor("effects"); break;
      case "panel.routing": setPanel("routing"); setActiveEditor("routing"); break;
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

  useEffect(() => {
    const open = () => setShortcutDialogOpen(true);
    window.addEventListener("prism:open-shortcuts", open);
    return () => window.removeEventListener("prism:open-shortcuts", open);
  }, []);

  useEffect(() => {
    if (!openTopMenu) return;
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest(".workstation-command-menus")) setOpenTopMenu(null);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [openTopMenu]);

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
      if (event.key === "Escape" && (shortcutStateRef.current.menuOpen || shortcutStateRef.current.topMenuOpen || shortcutStateRef.current.contextMenu)) {
        event.preventDefault();
        setOpenCommandMenu(null);
        setOpenTopMenu(null);
        setContextMenu(null);
        return;
      }
      if (isEditableTarget(event.target)) return;
      const element = event.target as Element | null;
      if (event.key === " " && typeof element?.closest === "function" &&
          element.closest("button, a, [role='button']")) return;
      const context = shortcutStateRef.current.activeEditor;
      const commands = shortcutRegistry.filter((item) =>
        commandIsActive(item, context) &&
        matchesShortcut(event, shortcutStateRef.current.bindings[item.id], platform),
      );
      if (commands.length > 1) {
        event.preventDefault();
        setNotice("This shortcut has conflicting assignments. Open Preferences > Shortcuts to resolve them.");
        return;
      }
      const command = commands[0];
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
  const pianoBeatWidth = beatSeconds * pixelsPerSecond;
  const pianoContentWidth = Math.max(1000, (duration / beatSeconds + beatsPerBar(session.timeSignature) * 2) * pianoBeatWidth);
  const songKey = session.songKey ?? null;
  const arrangementLayout = {
    headerWidth,
    rulerHeight: ARRANGEMENT_RULER_HEIGHT,
    rowHeights: trackHeights,
    originX: headerWidth,
    pixelsPerSecond,
  };
  const resizeTrackHeader = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.type === "pointerdown") {
      event.preventDefault();
      headerResizeRef.current = { x: event.clientX, initialWidth: headerWidth, width: headerWidth };
      event.currentTarget.setPointerCapture(event.pointerId);
    } else if (event.type === "pointermove" && headerResizeRef.current) {
      const width = clampLayoutSize(
        headerResizeRef.current.initialWidth + event.clientX - headerResizeRef.current.x,
        MIN_TRACK_HEADER_WIDTH,
        MAX_TRACK_HEADER_WIDTH,
      );
      headerResizeRef.current.width = width;
      setHeaderWidth(width);
    } else if (event.type === "pointerup" || event.type === "pointercancel") {
      const finalWidth = headerResizeRef.current?.width ?? headerWidth;
      headerResizeRef.current = null;
      localStorage.setItem("prism.arrangementHeaderWidth", String(finalWidth));
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const resizeTrackRow = (trackId: string, event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.type === "pointerdown") {
      event.preventDefault();
      const height = trackHeights[trackId] ?? DEFAULT_TRACK_HEIGHT;
      trackResizeRef.current = { id: trackId, y: event.clientY, initialHeight: height, height };
      event.currentTarget.setPointerCapture(event.pointerId);
    } else if (event.type === "pointermove" && trackResizeRef.current?.id === trackId) {
      const next = clampLayoutSize(
        trackResizeRef.current.initialHeight + event.clientY - trackResizeRef.current.y,
        MIN_TRACK_HEIGHT,
        MAX_TRACK_HEIGHT,
      );
      trackResizeRef.current.height = next;
      setTrackHeights((current) => ({ ...current, [trackId]: next }));
    } else if (event.type === "pointerup" || event.type === "pointercancel") {
      const resized = trackResizeRef.current;
      if (resized) localStorage.setItem("prism.arrangementTrackHeights", JSON.stringify({
        ...trackHeights,
        [resized.id]: resized.height,
      }));
      trackResizeRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const toggleLoop = () => setSession((current) => ({
    ...current,
    loopRange: current.loopRange?.enabled
      ? { ...current.loopRange, enabled: false }
      : { enabled: true, startSeconds: current.loopRange?.startSeconds ?? 0, endSeconds: current.loopRange?.endSeconds ?? Math.max(barSeconds * 4, 8) },
  }));

  const menuAction = (action: string) => {
    if (action.startsWith("insert.")) {
      if (action === "insert.audio") addTrack("audio");
      else if (action === "insert.instrument") addTrack("instrument");
      else if (action === "insert.drum") addTrack("drum");
      else if (action === "insert.sampler") addTrack("sampler");
      else if (action === "insert.bus") addBus();
      else if (action === "insert.import") void importAudio();
      else if (action === "insert.midi") {
        const currentTrack = selectedPatternTrack && ["instrument", "sampler", "drum"].includes(selectedPatternTrack.type)
          ? selectedPatternTrack
          : null;
        const previousPanel = panel;
        const track = currentTrack ?? addTrack("instrument");
        if (!currentTrack) setPanel(previousPanel);
        setActiveEditor("arrangement");
        createMidiClip(track.id, track);
      }
      return;
    }
    if (action === "preferences") { onSettings(); setOpenTopMenu(null); return; }
    if (action === "about") { setNotice(`PRISM${version ? ` ${version}` : ""} · Offline music workstation`); setOpenTopMenu(null); return; }
    executeCommand(action as ShortcutCommandId);
  };
  const menuEntries: Record<NonNullable<typeof openTopMenu>, Array<{ label: string; action?: string; command?: ShortcutCommandId; disabled?: boolean; shortcut?: string; separator?: boolean; checked?: boolean }>> = {
    File: [
      { label: "New Project", command: "project.new", shortcut: "" },
      { label: "Open Project", command: "project.open", shortcut: "" },
      { separator: true, label: "" },
      { label: "Save Project", command: "project.save" },
      { label: "Save Project As…", command: "project.saveAs" },
      { separator: true, label: "" },
      { label: "Export Audio", command: "project.export", disabled: recording || busy === "export" },
      { label: "Exit", command: "project.exit" },
    ],
    Edit: [
      { label: "Undo", command: "edit.undo", disabled: !historyAvailability.canUndo || recording },
      { label: "Redo", command: "edit.redo", disabled: !historyAvailability.canRedo || recording },
      { separator: true, label: "" },
      { label: "Cut", command: "edit.cut", disabled: !["arrangement", "piano"].includes(activeEditor) || !(selectedClip || selectedMidiClip || selectedNote || allItemsSelected) },
      { label: "Split", command: "edit.split", disabled: !["arrangement", "piano"].includes(activeEditor) || !(selectedClip || selectedMidiClip || selectedNote) },
      { label: "Copy", command: "edit.copy", disabled: !["arrangement", "piano"].includes(activeEditor) || !(selectedClip || selectedMidiClip || selectedNote || allItemsSelected) },
      { label: "Paste", command: "edit.paste", disabled: !["arrangement", "piano"].includes(activeEditor) || clipboard.length === 0 },
      { label: "Delete", command: "edit.delete", disabled: !["arrangement", "piano"].includes(activeEditor) || !(selectedClip || selectedMidiClip || selectedNote || allItemsSelected) },
      { label: "Duplicate", command: "edit.duplicate", disabled: !["arrangement", "piano"].includes(activeEditor) || !(selectedClip || selectedMidiClip || selectedNote || allItemsSelected) },
      { label: "Select All", command: "edit.selectAll", disabled: activeEditor === "piano" ? pianoNotes.length === 0 : activeEditor !== "arrangement" || session.tracks.every((track) => !track.clips.length && !track.midiClips?.length) },
      { label: "Clear Selection", command: "edit.clearSelection", disabled: !["arrangement", "piano"].includes(activeEditor) || !(selectedClip || selectedMidiClip || selectedNote || allItemsSelected) },
      { separator: true, label: "" },
      { label: "Preferences…", action: "preferences" },
    ],
    Insert: [
      { label: "Audio Track", action: "insert.audio" },
      { label: "MIDI / Instrument Track", action: "insert.instrument" },
      { label: "Drum Track", action: "insert.drum" },
      { label: "Sampler Track", action: "insert.sampler" },
      { label: "Bus Track", action: "insert.bus", disabled: session.buses.length >= maxAudioBuses },
      { separator: true, label: "" },
      { label: "MIDI Clip", action: "insert.midi" },
      { label: "Import Audio…", action: "insert.import" },
    ],
    View: [
      { label: `${inspectorVisible ? "Hide" : "Show"} Track Inspector`, action: "view.inspector", checked: inspectorVisible },
      { label: "Mixer", command: "panel.mixer", checked: panel === "mixer" },
      { label: "Piano Roll / MIDI Editor", command: "panel.piano", checked: panel === "piano" },
      { label: "Effects", command: "panel.effects", checked: panel === "effects" },
      { label: "Routing", command: "panel.routing", checked: panel === "routing" },
      { separator: true, label: "" },
      { label: "Zoom In", command: "view.zoomIn" },
      { label: "Zoom Out", command: "view.zoomOut" },
      { label: "Reset Zoom", command: "view.zoomReset" },
      { label: "Fit Project / Selection", command: "view.fit", disabled: !["arrangement", "piano"].includes(activeEditor) },
    ],
    Transport: [
      { label: snapshot.status === "playing" ? "Pause" : "Play", command: "transport.toggle" },
      { label: "Stop", command: "transport.stop" },
      { label: "Return to Project Start", command: "transport.home" },
      { separator: true, label: "" },
      { label: recording ? "Stop Recording" : "Record", command: "transport.record" },
      { label: `${session.loopRange?.enabled ? "Disable" : "Enable"} Loop`, command: "transport.loop", checked: !!session.loopRange?.enabled },
      { label: `${session.metronomeEnabled ? "Disable" : "Enable"} Metronome`, command: "transport.metronome", checked: session.metronomeEnabled },
    ],
    Help: [
      { label: `PRISM${version ? ` ${version}` : ""}`, disabled: true },
      { separator: true, label: "" },
      { label: "Keyboard Shortcuts…", command: "help.shortcuts" },
      { label: "About PRISM", action: "about" },
    ],
  };
  const renderMenu = (menu: NonNullable<typeof openTopMenu>) => <div className="top-menu-surface" role="menu" aria-label={`${menu} commands`}>
    {menuEntries[menu].map((item, index) => item.separator
      ? <div key={`separator-${index}`} className="menu-separator" role="separator" />
      : <button key={`${menu}-${item.label}`} type="button" role={item.checked === undefined ? "menuitem" : item.action === "view.inspector" ? "menuitemcheckbox" : "menuitemradio"} aria-checked={item.checked} data-testid={`menuitem-${menu.toLowerCase()}-${index}`} className={`top-menu-item ${item.checked ? "checked" : ""}`} disabled={item.disabled} onClick={() => {
        if (item.action === "view.inspector") {
          setInspectorVisible((visible) => { const next = !visible; localStorage.setItem("prism.inspectorVisible", String(next)); return next; });
          setOpenTopMenu(null);
        } else if (item.command) menuAction(item.command);
        else if (item.action) menuAction(item.action);
      }}>
        <span className="menu-check">{item.checked ? "✓" : ""}</span><span>{item.label}</span>
        {item.command && shortcutBindings[item.command] && <kbd>{formatShortcut(shortcutBindings[item.command], platform)}</kbd>}
      </button>)}
  </div>;

  return <main className="workstation">
    <header className="workstation-header">
      <nav className="workstation-command-menus" aria-label="Application menus" onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); setOpenTopMenu(null); setOpenCommandMenu(null); }
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && openTopMenu) {
          event.preventDefault();
          const menu = event.currentTarget.querySelector('[role="menu"]');
          const items = Array.from(menu?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? []);
          const current = items.indexOf(document.activeElement as HTMLElement);
          const index = current < 0 ? (event.key === "ArrowDown" ? 0 : items.length - 1)
            : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items[index]?.focus();
        }
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          const order = ["File", "Edit", "Insert", "View", "Transport", "Help"] as const;
          const current = order.indexOf(openTopMenu ?? "File");
          const delta = event.key === "ArrowRight" ? 1 : -1;
          const next = order[(current + delta + order.length) % order.length];
          setOpenTopMenu(next);
          event.currentTarget.querySelector<HTMLButtonElement>(`[data-menu="${next}"]`)?.focus();
          event.preventDefault();
        }
      }}>
        <button className="mini-brand" type="button" aria-label="PRISM project library" onClick={() => void leave(onHome)}><img className="workstation-logo" src={prismLogo} alt="" /><b>PRISM</b></button>
        {(["File", "Edit", "Insert", "View", "Transport", "Help"] as const).map((menu) => <div className="top-menu-wrap" key={menu}>
          <button className={`top-menu-trigger ${openTopMenu === menu ? "active" : ""}`} data-menu={menu} data-testid={`menu-${menu.toLowerCase()}`} type="button" aria-haspopup="menu" aria-expanded={openTopMenu === menu} onClick={() => {
            setOpenTopMenu((current) => current === menu ? null : menu);
            setOpenCommandMenu(null);
          }} onFocus={() => { if (openTopMenu) setOpenTopMenu(menu); }}>{menu}</button>
          {openTopMenu === menu && renderMenu(menu)}
        </div>)}
      </nav>
      <span className="header-divider" />
      <strong className="current-song" data-testid="text-song-title">{session.title}</strong>
      <div className={`save-indicator ${saveStatus}`} data-testid="status-session-save" aria-live="polite" title={saveError || "Stored on this device"}>
        <span className="save-dot" />{saveStatus === "saving" ? "Saving" : saveStatus === "error" ? "Save error" : "Saved locally"}
      </div>
      <button className="icon-button" data-testid="button-save-session" title="Save project" onClick={() => void saveNow()}><Save size={16} /></button>
      <details className="song-settings">
        <summary data-testid="button-song-settings">Song settings</summary>
        <div className="song-settings-popover">
          <SongKeyControls value={songKey} onChange={setSongKey} prefix="settings-song-key" />
          <p>Song Key guides MIDI editing. Changing it never changes existing notes.</p>
        </div>
      </details>
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
      <div className="transport-master">
        <span>MASTER</span><MeterBar meter={snapshot.meters.master} id="transport-master" />
        <input data-testid="input-transport-master-volume" aria-label="Master output level" type="range" min="0" max="1.5" step=".01" value={session.masterVolume} onChange={(event) => setSession((current) => ({ ...current, masterVolume: Number(event.target.value) }))} />
      </div>
    </section>

    {(engineError || saveError || recoveryMessage || visibleSnapshotError || notice) && <div className={`workstation-notice ${engineError || saveError || recoveryMessage || visibleSnapshotError ? "error-notice" : ""}`} role={engineError || saveError || recoveryMessage || visibleSnapshotError ? "alert" : "status"} data-testid="status-workstation-message">
      <span>{engineError || saveError || recoveryMessage || visibleSnapshotError || notice}</span>
      {recoveryMessage && selectedTrackData?.type === "unsupported" && <button className="button button-subtle recovery-action" data-testid="button-recover-unsupported-track" onClick={() => recoverUnsupportedTrack(selectedTrackData.id)}>Recover as synth</button>}
      <button data-testid="button-dismiss-message" aria-label="Dismiss message" onClick={() => { setEngineError(""); setSaveError(""); setNotice(""); setRecoveryDismissedTrackId(selectedTrack); setDismissedSnapshotError(snapshot.error ?? ""); }}><X size={14} /></button>
    </div>}

    <section className="arrangement" onPointerDown={() => setActiveEditor("arrangement")}>
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
          <label className="snap-toggle"><input data-testid="input-snap" type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} /> Snap</label>
          <button className="icon-button compact" type="button" data-testid="button-open-shortcuts" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={() => setShortcutDialogOpen(true)}><Keyboard size={14} /></button>
        </div>
        <div className="zoom-control"><span>Zoom</span><input data-testid="input-timeline-zoom" aria-label="Timeline zoom" type="range" min=".5" max="2.4" step=".05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></div>
      </div>
      <div className="timeline-scroll" ref={timelineRef}>
        <div className="timeline-content" style={{
          width: `${headerWidth + timelineWidth}px`,
          "--track-header-width": `${arrangementLayout.headerWidth}px`,
          "--arrangement-origin-x": `${arrangementLayout.originX}px`,
        } as CSSProperties}>
          <div className="timeline-ruler-row" style={{ gridTemplateColumns: `${arrangementLayout.headerWidth}px ${timelineWidth}px`, height: `${arrangementLayout.rulerHeight}px` }}>
            <div className="track-column-heading"><span>TRACKS</span><details className="track-add-menu">
              <summary data-testid="button-add-track" aria-label="Add track">+ <span>Add Track</span></summary>
              <div className="track-add-options" role="menu" aria-label="Add track type">
                <button role="menuitem" data-testid="add-track-audio" onClick={() => addTrack("audio")}>Audio Track</button>
                <button role="menuitem" data-testid="add-track-instrument" onClick={() => addTrack("instrument")}>MIDI / Instrument</button>
                <button role="menuitem" data-testid="add-track-drum" onClick={() => addTrack("drum")}>Drum Track</button>
                <button role="menuitem" data-testid="add-track-sampler" onClick={() => addTrack("sampler")}>Sampler Track</button>
                <button role="menuitem" data-testid="add-track-bus" disabled={session.buses.length >= maxAudioBuses} title={session.buses.length >= maxAudioBuses ? `Maximum ${maxAudioBuses} buses` : "Create a routable audio bus"} onClick={addBus}>Bus Track</button>
              </div>
            </details><div className="header-resize-grip" data-testid="track-header-resize" role="separator" aria-label="Resize track header" aria-orientation="vertical" aria-valuenow={headerWidth} onPointerDown={resizeTrackHeader} onPointerMove={resizeTrackHeader} onPointerUp={resizeTrackHeader} onPointerCancel={resizeTrackHeader} /></div>
            <div className="timeline-ruler" data-testid="timeline-ruler" style={{ width: `${timelineWidth}px` }} onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              seek(clientXToTimelineSeconds(event.clientX, bounds.left, arrangementLayout.pixelsPerSecond));
            }}>
          {Array.from({ length: Math.ceil(duration / barSeconds) + 2 }, (_, index) => <div className="ruler-mark" key={index} style={{ left: `${index * barSeconds * pixelsPerSecond}px` }}><span>{String(index + 1).padStart(2, "0")}</span></div>)}
              {session.loopRange?.enabled && <div className="loop-region" style={{ left: `${session.loopRange.startSeconds * pixelsPerSecond}px`, width: `${Math.max(12, (session.loopRange.endSeconds - session.loopRange.startSeconds) * pixelsPerSecond)}px` }} />}
            </div>
          </div>
          {session.tracks.map((track, index) => {
            const trackHeight = arrangementLayout.rowHeights[track.id] ?? DEFAULT_TRACK_HEIGHT;
            return <div className={`timeline-track-row ${selectedTrack === track.id ? "track-selected" : ""}`} key={track.id}
              style={{ gridTemplateColumns: `${arrangementLayout.headerWidth}px ${timelineWidth}px`, height: `${trackHeight}px`, minHeight: `${trackHeight}px` }}>
            <div className="track-controls" data-track-id={track.id}>
              <span className="track-color" style={{ background: track.color || colors[index % colors.length] }} />
              <button className="track-name" data-testid={`button-rename-track-${track.id}`} title="Rename track" onClick={() => { const name = window.prompt("Track name", track.name); if (name?.trim()) updateTrack(track.id, { name: name.trim() }); selectArrangementTrack(track); }}>{track.name}</button>
              <small className="track-kind">{track.type === "instrument" ? "INSTRUMENT" : track.type === "sampler" ? "SAMPLER" : track.type === "drum" ? "DRUM KIT" : track.type === "unsupported" ? "UNSUPPORTED" : "AUDIO"}</small>
              <div className="track-buttons">
                <button className={`track-toggle ${track.muted ? "active" : ""}`} data-testid={`button-mute-${track.id}`} aria-label={`${track.muted ? "Unmute" : "Mute"} ${track.name}`} aria-pressed={track.muted} onClick={() => updateTrack(track.id, { muted: !track.muted })}>{track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}</button>
                <button className={`track-toggle ${track.solo ? "solo-active" : ""}`} data-testid={`button-solo-${track.id}`} aria-label={`${track.solo ? "Unsolo" : "Solo"} ${track.name}`} aria-pressed={track.solo} onClick={() => updateTrack(track.id, { solo: !track.solo })}>S</button>
                {track.type === "audio" && <button className={`track-toggle arm-toggle ${track.recordArmed ? "armed" : ""}`} data-testid={`button-arm-${track.id}`} aria-label={`${track.recordArmed ? "Disarm" : "Arm"} ${track.name}`} aria-pressed={track.recordArmed} onClick={() => updateTrack(track.id, { recordArmed: !track.recordArmed })}>R</button>}
                <button className="track-toggle danger-hover" data-testid={`button-delete-track-${track.id}`} aria-label={`Delete ${track.name}`} title="Remove track" disabled={recording} onClick={() => removeTrack(track.id)}><Trash2 size={12} /></button>
              </div>
              <div className="track-meter-wrap"><MeterBar meter={snapshot.meters[track.id]} id={`track-${track.id}`} /><span className="track-db">{snapshot.meters[track.id]?.peak ? `${(20 * Math.log10(snapshot.meters[track.id].peak)).toFixed(1)} dB` : "−∞ dB"}</span></div>
              <label className="track-level"><span>VOL</span><input data-testid={`input-track-volume-${track.id}`} aria-label={`${track.name} volume`} type="range" min="0" max="1.25" step=".01" value={track.volume} onChange={(event) => updateTrack(track.id, { volume: Number(event.target.value) })} /><small>{Math.round(track.volume * 100)}</small></label>
              <label className="track-pan"><span>PAN</span><input data-testid={`input-track-pan-${track.id}`} aria-label={`${track.name} pan`} type="range" min="-1" max="1" step=".01" value={track.pan} onChange={(event) => updateTrack(track.id, { pan: Number(event.target.value) })} /></label>
              <div className="track-height-grip" data-testid={`track-height-resize-${track.id}`} data-track-id={track.id} role="separator" aria-label={`Resize ${track.name} row`} aria-orientation="horizontal" aria-valuenow={trackHeight} onPointerDown={(event) => resizeTrackRow(track.id, event)} onPointerMove={(event) => resizeTrackRow(track.id, event)} onPointerUp={(event) => resizeTrackRow(track.id, event)} onPointerCancel={(event) => resizeTrackRow(track.id, event)} />
            </div>
            <div className={`timeline-lane tool-${editTool}`} data-testid={`timeline-lane-${track.id}`} data-track-id={track.id} onClick={(event) => {
              if ((event.target as HTMLElement).closest(".audio-clip, .midi-clip, .midi-note")) return;
              selectArrangementTrack(track);
              const bounds = event.currentTarget.getBoundingClientRect();
              const seconds = clientXToTimelineSeconds(event.clientX, bounds.left, arrangementLayout.pixelsPerSecond);
              if (editTool === "draw") {
                const pitch = clientYToArrangementPitch(event.clientY, bounds.top, bounds.height);
                createMidiNoteAt(track.id, seconds / beatSeconds, pitch, event.altKey);
                return;
              }
              if (editTool !== "erase") seek(seconds);
            }} onDoubleClick={(event) => {
              if ((event.target as HTMLElement).closest(".audio-clip, .midi-clip")) return;
              if (editTool !== "select") return;
              if (!["instrument", "sampler", "drum"].includes(track.type)) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              const seconds = clientXToTimelineSeconds(event.clientX, bounds.left, arrangementLayout.pixelsPerSecond);
              const rawBeat = seconds / beatSeconds;
              const startBeat = snap ? Math.max(0, Math.round(rawBeat * 4) / 4) : Math.max(0, rawBeat);
              const clip: MidiClip = {
                id: crypto.randomUUID(),
                name: "MIDI Clip",
                startBeat,
                durationBeats: beatsPerBar(session.timeSignature),
              };
              updateTrack(track.id, { midiClips: [...(track.midiClips ?? []), clip] });
              setSelectedTrack(track.id);
              setSelectedMidiClip(clip.id);
              setSelectedClip(null);
              setSelectedNote(null);
              setPanel("piano");
              setActiveEditor("piano");
              setNotice("");
            }}>
              {Array.from({ length: Math.ceil(duration / barSeconds) + 2 }, (_, index) => <div key={index} className="lane-gridline" style={{ left: `${index * barSeconds * pixelsPerSecond}px` }} />)}
              {track.clips.map((clip) => <ClipBlock key={clip.id} clip={clip} selected={selectedClip === clip.id || allItemsSelected} pps={pixelsPerSecond} snapStep={beatSeconds / 4} snap={snap} tool={editTool} onSelect={() => { setAllItemsSelected(false); setSelectedTrack(track.id); setSelectedClip(clip.id); setSelectedMidiClip(null); setSelectedNote(null); setPanel("clip"); setActiveEditor("arrangement"); }} onUpdate={(update) => updateClip(track.id, clip.id, update)} onDelete={() => removeClip(clip.id)} onSplit={() => splitClipById(clip.id)} onContextMenu={(x, y) => { setSelectedTrack(track.id); setSelectedClip(clip.id); setSelectedNote(null); setPanel("clip"); setActiveEditor("arrangement"); setContextMenu({ kind: "clip", clipId: clip.id, trackId: track.id, x, y }); }} />)}
              {(track.midiClips ?? []).map((clip) => <MidiClipBlock key={clip.id} clip={clip} notes={track.notes.filter((note) => note.midiClipId === clip.id)} selected={selectedMidiClip === clip.id || allItemsSelected} pps={beatSeconds * pixelsPerSecond} snapStep={1} snap={snap} tool={editTool} onSelect={() => { setAllItemsSelected(false); setSelectedTrack(track.id); setSelectedMidiClip(clip.id); setSelectedClip(null); setSelectedNote(null); setActiveEditor("arrangement"); }} onOpen={() => openMidiEditor(track.id, clip.id)} onUpdate={(update) => updateMidiClip(track.id, clip.id, update)} onDelete={() => removeMidiClip(track.id, clip.id)} onContextMenu={(x, y) => {
                setSelectedTrack(track.id); setSelectedMidiClip(clip.id);
                setContextMenu({ kind: "midiClip", midiClipId: clip.id, trackId: track.id, x, y });
              }} />)}
              <div className="playhead" style={{ left: `${snapshot.position * pixelsPerSecond}px` }} />
            </div>
          </div>;
          })}
          {session.tracks.length === 0 && <div className="timeline-empty"><Music2 size={22} /><strong>Start with a track</strong><span>Import audio or create an instrument lane.</span></div>}
        </div>
      </div>
      <div className="arrangement-footer"><span>{session.tracks.length} {session.tracks.length === 1 ? "track" : "tracks"}</span><span>Local project audio · {session.timeSignature} · {session.tempo} BPM</span></div>
    </section>

    {inspectorVisible && <div className="dock-resize-handle" role="separator" aria-label="Resize lower dock" aria-orientation="horizontal" aria-valuenow={dockHeight} tabIndex={0} onKeyDown={(event) => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const next = clamp(dockHeight + (event.key === "ArrowUp" ? 12 : -12), 150, Math.floor(window.innerHeight * 0.65));
        setDockHeight(next); localStorage.setItem("prism.dockHeight", String(next)); event.preventDefault();
      }
    }} onPointerDown={(event) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      (event.currentTarget as HTMLElement).dataset.dragY = String(event.clientY);
      (event.currentTarget as HTMLElement).dataset.dragHeight = String(dockHeight);
    }} onPointerMove={(event) => {
      const element = event.currentTarget as HTMLElement;
      if (!element.hasPointerCapture(event.pointerId)) return;
      const startY = Number(element.dataset.dragY);
      const startHeight = Number(element.dataset.dragHeight);
      setDockHeight(clamp(startHeight + startY - event.clientY, 150, Math.floor(window.innerHeight * 0.65)));
    }} onPointerUp={(event) => {
      event.currentTarget.releasePointerCapture(event.pointerId);
      localStorage.setItem("prism.dockHeight", String(dockHeight));
    }} />}
    {inspectorVisible ? <section className={`workstation-bottom ${panel === "effects" ? "effects-open" : ""} ${panel === "routing" ? "routing-open" : ""} ${panel === "sampler" ? "sampler-open" : ""} ${panel === "drums" ? "drums-open" : ""}`} style={{ flexBasis: `${dockHeight}px` }} onPointerDown={() => setActiveEditor(activeShortcutContext(panel))}>
      <nav className="lower-panel-tabs" aria-label="Workstation panels">
        {(["mixer", "clip", "piano", "sampler", "drums", "effects", "routing", "devices"] as const).map((tab) => <button key={tab} className={`lower-tab ${panel === tab ? "active" : ""}`} data-testid={`tab-${tab}`} onClick={() => { if (tab === "effects") setSelectedEffectBusId(""); setPanel(tab); setActiveEditor(activeShortcutContext(tab)); }}>{tab === "mixer" ? <SlidersHorizontal size={13} /> : tab === "clip" ? <AudioLines size={13} /> : tab === "piano" || tab === "drums" ? <Music2 size={13} /> : tab === "sampler" || tab === "routing" ? <AudioLines size={13} /> : tab === "effects" ? <Sparkles size={13} /> : <Headphones size={13} />}{tab === "clip" ? "Clip" : tab === "devices" ? "I/O" : tab[0].toUpperCase() + tab.slice(1)}</button>)}
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
          onOpenPattern={() => { setPanel("piano"); setActiveEditor("piano"); }}
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
          onOpenPattern={() => { setPanel("piano"); setActiveEditor("piano"); }}
        />
      </div> : <div className="panel-empty">Select a drum track to assign samples and build a pad pattern.</div>)}
      {panel === "piano" && <div className="piano-panel">
        <div className="piano-tools">
          <SongKeyControls value={songKey} onChange={setSongKey} trackId={selectedPatternTrack?.id} />
          <button className={`button button-subtle midi-view-toggle ${smartView ? "active" : ""}`} type="button" data-testid="button-smart-view" data-track-id={selectedPatternTrack?.id ?? ""} aria-pressed={smartView} onClick={toggleSmartView}>Smart View</button>
          <button className={`button button-subtle midi-view-toggle ${scaleSnap ? "active" : ""}`} type="button" data-testid="button-scale-snap" data-track-id={selectedPatternTrack?.id ?? ""} aria-pressed={scaleSnap} disabled={!songKey} title={!songKey ? "Select a Song Key before enabling Scale Snap." : "Constrain new and moved notes to the Song Key; hold Alt for chromatic movement."} onClick={toggleScaleSnap}>Scale Snap</button>
          {smartView && songKey && <span className="scale-guide-legend" data-testid="text-scale-guide">
            {rootNames[songKey.root]} {songKey.scale === "major" ? "Major" : "Natural minor"} · {allowedPitchClasses(songKey).map((pitch) => rootNames[pitch]).join(" ")}
          </span>}
          {smartView && !songKey && <span className="song-key-prompt" data-testid="text-song-key-prompt">Choose a Song Key to show scale guides.</span>}
          {selectedInstrument && <>
            <label>Instrument<select data-testid="select-oscillator" value={selectedInstrument.instrument?.waveform ?? "triangle"} onChange={(event) => selectedInstrument.instrument && updateTrack(selectedInstrument.id, { instrument: { ...selectedInstrument.instrument, waveform: event.target.value as OscillatorType } })}>{["sine", "triangle", "square", "sawtooth"].map((wave) => <option key={wave}>{wave}</option>)}</select></label>
            <label>Attack<input data-testid="input-instrument-attack" type="number" min="0.001" max="4" step="0.001" value={selectedInstrument.instrument?.attack ?? 0.01} onChange={(event) => updateInstrumentParameter("attack", Number(event.target.value))} /></label>
            <label>Decay<input data-testid="input-instrument-decay" type="number" min="0.001" max="4" step="0.001" value={selectedInstrument.instrument?.decay ?? 0.12} onChange={(event) => updateInstrumentParameter("decay", Number(event.target.value))} /></label>
            <label>Sustain<input data-testid="input-instrument-sustain" type="number" min="0" max="1" step="0.01" value={selectedInstrument.instrument?.sustain ?? 0.65} onChange={(event) => updateInstrumentParameter("sustain", Number(event.target.value))} /></label>
            <label>Release<input data-testid="input-instrument-release" type="number" min="0.005" max="4" step="0.005" value={selectedInstrument.instrument?.release ?? 0.18} onChange={(event) => updateInstrumentParameter("release", Number(event.target.value))} /></label>
          </>}
          {!selectedInstrument && <span className="pattern-track-label" data-testid="text-pattern-track">
            {selectedPatternTrack ? `MIDI · ${selectedPatternTrack.name}` : "Select a MIDI track"}
          </span>}
          {selectedPatternTrack && <label className="midi-clip-picker">Clip<select data-testid="select-midi-clip" value={selectedMidiClipData?.id ?? ""} onChange={(event) => {
            setSelectedMidiClip(event.target.value || null); setSelectedNote(null);
           }}><option value="">No clip selected</option>{(selectedPatternTrack.midiClips ?? []).map((clip) => <option key={clip.id} value={clip.id}>{clip.name}</option>)}</select></label>}
          {selectedPatternTrack && <button className="button button-subtle" data-testid="button-add-midi-note" disabled={selectedPatternTrack.type === "unsupported"} onClick={() => {
            const pitch = selectedPatternTrack.type === "sampler"
              ? selectedPatternTrack.sampler?.rootNote ?? 60
              : selectedPatternTrack.type === "drum"
                ? selectedPatternTrack.drumKit?.pads[0]?.note ?? 36
                : 60;
            addMidiNote(selectedPatternTrack.id, pitch);
          }}><Plus size={13} /> Add note</button>}
          {selectedPatternNote && <>
            <label>Pitch<input data-testid="input-note-pitch" type="number" min="0" max="127" value={selectedPatternNote.pitch} onChange={(event) => updateNote(selectedPatternTrack!.id, selectedPatternNote.id, {
              pitch: constrainCreatedPitch(Math.round(clamp(Number(event.target.value), 0, 127)), songKey, scaleSnap),
            })} /></label>
            <label>Velocity<input data-testid="input-note-velocity" type="range" min="1" max="127" value={selectedPatternNote.velocity} onChange={(event) => updateNote(selectedPatternTrack!.id, selectedPatternNote.id, { velocity: Number(event.target.value) })} /></label>
            <button className="icon-button compact danger-hover" data-testid="button-delete-midi-note" title="Delete selected note" onClick={() => { if (selectedNote) removeNote(selectedNote); }}><Trash2 size={13} /></button>
          </>}
        </div>
        <PianoRollSurface
          gridRef={pianoGridRef}
          keyboardRef={pianoKeyboardRef}
          rulerRef={pianoRulerRef}
          trackId={selectedPatternTrack?.id ?? ""}
          notes={pianoNotes}
          selectedNoteId={selectedNote}
          allSelected={allItemsSelected}
          beatWidth={pianoBeatWidth}
          contentWidth={pianoContentWidth}
          beatsPerBar={beatsPerBar(session.timeSignature)}
          snap={snap}
          tool={editTool}
          scaleKey={songKey}
          smartView={smartView}
          scaleSnap={scaleSnap}
          canCreate={Boolean(selectedPatternTrack && selectedPatternTrack.type !== "unsupported")}
          onCreate={(beat, pitch, chromaticOverride) => {
            if (selectedPatternTrack) createMidiNoteAt(selectedPatternTrack.id, beat, pitch, chromaticOverride);
          }}
          onUnavailableCreate={() => setNotice("Select a supported sampler, drum, or instrument track to create MIDI notes.")}
          onSelectNote={(noteId) => {
            setAllItemsSelected(false);
            setSelectedNote(noteId);
            if (selectedPatternTrack) setSelectedTrack(selectedPatternTrack.id);
          }}
          onChangeNote={(noteId, update) => {
            if (selectedPatternTrack) updateNote(selectedPatternTrack.id, noteId, update);
          }}
          onDeleteNote={removeNote}
          onSplitNote={splitMidiNote}
          onContextMenu={(noteId, x, y) => {
            if (!selectedPatternTrack) return;
            setSelectedNote(noteId);
            setSelectedTrack(selectedPatternTrack.id);
            setContextMenu({ kind: "note", noteId, trackId: selectedPatternTrack.id, x, y });
          }}
        />
         {!selectedPatternTrack && <div className="piano-hint">Choose an instrument, sampler, or drum track to edit MIDI notes. Double-click the grid to place a note.</div>}
        {selectedPatternTrack?.type === "unsupported" && <div className="piano-hint">This track’s MIDI is preserved but cannot play until you recover it as a supported instrument.</div>}
      </div>}
      {panel === "routing" && <RoutingPanel
        session={session}
        selectedTrackId={selectedTrack}
        meters={snapshot.meters}
        allowedBusTargets={(busId) => getAllowedBusTargets(session.tracks, session.buses, busId)}
        onChange={setSession}
        onSelectTrack={setSelectedTrack}
        onEditBusEffects={(busId) => { setSelectedEffectBusId(busId); setPanel("effects"); setActiveEditor("effects"); }}
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
    </section> : <button className="show-lower-panel" onClick={() => { setInspectorVisible(true); localStorage.setItem("prism.inspectorVisible", "true"); }}><PanelBottom size={13} /> Show dock</button>}
    {contextMenu && <div className="workstation-context-backdrop" data-testid="workstation-context-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setContextMenu(null); }}>
      <div className="workstation-context-menu" role="menu" data-testid="workstation-context-menu" style={{ left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 190)), top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 160)) }} onContextMenu={(event) => event.preventDefault()}>
        <span className="context-menu-heading">{contextMenu.kind === "clip" ? "Audio clip" : contextMenu.kind === "midiClip" ? "MIDI clip" : "MIDI note"}</span>
        <button role="menuitem" data-testid="context-duplicate" onClick={() => {
          if (contextMenu.kind === "clip") duplicateClipById(contextMenu.clipId);
          else if (contextMenu.kind === "midiClip") duplicateMidiClip(contextMenu.midiClipId);
          else duplicateNote(contextMenu.noteId);
          setContextMenu(null);
        }}>Duplicate</button>
        <button role="menuitem" data-testid="context-split" onClick={() => {
          if (contextMenu.kind === "clip") splitClipById(contextMenu.clipId);
          else if (contextMenu.kind === "midiClip") splitMidiClipById(contextMenu.midiClipId);
          else splitMidiNote(contextMenu.noteId);
          setContextMenu(null);
        }}>Split at playhead</button>
        <button role="menuitem" className="context-danger" data-testid="context-delete" onClick={() => {
          if (contextMenu.kind === "clip") removeClip(contextMenu.clipId);
          else if (contextMenu.kind === "midiClip") removeMidiClip(contextMenu.trackId, contextMenu.midiClipId);
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
  const begin = (event: ReactPointerEvent<HTMLElement>, edge: "move" | "left" | "right") => {
    if (event.button !== 0 || tool === "erase" || tool === "split") return;
    event.preventDefault(); event.stopPropagation(); onSelect();
    drag.current = { x: event.clientX, start: clip.startSeconds, duration: clip.durationSeconds, edge };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
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
  const sourceDuration = Math.max(clip.sourceDurationSeconds, .001);
  const visibleWaveform = getWaveformWindow(
    clip.waveform,
    sourceDuration,
    sourceStart,
    width,
    112,
  );
  const waveformBars = visibleWaveform.map((peak, index) => {
    const amplitude = Math.max(0, Math.min(1, Number.isFinite(peak) ? peak : 0)) * 45;
    const x = index + 0.5;
    return `M${x} ${50 - amplitude}V${50 + amplitude}`;
  }).join("");
  return <div className={`audio-clip ${selected ? "selected" : ""}`} data-testid={`clip-${clip.id}`} style={{ left: `${start * pps}px`, width: `${Math.max(1, width * pps)}px` }} onClick={(event) => { event.stopPropagation(); if (tool === "erase") onDelete(); else if (tool === "split") onSplit(); else onSelect(); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onContextMenu(event.clientX, event.clientY); }} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
    <button className="trim-edge trim-left" data-testid={`trim-left-${clip.id}`} aria-label="Trim clip start" onPointerDown={(event) => begin(event, "left")} />
    <div className="clip-body" onPointerDown={(event) => begin(event, "move")}><div className="clip-topline"><span className="clip-label">{clip.name}</span><button data-testid={`button-delete-clip-${clip.id}`} aria-label={`Delete ${clip.name}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onDelete(); }}><X size={12} /></button></div>
      <svg className="waveform" viewBox={`0 0 ${Math.max(1, visibleWaveform.length)} 100`} preserveAspectRatio="none" role="img" aria-label={`${clip.name} source waveform`}>
        <line className="waveform-baseline" x1="0" x2={Math.max(1, visibleWaveform.length)} y1="50" y2="50" />
        <path d={waveformBars} />
      </svg>
      <span className="clip-duration">{formatSeconds(clip.durationSeconds)}</span><span className="clip-fades" style={{ "--fade-in": `${clip.fadeInSeconds / Math.max(clip.durationSeconds, .01) * 100}%`, "--fade-out": `${clip.fadeOutSeconds / Math.max(clip.durationSeconds, .01) * 100}%` } as CSSProperties} />
    </div>
    <button className="trim-edge trim-right" data-testid={`trim-right-${clip.id}`} aria-label="Trim clip end" onPointerDown={(event) => begin(event, "right")} />
  </div>;
}

function MidiClipBlock({ clip, notes, selected, pps, snap, snapStep, tool, onSelect, onOpen, onUpdate, onDelete, onContextMenu }: {
  clip: MidiClip;
  notes: MidiNote[];
  selected: boolean;
  pps: number;
  snap: boolean;
  snapStep: number;
  tool: EditTool;
  onSelect: () => void;
  onOpen: () => void;
  onUpdate: (update: Partial<MidiClip>) => void;
  onDelete: () => void;
  onContextMenu: (x: number, y: number) => void;
}) {
  const drag = useRef<{ x: number; start: number; duration: number; side: "move" | "right" } | null>(null);
  const [preview, setPreview] = useState<{ start: number; duration: number } | null>(null);
  const start = preview?.start ?? clip.startBeat;
  const duration = preview?.duration ?? clip.durationBeats;
  const begin = (event: ReactPointerEvent<HTMLElement>, side: "move" | "right") => {
    if (event.button !== 0 || tool === "erase" || tool === "split") return;
    event.preventDefault(); event.stopPropagation(); onSelect();
    drag.current = { x: event.clientX, start: clip.startBeat, duration: clip.durationBeats, side };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const state = drag.current;
    const rawDelta = (event.clientX - state.x) / pps;
    const quantize = (value: number) => snap ? Math.round(value / snapStep) * snapStep : value;
    if (state.side === "move") {
      setPreview({ start: Math.max(0, quantize(state.start + rawDelta)), duration: state.duration });
    } else {
      setPreview({ start: state.start, duration: Math.max(.25, quantize(state.duration + rawDelta)) });
    }
  };
  const finish = () => {
    if (preview) onUpdate({ startBeat: preview.start, durationBeats: preview.duration });
    setPreview(null); drag.current = null;
  };
  return <div className={`midi-clip ${selected ? "selected" : ""}`} data-testid={`midi-clip-${clip.id}`}
    style={{ left: `${start * pps}px`, width: `${Math.max(1, duration * pps)}px` }}
    onClick={(event) => { event.stopPropagation(); if (tool === "erase") onDelete(); else if (tool === "select") onSelect(); }}
    onDoubleClick={(event) => { event.stopPropagation(); onOpen(); }}
    onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onContextMenu(event.clientX, event.clientY); }}
    onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
    <button className="midi-clip-body" type="button" title={`${clip.name} · ${notes.length} notes · double-click to edit`} onPointerDown={(event) => begin(event, "move")}>
      <span className="midi-clip-name">{clip.name}</span>
      <span className="midi-clip-notes">{notes.map((note) => <i key={note.id} style={{
        left: `${Math.max(0, (note.startBeat - clip.startBeat) / clip.durationBeats) * 100}%`,
        width: `${Math.max(1, note.durationBeats / clip.durationBeats * 100)}%`,
        bottom: `${Math.max(8, Math.min(88, note.pitch / 127 * 80))}%`,
        opacity: .35 + note.velocity / 190,
      }} />)}</span>
      <small>{notes.length} notes</small>
    </button>
    <button className="midi-clip-trim" type="button" aria-label="Resize MIDI clip" onPointerDown={(event) => begin(event, "right")} />
  </div>;
}

function MeterBar({ meter, id }: { meter?: Meter; id: string }) {
  const peak = Math.max(0, Math.min(1, meter?.peak ?? 0));
  const [heldPeak, setHeldPeak] = useState(peak);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    setHeldPeak((current) => Math.max(peak, current * .985));
    if ((meter?.peak ?? 0) >= .995) setClipped(true);
  }, [peak]);
  const clearPeak = () => { setHeldPeak(0); setClipped(false); };
  return <div className={`mixer-meter ${clipped ? "is-clipping" : ""}`} data-testid={`meter-${id}`} role="meter" aria-label={`${id} output level; click to reset peak`} aria-valuemin={0} aria-valuemax={1} aria-valuenow={peak} title={`${Math.round(peak * 100)}% peak · click to clear peak`} tabIndex={0} onClick={clearPeak} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); clearPeak(); } }}>
    <span style={{ transform: `scaleX(${peak})` }} /><i style={{ left: `${heldPeak * 100}%` }} /><b aria-hidden="true" />
  </div>;
}

function beatsPerBar(meter: string): number { const [top] = meter.split("/").map(Number); return top || 4; }
function clamp(value: number, low: number, high: number): number { return Math.max(low, Math.min(high, Number.isFinite(value) ? value : low)); }
function formatSeconds(seconds: number): string { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`; }
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
