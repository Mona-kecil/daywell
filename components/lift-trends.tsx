"use client";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ChartSpline,
  CirclePause,
  MoveRight,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LAPSED_DAYS, STALL_SESSIONS, TREND_WEEKS } from "@/lib/trends";
import { SectionTitle } from "./ui";

type Lift = FunctionReturnType<typeof api.trends.list>["lifts"][number];
type Shown = Exclude<Lift["status"], "early" | "lapsed">;

const STATUS: Record<Shown, { icon: LucideIcon; label: string }> = {
  stalled: { icon: CirclePause, label: "Stalled" },
  slipping: { icon: TrendingDown, label: "Slipping" },
  climbing: { icon: TrendingUp, label: "Climbing" },
  steady: { icon: MoveRight, label: "Holding" },
};
const SHOWN = 5;
const SW = 88;
const SH = 28;

const oneDp = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const displayedValue = (lift: Lift, value: number) =>
  lift.unit === "reps" ? Math.round(value) : Math.round(value * 10) / 10;
const amount = (lift: Lift, value: number) =>
  lift.unit === "reps"
    ? `${displayedValue(lift, value)} reps`
    : `${oneDp(displayedValue(lift, value))} kg`;
const isShown = (lift: Lift): lift is Lift & { status: Shown } =>
  lift.status in STATUS;

function rate(lift: Lift) {
  if (lift.changePct === null) return null;
  if (Math.abs(lift.changePct) < 0.05) return "flat";
  const sign = lift.changePct > 0 ? "+" : "−";
  return `${sign}${oneDp(Math.abs(lift.changePct))}% a week`;
}

function hint(lift: Lift) {
  const latest = displayedValue(lift, lift.points.at(-1)?.value ?? 0);
  const best = displayedValue(lift, lift.best);
  if (lift.status === "stalled")
    return `No new best in ${lift.sessionsSinceBest} sessions. A new rep range or a lighter week often restarts progress.`;
  if (lift.status === "slipping" && best > 0)
    return `${Math.round(((best - latest) / best) * 100)}% under your best of ${amount(lift, lift.best)}.`;
  return null;
}

function Sparkline({ points }: { points: Lift["points"] }) {
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const t0 = points[0].at;
  const span = points.at(-1)!.at - t0 || 1;
  const x = (at: number) => 3 + ((at - t0) / span) * (SW - 6);
  const y = (v: number) =>
    hi === lo ? SH / 2 : 3 + ((hi - v) / (hi - lo)) * (SH - 6);
  const last = points.at(-1)!;
  return (
    <svg
      className="lift-spark"
      viewBox={`0 0 ${SW} ${SH}`}
      width={SW}
      height={SH}
      aria-hidden
    >
      <path
        d={points
          .map(
            (p, i) =>
              `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`,
          )
          .join("")}
      />
      <circle cx={x(last.at)} cy={y(last.value)} r={3} />
    </svg>
  );
}

// Per-exercise estimated max over the last 8 weeks: which lifts still climb
// and which have stopped. Rows open the exercise history.
export function LiftTrendsCard({
  now,
  onOpen,
}: {
  now: number;
  onOpen?: (id: Id<"exercises">) => void;
}) {
  // Rounded so the subscription changes every 5 minutes, not every tick.
  const data = useQuery(api.trends.list, {
    now: Math.ceil(now / 300_000) * 300_000,
  });
  const [all, setAll] = useState(false);
  if (!data || data.lifts.length === 0) return null;
  const main = data.lifts.filter(isShown);
  const early = data.lifts.filter((l) => l.status === "early");
  const lapsed = data.lifts.filter((l) => l.status === "lapsed");
  const shown = all ? main : main.slice(0, SHOWN);
  const stalled = main.filter((l) => l.status === "stalled").length;

  return (
    <section className="card lift-card" aria-labelledby="lift-title">
      <SectionTitle
        id="lift-title"
        title="Lift trends"
        detail={`Best estimated max per session over the last ${TREND_WEEKS} weeks. Stalled means ${STALL_SESSIONS} sessions without a new best.`}
        action={
          <span className="icon-tile green">
            <ChartSpline size={22} />
          </span>
        }
      />
      {main.length > 0 && (
        <p className="small lift-summary">
          {stalled ? (
            <>
              <strong>{stalled}</strong> of {main.length}{" "}
              {main.length === 1 ? "lift has" : "lifts have"} stalled
            </>
          ) : (
            <>
              None of your {main.length}{" "}
              {main.length === 1 ? "lift has" : "lifts have"} stalled
            </>
          )}
        </p>
      )}
      {main.length > 0 && (
        <ul className="lift-list">
          {shown.map((lift) => {
            const { icon: Icon, label } = STATUS[lift.status];
            const latest = lift.points.at(-1)!;
            const change = rate(lift);
            const note = hint(lift);
            const body = (
              <>
                <span className="lift-head">
                  <span className="lift-name">
                    <strong>{lift.name}</strong>
                    <span className={`lift-status ${lift.status}`}>
                      <Icon size={14} aria-hidden />
                      {label}
                    </span>
                  </span>
                  <span className="small muted">
                    {lift.unit === "reps" ? "Best set" : "Est. max"}{" "}
                    <strong className="lift-value">
                      {amount(lift, latest.value)}
                    </strong>
                    {change && ` · ${change}`}
                  </span>
                  {note && <span className="small lift-hint">{note}</span>}
                </span>
                <Sparkline points={lift.points} />
              </>
            );
            return (
              <li key={lift.id}>
                {onOpen ? (
                  <button
                    type="button"
                    onClick={() => onOpen(lift.id)}
                    aria-label={`${lift.name}: ${label.toLowerCase()}, ${lift.unit === "reps" ? "best set" : "estimated max"} ${amount(lift, latest.value)}${change ? `, ${change}` : ""}. ${note ? `${note} ` : ""}Open history`}
                  >
                    {body}
                  </button>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      )}
      {main.length > SHOWN && (
        <button
          type="button"
          className="text-button"
          aria-expanded={all}
          onClick={() => setAll(!all)}
        >
          {all ? "Show fewer" : `Show all ${main.length}`}
        </button>
      )}
      {early.length > 0 && (
        <p className="small muted lift-rest">
          Too new to call (under 3 sessions):{" "}
          {early.map((l) => l.name).join(", ")}
        </p>
      )}
      {lapsed.length > 0 && (
        <p className="small muted lift-rest">
          Not done in {LAPSED_DAYS / 7} weeks:{" "}
          {lapsed.map((l) => l.name).join(", ")}
        </p>
      )}
    </section>
  );
}
