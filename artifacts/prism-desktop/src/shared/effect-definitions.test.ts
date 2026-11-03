import assert from "node:assert/strict";
import test from "node:test";
import { migrateProjectLibrary } from "./migrations";
import { createEffectPresetFile, parseEffectPresetFile } from "./effect-presets";
import {
  effectDefaults,
  nativeEffectCatalog,
  normalizeEffectChain,
  normalizeEffectParameters,
  normalizeEffectState,
} from "./effect-definitions";

test("the native catalog exposes implemented effect categories and safe defaults", () => {
  assert.deepEqual(nativeEffectCatalog.map((effect) => effect.type), [
    "equalizer", "reverb", "delay", "compressor", "distortion", "overdrive", "fuzz",
    "noise-gate", "chorus", "flanger", "phaser", "limiter",
  ]);
  for (const effect of nativeEffectCatalog) {
    assert.ok(effect.description.length > 0);
    assert.ok(effect.parameters.length > 0);
    assert.deepEqual(Object.keys(effectDefaults(effect.type)), effect.parameters.map((item) => item.key));
  }
});

test("every pedal bounds invalid parameters and round-trips presets without reusing identity", () => {
  for (const definition of nativeEffectCatalog) {
    const invalid = Object.fromEntries(definition.parameters.map((parameter, index) =>
      [parameter.key, index % 2 ? Number.POSITIVE_INFINITY : parameter.max + 1]));
    const normalized = normalizeEffectParameters(definition.type, invalid);
    definition.parameters.forEach(parameter => {
      assert.ok(Number.isFinite(normalized[parameter.key]));
      assert.ok(normalized[parameter.key] >= parameter.min && normalized[parameter.key] <= parameter.max);
    });
    const state = { id: `saved-${definition.type}`, type: definition.type, enabled: false, parameters: normalized };
    const file = createEffectPresetFile("Pedals", [{ ...state, raw: state }]);
    const reopened = parseEffectPresetFile(JSON.parse(JSON.stringify(file)));
    assert.deepEqual(reopened.effects[0].parameters, normalized);
    assert.equal(reopened.effects[0].enabled, false);
    assert.equal(reopened.effects[0].id, state.id);
  }
});

test("schema 6 upgrades without changing legacy effects and schema 7 retains all pedal chains", () => {
  const legacy = { id: "legacy", type: "delay", enabled: false, parameters: { time: .42, feedback: .3, mix: .17 } };
  const old = migrateProjectLibrary({ version: 6, releases: [], assets: [], sessions: [{
    id: "song", releaseId: "release", title: "Legacy pedals", tracks: [{ id: "track", effects: [legacy] }],
  }] });
  assert.equal(old.version, 9);
  assert.deepEqual(old.sessions[0].tracks[0].effects, [legacy]);
  const chain = nativeEffectCatalog.map(def => ({
    id: def.type, type: def.type, enabled: def.type !== "flanger", parameters: effectDefaults(def.type),
  }));
  const session = old.sessions[0];
  session.tracks[0].effects = chain;
  session.buses = [{ id: "bus", name: "Bus", level: .7, muted: false, solo: false, outputBusId: null, sends: [], effects: chain }];
  session.masterEffects = chain;
  const reopened = migrateProjectLibrary(JSON.parse(JSON.stringify(old))).sessions[0];
  assert.deepEqual(reopened.tracks[0].effects, chain);
  assert.deepEqual(reopened.buses[0].effects, chain);
  assert.deepEqual(reopened.masterEffects, chain);
});

test("effect parameters are defaulted and clamped to the same DSP ranges", () => {
  assert.deepEqual(
    normalizeEffectParameters("delay", { time: -1, feedback: 4, mix: Number.NaN }),
    { time: 0.01, feedback: 0.85, mix: 0.2 },
  );
  assert.deepEqual(
    normalizeEffectParameters("equalizer", { frequency: 88_000, gain: -99, q: 0 }),
    { frequency: 20_000, gain: -24, q: 0.1 },
  );
  assert.deepEqual(normalizeEffectParameters("compressor", {}), effectDefaults("compressor"));
});

test("effect state validation removes unknown fields and enforces unique chain IDs", () => {
  assert.deepEqual(normalizeEffectState({
    id: "eq-1",
    type: "equalizer",
    enabled: false,
    parameters: { frequency: 200, gain: 4, q: 2, script: "not-a-parameter" },
  }), {
    id: "eq-1",
    type: "equalizer",
    enabled: false,
    parameters: { frequency: 200, gain: 4, q: 2 },
  });
  assert.equal(normalizeEffectState({ id: "unknown", type: "vst3" }), null);
  assert.throws(() => normalizeEffectChain([
    { id: "duplicate", type: "delay", enabled: true, parameters: {} },
    { id: "duplicate", type: "reverb", enabled: true, parameters: {} },
  ]), /unique/);
  assert.throws(() => normalizeEffectChain(Array.from({ length: 65 }, (_, index) => ({
    id: `delay-${index}`, type: "delay", enabled: true, parameters: {},
  }))), /at most 64/);
});
