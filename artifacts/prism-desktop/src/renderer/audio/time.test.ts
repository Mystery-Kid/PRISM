import assert from "node:assert/strict";
import test from "node:test";
import {
  beatToSeconds,
  formatMusicalPosition,
  normalizeLoopRange,
  parseTimeSignature,
  secondsToBeat,
  snapBeat,
} from "./time";

test("time conversions share the tempo and meter basis", () => {
  assert.equal(beatToSeconds(4, 120, "4/4"), 2);
  assert.equal(beatToSeconds(4, 120, "6/8"), 1);
  assert.equal(secondsToBeat(1.5, 120, "4/4"), 3);
});

test("invalid meters fall back safely and musical position is one-based", () => {
  assert.deepEqual(parseTimeSignature("0/7"), { numerator: 4, denominator: 4 });
  assert.equal(formatMusicalPosition(0, 120, "4/4"), "1.1.1 (4/4)");
  assert.equal(formatMusicalPosition(2, 120, "4/4"), "2.1.1 (4/4)");
});

test("grid snapping and loop validation reject invalid ranges", () => {
  assert.equal(snapBeat(1.12, 4), 1);
  assert.equal(snapBeat(1.13, 4), 1.25);
  assert.deepEqual(normalizeLoopRange(3, 1), { startSeconds: 1, endSeconds: 3 });
  assert.equal(normalizeLoopRange(2, 2), null);
});
