"use client";
import { useQuery } from "convex/react";
import { Grid3x3 } from "lucide-react";
import { useState, type PointerEvent } from "react";
import { api } from "@/convex/_generated/api";
import { dayKey } from "@/lib/insights";
import {
  PIXEL_MONTHS,
  pixelStart,
  yearPixels,
  type PixelCheckin,
  type PixelMetric,
} from "@/lib/pixels";
import { ENERGY, MOODS } from "./checkin";
import { SectionTitle } from "./ui";

const LEFT = 30;
const CELL_W = 8;
const PITCH_X = 10;
const CELL_H = 12;
const PITCH_Y = 16;
const W = LEFT + 31 * PITCH_X - (PITCH_X - CELL_W);
const H = PIXEL_MONTHS * PITCH_Y - (PITCH_Y - CELL_H);

const METRICS: { id: PixelMetric; label: string; scale: string[] }[] = [
  { id: "mood", label: "Mood", scale: MOODS.map((m) => m.label) },
  { id: "energy", label: "Energy", scale: ENERGY },
  {
    id: "sleep",
    label: "Sleep",
    scale: ["Under 5 h", "5–6 h", "6–7 h", "7–8 h", "8 h+"],
  },
];

const oneDp = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const longDay = (key: string) =>
  new Date(`${key}T12:00:00`).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
const monthName = (year: number, month: number, style: "short" | "long") =>
  new Date(year, month, 15).toLocaleDateString([], { month: style });

function describeValue(value: number | null, metric: PixelMetric) {
  if (value === null) return `No ${metric} logged`;
  if (metric === "sleep") return `${oneDp(value)} h sleep`;
  const v = Math.min(5, Math.max(1, Math.round(value)));
  return metric === "mood"
    ? `${MOODS[v - 1].label}, ${v} of 5`
    : `${ENERGY[v - 1]} energy, ${v} of 5`;
}

// Twelve months of check-ins, a row per month and a cell per day, shaded by
// mood, energy or sleep. Scrub or use the arrow keys to read a single day.
export function YearPixels({ now }: { now: number }) {
  const today = dayKey(new Date(now));
  const checkins = useQuery(api.checkins.range, {
    fromDay: pixelStart(today),
    toDay: today,
  });
  if (!checkins) return null;
  return <YearPixelsView today={today} checkins={checkins} />;
}

export function YearPixelsView({
  today,
  checkins,
}: {
  today: string;
  checkins: PixelCheckin[];
}) {
  const [metric, setMetric] = useState<PixelMetric>("mood");
  // [month row, day index] of the day being read, if any.
  const [active, setActive] = useState<[number, number] | null>(null);
  const { months, logged, average, best } = yearPixels(today, checkins, metric);
  const meta = METRICS.find((m) => m.id === metric)!;
  const lastDay = (row: number) =>
    months[row].days.findLastIndex((d) => !d.future);

  const summary = !logged
    ? `No ${metric} logged in the last 12 months yet.`
    : `Average ${metric === "sleep" ? `${oneDp(average!)} h` : `${oneDp(average!)} of 5`} over ${logged} ${metric === "sleep" ? (logged === 1 ? "night" : "nights") : logged === 1 ? "day" : "days"}${best ? ` · best month ${monthName(best.year, best.month, "long")}` : ""}`;
  const shown = active && months[active[0]].days[active[1]];

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    const row = Math.min(
      PIXEL_MONTHS - 1,
      Math.max(0, Math.floor(y / PITCH_Y)),
    );
    const col = Math.max(0, Math.floor((x - LEFT) / PITCH_X));
    setActive([row, Math.min(col, lastDay(row))]);
  };
  const move = (key: string): [number, number] | null => {
    const last = PIXEL_MONTHS - 1;
    if (key === "Home") return [0, 0];
    if (key === "End") return [last, lastDay(last)];
    const [row, col] = active ?? [last, lastDay(last)];
    switch (key) {
      case "ArrowRight":
        if (col < lastDay(row)) return [row, col + 1];
        return row < last ? [row + 1, 0] : [row, col];
      case "ArrowLeft":
        if (col > 0) return [row, col - 1];
        return row > 0 ? [row - 1, lastDay(row - 1)] : [row, col];
      case "ArrowUp":
        return row > 0 ? [row - 1, Math.min(col, lastDay(row - 1))] : null;
      case "ArrowDown":
        return row < last ? [row + 1, Math.min(col, lastDay(row + 1))] : null;
    }
    return null;
  };

  return (
    <section className="card pixels-card" aria-labelledby="pixels-title">
      <SectionTitle
        id="pixels-title"
        title="Year in pixels"
        detail="Every check-in from the last 12 months, one square a day."
        action={
          <span className="icon-tile blue">
            <Grid3x3 size={22} />
          </span>
        }
      />
      <div className="segmented pixels-metric" role="group" aria-label="Show">
        {METRICS.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={metric === m.id}
            onClick={() => setMetric(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="chart-readout pixels-readout" aria-live="polite">
        {shown ? (
          <>
            <strong>{longDay(shown.key)}</strong> ·{" "}
            {describeValue(shown.value, metric)}
          </>
        ) : (
          summary
        )}
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        tabIndex={0}
        aria-label={`${meta.label} by day, last 12 months. ${summary}. Use arrow keys to move between days.`}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          const next = move(e.key);
          if (!next) return;
          e.preventDefault();
          setActive(next);
        }}
      >
        {months.map((m, row) => (
          <g key={m.key}>
            <text
              className="chart-axis-label"
              x={0}
              y={row * PITCH_Y + CELL_H / 2}
              dy="0.32em"
            >
              {monthName(m.year, m.month, "short")}
            </text>
            {m.days.map((d, col) =>
              d.future ? null : (
                <rect
                  key={d.key}
                  className={`pixel pix-${d.step}${d.key === today ? " today" : ""}${active?.[0] === row && active[1] === col ? " active" : ""}`}
                  x={LEFT + col * PITCH_X}
                  y={row * PITCH_Y}
                  width={CELL_W}
                  height={CELL_H}
                  rx={2}
                />
              ),
            )}
          </g>
        ))}
      </svg>
      <ul className="pixels-legend small muted">
        {meta.scale.map((label, i) => (
          <li key={label}>
            <i className={`pix-${i + 1}`} aria-hidden />
            {label}
          </li>
        ))}
        <li>
          <i className="pix-0" aria-hidden />
          Not logged
        </li>
      </ul>
    </section>
  );
}
