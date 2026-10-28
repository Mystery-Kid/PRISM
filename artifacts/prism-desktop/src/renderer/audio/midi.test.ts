import assert from "node:assert/strict";
import test from "node:test";
import type { InstrumentState, MidiNote } from "@shared/types";
import {
  createMidiEnvelopePlan,
  getMidiPlaybackWindow,
  midiPitchToFrequency,
} from "./midi";

const instrument: InstrumentState = {
  waveform: "triangle",
  attack: 0.01,
  decay: 0.1,
  sustain: 0.5,
  release: 0.2,
};

const note: MidiNote = {
  id: "note",
  pitch: 69,
  startBeat: 2,
  durationBeats: 2,
  velocity: 127,
};

test("MIDI pitch maps to standard equal-tempered frequencies", () => {
  assert.equal(midiPitchToFrequency(69), 440);
  assert.ok(Math.abs(midiPitchToFrequency(60) - 261.625565) < 0.001);
});

test("velocity scales the full ADSR envelope, including the attack", () => {
  const full = createMidiEnvelopePlan({ velocity: 127 }, instrument, 1);
  const soft = createMidiEnvelopePlan({ velocity: 64 }, instrument, 1);

  assert.equal(full.initialValue, 0);
  assert.equal(full.events[0].value, 1);
  assert.ok(Math.abs(soft.events[0].value - 64 / 127) < 1e-12);
  assert.ok(Math.abs(soft.events[1].value - (64 / 127) * instrument.sustain) < 1e-12);
  assert.equal(full.events.at(-1)?.value, 0);
});

test("resuming a note restores its envelope level and remaining phases", () => {
  const duringAttack = createMidiEnvelopePlan({ velocity: 127 }, instrument, 1, 0.005);
  assert.equal(duringAttack.initialValue, 0.5);
  assert.equal(duringAttack.events[0].timeSeconds, 0.01);
  assert.equal(duringAttack.events[0].value, 1);

  const duringRelease = createMidiEnvelopePlan({ velocity: 127 }, instrument, 1, 0.9);
  assert.ok(Math.abs(duringRelease.initialValue - 0.25) < 1e-12);
  assert.deepEqual(duringRelease.events, [{ timeSeconds: 1, value: 0, curve: "linear" }]);
});

test("very short notes keep a valid, bounded envelope schedule", () => {
  const plan = createMidiEnvelopePlan({ velocity: 1 }, instrument, 0.001);
  assert.ok(plan.events.every((event) => Number.isFinite(event.timeSeconds) && event.timeSeconds <= 0.005));
  assert.equal(plan.events.at(-1)?.value, 0);
  assert.ok(plan.initialValue >= 0 && plan.initialValue <= 1);
});

test("playback windows schedule notes once and resume a note when seeking inside it", () => {
  const firstSegment = getMidiPlaybackWindow(note, 120, "4/4", 0.5, 1.5, 0.5, null);
  assert.deepEqual(firstSegment, { startSeconds: 1, endSeconds: 2, offsetSeconds: 0 });

  const seek = getMidiPlaybackWindow(note, 120, "4/4", 1.25, 1.75, 1.25, null);
  assert.deepEqual(seek, { startSeconds: 1.25, endSeconds: 2, offsetSeconds: 0.25 });

  assert.equal(getMidiPlaybackWindow(note, 120, "4/4", 1.5, 1.75, 1.25, null), null);
});

test("loop boundaries release and resume notes at the loop start", () => {
  const spanningNote = { ...note, startBeat: 0, durationBeats: 4 };
  const loopRange = { enabled: true, startSeconds: 0.5, endSeconds: 1.5 };
  const firstPass = getMidiPlaybackWindow(
    spanningNote,
    120,
    "4/4",
    0.5,
    1,
    0.5,
    loopRange,
  );
  assert.deepEqual(firstPass, { startSeconds: 0.5, endSeconds: 1.5, offsetSeconds: 0.5 });

  const nextPass = getMidiPlaybackWindow(
    spanningNote,
    120,
    "4/4",
    0.5,
    1,
    0.5,
    loopRange,
  );
  assert.deepEqual(nextPass, firstPass);
});
