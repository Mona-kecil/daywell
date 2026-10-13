"use client";
import { useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  Trash2,
  SlidersHorizontal,
  Check,
  Dumbbell,
  Plus,
  ChevronRight,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { localDateTimeValue } from "@/lib/day";
import { recovery } from "@/lib/recovery";
import { Empty, Progress, SectionTitle, useTask } from "./ui";
import {
  BodyModel,
  muscleKey,
  recoveryHex,
  useIsDark,
  type MuscleKey,
} from "./body3d";
import {
  EntryEditor,
  ExerciseHistorySheet,
  ExercisePicker,
  SessionSets,
  type EntryDraft,
  type Exercise,
} from "./strength";
import { MuscleSheet } from "./muscle-sheet";
import { RestTimer, startRest, type Rest } from "./rest-timer";
type Muscle = FunctionReturnType<
  typeof api.tracker.overview
>["muscles"][number];
function MuscleCard({
  muscle,
  now,
  editing,
  weekSets,
  onOpen,
}: {
  muscle: Muscle;
  now: number;
  editing: boolean;
  weekSets: number | undefined;
  onOpen: () => void;
}) {
  const setCooldown = useMutation(api.tracker.setCooldown);
  const { run, pending } = useTask();
  const status = recovery(now, muscle.lastTrainedAt, muscle.cooldownHours);
  const dark = useIsDark();
  const readyAt =
    status.kind === "recovering" && muscle.lastTrainedAt !== null
      ? new Date(muscle.lastTrainedAt + muscle.cooldownHours * 3_600_000)
      : null;
  return (
    <div className="muscle-card">
      <div className="row spaced">
        <button
          type="button"
          className="muscle-name-button"
          aria-haspopup="dialog"
          onClick={onOpen}
        >
          <h3 className="capitalize">{muscle.name}</h3>
          <ChevronRight size={16} aria-hidden />
        </button>
        <span
          className={`small ${status.kind === "recovering" ? "muted" : "green-text"}`}
        >
          {status.label}
        </span>
      </div>
      <Progress
        value={status.kind === "never" ? 0 : status.fraction}
        label={`${muscle.name} recovery`}
        color={recoveryHex(status, dark)}
      />
      {editing ? (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            void run(
              () =>
                setCooldown({
                  id: muscle._id,
                  hours: Number(data.get("hours")),
                }),
              "Cooldown saved",
            );
          }}
        >
          <label className="small muted" htmlFor={`cooldown-${muscle._id}`}>
            Cooldown hours
          </label>
          <input
            id={`cooldown-${muscle._id}`}
            name="hours"
            type="number"
            min="0.5"
            max="720"
            step="0.5"
            defaultValue={muscle.cooldownHours}
            required
          />
          <button
            className="icon-button"
            disabled={pending}
            aria-label={`Save ${muscle.name} cooldown`}
          >
            <Check size={19} />
          </button>
        </form>
      ) : (
        <p className="muted small">
          {readyAt
            ? `Ready ${readyAt.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })} · `
            : ""}
          {muscle.cooldownHours}h cooldown
          {weekSets
            ? ` · ${weekSets} ${weekSets === 1 ? "set" : "sets"} this week`
            : ""}
          {!readyAt && muscle.lastTrainedAt !== null
            ? ` · Last trained ${new Date(muscle.lastTrainedAt).toLocaleDateString([], { month: "short", day: "numeric" })}`
            : ""}
        </p>
      )}
    </div>
  );
}
// Soonest-ready recovering muscles first, then ready, then never trained.
function byReadiness(muscles: Muscle[], now: number) {
  const rank = (m: Muscle) => {
    const status = recovery(now, m.lastTrainedAt, m.cooldownHours);
    if (status.kind === "recovering")
      return m.lastTrainedAt! + m.cooldownHours * 3_600_000 - now;
    return status.kind === "ready" ? Number.MAX_SAFE_INTEGER : Infinity;
  };
  return [...muscles].sort((a, b) => rank(a) - rank(b));
}
export function Train({ muscles, now }: { muscles: Muscle[]; now: number }) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Id<"muscles">[]>([]);
  const [entries, setEntries] = useState<EntryDraft[]>([]);
  const [picking, setPicking] = useState(false);
  const [historyFor, setHistoryFor] = useState<Exercise | null>(null);
  const [detailId, setDetailId] = useState<Id<"muscles"> | null>(null);
  const [rest, setRest] = useState<Rest | null>(null);
  const detail = muscles.find((m) => m._id === detailId) ?? null;
  const addWorkout = useMutation(api.tracker.addWorkout),
    logSession = useMutation(api.strength.logSession),
    deleteWorkout = useMutation(api.tracker.deleteWorkout);
  const exercises = useQuery(api.strength.exercises, {});
  // Sets logged this minute still count: the window ends at the next minute.
  const weekly = useQuery(api.strength.weeklyMuscleSets, {
    now: Math.ceil(now / 60_000) * 60_000,
  });
  const weekSets = new Map(weekly?.map((w) => [w.muscleId, w.sets]));
  const { results, status, loadMore } = usePaginatedQuery(
    api.tracker.workoutHistory,
    {},
    { initialNumItems: 10 },
  );
  const { run, pending } = useTask();
  const toggle = (id: Id<"muscles">) =>
    setSelected((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  const byKey = new Map(
    muscles.flatMap((m) => {
      const key = muscleKey(m.name);
      return key ? [[key, m] as const] : [];
    }),
  );
  const states = Object.fromEntries(
    [...byKey].map(([key, m]) => [
      key,
      recovery(now, m.lastTrainedAt, m.cooldownHours),
    ]),
  );
  const addEntry = (exercise: Exercise) => {
    setEntries((list) => [
      ...list,
      { exercise, sets: [{ reps: 8, weightKg: 20 }], fresh: true },
    ]);
    const ids = muscles
      .filter((m) => exercise.muscles.includes(m.name))
      .map((m) => m._id);
    setSelected((cur) => [...new Set([...cur, ...ids])]);
  };
  const setCount = entries.reduce((n, e) => n + e.sets.length, 0);
  const selectedKeys = [...byKey]
    .filter(([, m]) => selected.includes(m._id))
    .map(([key]) => key);
  return (
    <>
      <section className="page-heading">
        <div className="eyebrow">TRAIN & REST</div>
        <h1>Training & recovery.</h1>
        <p className="muted">Log workouts and check each muscle group.</p>
      </section>
      <section className="card">
        <SectionTitle title="Log a workout" action={<Dumbbell size={22} />} />
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = new FormData(form);
            const trainedAt = new Date(String(data.get("at"))).getTime();
            const note = String(data.get("note"));
            if (
              await run(
                () =>
                  entries.length
                    ? logSession({
                        trainedAt,
                        note,
                        entries: entries.map((en) => ({
                          exerciseId: en.exercise._id,
                          sets: en.sets.map(({ reps, weightKg }) => ({
                            reps,
                            weightKg,
                          })),
                        })),
                        extraMuscleIds: selected,
                      })
                    : addWorkout({ muscleIds: selected, trainedAt, note }),
                entries.length
                  ? `Saved ${setCount} ${setCount === 1 ? "set" : "sets"}`
                  : "Workout saved",
              )
            ) {
              setSelected([]);
              setEntries([]);
              form.reset();
            }
          }}
        >
          <BodyModel
            states={states}
            selected={selectedKeys}
            onToggle={(key: MuscleKey) => {
              const m = byKey.get(key);
              if (m) toggle(m._id);
            }}
          />
          <fieldset>
            <legend>What did you train?</legend>
            <div className="muscle-picker">
              {muscles.map((m) => (
                <button
                  type="button"
                  key={m._id}
                  className={selected.includes(m._id) ? "selected" : ""}
                  aria-pressed={selected.includes(m._id)}
                  onClick={() => toggle(m._id)}
                >
                  {selected.includes(m._id) && <Check size={14} />}
                  {m.name}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="exercise-entries">
            <legend>
              Exercises <span className="muted">(optional)</span>
            </legend>
            {entries.map((en, i) => (
              <EntryEditor
                key={en.exercise._id}
                entry={en}
                index={i}
                onChange={(sets) =>
                  setEntries((list) =>
                    list.map((x, j) =>
                      j === i ? { ...x, sets, fresh: false } : x,
                    ),
                  )
                }
                onRemove={() =>
                  setEntries((list) => list.filter((_, j) => j !== i))
                }
                onHistory={() => setHistoryFor(en.exercise)}
                onRest={() => setRest(startRest())}
              />
            ))}
            <button
              type="button"
              className="soft-button full"
              disabled={!exercises || entries.length >= 25}
              aria-haspopup="dialog"
              onClick={() => setPicking(true)}
            >
              <Plus size={17} /> Add exercise
            </button>
          </fieldset>
          <label htmlFor="workout-at">When</label>
          <input
            id="workout-at"
            name="at"
            type="datetime-local"
            defaultValue={localDateTimeValue(new Date(now))}
            required
          />
          <label htmlFor="workout-note">
            Note <span className="muted">(optional)</span>
          </label>
          <textarea
            id="workout-note"
            name="note"
            placeholder="How the session went…"
            maxLength={2000}
            rows={2}
          />
          <button
            className="primary-button full"
            disabled={pending || (!selected.length && !entries.length)}
          >
            {pending
              ? "Saving…"
              : setCount
                ? `Save workout · ${setCount} ${setCount === 1 ? "set" : "sets"}`
                : "Save workout"}
          </button>
        </form>
        <RestTimer rest={rest} onChange={setRest} />
        <ExercisePicker
          open={picking}
          onClose={() => setPicking(false)}
          exercises={exercises ?? []}
          muscles={muscles}
          chosen={entries.map((en) => en.exercise._id)}
          onPick={addEntry}
        />
        <MuscleSheet
          muscle={detail}
          now={now}
          exercises={exercises ?? []}
          onClose={() => setDetailId(null)}
          onExercise={setHistoryFor}
        />
        <ExerciseHistorySheet
          exercise={historyFor}
          onClose={() => setHistoryFor(null)}
        />
      </section>
      <section>
        <SectionTitle
          title="Muscle recovery"
          action={
            <button
              className="text-button"
              onClick={() => setEditing(!editing)}
              aria-pressed={editing}
            >
              <SlidersHorizontal size={16} />
              {editing ? "Done" : "Cooldowns"}
            </button>
          }
        />
        <div className="muscle-list">
          {(editing ? muscles : byReadiness(muscles, now)).map((m) => (
            <MuscleCard
              key={m._id}
              muscle={m}
              now={now}
              editing={editing}
              weekSets={weekSets.get(m._id)}
              onOpen={() => setDetailId(m._id)}
            />
          ))}
        </div>
      </section>
      <section className="card">
        <SectionTitle title="Workout history" />
        {results.length === 0 && (
          <Empty>Your first workout will appear here.</Empty>
        )}
        <ul className="entry-list">
          {results.map((w) => (
            <li key={w._id}>
              <div>
                <strong className="capitalize">
                  {w.muscleIds
                    .map(
                      (id) =>
                        muscles.find((m) => m._id === id)?.name ?? "Muscle",
                    )
                    .join(", ")}
                </strong>
                <p className="muted small">
                  {new Date(w.trainedAt).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
                <SessionSets workoutId={w._id} />
                {w.note && <p className="small">{w.note}</p>}
              </div>
              <button
                className="icon-button"
                disabled={pending}
                aria-label="Delete workout"
                onClick={() =>
                  run(() => deleteWorkout({ id: w._id }), "Workout deleted")
                }
              >
                <Trash2 size={18} />
              </button>
            </li>
          ))}
        </ul>
        {status === "CanLoadMore" && (
          <button
            className="secondary-button full"
            onClick={() => loadMore(10)}
          >
            Load older workouts
          </button>
        )}
      </section>
    </>
  );
}
