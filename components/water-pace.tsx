"use client";
import { useState } from "react";
import { WATER_DAY, waterPace } from "@/lib/coach";
import { timeLabel } from "./ui";

const W = 320;
const H = 150;
const PAD = { top: 14, right: 14, bottom: 22, left: 40 };
const DAY = 24 * 60;

type Drink = { _id: string; at: number; amountMl: number };

const ml = (n: number) => `${Math.round(n).toLocaleString()} ml`;

// Cumulative intake through the day against the coach's even pace.
export function WaterPace({
  entries,
  goal,
  now,
}: {
  entries: Drink[];
  goal: number;
  now: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const minutes = (t: number) => (t - midnight) / 60_000;
  const nowMin = Math.min(DAY, minutes(now));
  const drinks = [...entries]
    .sort((a, b) => a.at - b.at)
    .reduce<(Drink & { min: number; total: number })[]>(
      (out, e) => [
        ...out,
        {
          ...e,
          min: minutes(e.at),
          total: (out.at(-1)?.total ?? 0) + e.amountMl,
        },
      ],
      [],
    );
  const total = drinks.at(-1)?.total ?? 0;
  const top = Math.max(goal, total) * 1.08;
  const x = (m: number) => PAD.left + (m / DAY) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
  // A step line: flat between drinks, rising at each one, ending at now.
  const path = [
    `M${x(0)},${y(0)}`,
    ...drinks.flatMap((d) => [`H${x(d.min)}`, `V${y(d.total)}`]),
    `H${x(nowMin)}`,
  ].join("");
  const due = goal * waterPace(nowMin);
  const gap = total - due;
  const summary =
    total >= goal
      ? `Goal reached · ${ml(total)}`
      : due === 0
        ? `${ml(total)} so far · pacing starts at ${timeLabel(midnight + WATER_DAY.start * 60_000)}`
        : Math.abs(gap) < goal * 0.05
          ? `On pace · ${ml(total)} of ${ml(due)} due by now`
          : gap > 0
            ? `${ml(gap)} ahead of pace`
            : `${ml(-gap)} behind pace`;
  const shown = active === null ? null : drinks[active];
  const hours = [0, 6, 12, 18, 24];
  return (
    <figure className="card chart water-pace">
      <figcaption className="chart-head">
        <h3>Pace</h3>
        <span className="chart-readout" aria-live="polite">
          {shown
            ? `${timeLabel(shown.at)} · +${ml(shown.amountMl)} · ${ml(shown.total)} total`
            : summary}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        tabIndex={drinks.length ? 0 : -1}
        aria-label={`Water through today. ${summary}.${drinks.length ? " Use arrow keys to step through drinks." : ""}`}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          const step =
            e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
          if (!step || !drinks.length) return;
          e.preventDefault();
          setActive((i) =>
            Math.min(
              drinks.length - 1,
              Math.max(
                0,
                i === null ? (step > 0 ? 0 : drinks.length - 1) : i + step,
              ),
            ),
          );
        }}
      >
        <g className="chart-gridline">
          <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} />
          <text x={PAD.left - 6} y={y(0)} dy="0.32em" textAnchor="end">
            0
          </text>
        </g>
        <g className="water-goal">
          <line x1={PAD.left} x2={W - PAD.right} y1={y(goal)} y2={y(goal)} />
          <text x={PAD.left - 6} y={y(goal)} dy="0.32em" textAnchor="end">
            {goal >= 1000 ? `${goal / 1000}L` : goal}
          </text>
        </g>
        {hours.map((h) => (
          <text
            key={h}
            className="chart-axis-label"
            x={x(h * 60)}
            y={H - 6}
            textAnchor={h === 0 ? "start" : h === 24 ? "end" : "middle"}
          >
            {new Date(midnight + h * 3_600_000).toLocaleTimeString([], {
              hour: "numeric",
            })}
          </text>
        ))}
        <polyline
          className="pace-line"
          points={`${x(0)},${y(0)} ${x(WATER_DAY.start)},${y(0)} ${x(WATER_DAY.end)},${y(goal)} ${x(DAY)},${y(goal)}`}
        />
        <text
          className="chart-axis-label"
          x={x((WATER_DAY.start + WATER_DAY.end) / 2) + 8}
          y={y(goal / 2) + 10}
        >
          even pace
        </text>
        <path d={path} className="water-step" />
        <circle className="now-dot" cx={x(nowMin)} cy={y(total)} r={4} />
        {drinks.map((d, i) => (
          <circle
            key={d._id}
            className={`line-dot${active === i ? " active" : ""}`}
            cx={x(d.min)}
            cy={y(d.total)}
            r={active === i ? 5.5 : 4}
          />
        ))}
        {drinks.map((d, i) => {
          const prev = i ? x(drinks[i - 1].min) : PAD.left;
          const next =
            i < drinks.length - 1 ? x(drinks[i + 1].min) : W - PAD.right;
          const left = i ? (prev + x(d.min)) / 2 : PAD.left;
          return (
            <rect
              key={d._id}
              x={left}
              y={PAD.top}
              width={Math.max(1, (x(d.min) + next) / 2 - left)}
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
