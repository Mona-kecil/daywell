"use client";
import { useState } from "react";
import { Clock3 } from "lucide-react";
import type { DaySpan } from "@/lib/insights";
import {
  WINDOW_DAYS,
  mealMinutes,
  duration,
  eatingDays,
  eatingSummary,
  type EatingDay,
} from "@/lib/eating";
import { SectionTitle, timeLabel } from "./ui";

const W = 340;
const ROW = 20;
const PAD = { left: 48, right: 10, bottom: 22 };
const MIN_STATS_DAYS = 3;

// A wall-clock minute on any date, for labels like "8:10 AM".
const clock = (minutes: number) => {
  const d = new Date(2026, 0, 1);
  d.setHours(0, Math.round(minutes));
  return timeLabel(d.getTime());
};
const hourLabel = (h: number) =>
  new Date(2026, 0, 1, h % 24).toLocaleTimeString([], { hour: "numeric" });
const dayLabel = (d: EatingDay, today: string, style: "short" | "long") => {
  if (d.key === today) return "Today";
  const date = new Date(d.startMs);
  // Weekday first in both styles: "Fri 2" fits the row label column.
  return style === "short"
    ? `${date.toLocaleDateString([], { weekday: "short" })} ${date.getDate()}`
    : date.toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
};

function describe(d: EatingDay, today: string) {
  const when = dayLabel(d, today, "long");
  const n = d.meals.length;
  if (!n) return `${when} · No meals logged`;
  if (n === 1) return `${when} · 1 meal at ${timeLabel(d.meals[0])}`;
  const first = d.meals[0];
  const last = d.meals.at(-1)!;
  return `${when} · ${n} meals · ${timeLabel(first)}–${timeLabel(last)}, ${duration(last - first)}`;
}

// First to last logged meal on each of the last two weeks, with the usual
// window and overnight gap. Descriptive only; no target is implied.
export function EatingWindowCard({
  meals,
  days: spans,
  today,
}: {
  meals: { at: number }[];
  days: DaySpan[];
  today: string;
}) {
  const days = eatingDays(
    spans.slice(-WINDOW_DAYS),
    meals.map((m) => m.at),
  );
  const summary = eatingSummary(days, today);
  const latest = days.findLastIndex((d) => d.meals.length);
  const [active, setActive] = useState<number | null>(null);
  const shown = active ?? latest;

  const all = days.flatMap((d) => mealMinutes(d.meals));
  const lo = Math.min(6 * 60, Math.floor(Math.min(...all) / 60) * 60);
  const hi = Math.max(22 * 60, Math.ceil(Math.max(...all) / 60) * 60);
  const H = days.length * ROW + PAD.bottom;
  const x = (min: number) =>
    PAD.left + ((min - lo) / (hi - lo)) * (W - PAD.left - PAD.right);
  const ticks = [0, 6, 12, 18, 24].filter((h) => h * 60 >= lo && h * 60 <= hi);

  const pick = (clientY: number, box: DOMRect) => {
    const i = Math.floor(((clientY - box.top) / box.height) * (H / ROW));
    setActive(Math.min(days.length - 1, Math.max(0, i)));
  };

  return (
    <section className="card eating-card" aria-labelledby="eating-title">
      <SectionTitle
        id="eating-title"
        title="Eating window"
        detail={`First to last logged meal, last ${WINDOW_DAYS} days.`}
        action={
          <span className="icon-tile amber">
            <Clock3 size={22} />
          </span>
        }
      />
      {latest < 0 ? (
        <p className="small muted eating-empty">
          Meal times show here once you log meals.
        </p>
      ) : (
        <>
          {summary.loggedDays >= MIN_STATS_DAYS ? (
            <dl className="eating-stats">
              <div>
                <dt>Usual window</dt>
                <dd>
                  {summary.windowMs === null ? "–" : duration(summary.windowMs)}
                </dd>
              </div>
              <div>
                <dt>Overnight gap</dt>
                <dd>
                  {summary.fastMs === null ? "–" : duration(summary.fastMs)}
                </dd>
              </div>
              <div>
                <dt>First meal</dt>
                <dd>
                  {summary.firstMeal === null ? "–" : clock(summary.firstMeal)}
                </dd>
              </div>
              <div>
                <dt>Last meal</dt>
                <dd>
                  {summary.lastMeal === null ? "–" : clock(summary.lastMeal)}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="small muted eating-empty">
              Usual times appear after meals on {MIN_STATS_DAYS} days.
            </p>
          )}
          <figure className="eating-chart">
            <figcaption className="chart-readout" aria-live="polite">
              {describe(days[shown], today)}
            </figcaption>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              tabIndex={0}
              aria-label={`Meal times for the last ${WINDOW_DAYS} days. Use the up and down arrow keys to step through days.`}
              onPointerMove={(e) =>
                pick(e.clientY, e.currentTarget.getBoundingClientRect())
              }
              onPointerDown={(e) =>
                pick(e.clientY, e.currentTarget.getBoundingClientRect())
              }
              onPointerLeave={() => setActive(null)}
              onBlur={() => setActive(null)}
              onKeyDown={(e) => {
                const step =
                  e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
                if (!step) return;
                e.preventDefault();
                setActive((i) =>
                  Math.min(days.length - 1, Math.max(0, (i ?? shown) + step)),
                );
              }}
            >
              <g className="chart-gridline">
                {ticks.map((h) => (
                  <g key={h}>
                    <line
                      x1={x(h * 60)}
                      x2={x(h * 60)}
                      y1={0}
                      y2={days.length * ROW}
                    />
                    <text
                      x={x(h * 60)}
                      y={days.length * ROW + 14}
                      textAnchor="middle"
                    >
                      {hourLabel(h)}
                    </text>
                  </g>
                ))}
              </g>
              {days.map((d, i) => {
                const cy = i * ROW + ROW / 2;
                const mins = mealMinutes(d.meals);
                return (
                  <g
                    key={d.key}
                    className={`eating-row${i === shown ? " active" : ""}${d.key === today ? " today" : ""}`}
                  >
                    <rect
                      className="eating-hit"
                      x={0}
                      y={i * ROW}
                      width={W}
                      height={ROW}
                      rx={6}
                    />
                    <text
                      className="eating-day"
                      x={PAD.left - 8}
                      y={cy}
                      dy="0.32em"
                      textAnchor="end"
                    >
                      {dayLabel(d, today, "short")}
                    </text>
                    {mins.length > 1 && (
                      <rect
                        className="eating-span"
                        x={x(mins[0])}
                        y={cy - 3}
                        width={x(mins.at(-1)!) - x(mins[0])}
                        height={6}
                        rx={3}
                      />
                    )}
                    {mins.map((m, j) => (
                      <circle
                        key={j}
                        className="eating-meal"
                        cx={x(m)}
                        cy={cy}
                        r={4}
                      />
                    ))}
                  </g>
                );
              })}
            </svg>
          </figure>
        </>
      )}
    </section>
  );
}
