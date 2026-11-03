import type { InstrumentState, MidiNote } from "@shared/types";
import { findInstrumentDefinition, getInstrumentId, instrumentParameterValue } from "@shared/instrument-library";
import { createMidiEnvelopePlan, midiPitchToFrequency } from "./midi";

export type InstrumentVoice = { sources: AudioScheduledSourceNode[]; cleanup(): void };
export const instrumentReleaseTail = (state: InstrumentState | null) =>
  state && findInstrumentDefinition(getInstrumentId(state))?.engine !== "legacy" ? Math.min(4, Math.max(.005, state.release)) : 0;

/** Shared by live playback, audition and WAV export. No renderer/UI synthesis loop. */
export function scheduleInstrumentVoice(
  context: BaseAudioContext, destination: AudioNode, state: InstrumentState,
  note: Pick<MidiNote, "pitch" | "velocity">,
  options: { when: number; duration: number; offset?: number; maximumDuration?: number },
): InstrumentVoice {
  const definition = findInstrumentDefinition(getInstrumentId(state));
  if (!definition || definition.kind !== "synth") throw new Error(`Instrument unavailable: ${getInstrumentId(state)}. MIDI and settings were kept.`);
  const sources: AudioScheduledSourceNode[] = [], nodes: AudioNode[] = [];
  let cleaned = false;
  const cleanup = () => { if (!cleaned) { cleaned = true; nodes.forEach((node) => node.disconnect()); sources.forEach((source) => source.disconnect()); } };
  const offset = Math.max(0, options.offset ?? 0), gate = Math.max(.000001, options.duration);
  const legacy = definition.engine === "legacy";
  const tail = instrumentReleaseTail(state);
  const remaining = Math.min(options.maximumDuration ?? Infinity, Math.max(.005, gate + tail - offset));
  const when = options.when, end = when + remaining;
  const frequency = midiPitchToFrequency(note.pitch);
  const velocity = Math.min(127, Math.max(1, note.velocity)) / 127;
  const envelope = context.createGain(); nodes.push(envelope);
  envelope.connect(destination);
  let input: AudioNode = envelope;
  if (["analog", "pad", "pluck", "fm"].includes(definition.engine)) {
    const filter = context.createBiquadFilter(); nodes.push(filter);
    filter.type = "lowpass";
    const cutoff = definition.engine === "fm" ? 1600 + instrumentParameterValue(state, "warmth") * 10000 : instrumentParameterValue(state, "tone");
    const safeCutoff = Math.min(context.sampleRate * .45, cutoff);
    filter.frequency.setValueAtTime(safeCutoff, when);
    filter.Q.value = definition.engine === "analog" ? instrumentParameterValue(state, "resonance") : .65;
    if (definition.engine === "pluck") filter.frequency.exponentialRampToValueAtTime(Math.max(150, safeCutoff * .2), Math.min(end, when + .3));
    filter.connect(envelope); input = filter;
  }
  const oscillator = (ratio: number, waveform: OscillatorType, level: number, cents = 0) => {
    const source = context.createOscillator(), gain = context.createGain();
    source.type = waveform; source.frequency.value = Math.min(context.sampleRate * .45, frequency * ratio);
    source.detune.value = cents; gain.gain.value = level;
    source.connect(gain); gain.connect(input); nodes.push(gain); sources.push(source);
    return source;
  };
  if (legacy) oscillator(1, state.waveform, 1);
  else if (definition.engine === "fm") {
    const carrier = oscillator(1, "sine", .85), modulator = context.createOscillator(), index = context.createGain();
    modulator.frequency.value = frequency * 2;
    index.gain.setValueAtTime(Math.max(.001, frequency * instrumentParameterValue(state, "bell") * velocity * Math.exp(-offset * 4)), when);
    index.gain.exponentialRampToValueAtTime(.001, end);
    modulator.connect(index); index.connect(carrier.frequency); nodes.push(index); sources.push(modulator);
    oscillator(1, "sine", .15);
  } else if (definition.engine === "organ") {
    const drawbars = instrumentParameterValue(state, "drawbars");
    [.5, 1, 1.5, 2, 3, 4, 6, 8].forEach((ratio, index) =>
      oscillator(ratio, "sine", index === 1 ? .55 : [.15, .55, .08, .18, .12, .08, .04, .02][index]! * drawbars));
    const percussion = oscillator(3, "sine", 1), gain = context.createGain(); nodes.push(gain);
    // Replace this source's steady connection with a short percussive drawbar.
    percussion.disconnect(); gain.gain.setValueAtTime(Math.max(.00001, instrumentParameterValue(state, "percussion") * Math.exp(-offset * 18)), when);
    gain.gain.exponentialRampToValueAtTime(.00001, Math.min(end, when + .2));
    percussion.connect(gain); gain.connect(input);
  } else if (definition.engine === "pad") {
    const detune = instrumentParameterValue(state, "detune");
    oscillator(1, "triangle", .38, -detune); oscillator(1, "sine", .28);
    oscillator(1, "triangle", .34, detune);
  } else if (definition.engine === "pluck") {
    oscillator(1, "triangle", .8); oscillator(2.01, "sine", .3 * instrumentParameterValue(state, "color"));
  } else {
    const bass = definition.id === "prism.bass.sub.v1", detune = instrumentParameterValue(state, "detune");
    oscillator(1, state.waveform, .58, -detune);
    oscillator(bass ? .5 : 1, bass ? "sine" : "sawtooth", .42, detune);
  }
  if (legacy) {
    const plan = createMidiEnvelopePlan(note, state, gate, offset);
    envelope.gain.setValueAtTime(plan.initialValue, when);
    for (const event of plan.events) {
      const at = when + event.timeSeconds - offset;
      if (event.curve === "set") envelope.gain.setValueAtTime(event.value, at);
      else envelope.gain.linearRampToValueAtTime(event.value, at);
    }
  } else {
    const attack = Math.max(.001, state.attack), decay = Math.max(.001, state.decay), sustain = Math.min(1, Math.max(0, state.sustain));
    const held = (time: number) => time < attack ? time / attack : time < attack + decay
      ? 1 + (sustain - 1) * (time - attack) / decay : sustain;
    const level = (time: number) => .32 * velocity * (time <= gate ? held(time) : held(gate) * Math.max(0, 1 - (time - gate) / tail));
    envelope.gain.setValueAtTime(level(offset), when);
    for (const time of [...new Set([attack, attack + decay, gate, gate + tail])].sort((a, b) => a - b)) {
      if (time > offset && time <= offset + remaining) envelope.gain.linearRampToValueAtTime(level(time), when + time - offset);
    }
    // Bound release tails at loop edges and explicit short previews.
    if (offset + remaining < gate + tail) {
      envelope.gain.setValueAtTime(level(offset + Math.max(0, remaining - .004)), Math.max(when, end - .004));
      envelope.gain.linearRampToValueAtTime(0, end);
    }
  }
  for (const source of sources) { source.start(when); source.stop(end + .01); }
  return { sources, cleanup };
}
