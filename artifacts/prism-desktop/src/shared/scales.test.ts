import assert from "node:assert/strict";
import test from "node:test";
import { allowedPitchClasses, isMidiViewSettings, isPitchInScale, isSongKey, movePitchByScaleSteps, nearestScalePitch, pitchClass } from "./scales";

test("major and natural minor memberships work at all roots and MIDI octaves", () => {
  for (let root = 0; root < 12; root++) {
    for (const scale of ["major", "naturalMinor"] as const) {
      const key = { root, scale };
      const expected = (scale === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10])
        .map((interval) => (root + interval) % 12);
      assert.deepEqual(allowedPitchClasses(key), expected);
      for (let pitch = 0; pitch <= 127; pitch++) {
        assert.equal(isPitchInScale(pitch, key), expected.includes(pitch % 12));
        const nearest = nearestScalePitch(pitch, key);
        assert.ok(nearest >= 0 && nearest <= 127);
        assert.ok(isPitchInScale(nearest, key));
        assert.ok(Math.abs(nearest - pitch) <= 1);
      }
    }
  }
});

test("scale steps cross octaves and preserve untouched chromatic notes", () => {
  const key = { root: 0, scale: "major" as const };
  assert.equal(movePitchByScaleSteps(60, 1, key), 62);
  assert.equal(movePitchByScaleSteps(60, -1, key), 59);
  assert.equal(movePitchByScaleSteps(71, 1, key), 72);
  assert.equal(movePitchByScaleSteps(61, 0, key), 61);
  assert.equal(movePitchByScaleSteps(61, 1, key), 62);
  assert.equal(movePitchByScaleSteps(61, -1, key), 60);
  assert.equal(movePitchByScaleSteps(127, 1, key), 127);
  assert.equal(movePitchByScaleSteps(0, -1, key), 0);
  assert.equal(nearestScalePitch(61, key), 60);
  assert.equal(pitchClass(-1), 11);
});

test("only explicit supported song keys and boolean view settings validate", () => {
  for (const invalid of [null, {}, { root: -1, scale: "major" }, { root: 12, scale: "major" },
    { root: 1.5, scale: "major" }, { root: 0, scale: "dorian" }, { root: "0", scale: "major" }]) {
    assert.equal(isSongKey(invalid), false);
  }
  assert.equal(isSongKey({ root: 9, scale: "naturalMinor" }), true);
  assert.equal(isMidiViewSettings({ smartView: true, scaleSnap: false }), true);
  assert.equal(isMidiViewSettings({ smartView: "true", scaleSnap: false }), false);
});
