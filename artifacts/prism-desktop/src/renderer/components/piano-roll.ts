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
