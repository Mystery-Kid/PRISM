import assert from "node:assert/strict";
import test from "node:test";
import {
  createEffectPresetFile,
  effectPresetFileData,
  normalizeStoredEffectPreset,
  parseEffectPresetFile,
  upsertEffectPreset,
  visibleEffectPresets,
} from "./effect-presets";
import type { EffectChainPreset } from "./types";

const now = "2026-10-28T12:00:00.000Z";
const basePreset: EffectChainPreset = {
  id: "project-preset",
  name: "Warm Room",
  version: 1,
  scope: "project",
  projectId: "release-a",
  createdAt: now,
  updatedAt: now,
  effects: [{
    id: "native-reverb",
    type: "reverb",
    enabled: true,
    parameters: { decay: 1.8, mix: 0.25 },
    raw: { id: "native-reverb", type: "reverb", enabled: true, parameters: { decay: 1.8, mix: 0.25 } },
  }],
};

test("versioned preset import preserves unknown effect payload as inert JSON", () => {
  const payload = {
    id: "unsupported-1",
    type: "com.vendor.custom-room",
    enabled: true,
    parameters: { size: 7 },
    pluginData: { preset: "large hall", code: "globalThis.compromised = true" },
  };
  const file = parseEffectPresetFile({
    format: "prism-effect-chain",
    version: 1,
    name: "Imported",
    effects: [payload],
  });
  assert.equal(file.effects[0].type, payload.type);
  assert.equal(JSON.stringify(file.effects[0].raw), JSON.stringify(payload));
  assert.equal((globalThis as { compromised?: boolean }).compromised, undefined);
  assert.equal(
    JSON.stringify(parseEffectPresetFile(JSON.parse(JSON.stringify(file))).effects[0].raw),
    JSON.stringify(payload),
  );
});

test("preset version, name, and chain size are validated", () => {
  assert.throws(() => parseEffectPresetFile({ format: "prism-effect-chain", version: 2, name: "Later", effects: [] }), /version 1/);
  assert.throws(() => parseEffectPresetFile({ format: "prism-effect-chain", version: 1, name: "", effects: [] }), /name/);
  assert.throws(() => parseEffectPresetFile({ format: "prism-effect-chain", version: 1, name: "Too many", effects: Array(65).fill({ type: "vst3" }) }), /at most 64/);
  assert.throws(() => parseEffectPresetFile({ format: "prism-effect-chain", version: 1, name: "Missing type", effects: [{}] }), /type/);
});

test("global presets cross release boundaries while project presets stay scoped", () => {
  const global = normalizeStoredEffectPreset({ ...basePreset, id: "global", scope: "global", projectId: null });
  assert.deepEqual(
    visibleEffectPresets([basePreset, global], "release-a").map((preset) => preset.id),
    ["global", "project-preset"],
  );
  assert.deepEqual(
    visibleEffectPresets([basePreset, global], "release-b").map((preset) => preset.id),
    ["global"],
  );
});

test("rename and duplicate survive serialization and reopening with raw data intact", () => {
  const global = normalizeStoredEffectPreset({ ...basePreset, id: "global", scope: "global", projectId: null });
  const named = upsertEffectPreset([global, basePreset], {
    ...basePreset,
    name: "Warm Room v2",
  });
  const duplicate = upsertEffectPreset(named, {
    ...basePreset,
    id: "project-preset-copy",
    name: "Warm Room Copy",
  });
  const reopened = JSON.parse(JSON.stringify(duplicate)).map(normalizeStoredEffectPreset);
  assert.equal(reopened.find((preset: EffectChainPreset) => preset.id === "project-preset")?.name, "Warm Room v2");
  assert.equal(
    JSON.stringify(reopened.find((preset: EffectChainPreset) => preset.id === "project-preset-copy")?.effects[0].raw),
    JSON.stringify(basePreset.effects[0].raw),
  );
  assert.equal(
    JSON.stringify(effectPresetFileData(reopened[0]).effects[0].raw),
    JSON.stringify(basePreset.effects[0].raw),
  );
  assert.equal(createEffectPresetFile("Empty chain", []).effects.length, 0);
});

test("an existing preset cannot be silently moved between scopes", () => {
  assert.throws(() => upsertEffectPreset([basePreset], {
    ...basePreset,
    scope: "global",
    projectId: null,
  }), /cannot be moved/);
});
