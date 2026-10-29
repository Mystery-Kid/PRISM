import type { InstrumentPreset, InstrumentState } from "./types";
import { isDrumKitState, isSamplerState } from "./instrument-tracks";

export function normalizeInstrumentPreset(value: unknown): InstrumentPreset {
  if (!value || typeof value !== "object") throw new Error("The instrument preset is damaged.");
  const preset = value as InstrumentPreset;
  const state = preset.instrument as InstrumentState | null;
  if (typeof preset.id !== "string" || !preset.id.trim() || preset.id.length > 128 ||
    typeof preset.name !== "string" || !preset.name.trim() || preset.name.length > 100 ||
    preset.version !== 1 || !["instrument", "sampler", "drum"].includes(preset.type) ||
    (preset.type === "instrument" && (!state || !["sine", "triangle", "square", "sawtooth"].includes(state.waveform) ||
      ![state.attack, state.decay, state.sustain, state.release].every(Number.isFinite) ||
      state.attack < .001 || state.attack > 4 || state.decay < .001 || state.decay > 4 ||
      state.sustain < 0 || state.sustain > 1 || state.release < .005 || state.release > 4 ||
      (state.instrumentId !== undefined && typeof state.instrumentId !== "string") ||
      (state.parameters !== undefined && (typeof state.parameters !== "object" || state.parameters === null ||
        Array.isArray(state.parameters) || !Object.values(state.parameters).every(Number.isFinite))))) ||
    (preset.type === "sampler" && !isSamplerState(preset.sampler)) ||
    (preset.type === "drum" && !isDrumKitState(preset.drumKit)) ||
    JSON.stringify(preset).length > 64_000) throw new Error("The instrument preset has invalid settings.");
  return { ...structuredClone(preset), name: preset.name.trim(),
    instrument: preset.instrument ? { ...structuredClone(preset.instrument), presetId: preset.id, presetName: preset.name.trim() } : null,
    createdAt: typeof preset.createdAt === "string" ? preset.createdAt : new Date().toISOString(),
    updatedAt: typeof preset.updatedAt === "string" ? preset.updatedAt : new Date().toISOString() };
}
