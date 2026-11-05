import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateSongSession } from "../shared/migrations";
import { musicalSnapshot } from "./workspace-smoke-data";

function fixture() {
  return migrateSongSession({ id: "s", releaseId: "r", title: "Snapshot",
    tracks: [{ id: "t", type: "instrument", midiClips: [{ id: "m", name: "MIDI", startBeat: 0, durationBeats: 4 }],
      notes: [{ id: "n", midiClipId: "m", pitch: 60, velocity: 100, startBeat: 0, durationBeats: 2 }] }] });
}

test("restart key ordering, save time and track color do not cause false musical differences", () => {
  const before = fixture();
  before.tracks[0].notes[0] = { id: "n", midiClipId: "m", pitch: 60, velocity: 100, startBeat: 0, durationBeats: 2 };
  const after = migrateSongSession(structuredClone(before));
  after.updatedAt = "different save timestamp";
  after.tracks[0].color = "#00c9b0";
  assert.notEqual(JSON.stringify(before.tracks[0].notes), JSON.stringify(after.tracks[0].notes));
  assert.equal(musicalSnapshot(before), musicalSnapshot(after));
});

test("musical comparison remains strict about timing, notes, mixer and routing", () => {
  const original = fixture(), reference = musicalSnapshot(original);
  for (const change of [
    (song: typeof original) => { song.tracks[0].notes[0].pitch++; },
    (song: typeof original) => { song.tracks[0].notes[0].startBeat += .25; },
    (song: typeof original) => { song.tracks[0].notes[0].velocity--; },
    (song: typeof original) => { song.tracks[0].midiClips![0].durationBeats++; },
    (song: typeof original) => { song.tracks[0].volume *= .5; },
    (song: typeof original) => { song.tracks[0].outputBusId = "other"; },
    (song: typeof original) => { song.tempo++; },
  ]) {
    const changed = structuredClone(original);
    change(changed);
    assert.notEqual(musicalSnapshot(changed), reference);
  }
});
