import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  AudioLines,
  Circle,
  CircleStop,
  Clock3,
  Minus,
  Pause,
  Play,
  Plus,
  Save,
  SkipBack,
  SlidersHorizontal,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { AudioClip, SongSession, Track } from "@shared/types";
import prismLogo from "../assets/prism-logo.png";

type WorkstationProps = {
  session: SongSession;
  releaseTitle: string;
  onBack: () => void;
  onHome: () => void;
};

type TrackNodes = { gain: GainNode; pan: StereoPannerNode };

const basePixelsPerSecond = 56;

export function Workstation({ session: initialSession, releaseTitle, onBack, onHome }: WorkstationProps) {
  const [session, setSession] = useState(initialSession);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [saveError, setSaveError] = useState("");
  const [audioError, setAudioError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [lowerPanel, setLowerPanel] = useState<"mixer" | "clips" | null>("mixer");
  const audioContext = useRef<AudioContext | null>(null);
  const sourceNodes = useRef<AudioBufferSourceNode[]>([]);
  const trackNodes = useRef<Map<string, TrackNodes>>(new Map());
  const masterGain = useRef<GainNode | null>(null);
  const playOrigin = useRef(0);
  const rafId = useRef<number>(0);
  const playheadAtStart = useRef(0);
  const isSoloed = useMemo(() => session.tracks.some((track) => track.solo), [session.tracks]);
  const pixelsPerSecond = basePixelsPerSecond * zoom;
  const clips = useMemo(() => session.tracks.flatMap((track) => track.clips.map((clip) => ({ track, clip }))), [session.tracks]);
  const totalDuration = Math.max(30, ...clips.map(({ clip }) => clip.startSeconds + clip.durationSeconds));
  const rulerMarks = Array.from({ length: Math.ceil(totalDuration / Math.max(1, 240 / pixelsPerSecond)) + 1 }, (_, i) => i);

  useEffect(() => {
    setSession(initialSession);
    setPlayhead(0);
    setPlaying(false);
  }, [initialSession.id]);

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
          setSaveError(cause instanceof Error ? cause.message : "Could not save the song session.");
        }
      });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [session]);

  const stopSources = useCallback(() => {
    sourceNodes.current.forEach((source) => {
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
    });
    sourceNodes.current = [];
  }, []);

  const stopPlayback = useCallback((reset = false) => {
    cancelAnimationFrame(rafId.current);
    stopSources();
    setPlaying(false);
    if (reset) setPlayhead(0);
  }, [stopSources]);

  useEffect(() => () => {
    cancelAnimationFrame(rafId.current);
    stopSources();
    void audioContext.current?.close();
  }, [stopSources]);

  useEffect(() => window.prism.onCloseRequested(() => {
    void window.prism.saveSession(session).then(() => {
      setSaveStatus("saved");
      return window.prism.finishClose();
    }).catch((cause: unknown) => {
      setSaveStatus("error");
      setSaveError(cause instanceof Error ? cause.message : "Could not save before closing PRISM.");
    });
  }), [session]);

  useEffect(() => {
    for (const track of session.tracks) {
      const nodes = trackNodes.current.get(track.id);
      if (!nodes || !audioContext.current) continue;
      const shouldMute = track.muted || (isSoloed && !track.solo);
      nodes.gain.gain.setTargetAtTime(shouldMute ? 0 : track.volume, audioContext.current.currentTime, 0.015);
      nodes.pan.pan.setTargetAtTime(track.pan, audioContext.current.currentTime, 0.015);
    }
  }, [session.tracks, isSoloed]);

  const updateTrack = (trackId: string, update: Partial<Track>) => {
    setSession((current) => ({
      ...current,
      tracks: current.tracks.map((track) => track.id === trackId ? { ...track, ...update } : track),
    }));
  };

  const startPlayback = async (from = playhead) => {
    setAudioError("");
    if (!clips.some(({ clip }) => clip.durationSeconds > 0)) {
      setAudioError("Import a supported audio file to start playback.");
      return;
    }
    const context = audioContext.current ?? new AudioContext();
    audioContext.current = context;
    if (context.state === "suspended") await context.resume();
    stopSources();
    trackNodes.current.clear();
    masterGain.current?.disconnect();
    const master = context.createGain();
    master.gain.value = 0.9;
    master.connect(context.destination);
    masterGain.current = master;

    const startAt = context.currentTime + 0.08;
    const activeTracks = session.tracks.filter((track) => !track.muted && (!isSoloed || track.solo));
    for (const track of activeTracks) {
      const gain = context.createGain();
      const pan = context.createStereoPanner();
      gain.gain.value = track.volume;
      pan.pan.value = track.pan;
      gain.connect(pan);
      pan.connect(master);
      trackNodes.current.set(track.id, { gain, pan });
      for (const clip of track.clips) {
        if (clip.durationSeconds <= 0 || clip.startSeconds + clip.durationSeconds <= from) continue;
        try {
          const response = await fetch(window.prism.assetUrl(clip.assetId));
          if (!response.ok) throw new Error("Audio file could not be read.");
          const decoded = await context.decodeAudioData(await response.arrayBuffer());
          const offset = Math.max(0, from - clip.startSeconds);
          const source = context.createBufferSource();
          source.buffer = decoded;
          const clipGain = context.createGain();
          clipGain.gain.value = clip.gain;
          source.connect(clipGain);
          clipGain.connect(gain);
          source.start(startAt + Math.max(0, clip.startSeconds - from), offset);
          sourceNodes.current.push(source);
        } catch (cause) {
          setAudioError(cause instanceof Error ? `${clip.name}: ${cause.message}` : `Could not decode ${clip.name}.`);
        }
      }
    }
    playheadAtStart.current = from;
    playOrigin.current = startAt;
    setPlaying(true);
    const tick = () => {
      const nextPosition = playheadAtStart.current + Math.max(0, context.currentTime - playOrigin.current);
      setPlayhead(nextPosition);
      if (nextPosition >= totalDuration) {
        stopPlayback();
        setPlayhead(totalDuration);
        return;
      }
      rafId.current = requestAnimationFrame(tick);
    };
    rafId.current = requestAnimationFrame(tick);
  };

  const togglePlayback = () => {
    if (playing) {
      const context = audioContext.current;
      if (context) setPlayhead(playheadAtStart.current + Math.max(0, context.currentTime - playOrigin.current));
      stopPlayback();
    } else {
      void startPlayback(playhead);
    }
  };

  const importAudio = async () => {
    setAudioError("");
    try {
      const imported = await window.prism.importAudio(session.id);
      if (!imported) return;
      const response = await fetch(imported.assetUrl);
      if (!response.ok) throw new Error("PRISM could not read the imported audio.");
      const context = audioContext.current ?? new AudioContext();
      audioContext.current = context;
      const decoded = await context.decodeAudioData(await response.arrayBuffer());
      const channel = decoded.getChannelData(0);
      const count = 112;
      const waveform = Array.from({ length: count }, (_, index) => {
        const start = Math.floor((index / count) * channel.length);
        const end = Math.max(start + 1, Math.floor(((index + 1) / count) * channel.length));
        let peak = 0;
        for (let sample = start; sample < end; sample += 1) peak = Math.max(peak, Math.abs(channel[sample]));
        return Math.max(0.035, peak);
      });
      const clip = { ...imported.clip, durationSeconds: decoded.duration, waveform };
      setSession((current) => ({
        ...current,
        tracks: current.tracks.map((track, index) =>
          index === 0 && track.id === current.tracks[0]?.id
            ? { ...track, clips: track.clips.map((entry) => entry.id === clip.id ? clip : entry) }
            : track,
        ),
      }));
      setSelectedClip(clip.id);
    } catch (cause) {
      setAudioError(cause instanceof Error ? `${cause.message} Try a WAV or MP3 file.` : "The audio file could not be imported.");
    }
  };

  const addTrack = () => {
    const number = session.tracks.length + 1;
    const track: Track = {
      id: crypto.randomUUID(),
      name: `Audio ${number}`,
      volume: 0.85,
      pan: 0,
      muted: false,
      solo: false,
      clips: [],
    };
    setSession((current) => ({ ...current, tracks: [...current.tracks, track] }));
  };

  const setClipPosition = (trackId: string, clipId: string, startSeconds: number) => {
    setSession((current) => ({
      ...current,
      tracks: current.tracks.map((track) => track.id !== trackId ? track : {
        ...track,
        clips: track.clips.map((clip) => clip.id === clipId ? { ...clip, startSeconds: Math.max(0, startSeconds) } : clip),
      }),
    }));
  };

  const removeSelectedClip = () => {
    if (!selectedClip) return;
    setSession((current) => ({
      ...current,
      tracks: current.tracks.map((track) => ({
        ...track,
        clips: track.clips.filter((clip) => clip.id !== selectedClip),
      })),
    }));
    setSelectedClip(null);
  };

  const updateTempo = (value: string) => {
    const tempo = Number(value);
    if (Number.isFinite(tempo) && tempo >= 20 && tempo <= 300) {
      setSession((current) => ({ ...current, tempo }));
    }
  };

  const manualSave = async () => {
    setSaveStatus("saving");
    try {
      await window.prism.saveSession(session);
      setSaveStatus("saved");
    } catch (cause) {
      setSaveStatus("error");
      setSaveError(cause instanceof Error ? cause.message : "Could not save the session.");
    }
  };

  const saveBeforeLeaving = async (navigate: () => void) => {
    setSaveStatus("saving");
    setSaveError("");
    try {
      await window.prism.saveSession(session);
      setSaveStatus("saved");
      navigate();
    } catch (cause) {
      setSaveStatus("error");
      setSaveError(cause instanceof Error ? cause.message : "Could not save before leaving the song.");
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
      if (event.code === "Space" && !event.repeat) {
        event.preventDefault();
        togglePlayback();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void manualSave();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d" && selectedClip) {
        event.preventDefault();
        setSession((current) => ({
          ...current,
          tracks: current.tracks.map((track) => {
            const clip = track.clips.find((item) => item.id === selectedClip);
            if (!clip) return track;
            const copy = { ...clip, id: crypto.randomUUID(), startSeconds: clip.startSeconds + clip.durationSeconds };
            return { ...track, clips: [...track.clips, copy] };
          }),
        }));
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedClip) {
        event.preventDefault();
        removeSelectedClip();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playing, playhead, session, selectedClip, saveStatus]);

  const beatSeconds = 60 / session.tempo;
  const rulerStep = beatSeconds * 4;
  const timeLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

  return (
    <main className="workstation">
      <header className="workstation-header">
        <div className="workstation-brand">
          <button className="mini-brand" title="PRISM project library" onClick={() => void saveBeforeLeaving(onHome)}><img className="workstation-logo" src={prismLogo} alt="" /><b>PRISM</b></button>
          <span className="crumb-divider">/</span>
          <button className="workstation-crumb" onClick={() => void saveBeforeLeaving(onBack)}>{releaseTitle}</button>
          <span className="crumb-divider">/</span>
          <strong className="current-song">{session.title}</strong>
        </div>
        <div className={`save-indicator ${saveStatus}`} title={saveError || "Session is stored locally"}>
          <span className="save-dot" />{saveStatus === "saving" ? "Saving…" : saveStatus === "error" ? "Save error" : "Saved"}
        </div>
        <button className="icon-button" title="Save now" onClick={() => void manualSave()}><Save size={17} /></button>
      </header>

      <section className="transport-bar">
        <div className="transport-actions">
          <button className="transport-button" title="Return to start" onClick={() => { stopPlayback(true); }}><SkipBack size={16} /></button>
          <button className="transport-play" title={playing ? "Pause" : "Play"} onClick={togglePlayback}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
          <button className="transport-button" title="Stop" onClick={() => stopPlayback(false)}><CircleStop size={17} /></button>
          <span className="transport-separator" />
          <button className="transport-button disabled-control" title="Recording is not implemented yet" disabled><Circle size={15} /></button>
          <span className="transport-position"><Clock3 size={14} /> {timeLabel(playhead)}</span>
        </div>
        <div className="transport-settings">
          <label className="tempo-control"><span>Tempo</span><input aria-label="Tempo in beats per minute" type="number" min={20} max={300} value={session.tempo} onChange={(event) => updateTempo(event.target.value)} /><small>BPM</small></label>
          <span className="time-signature"><span>Meter</span><b>{session.timeSignature}</b></span>
          <button className="icon-button compact disabled-control" disabled title="Metronome is not implemented yet"><AudioLines size={16} /></button>
        </div>
      </section>

      {saveError && <div className="workstation-notice error-notice" role="alert">{saveError}<button onClick={() => setSaveError("")}><X size={14} /></button></div>}
      {audioError && <div className="workstation-notice error-notice" role="alert">{audioError}<button onClick={() => setAudioError("")}><X size={14} /></button></div>}

      <section className="arrangement">
        <div className="arrangement-toolbar">
          <div className="arrangement-tools"><span className="panel-label">ARRANGEMENT</span><span className="tool-divider" /><button className="button button-subtle" onClick={() => void importAudio()}><Plus size={15} /> Import Audio</button><button className="button button-subtle" onClick={addTrack}><Plus size={15} /> Add Track</button></div>
          <div className="zoom-control"><span>Zoom</span><button className="icon-button compact" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.45, +(value - 0.15).toFixed(2)))}><Minus size={14} /></button><input aria-label="Timeline zoom" type="range" min="0.45" max="2.4" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><button className="icon-button compact" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(2.4, +(value + 0.15).toFixed(2)))}><Plus size={14} /></button></div>
        </div>
        <div className="timeline-scroll">
          <div className="timeline-content" style={{ width: `${Math.max(1000, totalDuration * pixelsPerSecond + 160)}px` }}>
            <div className="timeline-ruler-row">
              <div className="track-column-heading">TRACKS <button className="icon-button compact" title="Add track" onClick={addTrack}><Plus size={14} /></button></div>
              <div className="timeline-ruler" style={{ width: `${Math.max(1000, totalDuration * pixelsPerSecond + 160) - 242}px` }}>
                {rulerMarks.map((mark) => {
                  const time = mark * rulerStep;
                  return <div className="ruler-mark" key={mark} style={{ left: `${time * pixelsPerSecond}px` }}><span>{`BAR ${String(mark + 1).padStart(2, "0")}`}</span></div>;
                })}
              </div>
            </div>
            {session.tracks.map((track, index) => (
              <div className="timeline-track-row" key={track.id}>
                <div className="track-controls">
                  <span className={`track-color track-color-${index % 5}`} />
                  <button className="track-name" title="Rename track" onClick={() => {
                    const name = window.prompt("Track name", track.name);
                    if (name?.trim()) updateTrack(track.id, { name: name.trim() });
                  }}>{track.name}</button>
                  <div className="track-buttons"><button className={track.muted ? "track-toggle active" : "track-toggle"} onClick={() => updateTrack(track.id, { muted: !track.muted })} aria-label={`${track.muted ? "Unmute" : "Mute"} ${track.name}`}>{track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}</button><button className={track.solo ? "track-toggle solo-active" : "track-toggle"} onClick={() => updateTrack(track.id, { solo: !track.solo })} aria-label={`${track.solo ? "Unsolo" : "Solo"} ${track.name}`}>S</button></div>
                  <label className="track-level" title="Track volume"><span>VOL</span><input type="range" min="0" max="1" step="0.01" value={track.volume} onChange={(event) => updateTrack(track.id, { volume: Number(event.target.value) })} /><small>{Math.round(track.volume * 100)}</small></label>
                  <label className="track-pan" title="Pan"><span>PAN</span><input type="range" min="-1" max="1" step="0.01" value={track.pan} onChange={(event) => updateTrack(track.id, { pan: Number(event.target.value) })} /></label>
                </div>
                <div
                  className="timeline-lane"
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest(".audio-clip")) return;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setPlayhead(Math.max(0, (event.clientX - bounds.left + event.currentTarget.scrollLeft) / pixelsPerSecond));
                  }}
                >
                  {rulerMarks.map((mark) => <div key={mark} className="lane-gridline" style={{ left: `${mark * rulerStep * pixelsPerSecond}px` }} />)}
                  {track.clips.map((clip) => (
                    <AudioClipView
                      key={clip.id}
                      clip={clip}
                      selected={selectedClip === clip.id}
                      pixelsPerSecond={pixelsPerSecond}
                      onSelect={() => setSelectedClip(clip.id)}
                      onMove={(start) => setClipPosition(track.id, clip.id, start)}
                      onDelete={() => {
                        setSession((current) => ({ ...current, tracks: current.tracks.map((entry) => entry.id === track.id ? { ...entry, clips: entry.clips.filter((item) => item.id !== clip.id) } : entry) }));
                        setSelectedClip(null);
                      }}
                    />
                  ))}
                  <div className="playhead" style={{ left: `${playhead * pixelsPerSecond}px` }}><span /></div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="arrangement-footer"><span>{session.tracks.length} {session.tracks.length === 1 ? "track" : "tracks"}</span><span>Audio files remain stored locally on this device</span></div>
      </section>

      {lowerPanel && (
        <section className="lower-panel">
          <div className="lower-panel-tabs">
            <button className={lowerPanel === "mixer" ? "lower-tab active" : "lower-tab"} onClick={() => setLowerPanel("mixer")}><SlidersHorizontal size={14} /> Mixer</button>
            <button className={lowerPanel === "clips" ? "lower-tab active" : "lower-tab"} onClick={() => setLowerPanel("clips")}><AudioLines size={14} /> Clip details</button>
            <button className="icon-button compact collapse-lower" title="Collapse lower panel" onClick={() => setLowerPanel(null)}><X size={14} /></button>
          </div>
          {lowerPanel === "mixer" ? (
            <div className="mixer-channels">
              {session.tracks.map((track, index) => <div className="mixer-channel" key={track.id}>
                <div className="mixer-channel-name"><span className={`track-color track-color-${index % 5}`} />{track.name}</div>
                <div className="mixer-meter" aria-label="Level meters are not available yet" />
                <input className="mixer-fader" aria-label={`${track.name} volume`} type="range" min="0" max="1" step="0.01" value={track.volume} onChange={(event) => updateTrack(track.id, { volume: Number(event.target.value) })} />
                <div className="mixer-fader-value">{Math.round(track.volume * 100)}%</div>
              </div>)}
              <div className="mixer-channel master-channel"><div className="mixer-channel-name">MASTER</div><div className="mixer-meter" aria-label="Level meters are not available yet" /><div className="master-output"><Volume2 size={15} /> System output</div><div className="mixer-fader-value">Output</div></div>
            </div>
          ) : (
            <div className="clip-inspector">
              {clips.find(({ clip }) => clip.id === selectedClip) ? (() => {
                const chosen = clips.find(({ clip }) => clip.id === selectedClip)!;
                return <><div><span className="eyebrow">Selected audio</span><strong>{chosen.clip.name}</strong><small>On {chosen.track.name}</small></div><span>Start {timeLabel(chosen.clip.startSeconds)}</span><span>{formatTime(chosen.clip.durationSeconds)}</span><button className="button button-subtle danger-button" onClick={removeSelectedClip}><Trash2 size={14} /> Delete clip</button></>;
              })() : <span>Select a clip in the timeline to see its details.</span>}
            </div>
          )}
        </section>
      )}
      {!lowerPanel && <button className="show-lower-panel" onClick={() => setLowerPanel("mixer")}><Plus size={14} /> Show mixer</button>}
    </main>
  );
}

function AudioClipView({
  clip,
  selected,
  pixelsPerSecond,
  onSelect,
  onMove,
  onDelete,
}: {
  clip: AudioClip;
  selected: boolean;
  pixelsPerSecond: number;
  onSelect: () => void;
  onMove: (startSeconds: number) => void;
  onDelete: () => void;
}) {
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const dragState = useRef<{ pointerX: number; originalStart: number } | null>(null);
  return (
    <div
      className={`audio-clip ${selected ? "selected" : ""}`}
      style={{ left: `${(dragOffset ?? clip.startSeconds) * pixelsPerSecond}px`, width: `${Math.max(80, clip.durationSeconds * pixelsPerSecond)}px` }}
      onClick={(event) => { event.stopPropagation(); onSelect(); }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        event.preventDefault();
        dragState.current = { pointerX: event.clientX, originalStart: clip.startSeconds };
        setDragOffset(clip.startSeconds);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragState.current) return;
        const delta = (event.clientX - dragState.current.pointerX) / pixelsPerSecond;
        setDragOffset(Math.max(0, dragState.current.originalStart + delta));
      }}
      onPointerUp={(event) => {
        if (dragState.current) {
          const delta = (event.clientX - dragState.current.pointerX) / pixelsPerSecond;
          onMove(Math.max(0, dragState.current.originalStart + delta));
        }
        dragState.current = null;
        setDragOffset(null);
      }}
      onPointerCancel={() => { dragState.current = null; setDragOffset(null); }}
    >
      <div className="clip-topline"><span className="clip-label">{clip.name}</span><button title="Delete clip" aria-label={`Delete ${clip.name}`} onClick={(event) => { event.stopPropagation(); onDelete(); }}><X size={12} /></button></div>
      <div className="waveform" aria-label="Audio waveform">
        {clip.waveform.map((amplitude, index) => <span key={index} style={{ height: `${Math.max(4, amplitude * 82)}%` }} />)}
      </div>
      <span className="clip-duration">{formatTime(clip.durationSeconds)}</span>
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
