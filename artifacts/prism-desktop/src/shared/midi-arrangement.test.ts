import assert from "node:assert/strict";
import test from "node:test";
import { validateMidiArrangement } from "./midi-arrangement";
import { migrateSongSession } from "./migrations";

test("MIDI arrangement grouping and absolute-beat playback notes survive reload", () => {
  const track = {
    id: "lead", name: "Lead", type: "instrument",
    instrument: { waveform: "sine", attack: .01, decay: .1, sustain: .6, release: .1 },
    midiClips: [{ id: "phrase", name: "Phrase", startBeat: 8, durationBeats: 4 }],
    notes: [{ id: "note", midiClipId: "phrase", pitch: 64, startBeat: 9, durationBeats: 1, velocity: 80 }],
  };
  const reopened = migrateSongSession(JSON.parse(JSON.stringify({
    id: "song", releaseId: "release", title: "Grouping check", tracks: [track],
  })));
  assert.deepEqual(reopened.tracks[0]!.midiClips, track.midiClips);
  assert.deepEqual(reopened.tracks[0]!.notes, track.notes);
  assert.doesNotThrow(() => validateMidiArrangement(reopened.tracks[0]!));
});

test("legacy notes are accepted but duplicate clips, nonfinite timing and missing associations are rejected", () => {
  const note = { id: "note", pitch: 60, startBeat: 0, durationBeats: 1, velocity: 90 };
  const clip = { id: "clip", name: "Phrase", startBeat: 0, durationBeats: 4 };
  assert.doesNotThrow(() => validateMidiArrangement({ notes: [note] }));
  assert.throws(() => validateMidiArrangement({ notes: [], midiClips: [clip, clip] }), /identity/);
  assert.throws(() => validateMidiArrangement({ notes: [], midiClips: [{ ...clip, startBeat: NaN }] }), /timing/);
  assert.throws(() => validateMidiArrangement({ notes: [{ ...note, midiClipId: "missing" }], midiClips: [clip] }), /missing/);
});
