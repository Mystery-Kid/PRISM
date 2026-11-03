import assert from "node:assert/strict";
import test from "node:test";
import {
  clampLayoutSize,
  clientYToArrangementPitch,
  clientXToTimelineSeconds,
  secondsToTimelineX,
  timelineXToSeconds,
} from "./arrangement-layout";

test("arrangement transforms stay inverse at fractional zoom and nonzero origin", () => {
  const pps = 54 * 1.35;
  const origin = 287.5;
  const seconds = 13.625;
  const screenX = origin + secondsToTimelineX(seconds, pps);
  assert.equal(clientXToTimelineSeconds(screenX, origin, pps), seconds);
  assert.equal(timelineXToSeconds(screenX - origin, pps), seconds);
});

test("timeline coordinates clamp before the arrangement origin and accept high-DPI fractions", () => {
  assert.equal(clientXToTimelineSeconds(199.75, 200, 81), 0);
  assert.equal(clientXToTimelineSeconds(281, 200, 81), 1);
});

test("layout resize bounds remain sane", () => {
  assert.equal(clampLayoutSize(900, 176, 420), 420);
  assert.equal(clampLayoutSize(Number.NaN, 82, 220), 82);
});

test("arrangement pitch hit testing scales with the resized lane height", () => {
  assert.equal(clientYToArrangementPitch(25, 25, 112), 127);
  assert.equal(clientYToArrangementPitch(25 + 56, 25, 112), 63);
  assert.equal(clientYToArrangementPitch(200, 25, 112), 0);
  assert.equal(clientYToArrangementPitch(25 + 110, 25, 220), 63);
});
