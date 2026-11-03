import type { SongSession, Track } from "./types";
import { beatToSeconds, parseTimeSignature } from "../renderer/audio/time";

export type NativeParameter = { id: number; value: number };
/** Bounded, little-endian offline feasibility contract. No plugin binaries in projects. */
export function encodeNativeSlice(session: SongSession, track: Track, options: {
  seconds: number; sampleRate: number; blockSize: number;
  parameters?: NativeParameter[]; input?: readonly Float32Array[];
}): Uint8Array {
  const { sampleRate: rate, blockSize: block, seconds, input = [], parameters = [] } = options;
  if (!Number.isInteger(rate) || rate < 8000 || rate > 192000 || !Number.isInteger(block) ||
    block < 32 || block > 2048 || !Number.isFinite(seconds) || seconds <= 0 || seconds > 600 ||
    !Number.isFinite(session.tempo) || session.tempo < 20 || session.tempo > 300)
    throw new Error("Unsupported native slice timing.");
  const frames = Math.ceil(rate*seconds), meter = parseTimeSignature(session.timeSignature);
  if (input.length > 2 || input.some(channel => channel.length !== frames || !channel.every(Number.isFinite)))
    throw new Error("Native input requires matching finite mono/stereo channels.");
  const events = track.notes.flatMap((note, id) => {
    const on = Math.round(beatToSeconds(note.startBeat, session.tempo, session.timeSignature)*rate);
    const off = Math.round(beatToSeconds(note.startBeat+note.durationBeats, session.tempo, session.timeSignature)*rate);
    if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127 ||
      !Number.isFinite(note.velocity) || note.velocity < 0 || note.velocity > 127 ||
      !Number.isFinite(on) || on < 0 || !Number.isFinite(off) || off <= on)
      throw new Error("Invalid project MIDI note.");
    return on >= frames ? [] : [{ frame: on, pitch: note.pitch, velocity: note.velocity/127, on: 1, id },
      { frame: Math.min(frames-1, off), pitch: note.pitch, velocity: 0, on: 0, id }];
  }).sort((a, b) => a.frame-b.frame || a.on-b.on);
  if (events.length > 100000 || parameters.length > 10000 || parameters.some(p =>
    !Number.isInteger(p.id) || p.id < 0 || p.id > 0xffffffff || !Number.isFinite(p.value) || p.value < 0 || p.value > 1))
    throw new Error("Invalid native event or parameter count/value.");
  const bytes = new Uint8Array(48 + frames*input.length*4 + events.length*20 + parameters.length*12);
  const view = new DataView(bytes.buffer); let offset = 0;
  const u32 = (value: number) => { view.setUint32(offset, value, true); offset += 4; };
  const f32 = (value: number) => { view.setFloat32(offset, value, true); offset += 4; };
  const f64 = (value: number) => { view.setFloat64(offset, value, true); offset += 8; };
  u32(0x54535650); u32(1); u32(rate); u32(block); u32(frames); u32(events.length); u32(parameters.length); u32(input.length);
  f64(session.tempo); u32(meter.numerator); u32(meter.denominator);
  for (let frame = 0; frame < frames; frame++) for (const channel of input) f32(channel[frame]);
  for (const event of events) { u32(event.frame); u32(event.pitch); f32(event.velocity); u32(event.on); u32(event.id); }
  for (const p of parameters) { u32(p.id); f64(p.value); }
  return bytes;
}

export function decodeNativeSlice(bytes: Uint8Array): { sampleRate: number; latencySamples: number; tailSamples: number; channels: [Float32Array, Float32Array] } {
  if (bytes.byteLength < 24) throw new Error("Truncated native audio.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rate = view.getUint32(8, true), frames = view.getUint32(12, true);
  if (view.getUint32(0, true) !== 0x4f535650 || view.getUint32(4, true) !== 1 ||
      rate < 8000 || rate > 192000 || !frames || frames > rate*600 || bytes.byteLength !== 24+frames*8)
    throw new Error("Invalid native audio response.");
  const channels: [Float32Array, Float32Array] = [new Float32Array(frames), new Float32Array(frames)];
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < 2; channel++) {
    const value = view.getFloat32(24+(frame*2+channel)*4, true);
    if (!Number.isFinite(value) || Math.abs(value) >= 1000) throw new Error("Invalid native output sample.");
    channels[channel][frame] = value;
  }
  return { sampleRate: rate, latencySamples: view.getUint32(16, true), tailSamples: view.getUint32(20, true), channels };
}
