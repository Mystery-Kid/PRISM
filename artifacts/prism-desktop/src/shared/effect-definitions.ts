import type { EffectState, EffectType } from "./types";

export type EffectParameterDefinition = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit?: string;
  advanced?: boolean;
};

export type NativeEffectDefinition = {
  type: EffectType;
  label: string;
  category: "Tone" | "Space" | "Dynamics" | "Drive" | "Modulation";
  description: string;
  searchTerms: string[];
  parameters: EffectParameterDefinition[];
};

export const nativeEffectCatalog: NativeEffectDefinition[] = [
  {
    type: "equalizer",
    label: "Equalizer",
    category: "Tone",
    description: "Shape one frequency band with a peaking filter.",
    searchTerms: ["eq", "filter", "frequency", "gain", "q"],
    parameters: [
      { key: "frequency", label: "Freq", min: 20, max: 20_000, step: 10, defaultValue: 1_000, unit: "Hz" },
      { key: "gain", label: "Gain", min: -24, max: 24, step: 0.5, defaultValue: 0, unit: "dB" },
      { key: "q", label: "Q", min: 0.1, max: 18, step: 0.1, defaultValue: 1 },
    ],
  },
  {
    type: "reverb",
    label: "Reverb",
    category: "Space",
    description: "Add a generated stereo room impulse response.",
    searchTerms: ["room", "space", "decay", "mix", "wet"],
    parameters: [
      { key: "decay", label: "Decay", min: 0.15, max: 4, step: 0.05, defaultValue: 1.6, unit: "s" },
      { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, defaultValue: 0.2 },
    ],
  },
  {
    type: "delay",
    label: "Delay",
    category: "Space",
    description: "Create tempo-independent echoes with bounded feedback.",
    searchTerms: ["echo", "time", "feedback", "mix", "wet"],
    parameters: [
      { key: "time", label: "Time", min: 0.01, max: 1.5, step: 0.01, defaultValue: 0.25, unit: "s" },
      { key: "feedback", label: "Feedback", min: 0, max: 0.85, step: 0.01, defaultValue: 0.25 },
      { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, defaultValue: 0.2 },
    ],
  },
  {
    type: "compressor",
    label: "Compressor",
    category: "Dynamics",
    description: "Control peaks with a native dynamics compressor.",
    searchTerms: ["dynamics", "threshold", "ratio", "attack", "release", "knee"],
    parameters: [
      { key: "threshold", label: "Thresh", min: -60, max: 0, step: 1, defaultValue: -18, unit: "dB" },
      { key: "ratio", label: "Ratio", min: 1, max: 20, step: 0.5, defaultValue: 4 },
      { key: "attack", label: "Attack", min: 0.001, max: 1, step: 0.001, defaultValue: 0.003, unit: "s" },
      { key: "release", label: "Release", min: 0.01, max: 2, step: 0.01, defaultValue: 0.25, unit: "s" },
      { key: "knee", label: "Knee", min: 0, max: 40, step: 1, defaultValue: 12, unit: "dB" },
    ],
  },
  ...(["distortion", "overdrive", "fuzz"] as const).map((type): NativeEffectDefinition => ({
    type, label: type === "overdrive" ? "Overdrive" : type === "fuzz" ? "Fuzz" : "Distortion",
    category: "Drive",
    description: type === "overdrive" ? "Soft asymmetric saturation with tone and output trim."
      : type === "fuzz" ? "Hard, asymmetric fuzz with DC removal and tone shaping."
      : "Symmetric soft clipping with tone shaping and output trim.",
    searchTerms: ["guitar", "bass", "saturation", "drive", "clip"],
    parameters: [
      { key: "drive", label: "Drive", min: 1, max: 30, step: .1, defaultValue: type === "fuzz" ? 12 : 4 },
      { key: "tone", label: "Tone", min: 200, max: 16000, step: 10, defaultValue: 5000, unit: "Hz" },
      { key: "level", label: "Output", min: -30, max: 6, step: .1, defaultValue: -9, unit: "dB" },
      { key: "mix", label: "Mix", min: 0, max: 1, step: .01, defaultValue: 1, advanced: true },
    ],
  })),
  {
    type: "noise-gate", label: "Noise Gate", category: "Dynamics",
    description: "Envelope-controlled gate for quiet passages; not broadband noise removal.",
    searchTerms: ["vocal", "noise", "gate", "threshold", "guitar"],
    parameters: [
      { key: "threshold", label: "Threshold", min: -60, max: -6, step: .5, defaultValue: -36, unit: "dB" },
      { key: "response", label: "Response", min: 1, max: 100, step: 1, defaultValue: 10, unit: "ms" },
      { key: "floor", label: "Floor", min: -80, max: -6, step: 1, defaultValue: -80, unit: "dB" },
    ],
  },
  ...(["chorus", "flanger", "phaser"] as const).map((type): NativeEffectDefinition => ({
    type, label: type[0].toUpperCase() + type.slice(1), category: "Modulation",
    description: type === "phaser" ? "Four swept all-pass stages create moving notches."
      : type === "flanger" ? "Short modulated delay with bounded feedback creates comb filtering."
      : "A modulated delayed voice thickens the original signal.",
    searchTerms: ["guitar", "synth", "lfo", "sweep", "modulation"],
    parameters: [
      { key: "rate", label: "Rate", min: .05, max: 8, step: .05, defaultValue: .7, unit: "Hz" },
      { key: "depth", label: "Depth", min: 0, max: 1, step: .01, defaultValue: .6 },
      { key: "mix", label: "Mix", min: 0, max: 1, step: .01, defaultValue: .4 },
      ...(type === "flanger" ? [{ key: "feedback", label: "Feedback", min: 0, max: .85, step: .01, defaultValue: .35, advanced: true }] : []),
    ],
  })),
  {
    type: "limiter", label: "Peak Clip Limiter", category: "Dynamics",
    description: "Zero-lookahead sample-peak hard ceiling with input gain. Not a transparent true-peak mastering limiter.",
    searchTerms: ["master", "bus", "peak", "ceiling", "clip", "limiter"],
    parameters: [
      { key: "input", label: "Input", min: -12, max: 24, step: .1, defaultValue: 0, unit: "dB" },
      { key: "ceiling", label: "Ceiling", min: -24, max: 0, step: .1, defaultValue: -1, unit: "dB" },
    ],
  },
];

export const nativePluginFormat = {
  name: "VST3",
  description: "Manage VST3 effects in the VST3 tab. Buffered native effects run after this built-in chain.",
  searchTerms: ["plugin", "plug-in", "vst", "vst3", "native"],
};

export const unavailablePluginFormats = [
  {
    name: "VST2",
    description: "Legacy VST2 plug-ins are not supported.",
    searchTerms: ["plugin", "plug-in", "vst", "vst2"],
  },
];

export function isNativeEffectType(value: unknown): value is EffectType {
  return nativeEffectCatalog.some((effect) => effect.type === value);
}

export function effectDefaults(type: EffectType): Record<string, number> {
  const definition = nativeEffectCatalog.find((effect) => effect.type === type);
  if (!definition) throw new Error(`Unknown native effect: ${type}`);
  return Object.fromEntries(definition.parameters.map((item) => [item.key, item.defaultValue]));
}

export function normalizeEffectParameters(
  type: EffectType,
  values: Record<string, unknown>,
): Record<string, number> {
  const definition = nativeEffectCatalog.find((effect) => effect.type === type);
  if (!definition) throw new Error(`Unknown native effect: ${type}`);
  return Object.fromEntries(definition.parameters.map((item) => {
    const value = values[item.key];
    const number = typeof value === "number" && Number.isFinite(value) ? value : item.defaultValue;
    return [item.key, Math.min(item.max, Math.max(item.min, number))];
  }));
}

export function normalizeEffectState(value: unknown): EffectState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (typeof source.id !== "string" || !source.id || source.id.length > 128 || !isNativeEffectType(source.type)) return null;
  const parameters = typeof source.parameters === "object" && source.parameters !== null &&
      !Array.isArray(source.parameters)
    ? source.parameters as Record<string, unknown>
    : {};
  return {
    id: source.id,
    type: source.type,
    enabled: source.enabled !== false,
    parameters: normalizeEffectParameters(source.type, parameters),
  };
}

export function normalizeEffectChain(value: unknown, maximum = 64): EffectState[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`Effect chains must contain at most ${maximum} effects.`);
  }
  const effects = value.map(normalizeEffectState);
  if (effects.some((effect) => effect === null)) {
    throw new Error("An effect chain contains an unsupported effect.");
  }
  const normalized = effects as EffectState[];
  if (new Set(normalized.map((effect) => effect.id)).size !== normalized.length) {
    throw new Error("Effect IDs must be unique within a chain.");
  }
  return normalized;
}
