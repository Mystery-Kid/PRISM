import type { AudioClip, SongSession } from "@shared/types";
import { beatToSeconds } from "./time";

export function getSessionDuration(session: SongSession | null): number {
  if (!session) return 0;
  let duration = 0;
  for (const track of session.tracks) {
    for (const clip of track.clips) {
      duration = Math.max(duration, clip.startSeconds + clip.durationSeconds);
    }
    if (track.type === "instrument") {
      for (const note of track.notes) {
        duration = Math.max(
          duration,
          beatToSeconds(note.startBeat + note.durationBeats, session.tempo, session.timeSignature),
        );
      }
    }
  }
  if (session.loopRange?.enabled) duration = Math.max(duration, session.loopRange.endSeconds);
  return duration;
}

export function getClipWindow(
  clip: AudioClip,
  timelineFrom: number,
  timelineTo: number,
): {
  timelineStart: number;
  timelineEnd: number;
  sourceStart: number;
  duration: number;
} | null {
  const timelineStart = Math.max(timelineFrom, clip.startSeconds);
  const requestedEnd = Math.min(timelineTo, clip.startSeconds + clip.durationSeconds);
  const sourceStart = clip.sourceStartSeconds + timelineStart - clip.startSeconds;
  const duration = Math.min(requestedEnd - timelineStart, clip.sourceDurationSeconds - sourceStart);
  if (duration <= 0) return null;
  return {
    timelineStart,
    timelineEnd: timelineStart + duration,
    sourceStart,
    duration,
  };
}
