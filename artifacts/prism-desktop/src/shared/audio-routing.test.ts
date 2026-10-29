import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveRoutingAudibility,
  getAllowedBusTargets,
  validateAudioRouting,
} from "./audio-routing";
import type { AudioBus, Track } from "./types";

function track(id: string, changes: Partial<Track> = {}): Track {
  return {
    id,
    name: id,
    type: "audio",
    color: "#777777",
    volume: 1,
    pan: 0,
    muted: false,
    solo: false,
    recordArmed: false,
    clips: [],
    notes: [],
    instrument: null,
    effects: [],
    outputBusId: null,
    sends: [],
    ...changes,
  };
}

function bus(id: string, changes: Partial<AudioBus> = {}): AudioBus {
  return {
    id,
    name: id,
    level: 1,
    muted: false,
    solo: false,
    outputBusId: null,
    sends: [],
    effects: [],
    ...changes,
  };
}

test("validates direct track routing, bus routing, and adjustable sends", () => {
  validateAudioRouting(
    [track("drums", {
      outputBusId: "bus-a",
      sends: [{ id: "send-1", busId: "bus-b", level: 0.35, placement: "pre" }],
    })],
    [bus("bus-a", { outputBusId: "bus-b" }), bus("bus-b")],
  );
});

test("rejects cycles from bus outputs and bus sends", () => {
  assert.throws(
    () => validateAudioRouting([], [
      bus("bus-a", { outputBusId: "bus-b" }),
      bus("bus-b", { outputBusId: "bus-a" }),
    ]),
    /cycle/i,
  );
  assert.throws(
    () => validateAudioRouting([], [
      bus("bus-a", { sends: [{ id: "send-a", busId: "bus-b", level: 0.5, placement: "post" }] }),
      bus("bus-b", { sends: [{ id: "send-b", busId: "bus-a", level: 0.5, placement: "pre" }] }),
    ]),
    /cycle/i,
  );
});

test("rejects unknown destinations and out-of-range send gains", () => {
  assert.throws(
    () => validateAudioRouting([track("voice", { outputBusId: "missing" })], []),
    /does not exist/i,
  );
  assert.throws(
    () => validateAudioRouting([track("voice", {
      sends: [{ id: "send", busId: "bus-a", level: 1.6, placement: "post" }],
    })], [bus("bus-a")]),
    /invalid destination, level, or mode/i,
  );
});

test("only offers bus destinations that cannot create a cycle", () => {
  const buses = [
    bus("bus-a"),
    bus("bus-b", { outputBusId: "bus-a" }),
    bus("bus-c"),
  ];
  assert.deepEqual(getAllowedBusTargets([], buses, "bus-a"), ["bus-c"]);
});

test("track and bus solos follow the audible routing paths", () => {
  const source = track("source", { outputBusId: "submix", solo: true });
  const unrelated = track("unrelated");
  const submix = bus("submix");
  const trackSolo = deriveRoutingAudibility([source, unrelated], [submix]);
  assert.equal(trackSolo.tracks.get("source"), true);
  assert.equal(trackSolo.tracks.get("unrelated"), false);
  assert.equal(trackSolo.buses.get("submix"), true);

  const busSolo = deriveRoutingAudibility(
    [{ ...source, solo: false }, unrelated],
    [{ ...submix, solo: true }],
  );
  assert.equal(busSolo.tracks.get("source"), true);
  assert.equal(busSolo.tracks.get("unrelated"), false);
  assert.equal(busSolo.buses.get("submix"), true);

  const mutedSolo = deriveRoutingAudibility(
    [{ ...source, solo: false }],
    [{ ...submix, solo: true, muted: true }],
  );
  assert.equal(mutedSolo.tracks.get("source"), false);
  assert.equal(mutedSolo.buses.get("submix"), false);
});

test("mute gates a path and no-solo sessions preserve every unmuted source", () => {
  const result = deriveRoutingAudibility(
    [track("one"), track("two", { muted: true })],
    [bus("bus-a", { muted: true })],
  );
  assert.equal(result.tracks.get("one"), true);
  assert.equal(result.tracks.get("two"), false);
  assert.equal(result.buses.get("bus-a"), false);
});
