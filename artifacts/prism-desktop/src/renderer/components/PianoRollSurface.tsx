import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { MidiNote } from "@shared/types";
import { isPitchInScale } from "@shared/scales";
import {
  getPianoNoteDragUpdate,
  pianoClientToBeat,
  pianoClientToPitch,
  PIANO_KEYBOARD_WIDTH,
  PIANO_ROW_HEIGHT,
  type PianoNoteDragState,
  type PianoScaleKey,
} from "./piano-roll";

type EditTool = "select" | "draw" | "erase" | "split";

type PianoRollSurfaceProps = {
  gridRef: RefObject<HTMLDivElement | null>;
  keyboardRef: RefObject<HTMLDivElement | null>;
  rulerRef: RefObject<HTMLDivElement | null>;
  trackId: string;
  notes: MidiNote[];
  selectedNoteId: string | null;
  allSelected: boolean;
  beatWidth: number;
  contentWidth: number;
  beatsPerBar: number;
  snap: boolean;
  tool: EditTool;
  scaleKey: PianoScaleKey | null;
  smartView: boolean;
  scaleSnap: boolean;
  canCreate: boolean;
  onCreate: (beat: number, pitch: number, chromaticOverride: boolean) => void;
  onUnavailableCreate: () => void;
  onSelectNote: (id: string) => void;
  onChangeNote: (id: string, update: Partial<MidiNote>) => void;
  onDeleteNote: (id: string) => void;
  onSplitNote: (id: string) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
};

export function PianoRollSurface({
  gridRef, keyboardRef, rulerRef, trackId, notes, selectedNoteId, allSelected,
  beatWidth, contentWidth, beatsPerBar, snap, tool, scaleKey, smartView, scaleSnap,
  canCreate, onCreate, onUnavailableCreate, onSelectNote, onChangeNote, onDeleteNote,
  onSplitNote, onContextMenu,
}: PianoRollSurfaceProps) {
  const barWidth = beatWidth * beatsPerBar;
  return <div className={`piano-roll-layout ${smartView && scaleKey ? "smart-view-on" : ""}`} data-testid="piano-roll-layout" data-track-id={trackId}>
    <div className="piano-keyboard-column" style={{ width: `${PIANO_KEYBOARD_WIDTH}px` }} data-testid="piano-keyboard" data-track-id={trackId}>
      <div className="piano-keyboard-corner">KEY</div>
      <div className="piano-keyboard-scroll" ref={keyboardRef} onScroll={(event) => {
        const top = event.currentTarget.scrollTop;
        if (gridRef.current && gridRef.current.scrollTop !== top) gridRef.current.scrollTop = top;
      }}>
        {Array.from({ length: 128 }, (_, index) => {
          const pitch = 127 - index;
          const inScale = scaleKey ? isPitchInScale(pitch, scaleKey) : false;
          return <div key={pitch} data-testid={`piano-key-row-${pitch}`} data-pitch={pitch} data-track-id={trackId}
            className={`piano-row piano-key-row ${isBlackKey(pitch) ? "black-key-row" : ""} ${smartView && scaleKey ? inScale ? "scale-inside" : "scale-outside" : ""}`}
            style={{ height: `${PIANO_ROW_HEIGHT}px` }}>
            <span className="piano-key">{pitchName(pitch)}</span>
          </div>;
        })}
      </div>
    </div>
    <div className="piano-edit-column">
      <div className="piano-ruler-viewport" ref={rulerRef} data-testid="piano-ruler" data-track-id={trackId}>
        <div className="piano-time-ruler" style={{ width: `${contentWidth}px`, "--piano-beat-width": `${beatWidth}px` } as CSSProperties}>
          {Array.from({ length: Math.ceil(contentWidth / Math.max(1, barWidth)) }, (_, index) =>
            <span key={index} style={{ left: `${index * barWidth}px` }}>{String(index + 1).padStart(2, "0")}</span>)}
        </div>
      </div>
      <div className="piano-grid" ref={gridRef} data-testid="piano-roll" data-track-id={trackId}
        onScroll={(event) => {
          const { scrollLeft, scrollTop } = event.currentTarget;
          if (keyboardRef.current && keyboardRef.current.scrollTop !== scrollTop) keyboardRef.current.scrollTop = scrollTop;
          if (rulerRef.current && rulerRef.current.scrollLeft !== scrollLeft) rulerRef.current.scrollLeft = scrollLeft;
        }}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest(".piano-note")) return;
          if (tool === "erase" || tool === "split") return;
          if (!canCreate) { onUnavailableCreate(); return; }
          const bounds = event.currentTarget.getBoundingClientRect();
          const beat = pianoClientToBeat(event.clientX, bounds.left, event.currentTarget.scrollLeft, beatWidth);
          const pitch = pianoClientToPitch(event.clientY, bounds.top, event.currentTarget.scrollTop, PIANO_ROW_HEIGHT);
          onCreate(beat, pitch, event.altKey);
        }}>
        <div className="piano-time-content" style={{ width: `${contentWidth}px`, "--piano-beat-width": `${beatWidth}px` } as CSSProperties}>
          {Array.from({ length: 128 }, (_, index) => {
            const pitch = 127 - index;
            const inScale = scaleKey ? isPitchInScale(pitch, scaleKey) : false;
            return <div key={pitch} data-testid={`piano-grid-row-${pitch}`} data-pitch={pitch} data-track-id={trackId}
              className={`piano-row ${isBlackKey(pitch) ? "black-key-row" : ""} ${smartView && scaleKey ? inScale ? "scale-inside" : "scale-outside" : ""}`}
              style={{ height: `${PIANO_ROW_HEIGHT}px` }}>
              {smartView && scaleKey && <span className="scale-row-label">{inScale ? "IN" : "OUT"}</span>}
            </div>;
          })}
          {notes.map((note) => <PianoNote key={note.id} note={note} selected={note.id === selectedNoteId || allSelected}
            beatWidth={beatWidth} snap={snap} tool={tool} scaleKey={scaleKey} scaleSnap={scaleSnap}
            onSelect={() => onSelectNote(note.id)} onChange={(update) => onChangeNote(note.id, update)}
            onDelete={() => onDeleteNote(note.id)} onSplit={() => onSplitNote(note.id)}
            onContextMenu={(x, y) => onContextMenu(note.id, x, y)} />)}
        </div>
      </div>
    </div>
  </div>;
}

function PianoNote({ note, selected, beatWidth, snap, tool, scaleKey, scaleSnap, onSelect, onChange, onDelete, onSplit, onContextMenu }: {
  note: MidiNote;
  selected: boolean;
  beatWidth: number;
  snap: boolean;
  tool: EditTool;
  scaleKey: PianoScaleKey | null;
  scaleSnap: boolean;
  onSelect: () => void;
  onChange: (update: Partial<MidiNote>) => void;
  onDelete: () => void;
  onSplit: () => void;
  onContextMenu: (x: number, y: number) => void;
}) {
  const drag = useRef<PianoNoteDragState | null>(null);
  const [offset, setOffset] = useState<{ startBeat: number; durationBeats: number; pitch: number } | null>(null);
  const start = offset?.startBeat ?? note.startBeat;
  const duration = offset?.durationBeats ?? note.durationBeats;
  const pitch = offset?.pitch ?? note.pitch;
  return <div className={`piano-note ${selected ? "selected" : ""} ${tool === "erase" ? "eraser-target" : ""}`}
    data-testid={`piano-note-${note.id}`}
    style={{ left: `${start * beatWidth}px`, width: `${Math.max(1, duration * beatWidth)}px`, top: `${(127 - pitch) * PIANO_ROW_HEIGHT}px` }}
    onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      if (tool === "erase") { event.stopPropagation(); onDelete(); return; }
      if (tool === "split") return;
      event.stopPropagation();
      event.preventDefault();
      onSelect();
      drag.current = {
        pointerStartX: event.clientX,
        pointerStartY: event.clientY,
        startBeat: note.startBeat,
        durationBeats: note.durationBeats,
        pitch: note.pitch,
        resize: (event.target as HTMLElement).classList.contains("note-resize"),
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onClick={(event) => { event.stopPropagation(); if (tool === "split") onSplit(); }}
    onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onContextMenu(event.clientX, event.clientY); }}
    onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
      if (!drag.current) return;
      setOffset(getPianoNoteDragUpdate(drag.current, event.clientX, event.clientY, beatWidth, snap, scaleKey, scaleSnap, event.altKey));
    }}
    onPointerUp={() => {
      if (offset) onChange({ startBeat: offset.startBeat, durationBeats: offset.durationBeats, pitch: offset.pitch });
      setOffset(null);
      drag.current = null;
    }}
    onPointerCancel={() => { setOffset(null); drag.current = null; }}>
    <span>{pitchName(pitch)}</span><i className="note-resize" />
  </div>;
}

function pitchName(pitch: number): string {
  return `${["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

function isBlackKey(pitch: number): boolean {
  return [1, 3, 6, 8, 10].includes(pitch % 12);
}
