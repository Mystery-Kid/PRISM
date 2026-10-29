import type { Track } from "./types";

/** Legacy ungrouped notes are valid; malformed new clip metadata is not. */
export function validateMidiArrangement(track: Pick<Track, "midiClips" | "notes">): void {
  if (track.midiClips === undefined) return;
  if (!Array.isArray(track.midiClips) || track.midiClips.length > 10_000) {
    throw new Error("The MIDI arrangement clip list is invalid.");
  }
  const ids = new Set<string>();
  for (const clip of track.midiClips) {
    if (!clip || typeof clip.id !== "string" || !clip.id.trim() ||
        typeof clip.name !== "string" || ids.has(clip.id) ||
        !Number.isFinite(clip.startBeat) || clip.startBeat < 0 ||
        !Number.isFinite(clip.durationBeats) || clip.durationBeats < 0.125) {
      throw new Error("A MIDI arrangement clip has invalid timing or identity.");
    }
    ids.add(clip.id);
  }
  if (track.notes.some((note) => note.midiClipId !== undefined && !ids.has(note.midiClipId))) {
    throw new Error("A MIDI note references a missing arrangement clip.");
  }
}
