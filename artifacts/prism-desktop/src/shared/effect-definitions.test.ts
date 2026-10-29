import assert from "node:assert/strict";
import test from "node:test";
import {
  effectDefaults,
  nativeEffectCatalog,
  normalizeEffectChain,
  normalizeEffectParameters,
  normalizeEffectState,
} from "./effect-definitions";

test("the native catalog exposes implemented effect categories and safe defaults", () => {
  assert.deepEqual(nativeEffectCatalog.map((effect) => effect.type), [
    "equalizer", "reverb", "delay", "compressor",
  ]);
  for (const effect of nativeEffectCatalog) {
    assert.ok(effect.description.length > 0);
    assert.ok(effect.parameters.length > 0);
    assert.deepEqual(Object.keys(effectDefaults(effect.type)), effect.parameters.map((item) => item.key));
  }
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
