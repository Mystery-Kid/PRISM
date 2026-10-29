import assert from "node:assert/strict";
import test from "node:test";
import { getPianoNoteDragUpdate, splitMidiNoteAt, type PianoNoteDragState } from "./piano-roll";

const drag: PianoNoteDragState = {
  pointerStartX: 100,
  pointerStartY: 100,
  startBeat: 2,
  durationBeats: 1,
  pitch: 60,
  resize: false,
};

test("dragging a piano-roll note changes its beat and pitch", () => {
  assert.deepEqual(
    getPianoNoteDragUpdate(drag, 154, 70, 54, false),
    { startBeat: 3, durationBeats: 1, pitch: 62 },
  );
});

test("note moves snap to quarter beats and keep pitch within MIDI range", () => {
  assert.deepEqual(
    getPianoNoteDragUpdate({ ...drag, startBeat: 0, pitch: 127 }, 108, 130, 54, true),
    { startBeat: 0.25, durationBeats: 1, pitch: 125 },
  );
  assert.equal(
    getPianoNoteDragUpdate({ ...drag, pitch: 0 }, 100, 130, 54, false).pitch,
    0,
  );
});

test("resizing changes only duration and honors the minimum note length", () => {
  assert.deepEqual(
    getPianoNoteDragUpdate({ ...drag, resize: true }, 127, 40, 54, true),
    { startBeat: 2, durationBeats: 1.5, pitch: 60 },
  );
  assert.equal(
    getPianoNoteDragUpdate({ ...drag, resize: true }, 0, 100, 54, true).durationBeats,
    0.25,
  );
});

test("splitting a note preserves both note segments and musical properties", () => {
  const note = { id: "note-a", pitch: 64, startBeat: 2, durationBeats: 2, velocity: 91 };
  assert.deepEqual(splitMidiNoteAt(note, 3, "note-b"), {
    left: { ...note, durationBeats: 1 },
    right: { ...note, id: "note-b", startBeat: 3, durationBeats: 1 },
  });
  assert.equal(splitMidiNoteAt(note, 2.1, "note-b"), null);
  assert.equal(splitMidiNoteAt(note, 3.9, "note-b"), null);
});
