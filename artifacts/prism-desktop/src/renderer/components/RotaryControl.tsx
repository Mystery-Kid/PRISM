import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent, CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";

type RotaryControlProps = {
  testId: string;
  effectLabel: string;
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  defaultValue: number;
  onChange: (value: number) => void;
};

type DragState = { pointerId: number; startY: number; startValue: number };

export function RotaryControl({
  testId,
  effectLabel,
  label,
  unit,
  min,
  max,
  step,
  value,
  defaultValue,
  onChange,
}: RotaryControlProps) {
  const dragState = useRef<DragState | null>(null);
  const range = max - min || 1;
  const ratio = Math.max(0, Math.min(1, (value - min) / range));
  const style = { "--rotary-angle": `${-135 + ratio * 270}deg` } as CSSProperties;
  const setValue = (next: number) => onChange(Number(Math.max(min, Math.min(max, next)).toFixed(5)));
  const stepValue = (direction: -1 | 1, multiplier = 1, fine = false) =>
    setValue(value + direction * step * multiplier * (fine ? 0.1 : 1));

  const handlePointerDown = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragState.current = { pointerId: event.pointerId, startY: event.clientY, startValue: value };
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLInputElement>) => {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const fine = event.shiftKey;
    const movement = (drag.startY - event.clientY) / 180 * range * (fine ? 0.1 : 1);
    setValue(drag.startValue + movement);
  };
  const handlePointerUp = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (dragState.current?.pointerId !== event.pointerId) return;
    dragState.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    const fine = event.shiftKey;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      stepValue(-1, 1, fine);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      stepValue(1, 1, fine);
    } else if (event.key === "PageDown") {
      event.preventDefault();
      stepValue(-1, 10, fine);
    } else if (event.key === "PageUp") {
      event.preventDefault();
      stepValue(1, 10, fine);
    } else if (event.key === "Home") {
      event.preventDefault();
      setValue(min);
    } else if (event.key === "End") {
      event.preventDefault();
      setValue(max);
    }
  };

  return <label className="rotary-control">
    <span className="rotary-label">{label}</span>
    <span className="rotary-dial" style={style}>
      <i className="rotary-needle" />
      <input
        data-testid={testId}
        className="rotary-slider"
        type="range"
        role="slider"
        min={min}
        max={max}
        step="any"
        value={value}
        aria-label={`${effectLabel} ${label}`}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={formatRotaryValue(value, unit)}
        title={`${formatRotaryValue(value, unit)} · drag vertically · Shift for fine control`}
        onChange={(event) => setValue(Number(event.currentTarget.value))}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={() => setValue(defaultValue)}
        onKeyDown={handleKeyDown}
      />
    </span>
    <output className="rotary-value" aria-live="off">{formatRotaryValue(value, unit)}</output>
  </label>;
}

function formatRotaryValue(value: number, unit?: string): string {
  return `${Number(value.toFixed(5))}${unit ? ` ${unit}` : ""}`;
}
