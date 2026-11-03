import assert from "node:assert/strict";
import test from "node:test";
import { migrateProjectLibrary, migrateSongSession } from "./migrations";

test("song key and independent MIDI view settings round-trip without rewriting notes", () => {
  const original = {
    id: "song-key", releaseId: "release", title: "Scale session",
    songKey: { root: 9, scale: "naturalMinor" }, midiView: { smartView: true, scaleSnap: true },
    tracks: [{ id: "lead", type: "instrument", name: "Lead", notes: [
      { id: "chromatic", pitch: 61, startBeat: 8.5, durationBeats: 2, velocity: 87, midiClipId: "group" },
    ], midiClips: [{ id: "group", name: "Original", startBeat: 8, durationBeats: 4 }] }],
  };
  const migrated = migrateSongSession(original);
  assert.deepEqual(migrated.songKey, original.songKey);
  assert.deepEqual(migrated.midiView, original.midiView);
  assert.deepEqual(migrated.tracks[0]!.notes, original.tracks[0]!.notes);
  const toggled = migrateSongSession({ ...migrated, songKey: { root: 0, scale: "major" },
    midiView: { smartView: false, scaleSnap: false } });
  assert.deepEqual(toggled.tracks, migrated.tracks);
  assert.deepEqual(migrateSongSession(JSON.parse(JSON.stringify(toggled))), toggled);
});

test("legacy or invalid key settings stay unrestricted and keep existing note events", () => {
  const legacy = { id: "song", releaseId: "release", title: "Legacy", tracks: [
    { id: "track", notes: [{ id: "note", pitch: 73, startBeat: 2, durationBeats: 1, velocity: 93 }] },
  ] };
  for (const songKey of [undefined, { root: 12, scale: "major" }, { root: 0, scale: "unknown" }]) {
    const result = migrateSongSession({ ...legacy, songKey });
    assert.equal(result.songKey, null);
    assert.deepEqual(result.midiView, { smartView: false, scaleSnap: false });
    assert.deepEqual(result.tracks[0]!.notes, legacy.tracks[0]!.notes);
  }
});

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

test("sampler sample references, settings, and MIDI patterns survive reopening", () => {
  const migrated = migrateSongSession({
    id: "sampler-session",
    releaseId: "release-1",
    title: "Sampled lead",
    tempo: 104,
    timeSignature: "4/4",
    tracks: [{
      id: "sampler-1",
      name: "Vocal chop",
      type: "sampler",
      sampler: { sampleAssetId: "missing-sample-id", rootNote: 57, gain: 0.78 },
      notes: [
        { id: "chop-a", pitch: 57, startBeat: 0, durationBeats: 0.5, velocity: 103 },
        { id: "chop-b", pitch: 64, startBeat: 1, durationBeats: 0.25, velocity: 86 },
      ],
    }],
  });
  assert.equal(migrated.tracks[0].type, "sampler");
  assert.deepEqual(migrated.tracks[0].sampler, {
    sampleAssetId: "missing-sample-id",
    rootNote: 57,
    gain: 0.78,
  });
  assert.deepEqual(migrated.tracks[0].notes.map((note) => note.id), ["chop-a", "chop-b"]);
});

test("MIDI clip groups and absolute-beat note events survive portable save migrations", () => {
  const session = {
    id: "midi-clip-session",
    releaseId: "release-1",
    title: "MIDI arrangement",
    tempo: 110,
    timeSignature: "4/4",
    tracks: [{
      id: "synth-1",
      name: "Lead",
      type: "instrument",
      midiClips: [{ id: "clip-a", name: "Verse phrase", startBeat: 8, durationBeats: 4 }],
      notes: [{ id: "note-a", pitch: 67, startBeat: 9.5, durationBeats: 0.75, velocity: 91, midiClipId: "clip-a" }],
    }],
  };
  const opened = migrateSongSession(JSON.parse(JSON.stringify(session)));
  assert.deepEqual(opened.tracks[0].midiClips, session.tracks[0].midiClips);
  assert.deepEqual(opened.tracks[0].notes, session.tracks[0].notes);
  const reopened = migrateSongSession(JSON.parse(JSON.stringify(opened)));
  assert.deepEqual(reopened.tracks[0].midiClips, session.tracks[0].midiClips);
  assert.deepEqual(reopened.tracks[0].notes, session.tracks[0].notes);
  const repairedLegacyNote = migrateSongSession({
    id: "orphaned-midi-session",
    releaseId: "release-1",
    title: "Legacy MIDI",
    tempo: 110,
    timeSignature: "4/4",
    tracks: [{
      id: "legacy-track",
      name: "Lead",
      type: "instrument",
      notes: [{ id: "orphaned-note", pitch: 60, startBeat: 2, durationBeats: 1, velocity: 90, midiClipId: "missing-group" }],
    }],
  });
  assert.equal(Object.hasOwn(repairedLegacyNote.tracks[0].notes[0], "midiClipId"), false);
});

test("drum pad assignments and MIDI patterns survive reopening", () => {
  const session = {
    id: "drum-session",
    releaseId: "release-1",
    title: "Beat",
    tempo: 120,
    timeSignature: "4/4",
    tracks: [{
      id: "drums",
      name: "Kit",
      type: "drum",
      drumKit: {
        patternLengthBars: 2,
        patternStartBeat: 8,
        pads: [
          { id: "kick", name: "Kick", note: 36, sampleAssetId: "kick-file", gain: 0.9 },
          { id: "snare", name: "Snare", note: 38, sampleAssetId: null, gain: 1 },
        ],
      },
      notes: [
        { id: "kick-1", pitch: 36, startBeat: 0, durationBeats: 0.25, velocity: 120 },
        { id: "snare-1", pitch: 38, startBeat: 2, durationBeats: 0.25, velocity: 94 },
      ],
    }],
  };
  const reopened = migrateSongSession(JSON.parse(JSON.stringify(session)));
  assert.deepEqual(reopened.tracks[0].drumKit, session.tracks[0].drumKit);
  assert.deepEqual(reopened.tracks[0].notes, session.tracks[0].notes);
});

test("unsupported track state is retained with MIDI notes and a recovery notice", () => {
  const migrated = migrateSongSession({
    id: "unsupported-session",
    releaseId: "release-1",
    title: "Recovered track",
    tempo: 120,
    timeSignature: "4/4",
    tracks: [{
      id: "old-plugin",
      name: "Old plugin",
      type: "vst3",
      pluginState: { manufacturer: "Example", preset: 7 },
      clips: [],
      notes: [{ id: "kept-note", pitch: 68, startBeat: 2, durationBeats: 1, velocity: 90 }],
    }],
  });
  const track = migrated.tracks[0];
  assert.equal(track.type, "unsupported");
  assert.equal(track.notes[0].id, "kept-note");
  assert.deepEqual(track.instrumentRecovery?.rawState, {
    type: "vst3",
    pluginState: { manufacturer: "Example", preset: 7 },
  });
  assert.match(track.instrumentRecovery?.message ?? "", /MIDI notes and source media were kept/i);
});

test("invalid drum state recovers with defaults while preserving raw state and MIDI", () => {
  const migrated = migrateSongSession({
    id: "damaged-drum",
    releaseId: "release-1",
    title: "Recovered kit",
    tempo: 120,
    timeSignature: "4/4",
    tracks: [{
      id: "drums",
      name: "Broken kit",
      type: "drum",
      drumKit: { pads: [{ id: "dup", name: "One", note: 36, sampleAssetId: null, gain: 1 }, { id: "dup", name: "Two", note: 36, sampleAssetId: null, gain: 1 }] },
      notes: [{ id: "kept-hit", pitch: 36, startBeat: 0, durationBeats: 0.25, velocity: 100 }],
    }],
  });
  const track = migrated.tracks[0];
  assert.equal(track.drumKit?.pads.length, 8);
  assert.equal(track.notes[0].id, "kept-hit");
  assert.deepEqual(track.instrumentRecovery?.rawState, {
    pads: [
      { id: "dup", name: "One", note: 36, sampleAssetId: null, gain: 1 },
      { id: "dup", name: "Two", note: 36, sampleAssetId: null, gain: 1 },
    ],
  });
});

test("version-one project library upgrades to the current schema", () => {
  const migrated = migrateProjectLibrary({
    version: 1,
    releases: [],
    sessions: [],
  });

  assert.deepEqual(migrated, {
    version: 5,
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

for (const version of [4, 5]) {
  test(`version-${version} full libraries retain sampler notes and routing across reopening`, () => {
    const migrated = migrateProjectLibrary({
      version,
      releases: [{ id: "release-1", title: "Full feature project", releaseType: "Single", songIds: ["song-1"] }],
      sessions: [{
        id: "song-1", releaseId: "release-1", title: "Sampled track", tempo: 120, timeSignature: "4/4",
        buses: [{ id: "bus-1", name: "Sample Bus", outputBusId: null }],
        tracks: [{
          id: "sampler-1", name: "Sample", type: "sampler", outputBusId: "bus-1",
          sampler: { sampleAssetId: "sample-id", rootNote: 60, gain: 0.8 },
          notes: [{ id: "note-1", pitch: 60, startBeat: 0, durationBeats: 1, velocity: 96 }],
        }],
      }],
      assets: [],
      effectPresets: [],
    });
    const reopened = migrateProjectLibrary(JSON.parse(JSON.stringify(migrated)));
    assert.equal(reopened.version, 5);
    assert.deepEqual(reopened.sessions[0].buses, migrated.sessions[0].buses);
    assert.deepEqual(reopened.sessions[0].tracks, migrated.sessions[0].tracks);
    assert.equal(reopened.sessions[0].tracks[0].sampler?.sampleAssetId, "sample-id");
    assert.equal(reopened.sessions[0].tracks[0].outputBusId, "bus-1");
    assert.equal(reopened.sessions[0].tracks[0].notes[0].id, "note-1");
  });
}
