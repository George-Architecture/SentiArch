// ============================================================
// SliderField Component - Draggable slider for parameter adjustment
// Design: Academic Instrument Dashboard (Neumorphism)
// ============================================================

import { useState, useRef, useCallback, useEffect } from "react";

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (val: number) => void;
  color?: string;
}

export default function SliderField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
  color = "#1D6B5E",
}: SliderFieldProps) {
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  const clamp = useCallback(
    (v: number) => {
      const clamped = Math.min(max, Math.max(min, v));
      const decimals = String(step).includes(".") ? String(step).split(".")[1].length : 0;
      return parseFloat(clamped.toFixed(decimals));
    },
    [min, max, step]
  );

  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;

  const updateFromPosition = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const raw = min + ratio * (max - min);
      const snapped = clamp(Math.round(raw / step) * step);
      onChange(snapped);
    },
    [min, max, step, clamp, onChange]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(true);
      updateFromPosition(e.clientX);
    },
    [updateFromPosition]
  );

  useEffect(() => {
    if (!dragging) return;
    const handleMouseMove = (e: MouseEvent) => updateFromPosition(e.clientX);
    const handleMouseUp = () => setDragging(false);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, updateFromPosition]);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      setDragging(true);
      updateFromPosition(e.touches[0].clientX);
    },
    [updateFromPosition]
  );

  useEffect(() => {
    if (!dragging) return;
    const handleTouchMove = (e: TouchEvent) => updateFromPosition(e.touches[0].clientX);
    const handleTouchEnd = () => setDragging(false);
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd);
    return () => {
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [dragging, updateFromPosition]);

  const commitEdit = () => {
    setEditing(false);
    const parsed = parseFloat(draft);
    if (!isNaN(parsed)) onChange(clamp(parsed));
  };

  return (
    <div className="py-1.5">
      {/* Label + Value row */}
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>
          {label}
        </span>
        {editing ? (
          <input
            type="number"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") { setEditing(false); setDraft(String(value)); }
            }}
            step={step}
            min={min}
            max={max}
            className="sa-input text-right"
            style={{ width: 80, fontSize: "12px", padding: "3px 6px" }}
            autoFocus
          />
        ) : (
          <span
            className="text-sm cursor-pointer px-2 py-0.5 rounded-md transition-colors"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 600,
              color: "var(--foreground)",
            }}
            onClick={() => { setDraft(String(value)); setEditing(true); }}
            title="Click to edit"
          >
            {value}
            {suffix && <span style={{ color: "var(--muted-foreground)", fontWeight: 400, marginLeft: 2 }}>{suffix}</span>}
          </span>
        )}
      </div>

      {/* Slider track */}
      <div
        ref={trackRef}
        className="sa-slider-track"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        {/* Fill bar */}
        <div
          className="sa-slider-fill"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color}90, ${color})`,
            transition: dragging ? "none" : "width 0.15s ease",
          }}
        />

        {/* Thumb */}
        <div
          className="sa-slider-thumb"
          style={{
            left: `${pct}%`,
            borderColor: color,
          }}
        />
      </div>

      {/* Min/Max labels */}
      <div className="flex justify-between mt-1">
        <span style={{ fontSize: "9px", color: "var(--muted-foreground)", fontFamily: "'JetBrains Mono', monospace" }}>
          {min}
        </span>
        <span style={{ fontSize: "9px", color: "var(--muted-foreground)", fontFamily: "'JetBrains Mono', monospace" }}>
          {max}
        </span>
      </div>
    </div>
  );
}
