import assert from "node:assert/strict";
import test from "node:test";
import type { AudioClip } from "@shared/types";
import { getClipWindow } from "./timeline";

const clip: AudioClip = {
  id: "clip",
  assetId: "asset",
  name: "Take",
  durationSeconds: 6,
  sourceDurationSeconds: 20,
  startSeconds: 10,
  sourceStartSeconds: 4,
  gain: 1,
  fadeInSeconds: 0,
  fadeOutSeconds: 0,
  waveform: [],
};

test("playback window maps trimmed clip time to the correct source range", () => {
  assert.deepEqual(getClipWindow(clip, 12, 15), {
    timelineStart: 12,
    timelineEnd: 15,
    sourceStart: 6,
    duration: 3,
  });
});

test("clip source range cannot extend past the imported audio", () => {
  const shortSource = { ...clip, sourceDurationSeconds: 5 };
  assert.deepEqual(getClipWindow(shortSource, 10, 20), {
    timelineStart: 10,
    timelineEnd: 11,
    sourceStart: 4,
    duration: 1,
  });
  assert.equal(getClipWindow(shortSource, 11, 15), null);
});
