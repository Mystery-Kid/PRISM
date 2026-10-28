export type TimeSignatureParts = { numerator: number; denominator: number };

export function parseTimeSignature(value: string): TimeSignatureParts {
  const [numeratorText, denominatorText] = value.split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  if (
    !Number.isInteger(numerator) ||
    numerator < 1 ||
    numerator > 32 ||
    ![2, 4, 8, 16].includes(denominator)
  ) {
    return { numerator: 4, denominator: 4 };
  }
  return { numerator, denominator };
}

export function secondsPerBeat(tempo: number, signature: string): number {
  const { denominator } = parseTimeSignature(signature);
  return 60 / tempo * (4 / denominator);
}

export function beatToSeconds(beat: number, tempo: number, signature: string): number {
  return beat * secondsPerBeat(tempo, signature);
}

export function secondsToBeat(seconds: number, tempo: number, signature: string): number {
  return seconds / secondsPerBeat(tempo, signature);
}

export function snapBeat(beat: number, subdivision: number | null): number {
  if (!subdivision || subdivision <= 0) return Math.max(0, beat);
  return Math.max(0, Math.round(beat * subdivision) / subdivision);
}

export function formatMusicalPosition(
  seconds: number,
  tempo: number,
  signature: string,
): string {
  const { numerator, denominator } = parseTimeSignature(signature);
  const beat = secondsToBeat(Math.max(0, seconds), tempo, signature);
  const beatsPerBar = numerator;
  const bar = Math.floor(beat / beatsPerBar) + 1;
  const beatInBar = Math.floor(beat % beatsPerBar) + 1;
  const fractionalBeat = beat - Math.floor(beat);
  const subdivision = Math.floor(fractionalBeat * 4) + 1;
  return `${bar}.${beatInBar}.${subdivision} (${numerator}/${denominator})`;
}

export function normalizeLoopRange(
  startSeconds: number,
  endSeconds: number,
  minimumLength = 0.05,
): { startSeconds: number; endSeconds: number } | null {
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) return null;
  const start = Math.max(0, Math.min(startSeconds, endSeconds));
  const end = Math.max(startSeconds, endSeconds);
  if (end - start < minimumLength) return null;
  return { startSeconds: start, endSeconds: end };
}
