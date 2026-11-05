import "./TrackColorPicker.css";

// Individual accents derived from the official segmented color-wheel artwork.
export const trackColorPalette = [
  { name: "Red", value: "#ff283c" }, { name: "Orange", value: "#ff8500" },
  { name: "Gold", value: "#f5cc16" }, { name: "Lime", value: "#b7e600" },
  { name: "Green", value: "#69c900" }, { name: "Teal", value: "#00c9b0" },
  { name: "Blue", value: "#009ee0" }, { name: "Indigo", value: "#5545e5" },
  { name: "Violet", value: "#ad21dd" }, { name: "Pink", value: "#ec168d" },
];

export function TrackColorPicker({ color, name, onChange }: {
  color: string; name: string; onChange: (color: string) => void;
}) {
  return <details className="track-color-picker" onClick={event => event.stopPropagation()}>
    <summary className="track-color-choice" title={`Choose color for ${name}`} aria-label={`Choose color for ${name}`} style={{ backgroundColor: color }} />
    <div className="track-color-popover" role="group" aria-label={`Colors for ${name}`}>
      <span>Track color</span>
      <div className="track-color-swatches">
        {trackColorPalette.map(swatch => <button type="button" key={swatch.value}
          title={swatch.name} aria-label={`${swatch.name} track color`} aria-pressed={color.toLowerCase() === swatch.value}
          style={{ backgroundColor: swatch.value }} onClick={event => {
            onChange(swatch.value);
            event.currentTarget.closest("details")?.removeAttribute("open");
          }} />)}
      </div>
      <label>Custom color<input aria-label={`Custom color for ${name}`} type="color"
        value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#00c9b0"} onChange={event => onChange(event.target.value)} /></label>
    </div>
  </details>;
}
