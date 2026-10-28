import type {
  DrumKitState,
  DrumPadState,
  SamplerState,
  SongSession,
  Track,
} from "./types";

export const maxDrumPads = 16;

const defaultPads: Array<Pick<DrumPadState, "name" | "note">> = [
  { name: "Kick", note: 36 },
  { name: "Snare", note: 38 },
  { name: "Closed Hat", note: 42 },
  { name: "Open Hat", note: 46 },
  { name: "Clap", note: 39 },
  { name: "Low Tom", note: 43 },
  { name: "Ride", note: 51 },
  { name: "Crash", note: 49 },
];

export type SampleTrigger = {
  assetId: string;
  playbackRate: number;
  gain: number;
};

export function createDefaultSamplerState(): SamplerState {
  return { sampleAssetId: null, rootNote: 60, gain: 1 };
}

export function createDefaultDrumKit(): DrumKitState {
  return {
    patternLengthBars: 1,
    patternStartBeat: 0,
    pads: defaultPads.map((pad) => ({
      id: crypto.randomUUID(),
      ...pad,
      sampleAssetId: null,
      gain: 1,
    })),
  };
}

export function isSamplerState(value: unknown): value is SamplerState {
  if (typeof value !== "object" || value === null) return false;
  const sampler = value as Partial<SamplerState>;
  return (
    (sampler.sampleAssetId === null ||
      (typeof sampler.sampleAssetId === "string" && sampler.sampleAssetId.trim().length > 0)) &&
    Number.isInteger(sampler.rootNote) &&
    Number(sampler.rootNote) >= 0 &&
    Number(sampler.rootNote) <= 127 &&
    Number.isFinite(sampler.gain) &&
    Number(sampler.gain) >= 0 &&
    Number(sampler.gain) <= 1.5
  );
}

export function isDrumKitState(value: unknown): value is DrumKitState {
  if (typeof value !== "object" || value === null) return false;
  const kit = value as Partial<DrumKitState>;
  if (
    !Array.isArray(kit.pads) ||
    kit.pads.length > maxDrumPads ||
    (kit.patternLengthBars !== undefined &&
      (!Number.isInteger(kit.patternLengthBars) || Number(kit.patternLengthBars) < 1 || Number(kit.patternLengthBars) > 8)) ||
    (kit.patternStartBeat !== undefined &&
      (!Number.isFinite(kit.patternStartBeat) || Number(kit.patternStartBeat) < 0 || Number(kit.patternStartBeat) > 100_000))
  ) return false;
  const ids = new Set<string>();
  const notes = new Set<number>();
  for (const value of kit.pads) {
    if (typeof value !== "object" || value === null) return false;
    const pad = value as Partial<DrumPadState>;
    if (
      typeof pad.id !== "string" ||
      !pad.id.trim() ||
      ids.has(pad.id) ||
      typeof pad.name !== "string" ||
      !pad.name.trim() ||
      pad.name.length > 64 ||
      !Number.isInteger(pad.note) ||
      Number(pad.note) < 0 ||
      Number(pad.note) > 127 ||
      notes.has(Number(pad.note)) ||
      (pad.sampleAssetId !== null &&
        !(typeof pad.sampleAssetId === "string" && pad.sampleAssetId.trim())) ||
      !Number.isFinite(pad.gain) ||
      Number(pad.gain) < 0 ||
      Number(pad.gain) > 1.5
    ) return false;
    ids.add(pad.id);
    notes.add(Number(pad.note));
  }
  return true;
}

export function validateInstrumentTrackState(track: Track): string | null {
  if (track.type === "instrument" && !track.instrument) {
    return `Instrument track "${track.name}" has no supported synth settings.`;
  }
  if (track.type === "sampler" && !isSamplerState(track.sampler)) {
    return `Sampler track "${track.name}" has invalid sampler settings.`;
  }
  if (track.type === "drum" && !isDrumKitState(track.drumKit)) {
    return `Drum track "${track.name}" has invalid pad settings.`;
  }
  if (
    track.type === "unsupported" &&
    (!track.instrumentRecovery ||
      typeof track.instrumentRecovery.originalType !== "string" ||
      typeof track.instrumentRecovery.message !== "string" ||
      !track.instrumentRecovery.message.trim())
  ) {
    return `Track "${track.name}" contains unsupported instrument data without recovery information.`;
  }
  if (
    track.instrumentRecovery !== undefined &&
    track.instrumentRecovery !== null &&
    (typeof track.instrumentRecovery.originalType !== "string" ||
      typeof track.instrumentRecovery.message !== "string" ||
      !track.instrumentRecovery.message.trim())
  ) return `Track "${track.name}" has invalid instrument recovery information.`;
  if (!["audio", "instrument", "sampler", "drum", "unsupported"].includes(track.type)) {
    return `Track "${track.name}" uses an unsupported instrument type.`;
  }
  return null;
}

export function getSampleTrigger(
  track: Track,
  pitch: number,
  velocity: number,
): SampleTrigger | null {
  const safeVelocity = Math.max(1, Math.min(127, Number.isFinite(velocity) ? velocity : 96)) / 127;
  if (track.type === "sampler" && track.sampler?.sampleAssetId) {
    const semitones = Math.max(-36, Math.min(36, pitch - track.sampler.rootNote));
    return {
      assetId: track.sampler.sampleAssetId,
      playbackRate: Math.pow(2, semitones / 12),
      gain: safeVelocity * track.sampler.gain,
    };
  }
  if (track.type === "drum") {
    const pad = track.drumKit?.pads.find((item) => item.note === pitch);
    if (!pad?.sampleAssetId) return null;
    return {
      assetId: pad.sampleAssetId,
      playbackRate: 1,
      gain: safeVelocity * pad.gain,
    };
  }
  return null;
}

export function getAssignedSampleIds(session: SongSession): Set<string> {
  const ids = new Set<string>();
  for (const track of session.tracks) {
    if (track.type === "sampler" && track.sampler?.sampleAssetId) {
      ids.add(track.sampler.sampleAssetId);
    }
    if (track.type === "drum") {
      for (const pad of track.drumKit?.pads ?? []) {
        if (pad.sampleAssetId) ids.add(pad.sampleAssetId);
      }
    }
  }
  return ids;
}

export function countUnassignedInstrumentNotes(tracks: Track[]): number {
  let count = 0;
  for (const track of tracks) {
    if (track.type === "sampler" || track.type === "drum") {
      count += track.notes.filter((note) =>
        getSampleTrigger(track, note.pitch, note.velocity) === null,
      ).length;
    }
  }
  return count;
}
