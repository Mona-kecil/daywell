"use client";
import { useState, type ReactNode } from "react";

export type LinePoint = { key: string; t: number; v: number };

const W = 320;
const H = 150;
const PAD = { top: 16, right: 14, bottom: 24, left: 36 };

function niceTicks(lo: number, hi: number) {
  const span = Math.max(1, hi - lo);
  const raw = span / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const start = Math.floor(lo / step) * step;
  const ticks = [];
  for (let t = start; t <= hi + step * 0.001; t += step) ticks.push(t);
  if (ticks[ticks.length - 1] < hi) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

const shortDate = (t: number) =>
  new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });

// One series over time with a scrubbable, keyboard-steppable readout.
export function LineChart({
  className,
  title,
  points,
  format,
  describe,
  summary,
  label,
  highlight,
}: {
  className: string;
  title: ReactNode;
  points: LinePoint[];
  format: (v: number) => string;
  describe: (p: LinePoint) => string;
  summary: string;
  label: string;
  highlight?: string | null;
}) {
  const [active, setActive] = useState<number | null>(null);
  const values = points.map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const ticks = niceTicks(min - Math.max(1, (max - min) * 0.1), max);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const x = (t: number) =>
    PAD.left + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  const path = points
    .map((p, i) => `${i ? "L" : "M"}${x(p.t)},${y(p.v)}`)
    .join("");
  const shown = active === null ? null : points[active];
  return (
    <figure className={`line-chart ${className}`}>
      <figcaption className="chart-head">
        {title}
        <span className="chart-readout" aria-live="polite">
          {shown ? describe(shown) : summary}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        tabIndex={0}
        aria-label={`${label} Use arrow keys to step through points.`}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          const step =
            e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
          if (!step) return;
          e.preventDefault();
          setActive((i) =>
            Math.min(
              points.length - 1,
              Math.max(
                0,
                i === null ? (step > 0 ? 0 : points.length - 1) : i + step,
              ),
            ),
          );
        }}
      >
        {ticks.map((t) => (
          <g key={t} className="chart-gridline">
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        <text
          className="chart-axis-label"
          x={PAD.left}
          y={H - 6}
          textAnchor="start"
        >
          {shortDate(t0)}
        </text>
        <text
          className="chart-axis-label"
          x={W - PAD.right}
          y={H - 6}
          textAnchor="end"
        >
          {shortDate(t1)}
        </text>
        <path d={path} className="line-path" />
        {shown && (
          <line
            className="chart-crosshair"
            x1={x(shown.t)}
            x2={x(shown.t)}
            y1={PAD.top}
            y2={H - PAD.bottom}
          />
        )}
        {points.map((p, i) =>
          // Dense series drop resting markers; the line carries the shape.
          points.length > 14 && active !== i && p.key !== highlight ? null : (
            <circle
              key={p.key}
              className={`line-dot ${p.key === highlight ? "highlight" : ""} ${active === i ? "active" : ""}`}
              cx={x(p.t)}
              cy={y(p.v)}
              r={p.key === highlight ? 5.5 : 4}
            />
          ),
        )}
        {/* Hit targets: one column per point, wider than the mark. */}
        {points.map((p, i) => {
          const prev = i ? x(points[i - 1].t) : PAD.left;
          const next =
            i < points.length - 1 ? x(points[i + 1].t) : W - PAD.right;
          const left = (prev + x(p.t)) / 2;
          return (
            <rect
              key={p.key}
              x={i ? left : PAD.left - 8}
              y={PAD.top}
              width={(x(p.t) + next) / 2 - (i ? left : PAD.left - 8)}
              height={H - PAD.top - PAD.bottom}
              fill="transparent"
              onPointerEnter={() => setActive(i)}
              onPointerDown={() => setActive(i)}
            />
          );
        })}
      </svg>
    </figure>
  );
}
