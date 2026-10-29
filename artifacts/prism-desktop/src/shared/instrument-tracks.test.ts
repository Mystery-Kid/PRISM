import assert from "node:assert/strict";
import test from "node:test";
import {
  countUnassignedInstrumentNotes,
  createDefaultDrumKit,
  getAssignedSampleIds,
  getSampleTrigger,
  isDrumKitState,
  isSamplerState,
} from "./instrument-tracks";
import type { SongSession, Track } from "./types";

function createTrack(type: Track["type"], overrides: Partial<Track> = {}): Track {
  return {
    id: "track-1",
    name: "Test track",
    type,
    color: "#9a7b56",
    volume: 1,
    pan: 0,
    muted: false,
    solo: false,
    recordArmed: false,
    clips: [],
    notes: [{ id: "note-1", pitch: 60, startBeat: 0, durationBeats: 1, velocity: 96 }],
    instrument: null,
    sampler: null,
    drumKit: null,
    instrumentRecovery: null,
    effects: [],
    outputBusId: null,
    sends: [],
    ...overrides,
  };
}

function createSession(tracks: Track[]): SongSession {
  return {
    id: "session-1",
    releaseId: "release-1",
    title: "Sample test",
    tempo: 120,
    timeSignature: "4/4",
    loopRange: null,
    metronomeEnabled: false,
    masterVolume: 1,
    masterEffects: [],
    buses: [],
    tracks,
    updatedAt: new Date(0).toISOString(),
  };
}

test("default drum kit creates unique MIDI pads that pass state validation", () => {
  const kit = createDefaultDrumKit();
  assert.equal(kit.pads.length, 8);
  assert.equal(new Set(kit.pads.map((pad) => pad.note)).size, kit.pads.length);
  assert.equal(new Set(kit.pads.map((pad) => pad.id)).size, kit.pads.length);
  assert.equal(isDrumKitState(kit), true);
});

test("sampler notes resolve a root-pitched sample and velocity-scaled gain", () => {
  const track = createTrack("sampler", {
    sampler: { sampleAssetId: "sample-a", rootNote: 60, gain: 1.25 },
  });
  assert.equal(isSamplerState(track.sampler), true);
  assert.deepEqual(getSampleTrigger(track, 72, 64), {
    assetId: "sample-a",
    playbackRate: 2,
    gain: (64 / 127) * 1.25,
  });
});

test("drum pads use their assigned sample and unassigned notes remain identifiable", () => {
  const track = createTrack("drum", {
    drumKit: {
      pads: [
        { id: "kick", name: "Kick", note: 36, sampleAssetId: "kick-sample", gain: 0.8 },
        { id: "snare", name: "Snare", note: 38, sampleAssetId: null, gain: 1 },
      ],
    },
    notes: [
      { id: "kick-hit", pitch: 36, startBeat: 0, durationBeats: 0.25, velocity: 100 },
      { id: "snare-hit", pitch: 38, startBeat: 1, durationBeats: 0.25, velocity: 100 },
    ],
  });
  assert.deepEqual(getSampleTrigger(track, 36, 100), {
    assetId: "kick-sample",
    playbackRate: 1,
    gain: (100 / 127) * 0.8,
  });
  assert.equal(getSampleTrigger(track, 38, 100), null);
  assert.equal(countUnassignedInstrumentNotes([track]), 1);
  assert.deepEqual([...getAssignedSampleIds(createSession([track]))], ["kick-sample"]);
});

test("a missing file reference remains a valid assignment for recovery", () => {
  const track = createTrack("sampler", {
    sampler: { sampleAssetId: "file-no-longer-present", rootNote: 60, gain: 1 },
  });
  assert.equal(isSamplerState(track.sampler), true);
  assert.equal(getSampleTrigger(track, 60, 96)?.assetId, "file-no-longer-present");
});
