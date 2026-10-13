"use client";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { recovery } from "@/lib/recovery";
import { Empty, Progress, Sheet } from "./ui";
import { recoveryHex, useIsDark } from "./body3d";
import type { Exercise } from "./strength";

type Muscle = FunctionReturnType<
  typeof api.tracker.overview
>["muscles"][number];

const WEEKS = 8;
const WEEK_MS = 7 * 86_400_000;

export function MuscleSheet({
  muscle,
  now,
  exercises,
  onClose,
  onExercise,
}: {
  muscle: Muscle | null;
  now: number;
  exercises: Exercise[];
  onClose: () => void;
  onExercise: (exercise: Exercise) => void;
}) {
  return (
    <Sheet
      open={muscle !== null}
      onClose={onClose}
      title={muscle ? muscle.name[0].toUpperCase() + muscle.name.slice(1) : ""}
    >
      {muscle && (
        <MuscleDetail
          muscle={muscle}
          now={now}
          exercises={exercises.filter((e) => e.muscles.includes(muscle.name))}
          onExercise={onExercise}
        />
      )}
    </Sheet>
  );
}

function MuscleDetail({
  muscle,
  now,
  exercises,
  onExercise,
}: {
  muscle: Muscle;
  now: number;
  exercises: Exercise[];
  onExercise: (exercise: Exercise) => void;
}) {
  const dark = useIsDark();
  const status = recovery(now, muscle.lastTrainedAt, muscle.cooldownHours);
  // Pin week ends to the minute the sheet opened so queries stay stable.
  const [anchor] = useState(() => Math.ceil(now / 60_000) * 60_000);
  const readyAt =
    muscle.lastTrainedAt !== null
      ? muscle.lastTrainedAt + muscle.cooldownHours * 3_600_000
      : null;
  return (
    <>
      <div className="muscle-status">
        <div className="row spaced">
          <strong className={status.kind === "recovering" ? "" : "green-text"}>
            {status.label}
          </strong>
          <span className="muted small">{muscle.cooldownHours}h cooldown</span>
        </div>
        <Progress
          value={status.kind === "never" ? 0 : status.fraction}
          label={`${muscle.name} recovery`}
          color={recoveryHex(status, dark)}
        />
        <p className="muted small">
          {muscle.lastTrainedAt === null
            ? "Not trained yet."
            : `Last trained ${new Date(muscle.lastTrainedAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${
                readyAt && readyAt > now
                  ? ` · ready ${new Date(readyAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`
                  : ""
              }`}
        </p>
      </div>
      <WeeklySets muscleId={muscle._id} anchor={anchor} />
      <h3 className="sheet-subhead">Exercises</h3>
      {exercises.length === 0 ? (
        <Empty>No exercises target this muscle yet.</Empty>
      ) : (
        <ul className="picker-list muscle-exercises">
          {exercises.map((e) => (
            <li key={e._id}>
              <button type="button" onClick={() => onExercise(e)}>
                <span>
                  <strong>{e.name}</strong>
                  <span className="muted small capitalize">
                    {e.muscles.join(" · ")}
                  </span>
                </span>
                <ChevronRight size={18} aria-label="See history" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function WeeklySets({
  muscleId,
  anchor,
}: {
  muscleId: Id<"muscles">;
  anchor: number;
}) {
  const ends = Array.from(
    { length: WEEKS },
    (_, i) => anchor - (WEEKS - 1 - i) * WEEK_MS,
  );
  const counts = ends.map((end) => {
    // A fixed number of hook calls: one per week in the window.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const week = useQuery(api.strength.weeklyMuscleSets, { now: end });
    return week?.find((w) => w.muscleId === muscleId)?.sets;
  });
  const [active, setActive] = useState<number | null>(null);
  if (counts.some((c) => c === undefined))
    return <div className="week-bars loading" aria-busy />;
  const values = counts as number[];
  const max = Math.max(10, ...values);
  const label = (i: number) =>
    i === WEEKS - 1
      ? "Last 7 days"
      : `Week to ${new Date(ends[i]).toLocaleDateString([], { month: "short", day: "numeric" })}`;
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <figure className="week-chart">
      <figcaption className="chart-head">
        <span className="small">Sets per week</span>
        <span className="chart-readout" aria-live="polite">
          {active === null
            ? `${values[WEEKS - 1]} in the last 7 days · ${Math.round(total / WEEKS)} a week on average`
            : `${label(active)} · ${values[active]} ${values[active] === 1 ? "set" : "sets"}`}
        </span>
      </figcaption>
      <ol className="week-bars" onPointerLeave={() => setActive(null)}>
        {values.map((v, i) => (
          <li key={ends[i]}>
            <button
              type="button"
              aria-label={`${label(i)}: ${v} ${v === 1 ? "set" : "sets"}`}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              className={active === i ? "active" : ""}
            >
              <span
                className={v ? "" : "zero"}
                style={{ height: `${Math.max(v ? 6 : 2, (v / max) * 100)}%` }}
              />
            </button>
          </li>
        ))}
      </ol>
      <div className="week-axis" aria-hidden>
        <span>{WEEKS} weeks ago</span>
        <span>Now</span>
      </div>
    </figure>
  );
}
