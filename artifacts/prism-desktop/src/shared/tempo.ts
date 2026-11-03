import type { AudioClip, SongSession } from "./types";

export type TempoMedia = { id: string; originalAssetId: string; audioData: Uint8Array };
export type StretchedSource = { id: string; waveform: number[]; duration: number; ratio: number };
export function isTempo(value: number): boolean { return Number.isFinite(value) && value >= 20 && value <= 300; }
export function originalClipAsset(clip: AudioClip): string { return clip.tempoAdaptation?.originalAssetId ?? clip.assetId; }
export function applyTempoChange(session: SongSession, tempo: number, adapted?: Map<string, StretchedSource>): SongSession {
  if (!isTempo(tempo)) throw new Error("Tempo must be between 20 and 300 BPM.");
  const ratio = session.tempo / tempo;
  return {
    ...session, tempo,
    loopRange: adapted && session.loopRange ? { ...session.loopRange,
      startSeconds: session.loopRange.startSeconds * ratio, endSeconds: session.loopRange.endSeconds * ratio } : session.loopRange,
    tracks: session.tracks.map(track => ({ ...track, clips: track.clips.map(clip => {
      const source = adapted?.get(clip.assetId);
      if (!source || track.type === "unsupported") return clip;
      const previousRatio = clip.tempoAdaptation?.lengthRatio ?? 1;
      // Existing trims/fades may have been edited after a previous adaptation.
      return { ...clip, assetId: source.id,
        startSeconds: clip.startSeconds * ratio,
        sourceStartSeconds: clip.sourceStartSeconds / previousRatio * source.ratio,
        durationSeconds: clip.durationSeconds / previousRatio * source.ratio,
        sourceDurationSeconds: source.duration, waveform: source.waveform,
        fadeInSeconds: clip.fadeInSeconds / previousRatio * source.ratio,
        fadeOutSeconds: clip.fadeOutSeconds / previousRatio * source.ratio,
        tempoAdaptation: { algorithm: "prism-wsola-v1", originalAssetId: originalClipAsset(clip),
          originalTempo: clip.tempoAdaptation?.originalTempo ?? session.tempo,
          lengthRatio: source.ratio },
      };
    }) })),
  };
}
