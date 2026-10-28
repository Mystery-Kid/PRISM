import assert from "node:assert/strict";
import test from "node:test";
import type { AudioClip, SongSession, Track } from "@shared/types";
import { getClipWindow, getSessionDuration } from "./timeline";

const clip: AudioClip = {
  id: "clip",
  assetId: "asset",
  name: "Take",
  durationSeconds: 6,
  sourceDurationSeconds: 20,
  startSeconds: 10,
  sourceStartSeconds: 4,
  gain: 1,
  fadeInSeconds: 0,
  fadeOutSeconds: 0,
  waveform: [],
};

test("playback window maps trimmed clip time to the correct source range", () => {
  assert.deepEqual(getClipWindow(clip, 12, 15), {
    timelineStart: 12,
    timelineEnd: 15,
    sourceStart: 6,
    duration: 3,
  });
});

test("clip source range cannot extend past the imported audio", () => {
  const shortSource = { ...clip, sourceDurationSeconds: 5 };
  assert.deepEqual(getClipWindow(shortSource, 10, 20), {
    timelineStart: 10,
    timelineEnd: 11,
    sourceStart: 4,
    duration: 1,
  });
  assert.equal(getClipWindow(shortSource, 11, 15), null);
});

test("sampler and drum MIDI patterns contribute to arrangement length", () => {
  const makeMidiTrack = (id: string, type: "sampler" | "drum", startBeat: number): Track => ({
    id,
    name: id,
    type,
    color: "#b47c52",
    volume: 1,
    pan: 0,
    muted: false,
    solo: false,
    recordArmed: false,
    clips: [],
    notes: [{ id: `${id}-note`, pitch: type === "drum" ? 36 : 60, startBeat, durationBeats: 0.5, velocity: 100 }],
    instrument: null,
    sampler: type === "sampler" ? { sampleAssetId: "sample-a", rootNote: 60, gain: 1 } : null,
    drumKit: type === "drum" ? {
      pads: [{ id: `${id}-pad`, name: "Kick", note: 36, sampleAssetId: "sample-b", gain: 1 }],
    } : null,
    instrumentRecovery: null,
    effects: [],
    outputBusId: null,
    sends: [],
  });
  const session: SongSession = {
    id: "session",
    releaseId: "release",
    title: "Sampled arrangement",
    tempo: 120,
    timeSignature: "4/4",
    loopRange: null,
    metronomeEnabled: false,
    masterVolume: 1,
    masterEffects: [],
    buses: [],
    tracks: [makeMidiTrack("sampler", "sampler", 2), makeMidiTrack("drums", "drum", 4)],
    updatedAt: new Date(0).toISOString(),
  };

  assert.equal(getSessionDuration(session), 2.25);
});
