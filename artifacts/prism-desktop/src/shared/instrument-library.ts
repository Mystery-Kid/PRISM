import type { InstrumentState } from "./types";

export const LEGACY_INSTRUMENT_ID = "prism.legacy.oscillator";
export const FACTORY_DRUM_KIT_ID = "prism.drums.electronic.v1";
export type InstrumentParameter = { key: string; label: string; min: number; max: number; step: number; default: number; unit?: string };
export type InstrumentDefinition = {
  id: string; name: string; category: "Keys" | "Synths" | "Bass" | "Drums";
  description: string; kind: "synth" | "drum"; engine: "legacy" | "fm" | "organ" | "analog" | "pad" | "pluck" | "drum";
  parameters: InstrumentParameter[];
  defaults: Pick<InstrumentState, "waveform" | "attack" | "decay" | "sustain" | "release">;
};
const tone: InstrumentParameter = { key: "tone", label: "Tone", min: 200, max: 14000, step: 50, default: 4200, unit: "Hz" };
const detune: InstrumentParameter = { key: "detune", label: "Detune", min: 0, max: 30, step: 1, default: 9, unit: "cents" };
const resonance: InstrumentParameter = { key: "resonance", label: "Resonance", min: .1, max: 12, step: .1, default: .8 };
const envelope = (waveform: OscillatorType, attack: number, decay: number, sustain: number, release: number) =>
  ({ waveform, attack, decay, sustain, release });
export const BUILT_IN_INSTRUMENTS: readonly InstrumentDefinition[] = [
  { id: LEGACY_INSTRUMENT_ID, name: "Custom Oscillator", category: "Synths", kind: "synth", engine: "legacy",
    description: "Original waveform and ADSR. Existing PRISM sounds are unchanged.", parameters: [],
    defaults: envelope("sawtooth", .01, .12, .65, .18) },
  { id: "prism.keys.fm-ep.v1", name: "FM Electric Piano", category: "Keys", kind: "synth", engine: "fm",
    description: "A velocity-sensitive two-operator FM electric piano, not an acoustic recording.",
    parameters: [{ key: "bell", label: "Bell", min: 0, max: 5, step: .05, default: 1.8 },
      { key: "warmth", label: "Warmth", min: 0, max: 1, step: .01, default: .55 }],
    defaults: envelope("sine", .004, .8, .22, .45) },
  { id: "prism.keys.organ.v1", name: "Drawbar Organ", category: "Keys", kind: "synth", engine: "organ",
    description: "Additive tonewheel-style synthesis with independent drawbar harmonics.",
    parameters: [{ key: "drawbars", label: "Upper drawbars", min: 0, max: 1, step: .01, default: .55 },
      { key: "percussion", label: "Percussion", min: 0, max: 1, step: .01, default: .3 }],
    defaults: envelope("sine", .008, .12, .9, .12) },
  { id: "prism.synth.analog.v1", name: "Analog Poly", category: "Synths", kind: "synth", engine: "analog",
    description: "Detuned dual oscillators through a resonant low-pass filter.",
    parameters: [tone, detune, resonance], defaults: envelope("sawtooth", .025, .2, .6, .25) },
  { id: "prism.synth.lead.v1", name: "Bright Stack Lead", category: "Synths", kind: "synth", engine: "analog",
    description: "Square/saw stack with a bright, resonant lead articulation.",
    parameters: [{ ...tone, default: 7200 }, { ...detune, default: 4 }, { ...resonance, default: 2.5 }],
    defaults: envelope("square", .006, .13, .72, .12) },
  { id: "prism.synth.pad.v1", name: "Drift Pad", category: "Synths", kind: "synth", engine: "pad",
    description: "Three detuned voices and a slow envelope for sustained chords.",
    parameters: [{ ...tone, default: 2600 }, { ...detune, default: 17 }],
    defaults: envelope("triangle", .45, .6, .75, 1.2) },
  { id: "prism.synth.pluck.v1", name: "Glass Pluck", category: "Synths", kind: "synth", engine: "pluck",
    description: "A short resonator-like harmonic pluck with a decaying filter.",
    parameters: [{ ...tone, default: 5600 }, { key: "color", label: "Harmonic color", min: 0, max: 1, step: .01, default: .6 }],
    defaults: envelope("triangle", .002, .35, .025, .15) },
  { id: "prism.bass.sub.v1", name: "Sub & Saw Bass", category: "Bass", kind: "synth", engine: "analog",
    description: "A fundamental/sub oscillator blend with a low resonant cutoff.",
    parameters: [{ ...tone, default: 650 }, { ...detune, default: 2 }, { ...resonance, default: 1.4 }],
    defaults: envelope("sawtooth", .005, .18, .68, .16) },
  { id: FACTORY_DRUM_KIT_ID, name: "PRISM Electronic Kit", category: "Drums", kind: "drum", engine: "drum",
    description: "Eight original procedurally generated samples: kick, snare, hats, clap, tom, ride and crash.",
    parameters: [], defaults: envelope("sine", .001, .1, 0, .1) },
];
export const unavailableInstrumentCategories =
  "No acoustic piano, acoustic electric-bass, strings, brass or choir bank is bundled. These are not advertised as playable instruments.";
export function getInstrumentId(state: InstrumentState | null | undefined): string {
  return state?.instrumentId ?? LEGACY_INSTRUMENT_ID;
}
export function findInstrumentDefinition(id: string): InstrumentDefinition | undefined {
  return BUILT_IN_INSTRUMENTS.find((item) => item.id === id);
}
export function instrumentIsAvailable(state: InstrumentState | null | undefined): boolean {
  return Boolean(state && findInstrumentDefinition(getInstrumentId(state))?.kind === "synth");
}
export function createInstrumentState(id: string): InstrumentState {
  const definition = findInstrumentDefinition(id);
  if (!definition || definition.kind !== "synth") throw new Error("This instrument is unavailable or requires its drum samples.");
  return { instrumentId: id, ...definition.defaults,
    parameters: Object.fromEntries(definition.parameters.map((parameter) => [parameter.key, parameter.default])) };
}
export function instrumentParameterValue(state: InstrumentState, key: string): number {
  const definition = findInstrumentDefinition(getInstrumentId(state));
  const parameter = definition?.parameters.find((item) => item.key === key);
  if (!parameter) throw new Error(`Unsupported instrument parameter: ${key}`);
  const value = state.parameters?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(parameter.max, Math.max(parameter.min, value)) : parameter.default;
}
export function withInstrumentParameter(state: InstrumentState, key: string, value: number): InstrumentState {
  const next = { ...state, parameters: { ...state.parameters, [key]: value } };
  return { ...next, parameters: { ...next.parameters, [key]: instrumentParameterValue(next, key) } };
}
