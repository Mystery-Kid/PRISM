import assert from "node:assert/strict";
import test from "node:test";
import { getPianoNoteDragUpdate, pasteMidiNotes, splitMidiNoteAt, type PianoNoteDragState } from "./piano-roll";

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

test("single-note paste beyond the selected clip creates a clip at the playhead without clamping", () => {
  let id = 0;
  const existing = { id: "old", name: "Original", startBeat: 0, durationBeats: 4 };
  const source = { id: "source", midiClipId: "old", pitch: 64, velocity: 83, startBeat: 1, durationBeats: 2 };
  const result = pasteMidiNotes({
    notes: [source], clips: [existing], selectedClipId: "old",
    playheadBeat: 12, sourceOriginBeat: 1, createId: () => `new-${++id}`,
  });
  assert.notEqual(result.clipId, existing.id);
  assert.equal(result.notes[0]!.startBeat, 12);
  assert.equal(result.notes[0]!.durationBeats, 2);
  assert.equal(result.notes[0]!.velocity, 83);
  assert.equal(result.notes[0]!.midiClipId, result.clipId);
  assert.deepEqual(result.clips[0], existing);
  assert.equal(source.startBeat, 1);
});

test("multi-note paste at 120 BPM preserves an eight-beat gap and the longest tail", () => {
  const beatSeconds = 60 / 120;
  let id = 0;
  const result = pasteMidiNotes({
    notes: [
      { id: "first", pitch: 60, velocity: 90, startBeat: 2, durationBeats: 1 },
      { id: "last", pitch: 67, velocity: 70, startBeat: 10, durationBeats: 3 },
    ],
    clips: [], selectedClipId: null,
    playheadBeat: 10 / beatSeconds, sourceOriginBeat: (2 * beatSeconds) / beatSeconds,
    createId: () => `new-${++id}`,
  });
  assert.deepEqual(result.notes.map((note) => note.startBeat), [20, 28]);
  assert.deepEqual(result.notes.map((note) => note.durationBeats), [1, 3]);
  assert.equal(result.clips[0]!.startBeat, 20);
  assert.equal(result.clips[0]!.durationBeats, 11);
});

test("paste inside a selected clip extends it instead of shortening notes", () => {
  let id = 0;
  const result = pasteMidiNotes({
    notes: [{ id: "source", pitch: 60, velocity: 90, startBeat: 0, durationBeats: 5 }],
    clips: [{ id: "selected", name: "Selected", startBeat: 0, durationBeats: 4 }],
    selectedClipId: "selected", playheadBeat: 3, sourceOriginBeat: 0,
    createId: () => `new-${++id}`,
  });
  assert.equal(result.clipId, "selected");
  assert.equal(result.clips.length, 1);
  assert.equal(result.clips[0]!.durationBeats, 8);
  assert.equal(result.notes[0]!.durationBeats, 5);
});

test("multi-track note paste retains its offset from the common clipboard origin", () => {
  let id = 0;
  const result = pasteMidiNotes({
    notes: [{ id: "later-track", pitch: 60, velocity: 90, startBeat: 8, durationBeats: 2 }],
    clips: [{ id: "unrelated", name: "Unrelated", startBeat: 50, durationBeats: 4 }],
    selectedClipId: "unrelated", playheadBeat: 16, sourceOriginBeat: 4,
    createId: () => `new-${++id}`,
  });
  assert.equal(result.notes[0]!.startBeat, 20);
  assert.equal(result.clips[1]!.startBeat, 20);
  assert.notEqual(result.clipId, "unrelated");
});
