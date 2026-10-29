import type { InstrumentState, LoopRange, MidiNote } from "@shared/types";
import { beatToSeconds } from "./time";

export type MidiPlaybackWindow = {
  startSeconds: number;
  endSeconds: number;
  offsetSeconds: number;
};

export function getMidiPlaybackWindow(
  note: MidiNote,
  tempo: number,
  timeSignature: string,
  timelineFrom: number,
  timelineTo: number,
  anchorTimeline: number,
  loopRange: LoopRange | null,
): MidiPlaybackWindow | null {
  if (timelineTo <= timelineFrom) return null;
  const noteStart = beatToSeconds(note.startBeat, tempo, timeSignature);
  const noteEnd = beatToSeconds(
    note.startBeat + note.durationBeats,
    tempo,
    timeSignature,
  );
  const startsInSegment = noteStart >= timelineFrom && noteStart < timelineTo;
  const startsAtAnchor = Math.abs(timelineFrom - anchorTimeline) < 0.000001;
  const startsAtLoop = Boolean(
    loopRange?.enabled &&
    Math.abs(timelineFrom - loopRange.startSeconds) < 0.000001,
  );
  const resumesAtStart = noteStart < timelineFrom &&
    noteEnd > timelineFrom &&
    (startsAtAnchor || startsAtLoop);

  if (!startsInSegment && !resumesAtStart) return null;

  const startSeconds = startsInSegment ? noteStart : timelineFrom;
  const endSeconds = Math.min(
    noteEnd,
    loopRange?.enabled ? loopRange.endSeconds : noteEnd,
  );
  if (endSeconds <= startSeconds) return null;

  return {
    startSeconds,
    endSeconds,
    offsetSeconds: startSeconds - noteStart,
  };
}

export type MidiEnvelopeEvent = {
  timeSeconds: number;
  value: number;
  curve: "set" | "linear";
};

export type MidiEnvelopePlan = {
  initialValue: number;
  events: MidiEnvelopeEvent[];
};

function clamp(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

export function createMidiEnvelopePlan(
  note: Pick<MidiNote, "velocity">,
  instrument: InstrumentState,
  noteDurationSeconds: number,
  offsetSeconds = 0,
): MidiEnvelopePlan {
  const duration = Number.isFinite(noteDurationSeconds)
    ? Math.max(0.005, noteDurationSeconds)
    : 0.005;
  const attack = Math.min(clamp(instrument.attack, 0.001, 4, 0.01), duration / 2);
  const release = Math.min(clamp(instrument.release, 0.005, 4, 0.18), duration / 2);
  const peak = clamp(note.velocity, 1, 127, 96) / 127;
  const sustain = peak * clamp(instrument.sustain, 0, 1, 0.65);
  const attackEnd = attack;
  const releaseStart = duration - release;
  const decayRoom = Math.max(0, releaseStart - attackEnd);
  const decay = Math.min(clamp(instrument.decay, 0, 4, 0.12), decayRoom);
  const decayEnd = attackEnd + decay;
  const offset = clamp(offsetSeconds, 0, duration, 0);

  const levelAt = (timeSeconds: number): number => {
    if (timeSeconds <= 0) return 0;
    if (timeSeconds < attackEnd) return peak * timeSeconds / attackEnd;
    if (timeSeconds < decayEnd && decayEnd > attackEnd) {
      const progress = (timeSeconds - attackEnd) / (decayEnd - attackEnd);
      return peak + (sustain - peak) * progress;
    }
    if (timeSeconds < releaseStart) return sustain;
    const releaseDuration = duration - releaseStart;
    if (releaseDuration <= 0) return 0;
    return sustain * Math.max(0, (duration - timeSeconds) / releaseDuration);
  };

  const events: MidiEnvelopeEvent[] = [
    { timeSeconds: attackEnd, value: peak, curve: "linear" },
    {
      timeSeconds: decayEnd,
      value: sustain,
      curve: decayEnd > attackEnd ? "linear" : "set",
    },
  ];
  if (releaseStart > decayEnd) {
    events.push({ timeSeconds: releaseStart, value: sustain, curve: "set" });
  }
  events.push({ timeSeconds: duration, value: 0, curve: "linear" });

  return {
    initialValue: levelAt(offset),
    events: events.filter((event) => event.timeSeconds > offset + 0.000000001),
  };
}

export function midiPitchToFrequency(pitch: number): number {
  const safePitch = clamp(pitch, 0, 127, 69);
  return 440 * Math.pow(2, (safePitch - 69) / 12);
}
