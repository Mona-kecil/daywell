"use client";
import type { FunctionReturnType } from "convex/server";
import { ChevronRight } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { recovery } from "@/lib/recovery";
import { Empty, Progress, Sheet } from "./ui";
import { recoveryHex, useIsDark } from "./body3d";
import type { Exercise } from "./strength";
import { useWeeklyVolume, weekLabel } from "./volume";
import { VOLUME_HIGH, VOLUME_LOW } from "@/lib/volume";

type Muscle = FunctionReturnType<
  typeof api.tracker.overview
>["muscles"][number];

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
      <WeeklySets muscleId={muscle._id} />
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

function WeeklySets({ muscleId }: { muscleId: Id<"muscles"> }) {
  const data = useWeeklyVolume();
  const [active, setActive] = useState<number | null>(null);
  if (!data) return <div className="week-bars loading" aria-busy />;
  const weeks = data.weeks.map((w) => ({
    start: w.start,
    sets: w.perMuscle[muscleId] ?? 0,
  }));
  const row = data.muscles.find((m) => m.id === muscleId);
  const last = weeks.length - 1;
  const max = Math.max(VOLUME_HIGH + 4, ...weeks.map((w) => w.sets));
  const label = (i: number) =>
    i === last ? "This week" : `Week of ${weekLabel(weeks[i].start)}`;
  const sets = (n: number) => `${n} ${n === 1 ? "set" : "sets"}`;
  return (
    <figure className="week-chart">
      <figcaption className="chart-head">
        <span className="small">Working sets per week</span>
        <span className="chart-readout" aria-live="polite">
          {active === null
            ? `${sets(weeks[last].sets)} this week · usually ${Math.round(row?.average ?? 0)}`
            : `${label(active)} · ${sets(weeks[active].sets)}`}
        </span>
      </figcaption>
      <ol
        className="week-bars"
        onPointerLeave={() => setActive(null)}
        // The 10–20 band most people grow on, behind the bars.
        style={
          {
            "--band-lo": `${(VOLUME_LOW / max) * 100}%`,
            "--band-hi": `${(VOLUME_HIGH / max) * 100}%`,
          } as CSSProperties
        }
      >
        {weeks.map((w, i) => (
          <li key={w.start}>
            <button
              type="button"
              aria-label={`${label(i)}: ${sets(w.sets)}`}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              className={active === i ? "active" : ""}
            >
              <span
                className={w.sets ? "" : "zero"}
                style={{
                  height: `${Math.max(w.sets ? 6 : 2, (w.sets / max) * 100)}%`,
                }}
              />
            </button>
          </li>
        ))}
      </ol>
      <div className="week-axis" aria-hidden>
        <span>{weekLabel(weeks[0].start)}</span>
        <span>
          {VOLUME_LOW}–{VOLUME_HIGH} band
        </span>
        <span>This week</span>
      </div>
    </figure>
  );
}
