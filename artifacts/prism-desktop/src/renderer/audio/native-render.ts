import type { AudioBus, EffectState, SongSession, Track } from "@shared/types";
import type { NativePluginState } from "@shared/native-plugins";
import { encodeNativeSlice, decodeNativeSlice } from "@shared/native-contract";
import { deriveRoutingAudibility, validateAudioRouting } from "@shared/audio-routing";
import { createTrackGraph } from "./graph";
import { renderBuiltinSessionBuffer, scheduleOfflineMetronome } from "./render";
import { getSessionDuration } from "./timeline";

const rate = 48000, limit = rate*600;
export type BufferedNativeAudio = { audio: AudioBuffer; meters: Map<string, { peak: Float32Array; rms: Float32Array }> };
export const hasNativePlugins = (s: SongSession) => Boolean(s.nativeMasterEffects?.some(p => p.enabled) ||
  s.tracks.some(t => t.nativeInstrument?.enabled || t.nativeEffects?.some(p => p.enabled)) ||
  s.buses?.some(b => b.nativeEffects?.some(p => p.enabled)));
export const nativeAudioKey = (s: SongSession) => JSON.stringify({
  tempo: s.tempo, meter: s.timeSignature, metronome: s.metronomeEnabled,
  masterVolume: s.masterVolume, masterEffects: s.masterEffects, nativeMasterEffects: s.nativeMasterEffects, buses: s.buses,
  tracks: s.tracks.map(({ name: _, color: __, recordArmed: ___, instrumentRecovery: ____, ...audio }) => audio),
});

function context(frames: number) {
  if (!Number.isSafeInteger(frames) || frames < 1 || frames > limit) throw new Error("Buffered VST3 playback/export including all effect tails is limited to ten minutes.");
  return new OfflineAudioContext(2, frames, rate);
}
const empty = (frames: number) => {
  if (frames < 1 || frames > limit) throw new Error("Native audio buffer exceeds ten minutes.");
  return new AudioBuffer({ numberOfChannels: 2, length: frames, sampleRate: rate });
};
type Input = { buffer: AudioBuffer; gain: number };
async function mix(inputs: Input[], minimum: number, metronome?: SongSession) {
  const c = context(Math.max(minimum, ...inputs.map(i => i.buffer.length), 1));
  for (const input of inputs) {
    if (!input.gain) continue;
    const source = c.createBufferSource(), gain = c.createGain();
    source.buffer = input.buffer; gain.gain.value = input.gain;
    source.connect(gain).connect(c.destination); source.start();
  }
  if (metronome?.metronomeEnabled) scheduleOfflineMetronome(c, metronome, c.destination, getSessionDuration(metronome));
  return c.startRendering();
}
const tail = (effects: EffectState[]) => effects.some(e => e.enabled && (e.type === "reverb" || e.type === "delay")) ? 4
  : effects.some(e => e.enabled && ["chorus","flanger","phaser"].includes(e.type)) ? .5 : 0;

async function builtins(input: AudioBuffer, track: Track, effects: EffectState[], pan = 0, volume = 1) {
  const c = context(input.length+Math.ceil(tail(effects)*rate));
  const graph = createTrackGraph(c, { ...track, effects, nativeEffects: [], volume, pan, muted: false, solo: false }, c.destination);
  const source = c.createBufferSource(); source.buffer = input; source.connect(graph.input); source.start();
  try { return await c.startRendering(); } finally { graph.dispose(); }
}
async function native(session: SongSession, track: Track, plugin: NativePluginState, input: AudioBuffer | null, seconds: number, generation: number) {
  const request = encodeNativeSlice(session, track, { sampleRate: rate, blockSize: 512, seconds,
    parameters: Object.entries(plugin.parameters).map(([id, value]) => ({ id: Number(id), value })),
    input: input ? [input.getChannelData(0), input.getChannelData(Math.min(1, input.numberOfChannels-1))] : [] });
  const rendered = decodeNativeSlice(await window.prism.processNativePlugin({ plugin, request, generation }));
  if (rendered.sampleRate !== rate || rendered.latencySamples >= rendered.channels[0].length)
    throw new Error("Plugin returned an incompatible sample rate/latency.");
  // The native child processes extra latency and finite-tail frames, so shifting
  // does not truncate the intended source or an otherwise supported FX tail.
  const frames = rendered.channels[0].length-rendered.latencySamples, audio = empty(frames);
  audio.copyToChannel(rendered.channels[0].subarray(rendered.latencySamples) as Float32Array<ArrayBuffer>, 0);
  audio.copyToChannel(rendered.channels[1].subarray(rendered.latencySamples) as Float32Array<ArrayBuffer>, 1);
  return audio;
}
export async function renderNativeSessionBuffer(
  session: SongSession, getAudio: (id: string) => Promise<AudioBuffer>, cancelled: () => boolean = () => false,
): Promise<BufferedNativeAudio> {
  validateAudioRouting(session.tracks, session.buses ?? []);
  const duration = getSessionDuration(session);
  if (duration <= 0) throw new Error("Add audio or MIDI before preparing native playback.");
  const minimum = Math.ceil(duration*rate), meters: BufferedNativeAudio["meters"] = new Map();
  context(minimum); // Validate before any allocations/plugin execution.
  const status = await window.prism.nativePluginStatus();
  const enabled = [...session.nativeMasterEffects ?? [], ...session.tracks.flatMap(t =>
    [...t.nativeEffects ?? [], ...(t.nativeInstrument ? [t.nativeInstrument] : [])]), ...(session.buses ?? []).flatMap(b => b.nativeEffects ?? [])]
    .filter(p => p.enabled);
  if (enabled.length && !status.available) throw new Error(status.reason ?? "Native VST3 component is unavailable.");
  for (const p of enabled) if (!status.plugins.some(info => info.classId === p.classId && info.kind === p.kind))
    throw new Error(`VST3 "${p.name}" is missing. Scan trusted folders or bypass/remove/replace it. MIDI, audio and raw state were kept.`);
  const check = () => { if (cancelled()) throw new Error("Native preparation cancelled."); };
  const audibility = deriveRoutingAudibility(session.tracks, session.buses ?? []);
  const incoming = new Map<string | null, Input[]>(), pending = [...session.buses ?? []];
  const add = (bus: string | null, buffer: AudioBuffer, gain: number) => {
    if (gain > 0) incoming.set(bus, [...incoming.get(bus) ?? [], { buffer, gain }]);
  };
  const meter = (id: string, buffer: AudioBuffer, gain = 1) => {
    const size = Math.ceil(buffer.length/960), peak = new Float32Array(size), rms = new Float32Array(size);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    for (let k=0; k<size; k++) {
      let sum=0, maximum=0, count=0;
      for (const channel of channels) for (let i=k*960; i<Math.min(channel.length,(k+1)*960); i++) {
        const value = channel[i]*gain; maximum=Math.max(maximum,Math.abs(value)); sum += value*value; count++;
      }
      peak[k]=maximum; rms[k]=Math.sqrt(sum/Math.max(1,count));
    }
    meters.set(id, { peak, rms });
  };
  const route = (node: Track | AudioBus, beforeFader: AudioBuffer, level: number) => {
    add(node.outputBusId, beforeFader, level);
    for (const send of node.sends ?? []) add(send.busId, beforeFader, (send.placement === "pre" ? 1 : level)*send.level);
  };
  const effects = async (buffer: AudioBuffer, track: Track, builtin: EffectState[], plugins: NativePluginState[]) => {
    check();
    let result = await builtins(buffer, track, builtin);
    for (const plugin of plugins) if (plugin.enabled) {
      check(); result = await native(session, { ...track, notes: [] }, plugin, result, result.duration, status.generation);
    }
    return result;
  };
  const template = session.tracks[0];
  if (!template) throw new Error("Add a track before native playback.");
  for (const track of session.tracks) {
    check();
    const retained = new Set([...incoming.values()].flatMap(values => values.map(i => i.buffer)));
    if ([...retained].reduce((size,b) => size+b.length*b.numberOfChannels*4, 0) > 512*1024*1024)
      throw new Error("Buffered native routing exceeds its 512 MiB retained-audio budget. Reduce session length/tracks or bypass native plugins; project data was kept.");
    // Native selection never rewrites the original builtin ID or converts MIDI
    // into a persisted audio clip. The buffer is disposable playback data.
    const dryTrack = { ...track, nativeInstrument: null, nativeEffects: [], effects: [], sends: [], outputBusId: null,
      volume: 1, pan: 0, muted: false, solo: false, notes: track.nativeInstrument ? [] : track.notes };
    const drySession = { ...session, nativeMasterEffects: [], masterEffects: [], masterVolume: 1, buses: [],
      metronomeEnabled: false, loopRange: null, tracks: [dryTrack] };
    let dry = dryTrack.clips.length || dryTrack.notes.length
      ? await renderBuiltinSessionBuffer(drySession, getAudio) : empty(minimum);
    if (track.nativeInstrument?.enabled) {
      const synth = await native(session, track, track.nativeInstrument, null, duration+4, status.generation);
      dry = await mix([{ buffer: dry, gain: 1 }, { buffer: synth, gain: 1 }], minimum);
    }
    let post = await effects(dry, track, track.effects, track.nativeEffects ?? []);
    post = await builtins(post, track, [], track.pan, !track.muted && audibility.tracks.get(track.id) ? 1 : 0);
    meter(track.id, post, track.volume); route(track, post, track.volume);
  }
  const processed = new Set<string>();
  while (pending.length) {
    check();
    const index = pending.findIndex(bus => (session.buses ?? []).every(other =>
      other.id === bus.id || processed.has(other.id) ||
      (other.outputBusId !== bus.id && !other.sends.some(send => send.busId === bus.id))));
    if (index < 0) throw new Error("VST3 bus routing contains a cycle.");
    const bus = pending.splice(index,1)[0], inputs = incoming.get(bus.id) ?? [];
    incoming.delete(bus.id);
    let post = await effects(await mix(inputs, minimum), template, bus.effects, bus.nativeEffects ?? []);
    const audible = !bus.muted && audibility.buses.get(bus.id) ? 1 : 0;
    if (!audible) post = await mix([], post.length);
    meter(`bus:${bus.id}`, post, bus.level); route(bus, post, bus.level); processed.add(bus.id);
  }
  check();
  let audio = await effects(await mix(incoming.get(null) ?? [], minimum, session), template,
    session.masterEffects, session.nativeMasterEffects ?? []);
  if (session.masterVolume !== 1) audio = await mix([{ buffer: audio, gain: session.masterVolume }], audio.length);
  meter("master", audio); check();
  if ((await window.prism.nativePluginStatus()).generation !== status.generation) throw new Error("Native preparation cancelled.");
  return { audio, meters };
}
