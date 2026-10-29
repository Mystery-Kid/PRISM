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

test("legacy sessions without buses still route directly to Master", () => {
  const migrated = migrateSongSession({
    id: "legacy-session",
    releaseId: "release-1",
    title: "Legacy",
    tempo: 120,
    timeSignature: "4/4",
    tracks: [{ id: "legacy-track", name: "Audio", clips: [] }],
  });
  assert.deepEqual(migrated.buses, []);
  assert.equal(migrated.tracks[0].outputBusId, null);
  assert.deepEqual(migrated.tracks[0].sends, []);
});

test("bus routing, sends, levels, and effects survive save/reopen migration", () => {
  const session = {
    id: "routed-session",
    releaseId: "release-1",
    title: "Routed",
    tempo: 120,
    timeSignature: "4/4",
    loopRange: null,
    metronomeEnabled: false,
    masterVolume: 1,
    masterEffects: [],
    buses: [{
      id: "drum-bus",
      name: "Drum Bus",
      level: 0.72,
      muted: false,
      solo: false,
      outputBusId: null,
      sends: [],
      effects: [{
        id: "bus-eq",
        type: "equalizer",
        enabled: true,
        parameters: { frequency: 180, gain: 2, q: 1.1 },
      }],
    }],
    tracks: [{
      id: "kick",
      name: "Kick",
      type: "audio",
      outputBusId: "drum-bus",
      sends: [{ id: "kick-send", busId: "drum-bus", level: 0.4, placement: "pre" }],
      clips: [],
      notes: [],
      effects: [],
    }],
    updatedAt: new Date(0).toISOString(),
  };
  const reopened = migrateSongSession(JSON.parse(JSON.stringify(session)));
  assert.deepEqual(reopened.buses, session.buses);
  assert.equal(reopened.tracks[0].outputBusId, "drum-bus");
  assert.deepEqual(reopened.tracks[0].sends, session.tracks[0].sends);
});

test("migration refuses a cyclic bus graph instead of silently changing its sound", () => {
  assert.throws(() => migrateSongSession({
    id: "cyclic-session",
    releaseId: "release-1",
    title: "Cyclic",
    tempo: 120,
    timeSignature: "4/4",
    tracks: [],
    buses: [
      { id: "bus-a", name: "A", outputBusId: "bus-b" },
      { id: "bus-b", name: "B", outputBusId: "bus-a" },
    ],
  }), /cycle/i);
});
