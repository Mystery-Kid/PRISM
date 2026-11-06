import type { SongSession } from "../shared/types";

/** Ignore presentation and save time, but preserve every musical value and array order. */
export function musicalSnapshot(session: SongSession): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]));
    }
    return value;
  };
  const { updatedAt, tracks, ...music } = session;
  return JSON.stringify(canonical({ ...music, tracks: tracks.map(({ color, ...track }) => track) }));
}
