import {
  isNativeEffectType,
  normalizeEffectParameters,
} from "./effect-definitions";
import type {
  EffectChainPreset,
  EffectChainPresetFile,
  EffectPresetEffect,
  JsonValue,
} from "./types";

export const effectPresetFormat = "prism-effect-chain" as const;
export const effectPresetVersion = 1 as const;
export const maxEffectPresetBytes = 1_048_576;
export const maxPresetEffectCount = 64;
export const maxPresetNameLength = 80;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson(value: unknown, budget: { nodes: number }, depth = 0): JsonValue {
  budget.nodes += 1;
  if (budget.nodes > 30_000 || depth > 32) {
    throw new Error("Preset data is too deeply nested or contains too many values.");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Preset data contains an invalid number.");
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => cloneJson(entry, budget, depth + 1));
  if (!isRecord(value)) throw new Error("Preset data must contain JSON values only.");
  const result: Record<string, JsonValue> = Object.create(null);
  for (const key of Object.keys(value)) {
    result[key] = cloneJson(value[key], budget, depth + 1);
  }
  return result;
}

function cloneJsonRecord(value: unknown): Record<string, JsonValue> {
  if (!isRecord(value)) throw new Error("Each preset effect must be a JSON object.");
  const clone = cloneJson(value, { nodes: 0 });
  if (clone === null || Array.isArray(clone) || typeof clone !== "object") {
    throw new Error("Each preset effect must be a JSON object.");
  }
  return clone as Record<string, JsonValue>;
}

function normalizeEffect(value: unknown): EffectPresetEffect {
  if (!isRecord(value)) throw new Error("Each preset effect must be an object.");
  const rawSource = isRecord(value.raw) ? value.raw : value;
  const raw = cloneJsonRecord(rawSource);
  const type = raw.type;
  if (typeof type !== "string" || !type.trim() || type.length > 128) {
    throw new Error("A preset effect is missing its type.");
  }
  const id = typeof raw.id === "string" && raw.id.length <= 128
    ? raw.id
    : crypto.randomUUID();
  const enabled = raw.enabled !== false;
  const incoming = isRecord(raw.parameters) ? raw.parameters : {};
  const parameters: Record<string, number> = isNativeEffectType(type)
    ? normalizeEffectParameters(type, incoming)
    : Object.fromEntries(Object.entries(incoming).filter(([, current]) =>
      typeof current === "number" && Number.isFinite(current),
    )) as Record<string, number>;
  return { id, type, enabled, parameters, raw };
}

function normalizeEffects(value: unknown): EffectPresetEffect[] {
  if (!Array.isArray(value) || value.length > maxPresetEffectCount) {
    throw new Error(`An effect chain must contain at most ${maxPresetEffectCount} effects.`);
  }
  const normalized = value.map(normalizeEffect);
  const ids = new Set<string>();
  return normalized.map((effect) => {
    if (!ids.has(effect.id)) {
      ids.add(effect.id);
      return effect;
    }
    const id = crypto.randomUUID();
    ids.add(id);
    return { ...effect, id };
  });
}

function normalizeName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Enter a name for the effect preset.");
  const name = value.trim();
  if (!name || name.length > maxPresetNameLength) {
    throw new Error(`Preset names must be between 1 and ${maxPresetNameLength} characters.`);
  }
  return name;
}

function assertSize(value: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error("Preset data could not be serialized as JSON.");
  }
  if (new TextEncoder().encode(serialized).byteLength > maxEffectPresetBytes) {
    throw new Error("Effect preset files are limited to 1 MiB.");
  }
}

export function parseEffectPresetFile(value: unknown): EffectChainPresetFile {
  if (!isRecord(value) || value.format !== effectPresetFormat || value.version !== effectPresetVersion) {
    throw new Error("This is not a supported PRISM effect-chain preset (version 1).");
  }
  const name = normalizeName(value.name);
  const effects = normalizeEffects(value.effects);
  const preset = { format: effectPresetFormat, version: effectPresetVersion, name, effects };
  assertSize(preset);
  return preset;
}

export function normalizeStoredEffectPreset(value: unknown): EffectChainPreset {
  if (!isRecord(value) || value.version !== effectPresetVersion) {
    throw new Error("A saved effect preset has an unsupported version.");
  }
  if (
    typeof value.id !== "string" ||
    !value.id ||
    (value.scope !== "global" && value.scope !== "project") ||
    (value.scope === "project" && (typeof value.projectId !== "string" || !value.projectId)) ||
    (value.scope === "global" && value.projectId !== null)
  ) {
    throw new Error("A saved effect preset has invalid scope or identity.");
  }
  const preset: EffectChainPreset = {
    id: value.id,
    name: normalizeName(value.name),
    version: effectPresetVersion,
    scope: value.scope,
    projectId: value.projectId as string | null,
    effects: normalizeEffects(value.effects),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
  };
  assertSize(preset.effects);
  return preset;
}

export function createEffectPresetFile(
  name: string,
  effects: EffectPresetEffect[],
): EffectChainPresetFile {
  const file = {
    format: effectPresetFormat,
    version: effectPresetVersion,
    name: normalizeName(name),
    effects: normalizeEffects(effects),
  } satisfies EffectChainPresetFile;
  assertSize(file);
  return file;
}

export function visibleEffectPresets(
  presets: EffectChainPreset[],
  projectId: string,
): EffectChainPreset[] {
  return presets
    .filter((preset) => preset.scope === "global" || preset.projectId === projectId)
    .sort((left, right) =>
      Number(left.scope === "project") - Number(right.scope === "project") ||
      left.name.localeCompare(right.name),
    );
}

export function upsertEffectPreset(
  presets: EffectChainPreset[],
  input: Omit<EffectChainPreset, "createdAt" | "updatedAt">,
): EffectChainPreset[] {
  const normalized = normalizeStoredEffectPreset({
    ...input,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const existing = presets.find((preset) => preset.id === normalized.id);
  if (existing && (existing.scope !== normalized.scope || existing.projectId !== normalized.projectId)) {
    throw new Error("An effect preset cannot be moved between scopes while it is being edited.");
  }
  const saved = {
    ...normalized,
    createdAt: existing?.createdAt ?? normalized.createdAt,
    updatedAt: new Date().toISOString(),
  };
  return existing
    ? presets.map((preset) => preset.id === saved.id ? saved : preset)
    : [...presets, saved];
}

export function effectPresetFileData(preset: EffectChainPreset): EffectChainPresetFile {
  return createEffectPresetFile(preset.name, preset.effects);
}

