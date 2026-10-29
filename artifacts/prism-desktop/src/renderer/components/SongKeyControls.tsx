import type { SongKey } from "@shared/types";

export const SONG_KEY_ROOT_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

export function SongKeyControls({ value, onChange, prefix = "select-song-key", trackId }: {
  value: SongKey | null;
  onChange: (value: SongKey | null) => void;
  prefix?: string;
  trackId?: string;
}) {
  return <>
    <label className="song-key-control">Song Key
      <select data-testid={`${prefix}-root`} data-track-id={trackId} aria-label="Song key root"
        value={value?.root ?? ""} onChange={(event) => onChange(event.target.value === "" ? null :
          { root: Number(event.target.value), scale: value?.scale ?? "major" })}>
        <option value="">Unset</option>
        {SONG_KEY_ROOT_NAMES.map((name, root) => <option key={name} value={root}>{name}</option>)}
      </select>
    </label>
    <label className="song-key-control">Scale
      <select data-testid={`${prefix}-scale`} data-track-id={trackId} aria-label="Song key scale"
        disabled={!value} value={value?.scale ?? "major"} onChange={(event) => {
          if (value) onChange({ ...value, scale: event.target.value as SongKey["scale"] });
        }}>
        <option value="major">Major</option><option value="naturalMinor">Natural minor</option>
      </select>
    </label>
  </>;
}
