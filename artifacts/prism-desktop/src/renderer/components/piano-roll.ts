import type { MidiNote } from "@shared/types";

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
