"use client";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Weight } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { dayKey } from "@/lib/insights";
import { Empty, SectionTitle, Sheet, useTask } from "./ui";

type Trend = FunctionReturnType<typeof api.checkins.weightTrend>;
type Point = Trend["points"][number];

const kg = (n: number) =>
  `${n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`;
const cm = (n: number) =>
  `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} cm`;
const signed = (n: number, unit: (n: number) => string) =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}${unit(Math.abs(n))}`;
export const shortDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
};

export function rateLine(rate: number | null) {
  if (rate === null) return "Two weeks of weigh-ins show a weekly rate.";
  if (Math.abs(rate) < 0.05) return "Holding steady.";
  return `${signed(Math.round(rate * 10) / 10, kg)} a week.`;
}

export function goalLine(
  trend: Pick<Trend, "goalKg" | "eta" | "ratePerWeek">,
  today: string,
) {
  const goal = trend.goalKg === null ? "" : kg(trend.goalKg);
  switch (trend.eta.kind) {
    case "none":
      return null;
    case "reached":
      return `You're at your goal of ${goal}.`;
    case "flat":
      return trend.ratePerWeek === null
        ? `Goal ${goal}. A date shows after two weeks of weigh-ins.`
        : `Goal ${goal}. No date yet while the trend is flat.`;
    case "away":
      return `Goal ${goal}. The trend is moving away from it.`;
    case "far":
      return `Goal ${goal}. More than two years at this pace.`;
    case "eta": {
      const [y, m, d] = trend.eta.day.split("-").map(Number);
      const when = new Date(y, m - 1, d).toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year:
          trend.eta.day.slice(0, 4) === today.slice(0, 4)
            ? undefined
            : "numeric",
      });
      return `Goal ${goal} around ${when} at this pace.`;
    }
  }
}

// Daily weigh-ins bounce with water and salt; the smoothed trend is what
// moves, so that's the headline and the line.
export function WeightGoalCard({ now }: { now: number }) {
  const today = dayKey(new Date(now));
  const trend = useQuery(api.checkins.weightTrend, { today });
  const [editing, setEditing] = useState(false);
  if (trend === undefined) return null;
  const weighIns = trend.points.filter((p) => p.weightKg !== null).length;
  const goal = goalLine(trend, today);
  const waist =
    trend.waist.length >= 2
      ? `Waist ${cm(trend.waist.at(-1)!.waistCm)}, ${signed(Math.round((trend.waist.at(-1)!.waistCm - trend.waist[0].waistCm) * 10) / 10, cm)} since ${shortDay(trend.waist[0].day)}.`
      : trend.waist.length
        ? `Waist ${cm(trend.waist[0].waistCm)} on ${shortDay(trend.waist[0].day)}.`
        : null;

  return (
    <section className="card weight-goal" aria-labelledby="weight-goal-title">
      <SectionTitle
        id="weight-goal-title"
        title="Weight trend"
        detail={
          weighIns
            ? `Smoothed from ${weighIns} weigh-in${weighIns === 1 ? "" : "s"} in the last 120 days.`
            : "Log your weight in a check-in to see the trend."
        }
        action={
          <span className="icon-tile blue">
            <Weight size={22} />
          </span>
        }
      />
      {trend.trendKg === null ? (
        <Empty>
          Weigh in at the same time each morning for the clearest line.
        </Empty>
      ) : (
        <>
          <div className="weight-hero">
            <p>
              <strong>{kg(trend.trendKg)}</strong>
              <span className="muted small">
                trend
                {trend.latestKg !== null && ` · last ${kg(trend.latestKg)}`}
              </span>
            </p>
            <p className="weight-rate">{rateLine(trend.ratePerWeek)}</p>
          </div>
          {trend.points.length >= 2 && (
            <WeightChart points={trend.points} goalKg={trend.goalKg} />
          )}
        </>
      )}
      {waist && <p className="muted small weight-waist">{waist}</p>}
      <div className="weight-goal-row">
        {goal && <p>{goal}</p>}
        <button
          type="button"
          className="soft-button"
          onClick={() => setEditing(true)}
        >
          {trend.goalKg === null ? "Set a goal" : "Change goal"}
        </button>
      </div>
      <Sheet
        open={editing}
        onClose={() => setEditing(false)}
        title="Weight goal"
      >
        {editing && (
          <GoalForm
            goalKg={trend.goalKg}
            trendKg={trend.trendKg}
            onDone={() => setEditing(false)}
          />
        )}
      </Sheet>
    </section>
  );
}

function GoalForm({
  goalKg,
  trendKg,
  onDone,
}: {
  goalKg: number | null;
  trendKg: number | null;
  onDone: () => void;
}) {
  const setGoal = useMutation(api.coach.setGoalWeight);
  const { run, pending } = useTask();
  const save = async (value: number | null) => {
    if (
      await run(
        () => setGoal({ goalWeightKg: value }),
        value === null ? "Goal removed" : "Goal saved",
      )
    )
      onDone();
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = Number(new FormData(e.currentTarget).get("goal"));
    void save(Math.round(value * 10) / 10);
  };
  return (
    <form className="weight-goal-form" onSubmit={submit}>
      <label>
        Goal weight
        <span className="unit-input">
          <input
            name="goal"
            type="number"
            inputMode="decimal"
            min={30}
            max={300}
            step="any"
            required
            autoFocus
            defaultValue={
              goalKg ?? (trendKg === null ? "" : Math.round(trendKg))
            }
          />
          <span>kg</span>
        </span>
      </label>
      <p className="muted small">
        The date is a projection from your last four weeks, not a promise. A
        pace of 0.25–1% of your weight a week is easier to keep.
      </p>
      <button className="primary-button" disabled={pending}>
        {pending ? "Saving…" : "Save goal"}
      </button>
      {goalKg !== null && (
        <button
          type="button"
          className="text-button danger"
          disabled={pending}
          onClick={() => void save(null)}
        >
          Remove goal
        </button>
      )}
    </form>
  );
}

const W = 320;
const H = 150;
const PAD = { top: 12, right: 12, bottom: 22, left: 36 };

function ticksFor(lo: number, hi: number) {
  const raw = Math.max(0.5, hi - lo) / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const ticks = [];
  for (let t = Math.floor(lo / step) * step; t < hi + step; t += step) {
    ticks.push(Math.round(t * 100) / 100);
    if (t >= hi) break;
  }
  return ticks;
}

export function WeightChart({
  points,
  goalKg,
}: {
  points: Point[];
  goalKg: number | null;
}) {
  const [active, setActive] = useState<number | null>(null);
  if (points.length === 0) return null;
  const values = points.flatMap((p) =>
    p.weightKg === null ? [p.trendKg] : [p.trendKg, p.weightKg],
  );
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  // Draw the goal when it's near enough not to flatten the line.
  const showGoal =
    goalKg !== null &&
    goalKg >= lo - Math.max(2, hi - lo) &&
    goalKg <= hi + Math.max(2, hi - lo);
  if (showGoal) {
    lo = Math.min(lo, goalKg);
    hi = Math.max(hi, goalKg);
  }
  const ticks = ticksFor(lo - 0.3, hi + 0.3);
  const y0 = ticks[0];
  const y1 = ticks.at(-1)!;
  const x = (i: number) =>
    PAD.left +
    (i / Math.max(1, points.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    PAD.top + (1 - (v - y0) / (y1 - y0)) * (H - PAD.top - PAD.bottom);
  const path = points
    .map(
      (p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.trendKg).toFixed(1)}`,
    )
    .join("");
  const shown = active === null ? null : points[active];
  const first = points[0];
  const last = points.at(-1)!;
  const change = Math.round((last.trendKg - first.trendKg) * 10) / 10;
  return (
    <figure className="line-chart weight-chart">
      <figcaption className="chart-head">
        <ul className="chart-legend" aria-hidden>
          <li>
            <span className="legend-dot" /> Weigh-in
          </li>
          <li>
            <span className="legend-line" /> Trend
          </li>
          {showGoal && (
            <li>
              <span className="legend-line goal" /> Goal
            </li>
          )}
        </ul>
        <span className="chart-readout" aria-live="polite">
          {shown ? (
            <>
              <strong>{shortDay(shown.day)}</strong> ·{" "}
              {shown.weightKg === null ? "no weigh-in" : kg(shown.weightKg)} ·
              trend {kg(shown.trendKg)}
            </>
          ) : (
            `${signed(change, kg)} since ${shortDay(first.day)}`
          )}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        tabIndex={0}
        aria-label={`Weight trend from ${kg(first.trendKg)} on ${shortDay(first.day)} to ${kg(last.trendKg)} on ${shortDay(last.day)}.${showGoal ? ` Goal ${kg(goalKg)}.` : ""} Use arrow keys to step through days.`}
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
              {t.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            </text>
          </g>
        ))}
        <text className="chart-axis-label" x={PAD.left} y={H - 4}>
          {shortDay(first.day)}
        </text>
        <text
          className="chart-axis-label"
          x={W - PAD.right}
          y={H - 4}
          textAnchor="end"
        >
          {shortDay(last.day)}
        </text>
        {showGoal && (
          <line
            className="weight-goal-line"
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(goalKg)}
            y2={y(goalKg)}
          />
        )}
        {points.map((p, i) =>
          p.weightKg === null ? null : (
            <circle
              key={p.day}
              className="weight-dot"
              cx={x(i)}
              cy={y(p.weightKg)}
              r={3}
            />
          ),
        )}
        <path d={path} className="line-path" />
        {shown && (
          <>
            <line
              className="chart-crosshair"
              x1={x(active!)}
              x2={x(active!)}
              y1={PAD.top}
              y2={H - PAD.bottom}
            />
            <circle
              className="line-dot active"
              cx={x(active!)}
              cy={y(shown.trendKg)}
              r={4.5}
            />
          </>
        )}
        {points.map((p, i) => {
          const half =
            (W - PAD.left - PAD.right) / Math.max(1, points.length - 1) / 2;
          return (
            <rect
              key={p.day}
              x={x(i) - half}
              y={PAD.top}
              width={half * 2}
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
