import type { SongSession } from "@shared/types";
import { applyTempoChange, originalClipAsset, type StretchedSource, type TempoMedia } from "@shared/tempo";
import type { AudioEngine } from "./AudioEngine";

export async function adaptSessionTempo(session: SongSession, tempo: number, engine: AudioEngine,
  signal: AbortSignal, progress: (message: string) => void): Promise<{ session: SongSession; media: TempoMedia[]; skipped: string[] }> {
  const adapted = new Map<string, StretchedSource>(), media: TempoMedia[] = [], skipped: string[] = [];
  const clips = session.tracks.filter(t => t.type !== "unsupported").flatMap(t => t.clips);
  const ids = [...new Set(clips.map(clip => clip.assetId))];
  let totalBytes = 0;
  for (let index = 0; index < ids.length; index++) {
    if (signal.aborted) throw new DOMException("Tempo adaptation cancelled", "AbortError");
    const currentId = ids[index];
    const clip = clips.find(c => c.assetId === currentId)!;
    const originalId = originalClipAsset(clip);
    progress(`Decoding source ${index+1} of ${ids.length}…`);
    const audio = await engine.loadAudio(originalId);
    if (signal.aborted) throw new DOMException("Tempo adaptation cancelled", "AbortError");
    if (audio.numberOfChannels > 2 || audio.duration > 60) { skipped.push(`Source ${originalId}: more than 60 seconds or two channels; timing kept.`); continue; }
    const ratio = (clip.tempoAdaptation?.lengthRatio ?? 1) * session.tempo / tempo;
    if (ratio < .5 || ratio > 2) { skipped.push(`Source ${originalId}: cumulative length outside 0.5x–2x; timing kept.`); continue; }
    progress(`Stretching source ${index+1} of ${ids.length}…`);
    const result = await new Promise<{ wav: Uint8Array; waveform: number[]; duration: number }>((resolve, reject) => {
      const worker = new Worker(new URL("./stretch-worker.ts", import.meta.url), { type: "module" });
      const done = () => { signal.removeEventListener("abort", cancel); worker.terminate(); };
      const cancel = () => { done(); reject(new DOMException("Tempo adaptation cancelled", "AbortError")); };
      signal.addEventListener("abort", cancel, { once: true });
      worker.onmessage = event => { done(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data); };
      worker.onerror = event => { done(); reject(new Error(event.message || "Stretch worker failed.")); };
      const channels = Array.from({ length: audio.numberOfChannels }, (_, channel) => audio.getChannelData(channel).slice());
      worker.postMessage({ channels, sampleRate: audio.sampleRate, ratio }, channels.map(c => c.buffer));
    });
    totalBytes += result.wav.byteLength;
    if (totalBytes > 128 * 1024 * 1024) throw new Error("Tempo derivatives exceed the 128 MiB transaction limit. No tempo change was applied.");
    const id = crypto.randomUUID();
    adapted.set(currentId, { id, waveform: result.waveform, duration: result.duration, ratio });
    media.push({ id, originalAssetId: originalId, audioData: result.wav });
  }
  if (signal.aborted) throw new DOMException("Tempo adaptation cancelled", "AbortError");
  return { session: applyTempoChange(session, tempo, adapted), media, skipped };
}
