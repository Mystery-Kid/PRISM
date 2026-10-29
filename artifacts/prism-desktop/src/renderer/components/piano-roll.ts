import type { MidiClip, MidiNote } from "@shared/types";

/**
 * Plan a paste entirely in musical beats. Reuse a selected clip only when the
 * insertion starts inside it, extending its right edge as needed. A paste
 * outside that interval creates its own clip, never clamps or shortens notes.
 */
export function pasteMidiNotes(input: {
  notes: readonly MidiNote[];
  clips: readonly MidiClip[];
  selectedClipId: string | null;
  playheadBeat: number;
  sourceOriginBeat: number;
  createId: () => string;
}): { clips: MidiClip[]; notes: MidiNote[]; clipId: string } {
  if (!input.notes.length) throw new Error("Select MIDI notes before pasting.");
  const moved = input.notes.map((note) => ({
    ...note,
    startBeat: input.playheadBeat + note.startBeat - input.sourceOriginBeat,
  }));
  const startBeat = Math.min(...moved.map((note) => note.startBeat));
  const endBeat = Math.max(...moved.map((note) => note.startBeat + note.durationBeats));
  const selected = input.clips.find((clip) => clip.id === input.selectedClipId);
  const reuse = selected && startBeat >= selected.startBeat &&
    startBeat <= selected.startBeat + selected.durationBeats;
  const clip: MidiClip = reuse
    ? { ...selected, durationBeats: Math.max(selected.durationBeats, endBeat - selected.startBeat) }
    : { id: input.createId(), name: "MIDI Clip", startBeat, durationBeats: Math.max(4, endBeat - startBeat) };
  return {
    clips: reuse
      ? input.clips.map((item) => item.id === clip.id ? clip : item)
      : [...input.clips, clip],
    notes: moved.map((note) => ({ ...note, id: input.createId(), midiClipId: clip.id })),
    clipId: clip.id,
  };
}

export type PianoNoteDragState = {
  pointerStartX: number;
  pointerStartY: number;
  startBeat: number;
  durationBeats: number;
  pitch: number;
  resize: boolean;
};

export type PianoNoteDragUpdate = {
  startBeat: number;
  durationBeats: number;
  pitch: number;
};

export function splitMidiNoteAt(
  note: MidiNote,
  cutBeat: number,
  rightNoteId: string,
): { left: MidiNote; right: MidiNote } | null {
  const relativeCut = cutBeat - note.startBeat;
  if (relativeCut < 0.25 || note.durationBeats - relativeCut < 0.25) return null;
  return {
    left: { ...note, durationBeats: relativeCut },
    right: {
      ...note,
      id: rightNoteId,
      startBeat: cutBeat,
      durationBeats: note.durationBeats - relativeCut,
    },
  };
}

export function getPianoNoteDragUpdate(
  drag: PianoNoteDragState,
  pointerX: number,
  pointerY: number,
  beatWidth: number,
  snap: boolean,
): PianoNoteDragUpdate {
  const deltaBeats = (pointerX - drag.pointerStartX) / Math.max(1, beatWidth);
  const quantize = (beat: number) => snap ? Math.round(beat * 4) / 4 : beat;

  if (drag.resize) {
    return {
      startBeat: drag.startBeat,
      durationBeats: Math.max(0.25, quantize(drag.durationBeats + deltaBeats)),
      pitch: drag.pitch,
    };
  }

  return {
    startBeat: Math.max(0, quantize(drag.startBeat + deltaBeats)),
    durationBeats: drag.durationBeats,
    pitch: Math.max(
      0,
      Math.min(127, drag.pitch - Math.round((pointerY - drag.pointerStartY) / 15)),
    ),
  };
}
