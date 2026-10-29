import assert from "node:assert/strict";
import test from "node:test";
import { migrateProjectLibrary, migrateSongSession } from "./migrations";

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

test("version-one project library upgrades to the current schema", () => {
  const migrated = migrateProjectLibrary({
    version: 1,
    releases: [],
    sessions: [],
  });

  assert.deepEqual(migrated, {
    version: 3,
    releases: [],
    sessions: [],
    assets: [],
    effectPresets: [],
  });
});

test("project migration rejects media paths outside the managed asset folder", () => {
  assert.throws(() => migrateProjectLibrary({
    version: 3,
    releases: [],
    sessions: [],
    assets: [{
      id: "asset-1",
      fileName: "audio.wav",
      mimeType: "audio/wav",
      storageName: "../../outside.wav",
    }],
  }), /unsafe or damaged storage path/);
});

test("project migration preserves the saved order of songs in an album", () => {
  const migrated = migrateProjectLibrary({
    version: 2,
    releases: [{
      id: "release-1",
      title: "Album",
      releaseType: "Album",
      songIds: ["song-b", "song-a"],
    }],
    sessions: ["song-a", "song-b"].map((id) => ({
      id,
      releaseId: "release-1",
      title: id,
      tempo: 120,
      timeSignature: "4/4",
      tracks: [],
    })),
    assets: [],
  });
  const reopened = migrateProjectLibrary(JSON.parse(JSON.stringify(migrated)));

  assert.deepEqual(reopened.releases[0].songIds, ["song-b", "song-a"]);
});

test("core version-three libraries without presets remain compatible with effects builds", () => {
  const migrated = migrateProjectLibrary({ version: 3, releases: [], sessions: [], assets: [] });
  assert.deepEqual(migrated.effectPresets, []);
});

test("project migration preserves stored effect presets across reopening", () => {
  const preset = {
    id: "preset-1", name: "Saved chain", version: 1, scope: "global",
    projectId: null, effects: [],
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const migrated = migrateProjectLibrary({
    version: 3, releases: [], sessions: [], assets: [], effectPresets: [preset],
  });
  const reopened = migrateProjectLibrary(JSON.parse(JSON.stringify(migrated)));
  assert.deepEqual(reopened.effectPresets, [preset]);
});

test("project migration rejects malformed preset collections rather than clearing them", () => {
  assert.throws(() => migrateProjectLibrary({
    version: 3, releases: [], sessions: [], assets: [], effectPresets: null,
  }), /effect-preset library is damaged/);
});
