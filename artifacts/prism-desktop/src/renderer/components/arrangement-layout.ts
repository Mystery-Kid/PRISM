export type ArrangementLayout = {
  headerWidth: number;
  rulerHeight: number;
  rowHeights: Readonly<Record<string, number>>;
  originX: number;
  pixelsPerSecond: number;
};

export const DEFAULT_TRACK_HEADER_WIDTH = 240;
export const MIN_TRACK_HEADER_WIDTH = 176;
export const MAX_TRACK_HEADER_WIDTH = 420;
export const ARRANGEMENT_RULER_HEIGHT = 35;
export const DEFAULT_TRACK_HEIGHT = 112;
export const MIN_TRACK_HEIGHT = 82;
export const MAX_TRACK_HEIGHT = 220;

export function clampLayoutSize(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

/** Converts a pointer in an element-local timeline region to its time coordinate. */
export function timelineXToSeconds(localX: number, pixelsPerSecond: number): number {
  return Math.max(0, localX / Math.max(Number.EPSILON, pixelsPerSecond));
}

export function secondsToTimelineX(seconds: number, pixelsPerSecond: number): number {
  return Math.max(0, seconds) * pixelsPerSecond;
}

/** The local origin is measured from the clipped timeline region, never the window. */
export function clientXToTimelineSeconds(
  clientX: number,
  regionLeft: number,
  pixelsPerSecond: number,
): number {
  return timelineXToSeconds(clientX - regionLeft, pixelsPerSecond);
}

/** Maps the live lane's actual vertical extent to the 128 MIDI rows. */
export function clientYToArrangementPitch(clientY: number, laneTop: number, laneHeight: number): number {
  const height = Math.max(1, laneHeight);
  const localY = Math.max(0, Math.min(height - Number.EPSILON, clientY - laneTop));
  return Math.max(0, Math.min(127, 127 - Math.floor(localY / height * 128)));
}
