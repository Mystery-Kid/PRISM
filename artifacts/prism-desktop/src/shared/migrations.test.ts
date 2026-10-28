import assert from "node:assert/strict";
import test from "node:test";
import { migrateSongSession } from "./migrations";

test("version-one song shape migrates while preserving clips and assets", () => {
  const migrated = migrateSongSession({
    id: "session-1",
    releaseId: "release-1",
    title: "Old project",
    tempo: 96,
    timeSignature: "4/4",
    tracks: [{
      id: "track-1",
      name: "Audio 1",
      volume: 0.85,
      pan: -0.2,
      muted: false,
      solo: false,
      clips: [{
        id: "clip-1",
        assetId: "asset-1",
        name: "take.wav",
        durationSeconds: 12,
        startSeconds: 3,
        gain: 1,
        waveform: [0.1, 0.5],
      }],
    }],
  });

  assert.equal(migrated.tracks[0].type, "audio");
  assert.equal(migrated.tracks[0].clips[0].assetId, "asset-1");
  assert.equal(migrated.tracks[0].clips[0].sourceStartSeconds, 0);
  assert.equal(migrated.tracks[0].clips[0].sourceDurationSeconds, 12);
  assert.equal(migrated.tracks[0].clips[0].fadeOutSeconds, 0);
  assert.deepEqual(migrated.tracks[0].notes, []);
  assert.equal(migrated.masterVolume, 1);
  assert.equal(migrated.loopRange, null);
});

test("instrument settings and MIDI notes survive session serialization and migration", () => {
  const session = {
    id: "session-midi",
    releaseId: "release-1",
    title: "MIDI session",
    tempo: 128,
    timeSignature: "4/4",
    tracks: [{
      id: "instrument-1",
      name: "Lead",
      type: "instrument",
      notes: [{
        id: "note-1",
        pitch: 73,
        startBeat: 1.25,
        durationBeats: 0.75,
        velocity: 54,
      }],
      instrument: {
        waveform: "square",
        attack: 0.034,
        decay: 0.29,
        sustain: 0.42,
        release: 0.81,
      },
    },
  ],
  };
  const reopened = migrateSongSession(JSON.parse(JSON.stringify(session)));

  assert.deepEqual(reopened.tracks[0].notes, session.tracks[0].notes);
  assert.deepEqual(reopened.tracks[0].instrument, session.tracks[0].instrument);
});
