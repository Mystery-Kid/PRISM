import type { EffectState, EffectType } from "./types";

export type EffectParameterDefinition = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit?: string;
};

export type NativeEffectDefinition = {
  type: EffectType;
  label: string;
  category: "Tone" | "Space" | "Dynamics";
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
];

export const unavailablePluginFormats = [
  {
    name: "VST / VST3",
    description: "Unavailable — PRISM does not load third-party native plug-ins.",
    searchTerms: ["plugin", "plug-in", "vst", "vst3", "native"],
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
