"use client";
import { useEffect, useState } from "react";

export type Ring = {
  id: "water" | "protein" | "kcal";
  label: string;
  value: number;
  target: number;
  unit: string;
};

const SIZE = 136,
  STROKE = 12,
  GAP = 4;

export function DayRings({ rings }: { rings: Ring[] }) {
  // Draw from empty on first paint so the rings sweep in.
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div className="day-rings">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        aria-hidden
      >
        {rings.map((ring, i) => {
          const r = SIZE / 2 - STROKE / 2 - i * (STROKE + GAP);
          const c = 2 * Math.PI * r;
          const fraction = drawn
            ? Math.min(1, ring.target > 0 ? ring.value / ring.target : 0)
            : 0;
          return (
            <g key={ring.id} transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
              <circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={r}
                className={`ring-track ${ring.id}`}
                strokeWidth={STROKE}
              />
              <circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={r}
                className={`ring-arc ${ring.id}`}
                strokeWidth={STROKE}
                strokeDasharray={c}
                strokeDashoffset={c * (1 - fraction)}
                style={{ transitionDelay: `${i * 90}ms` }}
                opacity={fraction > 0 ? 1 : 0}
              />
            </g>
          );
        })}
      </svg>
      <ul className="ring-legend">
        {rings.map((ring) => (
          <li key={ring.id}>
            <i className={`swatch ${ring.id}`} />
            <span className="muted small">{ring.label}</span>
            <strong>
              {Math.round(ring.value).toLocaleString()}
              <small>
                {" "}
                / {ring.target.toLocaleString()} {ring.unit}
              </small>
            </strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
