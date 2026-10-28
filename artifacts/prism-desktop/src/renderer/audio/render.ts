import type { MidiNote, SongSession, Track } from "@shared/types";
import { deriveRoutingAudibility, validateAudioRouting } from "@shared/audio-routing";
import {
  AudioRoutingGraph,
  createBusGraph,
  createMasterGraph,
  createTrackGraph,
} from "./graph";
import { beatToSeconds } from "./time";
import { encodeAudioBufferWav } from "./wav";
import { getClipWindow, getSessionDuration } from "./timeline";
import { createMidiEnvelopePlan, midiPitchToFrequency } from "./midi";

const exportSampleRate = 48_000;
const maximumExportSeconds = 10 * 60;

export async function renderSessionWav(
  session: SongSession,
  getAudio: (assetId: string) => Promise<AudioBuffer>,
): Promise<Uint8Array> {
  const duration = getSessionDuration(session);
  if (duration <= 0) throw new Error("Add audio or MIDI notes before exporting a song.");
  if (duration > maximumExportSeconds) {
    throw new Error("WAV export is limited to 10 minutes to protect this computer's memory.");
  }
  const hasTail = session.masterEffects.some((effect) =>
    effect.enabled && (effect.type === "reverb" || effect.type === "delay"),
  ) || session.tracks.some((track) => track.effects.some((effect) =>
    effect.enabled && (effect.type === "reverb" || effect.type === "delay"),
  )) || (session.buses ?? []).some((bus) => bus.effects.some((effect) =>
    effect.enabled && (effect.type === "reverb" || effect.type === "delay"),
  ));
  const tailSeconds = hasTail ? 4 : 0;
  const frameCount = Math.ceil((duration + tailSeconds) * exportSampleRate);
  const context = new OfflineAudioContext(2, frameCount, exportSampleRate);
  const buses = session.buses ?? [];
  validateAudioRouting(session.tracks, buses);
  const master = createMasterGraph(
    context,
    session.masterVolume,
    session.masterEffects,
    context.destination,
  );
  const graphs = new Map<string, ReturnType<typeof createTrackGraph>>();
  const busGraphs = new Map<string, ReturnType<typeof createBusGraph>>();
  const routing = new AudioRoutingGraph();
  const audibility = deriveRoutingAudibility(session.tracks, buses);
  for (const bus of buses) {
    const graph = createBusGraph(context, bus);
    graph.update(bus, audibility.buses.get(bus.id) ?? false);
    busGraphs.set(bus.id, graph);
  }
  for (const track of session.tracks) {
    const graph = createTrackGraph(context, track);
    graph.update(track, audibility.tracks.get(track.id) ?? false);
    graphs.set(track.id, graph);
  }
  routing.update(session.tracks, buses, graphs, busGraphs, master.input);

  const assetIds = [...new Set(session.tracks.flatMap((track) =>
    track.clips.map((clip) => clip.assetId),
  ))];
  const audio = new Map<string, AudioBuffer>();
  await Promise.all(assetIds.map(async (id) => audio.set(id, await getAudio(id))));

  for (const track of session.tracks) {
    if (!(audibility.tracks.get(track.id) ?? false)) continue;
    const graph = graphs.get(track.id);
    if (!graph) continue;
    for (const clip of track.clips) {
      const buffer = audio.get(clip.assetId);
      const clipWindow = getClipWindow(
        clip,
        clip.startSeconds,
        clip.startSeconds + clip.durationSeconds,
      );
      if (!buffer || !clipWindow) continue;
      const sourceOffset = clipWindow.sourceStart;
      const playableDuration = Math.min(clipWindow.duration, buffer.duration - sourceOffset);
      if (playableDuration <= 0) continue;
      const source = context.createBufferSource();
      source.buffer = buffer;
      const gain = context.createGain();
      const gainValue = Math.max(0, Math.min(2, clip.gain));
      const clipStart = clipWindow.timelineStart;
      const clipEnd = clipStart + playableDuration;
      gain.gain.setValueAtTime(gainValue, clipStart);
      if (clip.fadeInSeconds > 0) {
        const fadeEnd = Math.min(clipStart + clip.fadeInSeconds, clipEnd);
        gain.gain.setValueAtTime(0, clipStart);
        gain.gain.linearRampToValueAtTime(gainValue, fadeEnd);
      }
      if (clip.fadeOutSeconds > 0) {
        const fadeStart = Math.max(clipStart, clipEnd - clip.fadeOutSeconds);
        gain.gain.setValueAtTime(gainValue, fadeStart);
        gain.gain.linearRampToValueAtTime(0, clipEnd);
      }
      source.connect(gain);
      gain.connect(graph.input);
      source.start(clipStart, sourceOffset, playableDuration);
    }
    if (track.type === "instrument" && track.instrument) {
      for (const note of track.notes) {
        scheduleOfflineNote(context, session, track, note, graph.input);
      }
    }
  }

  if (session.metronomeEnabled) scheduleOfflineMetronome(context, session, master.input, duration);
  const rendered = await context.startRendering();
  routing.dispose();
  graphs.forEach((graph) => graph.dispose());
  busGraphs.forEach((graph) => graph.dispose());
  master.dispose();
  return encodeAudioBufferWav(rendered);
}

function scheduleOfflineNote(
  context: OfflineAudioContext,
  session: SongSession,
  track: Track,
  note: MidiNote,
  destination: AudioNode,
): void {
  if (!track.instrument) return;
  const start = beatToSeconds(note.startBeat, session.tempo, session.timeSignature);
  const end = beatToSeconds(
    note.startBeat + note.durationBeats,
    session.tempo,
    session.timeSignature,
  );
  if (end <= start) return;
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.type = track.instrument.waveform;
  oscillator.frequency.value = midiPitchToFrequency(note.pitch);
  const envelopePlan = createMidiEnvelopePlan(note, track.instrument, end - start);
  envelope.gain.setValueAtTime(envelopePlan.initialValue, start);
  for (const event of envelopePlan.events) {
    if (event.curve === "set") {
      envelope.gain.setValueAtTime(event.value, start + event.timeSeconds);
    } else {
      envelope.gain.linearRampToValueAtTime(event.value, start + event.timeSeconds);
    }
  }
  oscillator.connect(envelope);
  envelope.connect(destination);
  oscillator.start(start);
  oscillator.stop(end + 0.01);
}

function scheduleOfflineMetronome(
  context: OfflineAudioContext,
  session: SongSession,
  destination: AudioNode,
  duration: number,
): void {
  const quarterBeat = 60 / session.tempo;
  const beatsPerBar = Number(session.timeSignature.split("/")[0]) || 4;
  const beatLength = quarterBeat * (4 / (Number(session.timeSignature.split("/")[1]) || 4));
  for (let beat = 0, at = 0; at < duration; beat += 1, at = beat * beatLength) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = beat % beatsPerBar === 0 ? 1250 : 850;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(beat % beatsPerBar === 0 ? 0.22 : 0.12, at + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.035);
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start(at);
    oscillator.stop(at + 0.04);
  }
}
