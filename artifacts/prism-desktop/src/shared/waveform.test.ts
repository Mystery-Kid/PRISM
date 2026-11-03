import assert from "node:assert/strict";
import test from "node:test";
import { computeWaveformPeaks, getWaveformWindow } from "./waveform";

test("peaks include right-channel audio, transients and real silence", () => {
  assert.deepEqual(computeWaveformPeaks([new Float32Array(8), new Float32Array([0, 0, -.8, 0, 0, .4, 0, 0])], 4),
    [0, Math.fround(.8), Math.fround(.4), 0]);
  assert.deepEqual(computeWaveformPeaks([new Float32Array(4)], 4), [0, 0, 0, 0]);
  assert.deepEqual(computeWaveformPeaks([], 4), []);
  assert.deepEqual(computeWaveformPeaks([new Float32Array([NaN, Infinity, -2, 0])], 2), [0, 1]);
});

test("windowing follows source offsets and trims instead of repeating the full source", () => {
  const source = [0, .1, .2, .3, .4, .5, .6, .7];
  assert.deepEqual(getWaveformWindow(source, 8, 2, 2, 2), [.2, .3]);
  assert.deepEqual(getWaveformWindow(source, 8, 6, 8, 2), [.6, .7]);
  assert.deepEqual(getWaveformWindow(source, 8, 8, 2, 2), []);
  assert.deepEqual(getWaveformWindow([], 8, 0, 2), []);
  assert.deepEqual(source, [0, .1, .2, .3, .4, .5, .6, .7]);
});
