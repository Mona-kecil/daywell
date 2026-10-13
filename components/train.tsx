"use client";
import { useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Trash2, SlidersHorizontal, Check, Dumbbell } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { localDateTimeValue } from "@/lib/day";
import { recovery } from "@/lib/recovery";
import { Empty, Progress, SectionTitle, useTask } from "./ui";
type Muscle = FunctionReturnType<
  typeof api.tracker.overview
>["muscles"][number];
function MuscleCard({
  muscle,
  now,
  editing,
}: {
  muscle: Muscle;
  now: number;
  editing: boolean;
}) {
  const setCooldown = useMutation(api.tracker.setCooldown);
  const { run, pending } = useTask();
  const status = recovery(now, muscle.lastTrainedAt, muscle.cooldownHours);
  return (
    <div className="muscle-card">
      <div className="row spaced">
        <h3 className="capitalize">{muscle.name}</h3>
        <span
          className={`small ${status.kind === "recovering" ? "muted" : "green-text"}`}
        >
          {status.label}
        </span>
      </div>
      <Progress
        value={status.fraction}
        label={`${muscle.name} recovery`}
        tone={status.kind === "never" ? "amber" : "green"}
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
          {muscle.cooldownHours}h cooldown
          {muscle.lastTrainedAt !== null
            ? ` · Last trained ${new Date(muscle.lastTrainedAt).toLocaleDateString([], { month: "short", day: "numeric" })}`
            : ""}
        </p>
      )}
    </div>
  );
}
export function Train({ muscles, now }: { muscles: Muscle[]; now: number }) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Id<"muscles">[]>([]);
  const addWorkout = useMutation(api.tracker.addWorkout),
    deleteWorkout = useMutation(api.tracker.deleteWorkout);
  const { results, status, loadMore } = usePaginatedQuery(
    api.tracker.workoutHistory,
    {},
    { initialNumItems: 10 },
  );
  const { run, pending } = useTask();
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
            if (
              await run(
                () =>
                  addWorkout({
                    muscleIds: selected,
                    trainedAt: new Date(String(data.get("at"))).getTime(),
                    note: String(data.get("note")),
                  }),
                "Workout saved",
              )
            ) {
              setSelected([]);
              form.reset();
            }
          }}
        >
          <fieldset>
            <legend>What did you train?</legend>
            <div className="muscle-picker">
              {muscles.map((m) => (
                <button
                  type="button"
                  key={m._id}
                  className={selected.includes(m._id) ? "selected" : ""}
                  aria-pressed={selected.includes(m._id)}
                  onClick={() =>
                    setSelected((ids) =>
                      ids.includes(m._id)
                        ? ids.filter((id) => id !== m._id)
                        : [...ids, m._id],
                    )
                  }
                >
                  {selected.includes(m._id) && <Check size={14} />}
                  {m.name}
                </button>
              ))}
            </div>
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
            placeholder="Sets, reps, or how the session went…"
            maxLength={2000}
            rows={2}
          />
          <button
            className="primary-button full"
            disabled={pending || !selected.length}
          >
            {pending ? "Saving…" : "Save workout"}
          </button>
        </form>
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
          {muscles.map((m) => (
            <MuscleCard key={m._id} muscle={m} now={now} editing={editing} />
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
