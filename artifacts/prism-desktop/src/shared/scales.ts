import type { MidiViewSettings, SongKey } from "./types";

const intervals = {
  major: [0, 2, 4, 5, 7, 9, 11],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
} as const;

export function isSongKey(value: unknown): value is SongKey {
  if (!value || typeof value !== "object") return false;
  const key = value as Partial<SongKey>;
  return Number.isInteger(key.root) && key.root! >= 0 && key.root! <= 11 &&
    (key.scale === "major" || key.scale === "naturalMinor");
}

export function isMidiViewSettings(value: unknown): value is MidiViewSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Partial<MidiViewSettings>;
  return typeof settings.smartView === "boolean" && typeof settings.scaleSnap === "boolean";
}

export function pitchClass(pitch: number): number {
  return ((Math.round(pitch) % 12) + 12) % 12;
}

export function allowedPitchClasses(key: SongKey): number[] {
  return intervals[key.scale].map((interval) => (key.root + interval) % 12);
}

export function isPitchInScale(pitch: number, key: SongKey): boolean {
  return allowedPitchClasses(key).includes(pitchClass(pitch));
}

/** Ties resolve downward consistently at all octave boundaries. */
export function nearestScalePitch(pitch: number, key: SongKey): number {
  const target = Math.min(127, Math.max(0, Math.round(pitch)));
  for (let distance = 0; distance <= 12; distance++) {
    const lower = target - distance;
    if (lower >= 0 && isPitchInScale(lower, key)) return lower;
    const upper = target + distance;
    if (upper <= 127 && isPitchInScale(upper, key)) return upper;
  }
  return target;
}

/** Move by scale degrees, leaving an untouched out-of-scale note unchanged. */
export function movePitchByScaleSteps(pitch: number, steps: number, key: SongKey): number {
  let result = Math.max(0, Math.min(127, Math.round(pitch)));
  const direction = Math.sign(steps);
  for (let count = 0; count < Math.min(128, Math.abs(Math.round(steps))); count++) {
    let candidate = result + direction;
    while (candidate >= 0 && candidate <= 127 && !isPitchInScale(candidate, key)) candidate += direction;
    if (candidate < 0 || candidate > 127) break;
    result = candidate;
  }
  return result;
}
