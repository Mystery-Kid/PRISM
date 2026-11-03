import assert from "node:assert/strict";
import test from "node:test";
import { stretchAudio } from "./time-stretch";
import { applyTempoChange } from "./tempo";
import { migrateProjectLibrary } from "./migrations";
import { beatToSeconds, secondsToBeat } from "../renderer/audio/time";

const fixture = () => migrateProjectLibrary({ version: 7, assets: [], releases: [], sessions: [{
  id: "song", releaseId: "release", title: "Tempo", tempo: 120, timeSignature: "6/8",
  loopRange: { enabled: true, startSeconds: 1, endSeconds: 3 },
  tracks: [{ id: "audio", type: "audio", clips: [{
    id: "clip", assetId: "source", name: "Take", startSeconds: 2, durationSeconds: 1,
    sourceStartSeconds: .25, sourceDurationSeconds: 3, gain: .8, fadeInSeconds: .1, fadeOutSeconds: .2,
  }] }, { id: "midi", type: "instrument", notes: [{ id: "note", pitch: 60, startBeat: 4, durationBeats: 2, velocity: 90 }] }],
}] }).sessions[0];
const pitch = (samples: Float32Array, rate: number) => {
  let crossings = 0;
  const start = Math.floor(samples.length * .2), end = Math.floor(samples.length * .8);
  for (let i = start+1; i < end; i++) if (samples[i-1] <= 0 && samples[i] > 0) crossings++;
  return crossings / ((end-start) / rate);
};
test("WSOLA changes length without resampling pitch or mutating original stereo PCM", () => {
  for (const rate of [22050, 48000]) {
    const source = Float32Array.from({ length: rate }, (_, i) => .6 * Math.sin(2*Math.PI*440*i/rate));
    const original = source.slice();
    for (const ratio of [.5, .75, 1.5, 2]) {
      const [left, right] = stretchAudio([source, source.map(value => -value)], rate, ratio);
      assert.equal(left.length, Math.round(rate*ratio));
      assert.ok(left.every(Number.isFinite));
      assert.ok(Math.abs(pitch(left, rate)-440) < 5, `Pitch moved at ${ratio}: ${pitch(left, rate)}`);
      assert.ok(left.every((value, i) => Math.abs(value+right[i]) < 1e-6), "Stereo phase was lost");
      assert.deepEqual(source, original);
    }
  }
});
test("stretch bounds and malformed PCM fail explicitly", () => {
  const source = new Float32Array(100);
  assert.throws(() => stretchAudio([source], 48000, .4), /0.5x/);
  assert.throws(() => stretchAudio([source, new Float32Array(50)], 48000, 1.5), /matching/);
  assert.throws(() => stretchAudio([Float32Array.of(Number.NaN)], 48000, 1), /finite/);
});
test("tempo-only retains audio seconds and source; MIDI keeps beats across BPM and meter", () => {
  const before = fixture(), next = applyTempoChange(before, 93.5);
  assert.deepEqual(next.tracks, before.tracks);
  assert.deepEqual(next.loopRange, before.loopRange);
  assert.equal(next.tempo, 93.5);
  for (const tempo of [47, 93.5, 123, 240]) for (const meter of ["3/4", "6/8", "7/8", "5/4"]) {
    assert.ok(Math.abs(secondsToBeat(beatToSeconds(7, tempo, meter), tempo, meter)-7) < 1e-10);
  }
  assert.equal(beatToSeconds(4, 120, "6/8"), 1);
  assert.equal(beatToSeconds(4, 60, "6/8"), 2);
});
test("adaptation maps trims/fades/loops and repeated stretches always refer to original media", () => {
  const before = fixture();
  const baseline = JSON.stringify(before);
  const first = applyTempoChange(before, 80, new Map([["source", { id: "derived", duration: 4.5, waveform: [.4], ratio: 1.5 }]]));
  const clip = first.tracks[0].clips[0];
  assert.equal(clip.startSeconds, 3); assert.equal(clip.durationSeconds, 1.5);
  assert.equal(clip.sourceStartSeconds, .375); assert.ok(Math.abs(clip.fadeOutSeconds-.3) < 1e-10);
  assert.equal(clip.tempoAdaptation?.originalAssetId, "source");
  assert.deepEqual(first.loopRange, { enabled: true, startSeconds: 1.5, endSeconds: 4.5 });
  const again = applyTempoChange(first, 160, new Map([["derived", { id: "derived2", duration: 2.25, waveform: [.3], ratio: .75 }]]));
  assert.equal(again.tracks[0].clips[0].durationSeconds, .75);
  assert.equal(again.tracks[0].clips[0].sourceStartSeconds, .1875);
  assert.equal(again.tracks[0].clips[0].tempoAdaptation?.originalAssetId, "source");
  assert.equal(JSON.stringify(before), baseline, "Original project was mutated");
  assert.throws(() => applyTempoChange(before, Number.NaN), /Tempo/);
});
