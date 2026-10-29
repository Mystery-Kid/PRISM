import type { MidiNote, SongSession, Track } from "@shared/types";
import { deriveRoutingAudibility, validateAudioRouting } from "@shared/audio-routing";
import { getSampleTrigger } from "@shared/instrument-tracks";
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
import { instrumentIsAvailable, getInstrumentId } from "@shared/instrument-library";
import { instrumentReleaseTail, scheduleInstrumentVoice } from "./instrument-voice";

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
  if (session.tracks.some((track) => track.type === "unsupported" && track.notes.length > 0)) {
    throw new Error("A MIDI track uses an unsupported instrument type. Its notes were kept; recover the track before exporting.");
  }
  for (const track of session.tracks) {
    if (track.type === "instrument" && track.notes.length && !instrumentIsAvailable(track.instrument)) {
      throw new Error(`Instrument "${getInstrumentId(track.instrument)}" is unavailable. MIDI and settings were kept; choose a replacement before export.`);
    }
  }
  const sampleEvents = session.tracks.flatMap((track) =>
    track.notes.flatMap((note) => {
      const trigger = getSampleTrigger(track, note.pitch, note.velocity);
      return trigger ? [{ track, note, trigger }] : [];
    }),
  );
  if (session.tracks.some((track) =>
    (track.type === "sampler" || track.type === "drum") &&
    track.notes.some((note) => !getSampleTrigger(track, note.pitch, note.velocity)),
  )) {
    throw new Error("Some sampler or drum MIDI notes have no assigned sample. Assign the sample; pattern data was kept.");
  }
  const sampleIds = new Set(sampleEvents.map((event) => event.trigger.assetId));
  const assetIds = new Set([
    ...session.tracks.flatMap((track) => track.clips.map((clip) => clip.assetId)),
    ...sampleIds,
  ]);
  const audio = new Map<string, AudioBuffer>();
  await Promise.all([...assetIds].map(async (id) => {
    try {
      audio.set(id, await getAudio(id));
    } catch (cause) {
      if (sampleIds.has(id)) {
        throw new Error("A sampler or drum sample is missing or unsupported. Replace it; MIDI patterns and assignments were kept.");
      }
      throw cause;
    }
  }));
  let sampleEnd = duration;
  for (const track of session.tracks) {
    if (track.type === "instrument") for (const note of track.notes) {
      sampleEnd = Math.max(sampleEnd, beatToSeconds(note.startBeat + note.durationBeats, session.tempo, session.timeSignature) + instrumentReleaseTail(track.instrument));
    }
  }
  for (const { note, trigger } of sampleEvents) {
    const buffer = audio.get(trigger.assetId);
    if (!buffer) continue;
    const start = beatToSeconds(note.startBeat, session.tempo, session.timeSignature);
    sampleEnd = Math.max(sampleEnd, start + buffer.duration / trigger.playbackRate);
  }
  const hasTail = session.masterEffects.some((effect) =>
    effect.enabled && (effect.type === "reverb" || effect.type === "delay"),
  ) || session.tracks.some((track) => track.effects.some((effect) =>
    effect.enabled && (effect.type === "reverb" || effect.type === "delay"),
  )) || (session.buses ?? []).some((bus) => bus.effects.some((effect) =>
    effect.enabled && (effect.type === "reverb" || effect.type === "delay"),
  ));
  const tailSeconds = hasTail ? 4 : 0;
  const exportDuration = Math.max(duration, sampleEnd);
  if (exportDuration + tailSeconds > maximumExportSeconds) {
    throw new Error("WAV export including sample and effect tails is limited to 10 minutes.");
  }
  const frameCount = Math.ceil((exportDuration + tailSeconds) * exportSampleRate);
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
    } else if (track.type === "sampler" || track.type === "drum") {
      for (const note of track.notes) {
        const trigger = getSampleTrigger(track, note.pitch, note.velocity);
        const sample = trigger && audio.get(trigger.assetId);
        if (trigger && sample) scheduleOfflineSample(context, session, note, trigger, sample, graph.input);
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
  scheduleInstrumentVoice(context, destination, track.instrument, note, { when: start, duration: end - start });
}

function scheduleOfflineSample(
  context: OfflineAudioContext,
  session: SongSession,
  note: MidiNote,
  trigger: { assetId: string; playbackRate: number; gain: number },
  sample: AudioBuffer,
  destination: AudioNode,
): void {
  const start = beatToSeconds(note.startBeat, session.tempo, session.timeSignature);
  const source = context.createBufferSource();
  source.buffer = sample;
  source.playbackRate.value = trigger.playbackRate;
  const gain = context.createGain();
  gain.gain.setValueAtTime(trigger.gain, start);
  source.connect(gain);
  gain.connect(destination);
  source.start(start);
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
