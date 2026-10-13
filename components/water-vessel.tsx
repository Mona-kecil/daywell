"use client";
import { useId } from "react";

const W = 96,
  H = 150,
  WAVE = W,
  AMP = 3.5;
const GLASS = `M6 4 H${W - 6} L${W - 15} ${H - 10} Q${W - 16} ${H - 2} ${W - 24} ${H - 2} H24 Q16 ${H - 2} 15 ${H - 10} Z`;

// Two wavelengths wide so sliding one wavelength left loops seamlessly.
function wave(phase: number) {
  const q = WAVE / 4;
  let d = `M${-phase} 0`;
  for (let x = -phase; x < 2 * WAVE; x += 2 * q)
    d += ` q${q / 2} ${-AMP} ${q} 0 t${q} 0`;
  return `${d} V${H + 10} H${-phase} Z`;
}

export function WaterVessel({
  value,
  label,
}: {
  value: number;
  label: string;
}) {
  const id = useId();
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  // Keep a sliver visible at 0% and the wave crest below the rim at 100%.
  const level = 8 + (H - 16) * (1 - pct / 100);
  return (
    <svg
      className="vessel"
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <defs>
        <clipPath id={`${id}-glass`}>
          <path d={GLASS} />
        </clipPath>
      </defs>
      <path d={GLASS} className="vessel-back" />
      <g clipPath={`url(#${id}-glass)`}>
        <g
          className="vessel-level"
          style={{ transform: `translateY(${level}px)` }}
        >
          <path d={wave(WAVE / 2)} className="vessel-wave back" />
          <path d={wave(0)} className="vessel-wave front" />
        </g>
      </g>
      <path d={GLASS} className="vessel-rim" />
    </svg>
  );
}
