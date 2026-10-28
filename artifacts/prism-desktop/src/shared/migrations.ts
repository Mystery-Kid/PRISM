import type {
  AudioClip,
  AudioBus,
  BusSend,
  DrumKitState,
  EffectState,
  InstrumentRecoveryState,
  InstrumentState,
  JsonValue,
  MidiNote,
  SamplerState,
  SongSession,
  Track,
} from "./types";
import { validateAudioRouting } from "./audio-routing";
import { normalizeEffectState } from "./effect-definitions";
import {
  createDefaultDrumKit,
  createDefaultSamplerState,
  isDrumKitState,
  isSamplerState,
} from "./instrument-tracks";

const waveforms = new Set(["sine", "square", "sawtooth", "triangle"]);
const trackColors = ["#f47b54", "#72c4be", "#b295e8", "#e4b85e", "#7c9ef2"];

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function migrateEffects(value: unknown): EffectState[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const effect = record(item);
    const normalized = normalizeEffectState(effect);
    return normalized ? [normalized] : [];
  });
}

function migrateSends(value: unknown): BusSend[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("A saved audio send list is damaged.");
  return value.flatMap((item) => {
    const send = record(item);
    if (typeof send.busId !== "string" || !send.busId.trim()) return [];
    const id = typeof send.id === "string" && send.id.trim() ? send.id : crypto.randomUUID();
    return [{
      id,
      busId: send.busId,
      level: Math.min(1.5, Math.max(0, finite(send.level, 1))),
      placement: send.placement === "pre" ? "pre" : "post",
    }];
  });
}

function migrateBus(value: unknown, index: number): AudioBus {
  const bus = record(value);
  return {
    id: typeof bus.id === "string" && bus.id.trim() ? bus.id : crypto.randomUUID(),
    name: typeof bus.name === "string" && bus.name.trim()
      ? bus.name.trim().slice(0, 80)
      : `Bus ${index + 1}`,
    level: Math.min(1.5, Math.max(0, finite(bus.level, 1))),
    muted: bus.muted === true,
    solo: bus.solo === true,
    outputBusId: typeof bus.outputBusId === "string" && bus.outputBusId.trim()
      ? bus.outputBusId
      : null,
    sends: migrateSends(bus.sends),
    effects: migrateEffects(bus.effects),
  };
}

function migrateClip(value: unknown): AudioClip | null {
  const clip = record(value);
  if (
    typeof clip.id !== "string" ||
    typeof clip.assetId !== "string" ||
    typeof clip.name !== "string"
  ) return null;
  const waveform = Array.isArray(clip.waveform)
    ? clip.waveform.filter((peak): peak is number =>
      typeof peak === "number" && Number.isFinite(peak),
    ).slice(0, 2048).map((peak) => Math.min(1, Math.max(0, peak)))
    : [];
  return {
    id: clip.id,
    assetId: clip.assetId,
    name: clip.name,
    durationSeconds: Math.max(0, finite(clip.durationSeconds, 0)),
    sourceDurationSeconds: Math.max(
      Math.max(0, finite(clip.sourceStartSeconds, 0)) + Math.max(0, finite(clip.durationSeconds, 0)),
      finite(clip.sourceDurationSeconds, 0),
    ),
    startSeconds: Math.max(0, finite(clip.startSeconds, 0)),
    sourceStartSeconds: Math.max(0, finite(clip.sourceStartSeconds, 0)),
    gain: Math.min(2, Math.max(0, finite(clip.gain, 1))),
    fadeInSeconds: Math.max(0, finite(clip.fadeInSeconds, 0)),
    fadeOutSeconds: Math.max(0, finite(clip.fadeOutSeconds, 0)),
    waveform,
  };
}

function migrateNote(value: unknown): MidiNote | null {
  const note = record(value);
  if (typeof note.id !== "string") return null;
  return {
    id: note.id,
    pitch: Math.max(0, Math.min(127, Math.round(finite(note.pitch, 60)))),
    startBeat: Math.max(0, finite(note.startBeat, 0)),
    durationBeats: Math.max(0.0625, finite(note.durationBeats, 1)),
    velocity: Math.max(1, Math.min(127, Math.round(finite(note.velocity, 96)))),
  };
}

function migrateInstrument(value: unknown): InstrumentState {
  const instrument = record(value);
  const waveform = typeof instrument.waveform === "string" &&
      waveforms.has(instrument.waveform)
    ? instrument.waveform as OscillatorType
    : "sawtooth";
  return {
    waveform,
    attack: Math.min(4, Math.max(0.001, finite(instrument.attack, 0.01))),
    decay: Math.min(4, Math.max(0.001, finite(instrument.decay, 0.12))),
    sustain: Math.min(1, Math.max(0, finite(instrument.sustain, 0.65))),
    release: Math.min(4, Math.max(0.005, finite(instrument.release, 0.18))),
  };
}

function serializeRecoveryState(value: unknown): JsonValue | null {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? null : JSON.parse(serialized) as JsonValue;
  } catch {
    return null;
  }
}

function migrateRecovery(value: unknown): InstrumentRecoveryState | null {
  const recovery = record(value);
  if (
    typeof recovery.originalType !== "string" ||
    typeof recovery.message !== "string" ||
    !recovery.message.trim()
  ) return null;
  return {
    originalType: recovery.originalType,
    rawState: serializeRecoveryState(recovery.rawState),
    message: recovery.message.slice(0, 500),
  };
}

function unsupportedTrackData(track: Record<string, unknown>): JsonValue | null {
  const {
    id: _id,
    name: _name,
    color: _color,
    volume: _volume,
    pan: _pan,
    muted: _muted,
    solo: _solo,
    recordArmed: _recordArmed,
    clips: _clips,
    notes: _notes,
    effects: _effects,
    outputBusId: _outputBusId,
    sends: _sends,
    ...instrumentData
  } = track;
  return serializeRecoveryState(instrumentData);
}

function instrumentStateIsSupported(value: unknown): boolean {
  const instrument = record(value);
  return waveforms.has(String(instrument.waveform)) &&
    ["attack", "decay", "sustain", "release"].every((key) =>
      instrument[key] === undefined ||
      (typeof instrument[key] === "number" && Number.isFinite(instrument[key])),
    );
}

function migrateSampler(value: unknown): SamplerState {
  const sampler = record(value);
  return {
    sampleAssetId: typeof sampler.sampleAssetId === "string" && sampler.sampleAssetId.trim()
      ? sampler.sampleAssetId
      : null,
    rootNote: Math.max(0, Math.min(127, Math.round(finite(sampler.rootNote, 60)))),
    gain: Math.min(1.5, Math.max(0, finite(sampler.gain, 1))),
  };
}

function migrateDrumKit(value: unknown): DrumKitState {
  const kit = record(value);
  if (!Array.isArray(kit.pads)) return createDefaultDrumKit();
  return {
    patternLengthBars: Math.max(1, Math.min(8, Math.round(finite(kit.patternLengthBars, 1)))),
    patternStartBeat: Math.max(0, Math.min(100_000, finite(kit.patternStartBeat, 0))),
    pads: kit.pads.slice(0, 16).map((item, index) => {
      const pad = record(item);
      return {
        id: typeof pad.id === "string" && pad.id.trim() ? pad.id : crypto.randomUUID(),
        name: typeof pad.name === "string" && pad.name.trim()
          ? pad.name.trim().slice(0, 64)
          : `Pad ${index + 1}`,
        note: Math.max(0, Math.min(127, Math.round(finite(pad.note, 36 + index)))),
        sampleAssetId: typeof pad.sampleAssetId === "string" && pad.sampleAssetId.trim()
          ? pad.sampleAssetId
          : null,
        gain: Math.min(1.5, Math.max(0, finite(pad.gain, 1))),
      };
    }),
  };
}

function migrateTrack(value: unknown, index: number): Track {
  const track = record(value);
  const requestedType = typeof track.type === "string" ? track.type : null;
  const knownTypes = new Set(["audio", "instrument", "sampler", "drum", "unsupported"]);
  const type = requestedType === null
    ? "audio"
    : knownTypes.has(requestedType)
      ? requestedType as Track["type"]
      : "unsupported";
  const clips = Array.isArray(track.clips)
    ? track.clips.map(migrateClip).filter((clip): clip is AudioClip => clip !== null)
    : [];
  const notes = Array.isArray(track.notes)
    ? track.notes.map(migrateNote).filter((note): note is MidiNote => note !== null)
    : [];
  const colorIndex = index % trackColors.length;
  const savedRecovery = migrateRecovery(track.instrumentRecovery);
  let instrumentRecovery = savedRecovery;
  if (!instrumentRecovery && type === "unsupported") {
    instrumentRecovery = {
      originalType: requestedType ?? "unknown",
      rawState: unsupportedTrackData(track),
      message: `The saved "${requestedType ?? "unknown"}" instrument type is not supported. Its MIDI notes and source media were kept; recover it as a built-in instrument or assign it a sample.`,
    };
  } else if (!instrumentRecovery && type === "instrument" && !instrumentStateIsSupported(track.instrument)) {
    instrumentRecovery = {
      originalType: type,
      rawState: serializeRecoveryState(track.instrument),
      message: "Some saved synth settings are unsupported. MIDI notes were kept and safe synth defaults were restored.",
    };
  } else if (!instrumentRecovery && type === "sampler" && !isSamplerState(track.sampler)) {
    instrumentRecovery = {
      originalType: type,
      rawState: serializeRecoveryState(track.sampler),
      message: "Some saved sampler settings are unsupported. MIDI notes were kept; assign a supported audio sample to recover playback.",
    };
  } else if (!instrumentRecovery && type === "drum" && !isDrumKitState(track.drumKit)) {
    instrumentRecovery = {
      originalType: type,
      rawState: serializeRecoveryState(track.drumKit),
      message: "Some saved drum-pad settings are unsupported. MIDI notes were kept and default pads were restored for reassignment.",
    };
  }
  let sampler: SamplerState | null = null;
  let drumKit: DrumKitState | null = null;
  if (type === "sampler") {
    const migratedSampler = migrateSampler(track.sampler);
    sampler = isSamplerState(migratedSampler) ? migratedSampler : createDefaultSamplerState();
  } else if (type === "drum") {
    const migratedKit = migrateDrumKit(track.drumKit);
    drumKit = isDrumKitState(migratedKit) ? migratedKit : createDefaultDrumKit();
    if (instrumentRecovery && !isDrumKitState(migratedKit)) drumKit = createDefaultDrumKit();
  }
  return {
    id: typeof track.id === "string" ? track.id : crypto.randomUUID(),
    name: typeof track.name === "string" && track.name.trim() ? track.name : `Track ${index + 1}`,
    type,
    color: typeof track.color === "string" ? track.color : trackColors[colorIndex],
    volume: Math.min(1.5, Math.max(0, finite(track.volume, 0.85))),
    pan: Math.min(1, Math.max(-1, finite(track.pan, 0))),
    muted: track.muted === true,
    solo: track.solo === true,
    recordArmed: track.recordArmed === true,
    clips,
    notes,
    instrument: type === "instrument" ? migrateInstrument(track.instrument) : null,
    sampler,
    drumKit,
    instrumentRecovery,
    effects: migrateEffects(track.effects),
    outputBusId: typeof track.outputBusId === "string" && track.outputBusId.trim()
      ? track.outputBusId
      : null,
    sends: migrateSends(track.sends),
  };
}

export function migrateSongSession(value: unknown): SongSession {
  const session = record(value);
  if (
    typeof session.id !== "string" ||
    typeof session.releaseId !== "string" ||
    typeof session.title !== "string"
  ) {
    throw new Error("A song session in the project library is damaged.");
  }
  const tracks = Array.isArray(session.tracks)
    ? session.tracks.map(migrateTrack)
    : [];
  if (session.buses !== undefined && !Array.isArray(session.buses)) {
    throw new Error("The saved audio buses are damaged.");
  }
  const buses = Array.isArray(session.buses)
    ? session.buses.map(migrateBus)
    : [];
  validateAudioRouting(tracks, buses);
  const rawLoop = record(session.loopRange);
  const startSeconds = Math.max(0, finite(rawLoop.startSeconds, 0));
  const endSeconds = Math.max(0, finite(rawLoop.endSeconds, 0));
  const loopRange = rawLoop.enabled === true && endSeconds > startSeconds
    ? { enabled: true, startSeconds, endSeconds }
    : null;
  return {
    id: session.id,
    releaseId: session.releaseId,
    title: session.title,
    tempo: Math.min(300, Math.max(20, Math.round(finite(session.tempo, 120)))),
    timeSignature: typeof session.timeSignature === "string" ? session.timeSignature : "4/4",
    loopRange,
    metronomeEnabled: session.metronomeEnabled === true,
    masterVolume: Math.min(1.5, Math.max(0, finite(session.masterVolume, 1))),
    masterEffects: migrateEffects(session.masterEffects),
    buses,
    tracks,
    updatedAt: typeof session.updatedAt === "string" ? session.updatedAt : new Date().toISOString(),
  };
}
