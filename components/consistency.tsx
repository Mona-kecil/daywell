"use client";
import { CalendarCheck } from "lucide-react";
import { useState } from "react";
import { consistency, type ConsistencyDay, type Day } from "@/lib/insights";

const CELL = 18;
const GAP = 3;
const LEFT = 28;
const TOP = 16;
const PITCH = CELL + GAP;
const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", ""];
const HABITS = [
  ["water", "water goal"],
  ["meals", "meals"],
  ["trained", "training"],
  ["checkedIn", "check-in"],
] as const;

const longDay = (t: number) =>
  new Date(t).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

function describe(c: ConsistencyDay) {
  const hit = HABITS.filter(([k]) => c.habits[k]).map(([, label]) => label);
  return `${longDay(c.startMs)} · ${hit.length ? `${hit.length} of 4: ${hit.join(", ")}` : "Nothing logged"}`;
}

// Thirteen weeks of days, shaded by how many of the four habits each hit.
export function ConsistencyCalendar({
  days,
  waterGoal,
  checkinDays,
}: {
  days: Day[];
  waterGoal: number;
  checkinDays: Set<string>;
}) {
  const [active, setActive] = useState<number | null>(null);
  const {
    cells,
    weeks,
    active: activeDays,
    best,
    current,
  } = consistency(days, waterGoal, checkinDays);
  if (!cells.length) return null;
  const W = LEFT + weeks * PITCH;
  const H = TOP + 7 * PITCH;
  const months = cells.filter(
    (c, i) => i === 0 || new Date(c.startMs).getDate() === 1,
  );
  // Drop the opening partial month when the next label would collide.
  const labels = months.filter(
    (c, i) => !(i === 0 && months[1] && months[1].col - c.col < 3),
  );
  const shown = active === null ? null : cells[active];
  const summary = `Active ${activeDays} of ${cells.length} days · best run ${best} · current ${current}`;
  const move = (key: string) => {
    const step =
      { ArrowRight: 7, ArrowLeft: -7, ArrowDown: 1, ArrowUp: -1 }[key] ?? 0;
    if (key === "Home") return 0;
    if (key === "End") return cells.length - 1;
    if (!step) return null;
    const from = active ?? cells.length - 1;
    const to = from + step;
    return to < 0 || to >= cells.length ? from : to;
  };
  return (
    <figure className="card chart consistency">
      <figcaption className="chart-head">
        <h3>
          <CalendarCheck size={18} aria-hidden /> Consistency
        </h3>
        <span className="chart-readout" aria-live="polite">
          {shown ? describe(shown) : summary}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        tabIndex={0}
        aria-label={`Consistency calendar, last ${cells.length} days. ${summary}. Use arrow keys to move between days.`}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          const next = move(e.key);
          if (next === null) return;
          e.preventDefault();
          setActive(next);
        }}
      >
        {WEEKDAYS.map((label, row) =>
          label ? (
            <text
              key={label}
              className="chart-axis-label"
              x={0}
              y={TOP + row * PITCH + CELL / 2}
              dy="0.32em"
            >
              {label}
            </text>
          ) : null,
        )}
        {labels.map((c) => (
          <text
            key={c.key}
            className="chart-axis-label"
            x={LEFT + c.col * PITCH}
            y={TOP - 5}
          >
            {new Date(c.startMs).toLocaleDateString([], { month: "short" })}
          </text>
        ))}
        {cells.map((c, i) => (
          <rect
            key={c.key}
            className={`cal-cell cal-${c.score}${i === cells.length - 1 ? " today" : ""}${active === i ? " active" : ""}`}
            x={LEFT + c.col * PITCH}
            y={TOP + c.row * PITCH}
            width={CELL}
            height={CELL}
            rx={4}
            onPointerEnter={() => setActive(i)}
            onPointerDown={() => setActive(i)}
          />
        ))}
      </svg>
      <div className="cal-legend small muted" aria-hidden>
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((n) => (
          <i key={n} className={`cal-${n}`} />
        ))}
        <span>More</span>
      </div>
      <p className="small muted">
        Each day counts four habits: reaching your water goal, logging a meal,
        training, and checking in.
      </p>
    </figure>
  );
}
