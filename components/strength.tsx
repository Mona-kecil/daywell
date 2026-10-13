"use client";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check, Minus, Plus, Search, Trash2, Trophy, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Empty, Sheet, useTask } from "./ui";
import { LineChart } from "./line-chart";

export type Exercise = FunctionReturnType<
  typeof api.strength.exercises
>[number];
export type SetDraft = { reps: number; weightKg: number };
// `fresh` entries take their sets from the last session once it loads.
export type EntryDraft = {
  exercise: Exercise;
  sets: SetDraft[];
  fresh?: boolean;
};
type MuscleRef = { _id: Id<"muscles">; name: string };

const shortDay = (t: number) =>
  new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
export const kg = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const setLabel = (s: SetDraft) =>
  s.weightKg > 0 ? `${s.reps} × ${kg(s.weightKg)} kg` : `${s.reps} reps`;

// "3 × 8 @ 60 kg" when every set matches, "60 kg × 10, 8, 8" when only the
// weight does, otherwise each set in order.
export function setsSummary(sets: SetDraft[]) {
  const w = sets[0].weightKg;
  const sameWeight = sets.every((s) => s.weightKg === w);
  const sameReps = sets.every((s) => s.reps === sets[0].reps);
  if (sameWeight && sameReps && sets.length > 1)
    return w > 0
      ? `${sets.length} × ${sets[0].reps} @ ${kg(w)} kg`
      : `${sets.length} × ${sets[0].reps}`;
  if (sameWeight && sets.length > 1) {
    const reps = sets.map((s) => s.reps).join(", ");
    return w > 0 ? `${kg(w)} kg × ${reps}` : `${reps} reps`;
  }
  return sets.map(setLabel).join(", ");
}

function Stepper({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const clamp = (n: number) =>
    Math.min(max, Math.max(min, Math.round(n * 100) / 100));
  return (
    <div className="stepper">
      <button
        type="button"
        aria-label={`Less ${label}`}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - step))}
      >
        <Minus size={15} />
      </button>
      <label>
        <span className="sr-only">{label}</span>
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step="any"
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(clamp(n));
          }}
        />
      </label>
      <button
        type="button"
        aria-label={`More ${label}`}
        disabled={value >= max}
        onClick={() => onChange(clamp(value + step))}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}

export function EntryEditor({
  entry,
  index,
  onChange,
  onRemove,
  onHistory,
}: {
  entry: EntryDraft;
  index: number;
  onChange: (sets: SetDraft[]) => void;
  onRemove: () => void;
  onHistory: () => void;
}) {
  const { sets, exercise } = entry;
  const last = useQuery(api.strength.exerciseHistory, {
    exerciseId: exercise._id,
    limit: 1,
  })?.sessions[0];
  const fresh = entry.fresh;
  useEffect(() => {
    if (fresh && last)
      onChange(last.sets.map((s) => ({ reps: s.reps, weightKg: s.weightKg })));
  }, [fresh, last, onChange]);
  const update = (i: number, patch: Partial<SetDraft>) =>
    onChange(sets.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="entry-editor">
      <div className="entry-head">
        <button type="button" className="entry-name" onClick={onHistory}>
          <strong>{exercise.name}</strong>
          <span className="muted small capitalize">
            {exercise.muscles.join(" · ")}
          </span>
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`Remove ${exercise.name}`}
          onClick={onRemove}
        >
          <X size={18} />
        </button>
      </div>
      {last && (
        <div className="entry-last">
          <span className="muted small">
            Last{" "}
            {new Date(last.trainedAt).toLocaleDateString([], {
              month: "short",
              day: "numeric",
            })}
            : {setsSummary(last.sets)}
          </span>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              onChange(
                last.sets.map((s) => ({ reps: s.reps, weightKg: s.weightKg })),
              )
            }
          >
            Repeat
          </button>
        </div>
      )}
      <div className="set-head" aria-hidden>
        <span>Set</span>
        <span>Reps</span>
        <span>kg</span>
      </div>
      <ol className="set-rows" aria-label={`${exercise.name} sets`}>
        {sets.map((s, i) => (
          <li key={i}>
            <span className="set-index" aria-hidden>
              {i + 1}
            </span>
            <Stepper
              label={`set ${i + 1} reps, exercise ${index + 1}`}
              value={s.reps}
              step={1}
              min={1}
              max={100}
              onChange={(reps) => update(i, { reps: Math.round(reps) })}
            />
            <Stepper
              label={`set ${i + 1} kilograms, exercise ${index + 1}`}
              value={s.weightKg}
              step={2.5}
              min={0}
              max={1000}
              onChange={(weightKg) => update(i, { weightKg })}
            />
            <button
              type="button"
              className="icon-button set-remove"
              aria-label={`Remove set ${i + 1}`}
              disabled={sets.length === 1}
              onClick={() => onChange(sets.filter((_, j) => j !== i))}
            >
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="text-button"
        disabled={sets.length >= 20}
        onClick={() => onChange([...sets, { ...sets[sets.length - 1] }])}
      >
        <Plus size={15} /> Add set
      </button>
    </div>
  );
}

export function ExercisePicker({
  open,
  onClose,
  exercises,
  muscles,
  chosen,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  exercises: Exercise[];
  muscles: MuscleRef[];
  chosen: Id<"exercises">[];
  onPick: (exercise: Exercise) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Add exercise">
      <PickerBody
        exercises={exercises}
        muscles={muscles}
        chosen={chosen}
        onPick={(e) => {
          onPick(e);
          onClose();
        }}
      />
    </Sheet>
  );
}

function PickerBody({
  exercises,
  muscles,
  chosen,
  onPick,
}: {
  exercises: Exercise[];
  muscles: MuscleRef[];
  chosen: Id<"exercises">[];
  onPick: (exercise: Exercise) => void;
}) {
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const q = query.trim().toLowerCase();
  const shown = exercises.filter(
    (e) =>
      (!q || e.name.toLowerCase().includes(q)) &&
      (!muscle || e.muscles.includes(muscle)),
  );
  return (
    <div className="picker">
      <label className="search-field">
        <Search size={17} aria-hidden />
        <span className="sr-only">Search exercises</span>
        <input
          type="search"
          placeholder="Search exercises"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="chip-row" role="group" aria-label="Filter by muscle">
        {muscles.map((m) => (
          <button
            key={m._id}
            type="button"
            className="chip capitalize"
            aria-pressed={muscle === m.name}
            onClick={() => setMuscle(muscle === m.name ? null : m.name)}
          >
            {m.name}
          </button>
        ))}
      </div>
      <ul className="picker-list">
        {shown.map((e) => {
          const added = chosen.includes(e._id);
          return (
            <li key={e._id}>
              <button type="button" disabled={added} onClick={() => onPick(e)}>
                <span>
                  <strong>{e.name}</strong>
                  <span className="muted small capitalize">
                    {e.muscles.join(" · ")}
                    {e.custom ? " · custom" : ""}
                  </span>
                </span>
                {added ? <Check size={18} /> : <Plus size={18} />}
              </button>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li>
            <Empty>No exercises match.</Empty>
          </li>
        )}
      </ul>
      {creating ? (
        <CustomExerciseForm
          muscles={muscles}
          initialName={query}
          onCreated={(e) => onPick(e)}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <button
          type="button"
          className="secondary-button full"
          onClick={() => setCreating(true)}
        >
          <Plus size={17} /> Create{" "}
          {query.trim() ? `“${query.trim()}”` : "a custom exercise"}
        </button>
      )}
    </div>
  );
}

function CustomExerciseForm({
  muscles,
  initialName,
  onCreated,
  onCancel,
}: {
  muscles: MuscleRef[];
  initialName: string;
  onCreated: (exercise: Exercise) => void;
  onCancel: () => void;
}) {
  const addExercise = useMutation(api.strength.addExercise);
  const { run, pending } = useTask();
  const [name, setName] = useState(initialName.trim());
  const [targets, setTargets] = useState<Id<"muscles">[]>([]);
  const nameId = useId();
  return (
    <form
      className="custom-exercise"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const id = await addExercise({ name, muscleIds: targets });
          onCreated({
            _id: id,
            name: name.trim(),
            custom: true,
            muscles: muscles
              .filter((m) => targets.includes(m._id))
              .map((m) => m.name),
          });
        }, `Created ${name.trim()}`);
      }}
    >
      <label htmlFor={nameId}>Exercise name</label>
      <input
        id={nameId}
        required
        maxLength={100}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <fieldset>
        <legend>Muscles it works</legend>
        <div className="muscle-picker">
          {muscles.map((m) => {
            const on = targets.includes(m._id);
            return (
              <button
                type="button"
                key={m._id}
                className={on ? "selected" : ""}
                aria-pressed={on}
                onClick={() =>
                  setTargets(
                    on
                      ? targets.filter((t) => t !== m._id)
                      : [...targets, m._id],
                  )
                }
              >
                {on && <Check size={14} />}
                {m.name}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="row form-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="primary-button grow"
          disabled={pending || !name.trim() || targets.length === 0}
        >
          Create and add
        </button>
      </div>
    </form>
  );
}

export function SessionSets({ workoutId }: { workoutId: Id<"workouts"> }) {
  const session = useQuery(api.strength.session, { workoutId });
  if (!session?.entries.length) return null;
  return (
    <ul className="session-sets">
      {session.entries.map((e) => (
        <li key={e.exerciseId}>
          <span>{e.name}</span>{" "}
          <span className="muted">{setsSummary(e.sets)}</span>
        </li>
      ))}
    </ul>
  );
}

export function ExerciseHistorySheet({
  exercise,
  onClose,
}: {
  exercise: { _id: Id<"exercises">; name: string } | null;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={exercise !== null}
      onClose={onClose}
      title={exercise?.name ?? ""}
    >
      {exercise && <ExerciseHistory exerciseId={exercise._id} />}
    </Sheet>
  );
}

function ExerciseHistory({ exerciseId }: { exerciseId: Id<"exercises"> }) {
  const history = useQuery(api.strength.exerciseHistory, {
    exerciseId,
    limit: 30,
  });
  if (!history)
    return (
      <p role="status" className="muted">
        Loading…
      </p>
    );
  if (!history.sessions.length)
    return <Empty>No sets logged yet. Your progress will chart here.</Empty>;
  const weighted = history.prE1rm > 0;
  return (
    <>
      {weighted && (
        <div className="stat-grid pr-stats">
          <div className="stat">
            <span className="muted small">
              <Trophy size={13} /> Best e1RM
            </span>
            <strong>
              {kg(history.prE1rm)}
              <small> kg</small>
            </strong>
            {history.prAt && (
              <span className="muted small">
                {new Date(history.prAt).toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            )}
          </div>
          <div className="stat">
            <span className="muted small">Heaviest set</span>
            <strong>
              {kg(history.prWeightKg)}
              <small> kg</small>
            </strong>
          </div>
          <div className="stat">
            <span className="muted small">Sessions</span>
            <strong>{history.sessions.length}</strong>
          </div>
        </div>
      )}
      {weighted && history.sessions.length > 1 && (
        <LineChart
          className="e1rm-chart"
          title={<span className="small">Estimated 1RM per session</span>}
          points={history.sessions
            .filter((s) => s.bestE1rm > 0)
            .map((s) => ({ key: s.workoutId, t: s.trainedAt, v: s.bestE1rm }))
            .sort((a, b) => a.t - b.t)}
          format={kg}
          summary={`Best ${kg(history.prE1rm)} kg`}
          describe={(p) =>
            `${shortDay(p.t)} · ${kg(p.v)} kg${p.t === history.prAt ? " · PR" : ""}`
          }
          label={`Estimated one-rep max per session; best ${kg(history.prE1rm)} kilograms.`}
          highlight={
            history.sessions.find((s) => s.trainedAt === history.prAt)
              ?.workoutId
          }
        />
      )}
      <h3 className="sheet-subhead">Sessions</h3>
      <ul className="entry-list history-sessions">
        {history.sessions.map((s) => (
          <li key={s.workoutId}>
            <div>
              <strong>
                {new Date(s.trainedAt).toLocaleDateString([], {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
                {s.trainedAt === history.prAt && weighted && (
                  <span className="pill green pr-pill">
                    <Trophy size={11} /> PR
                  </span>
                )}
              </strong>
              <p className="muted small">{setsSummary(s.sets)}</p>
            </div>
            {weighted && (
              <span className="small session-e1rm">
                {kg(s.bestE1rm)} kg
                <span className="muted"> e1RM</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="muted small">
        e1RM estimates your one-rep max from each set (Epley: weight × (1 + reps
        ⁄ 30)).
      </p>
    </>
  );
}
