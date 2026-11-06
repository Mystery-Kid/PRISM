import { useId, useState } from "react";
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
  const id = useId();
  const [position, setPosition] = useState({ top: 0, left: 0 });
  return <div className="track-color-picker" onClick={event => event.stopPropagation()}>
    <button type="button" popoverTarget={id} className="track-color-choice"
      title={`Choose color for ${name}`} aria-label={`Choose color for ${name}`} style={{ backgroundColor: color }}
      onClick={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        setPosition({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - 196)), top: Math.max(8, Math.min(bounds.bottom + 6, window.innerHeight - 194)) });
      }} />
    <div id={id} popover="auto" className="track-color-popover" role="group" aria-label={`Colors for ${name}`} style={position}>
      <span>Track color</span>
      <div className="track-color-swatches">
        {trackColorPalette.map(swatch => <button type="button" key={swatch.value}
          title={swatch.name} aria-label={`${swatch.name} track color`} aria-pressed={color.toLowerCase() === swatch.value}
          style={{ backgroundColor: swatch.value }} onClick={event => {
            onChange(swatch.value);
            event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
          }} />)}
      </div>
      <label>Custom color<input aria-label={`Custom color for ${name}`} type="color"
        value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#00c9b0"} onChange={event => onChange(event.target.value)} /></label>
    </div>
  </div>;
}
